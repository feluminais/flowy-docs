using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>Everything desktop/fixtures/outline.ts says about the navigator, reproduced by Flowy.Core: the rows, the Flows list, expandTo and the keys.</summary>
public class OutlineTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "outline.json")))!;

    /// <summary>The same pairs test/outline.test.ts sorts: any case, numbers as numbers, and a name that starts another comes first.</summary>
    [Theory]
    [InlineData("alpha", "Auth", -1)]
    [InlineData("step 1", "Step 02", -1)]
    [InlineData("Step 2", "step 10", -1)]
    [InlineData("step 10", "Step 2", 1)]
    [InlineData("Step 02", "Step 2", 0)]
    [InlineData("000", "0", 0)]
    [InlineData("a", "A", 0)]
    [InlineData("a", "a1", -1)]
    [InlineData("a2b", "a10a", -1)]
    public void NamesSortAsInTheExplorerDoes(string a, string b, int expected) => Assert.Equal(expected, Outlines.ByName(a, b));

    private static JsonObject Folders() => Expected()["folders"]!.AsObject();

    public static IEnumerable<object[]> Names() => Folders().Where(kv => kv.Value!["parseError"] is null).Select(kv => new object[] { kv.Key });

    /// <summary>A fixture folder by its name in fixtures.json, or a case that only the outline dump uses (flowdiff).</summary>
    private static Folder Load(string name) =>
        FolderLoader.Load(Path.Combine(Repo.Root, JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "fixtures.json")))![name]?.GetValue<string>() ?? $"desktop/fixtures/cases/{name}/flowy"));

    private static JsonObject Json(OutlineRow r)
    {
        var o = new JsonObject { ["key"] = r.Key, ["kind"] = r.Kind, ["id"] = r.Id, ["depth"] = r.Depth, ["name"] = r.Name, ["external"] = r.External, ["shapes"] = r.Shapes, ["flows"] = r.Flows };
        if (r.Parent is not null) o["parent"] = r.Parent;
        if (r.Type is not null) o["type"] = r.Type;
        if (r.Steps is not null) o["steps"] = r.Steps;
        o["problem"] = r.Problem;
        o["expandable"] = r.Expandable;
        o["expanded"] = r.Expanded;
        o["match"] = r.Match;
        if (r.Linked is not null) o["linked"] = r.Linked;
        return o;
    }

    private static JsonObject Json(FlowRef f)
    {
        var o = new JsonObject { ["id"] = f.Id, ["name"] = f.Name, ["steps"] = f.Steps, ["linked"] = f.Linked, ["folder"] = f.Folder, ["tags"] = Strings(f.Tags) };
        if (f.View is not null) o["view"] = f.View;
        return o;
    }

    private static JsonObject Json(FlowList list) => new()
    {
        ["rows"] = new JsonArray(list.Rows.Select(r => (JsonNode?)(r switch
        {
            FolderRow f => new JsonObject { ["kind"] = "folder", ["key"] = f.Key, ["path"] = f.Path, ["name"] = f.Name, ["depth"] = f.Depth, ["flows"] = f.Flows, ["open"] = f.Open },
            FlowItemRow f => new JsonObject { ["kind"] = "flow", ["key"] = f.Key, ["flow"] = Json(f.Flow), ["depth"] = f.Depth },
            _ => throw new InvalidOperationException($"unknown row {r}"),
        })).ToArray()),
        ["tags"] = new JsonArray(list.Tags.Select(t => (JsonNode?)new JsonObject { ["tag"] = t.Tag, ["count"] = t.Count }).ToArray()),
        ["total"] = list.Total,
        ["shown"] = list.Shown,
    };

    private static JsonArray Strings(IEnumerable<string> items) => new(items.Select(s => (JsonNode?)JsonValue.Create(s)).ToArray());

    private static JsonObject Json(KeyResult r)
    {
        var o = new JsonObject();
        if (r.Focus is not null) o["focus"] = r.Focus;
        if (r.Toggle is { } t) o["toggle"] = new JsonObject { ["id"] = t.Id, ["expand"] = t.Expand };
        if (r.Open is not null) o["open"] = Json(r.Open);
        return o;
    }

    [Theory]
    [MemberData(nameof(Names))]
    public void Rows_and_totals_are_the_TypeScript_ones_in_every_state(string name)
    {
        var folder = Load(name);
        var states = Folders()[name]!["outlines"]!.AsArray();
        Assert.Equal(8, states.Count);
        foreach (var s in states)
        {
            var expanded = s!["expanded"]!.AsArray().Select(e => e!.GetValue<string>()).ToHashSet();
            var actual = Outlines.Build(folder.Model, folder.Problems, expanded, s["filter"]!.GetValue<string>(), s["editing"]!.GetValue<bool>());
            var json = new JsonObject
            {
                ["rows"] = new JsonArray(actual.Rows.Select(r => (JsonNode?)Json(r)).ToArray()),
                ["totals"] = new JsonObject { ["shapes"] = actual.Totals.Shapes, ["flows"] = actual.Totals.Flows, ["problems"] = actual.Totals.Problems },
            };
            Assert.Equal(JsonDump.Pretty(new JsonObject { ["rows"] = s["rows"]!.DeepClone(), ["totals"] = s["totals"]!.DeepClone() }), JsonDump.Pretty(json));
        }
    }

    [Theory]
    [MemberData(nameof(Names))]
    public void The_Flows_list_is_the_one_the_TypeScript_lists_for_every_way_of_asking(string name)
    {
        var folder = Load(name);
        var lists = Folders()[name]!["lists"]!.AsArray();
        Assert.NotEmpty(lists);
        foreach (var ask in lists)
        {
            var closed = ask!["closed"]!.AsArray().Select(c => c!.GetValue<string>()).ToHashSet();
            var tags = ask["tags"]?.AsArray().Select(t => t!.GetValue<string>()).ToList();
            var actual = Outlines.FlowList(folder.Model, new FlowListOptions(ask["editing"]?.GetValue<bool>() ?? false, ask["query"]?.GetValue<string>() ?? "", tags, closed));
            Assert.Equal(JsonDump.Pretty(ask["result"]), JsonDump.Pretty(Json(actual)));
        }
    }

    [Theory]
    [MemberData(nameof(Names))]
    public void ExpandTo_opens_what_the_TypeScript_opens(string name)
    {
        var folder = Load(name);
        foreach (var e in Folders()[name]!["expandTo"]!.AsArray())
        {
            var opened = Outlines.ExpandTo(folder.Model, e!["id"]!.GetValue<string>(), [], e["self"]!.GetValue<bool>()).OrderBy(x => x, StringComparer.Ordinal);
            Assert.Equal(e["opened"]!.AsArray().Select(x => x!.GetValue<string>()), opened);
        }
    }

    // ---- pairs ---------------------------------------------------------------------------------------------------

    /// <summary>Five flows on the compare case's shapes: b tags a, c tags b, and d and e stand alone.</summary>
    private static Model Paired()
    {
        var shapes = Load("compare").Model;
        var steps = new List<Step> { new("web", "api", "x", null) };
        var flows = new IdMap<Flow>();
        flows.Add("e", new Flow("E alone", "shop", steps));
        flows.Add("c", new Flow("C newest", "shop", steps) { CompareRaw = "b" });
        flows.Add("a", new Flow("A oldest", "shop", steps));
        flows.Add("d", new Flow("D other", "shop", steps));
        flows.Add("b", new Flow("B middle", "shop", steps) { CompareRaw = new Dictionary<string, object?> { ["with"] = "a", ["note"] = "n" } });
        return new Model { Objects = shapes.Objects, Connections = shapes.Connections, Flows = flows };
    }

    private static IEnumerable<FlowRef> Listed(FlowList list) => list.Rows.OfType<FlowItemRow>().Select(r => r.Flow);

    private static string ListOf(IEnumerable<FlowRef> flows) => string.Join(" ", flows.Select(f => f.Linked ? $"{f.Id}*" : f.Id));

    [Fact]
    public void A_flow_in_a_pair_is_linked_and_one_that_tags_nothing_and_is_tagged_by_nothing_is_not()
    {
        Assert.Equal("a* b* c* d e", ListOf(Listed(Outlines.FlowList(Paired())))); // a is tagged by b, b by c; d and e stand alone, and the list is in file name order
    }

    [Fact]
    public void A_flow_row_says_whether_it_is_linked_and_a_shape_row_does_not()
    {
        var rows = Outlines.Build(Paired(), [], new HashSet<string> { "root", "shop" }).Rows;
        Assert.Equal(["a", "b", "c", "d", "e"], rows.Where(r => r.Kind == "flow").Select(r => r.Id));
        Assert.Equal([true, true, true, false, false], rows.Where(r => r.Kind == "flow").Select(r => r.Linked));
        Assert.All(rows.Where(r => r.Kind == "shape"), r => Assert.Null(r.Linked));
    }

    [Fact]
    public void Every_key_does_what_it_does_in_the_TypeScript_tree()
    {
        var keys = Expected()["keys"]!;
        var rows = keys["rows"]!.AsArray().Select(r => new OutlineRow(
            r!["key"]!.GetValue<string>(), r["kind"]!.GetValue<string>(), r["id"]!.GetValue<string>(), null, r["depth"]!.GetValue<int>(), r["name"]!.GetValue<string>(),
            null, false, 0, 0, null, false, r["expandable"]!.GetValue<bool>(), r["expanded"]!.GetValue<bool>(), true)).ToList();
        var results = keys["results"]!.AsArray();
        Assert.True(results.Count > 40);
        foreach (var r in results)
            Assert.Equal(JsonDump.Pretty(r!["result"]), JsonDump.Pretty(Json(Outlines.Key(rows, r["focus"]?.GetValue<string>(), r["key"]!.GetValue<string>()))));
        foreach (var r in keys["none"]!.AsArray())
            Assert.Equal(JsonDump.Pretty(r!["result"]), JsonDump.Pretty(Json(Outlines.Key([], null, r["key"]!.GetValue<string>()))));
    }
}
