using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>Everything desktop/fixtures/outline.ts says about the navigator, reproduced by Flowy.Core: the rows, the flow groups, expandTo and the keys.</summary>
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
        var o = new JsonObject { ["id"] = f.Id, ["name"] = f.Name, ["steps"] = f.Steps, ["linked"] = f.Linked };
        if (f.View is not null) o["view"] = f.View;
        return o;
    }

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
    public void Flows_are_grouped_as_the_TypeScript_groups_them(string name)
    {
        var folder = Load(name);
        var groups = Folders()[name]!["groups"]!.AsArray();
        Assert.NotEmpty(groups);
        foreach (var g in groups)
        {
            var actual = Outlines.Groups(folder.Model, g!["view"]!.GetValue<string>(), g["editing"]!.GetValue<bool>());
            var json = new JsonObject
            {
                ["here"] = new JsonArray(actual.Here.Select(f => (JsonNode?)Json(f)).ToArray()),
                ["elsewhere"] = new JsonArray(actual.Elsewhere.Select(e => (JsonNode?)new JsonObject
                {
                    ["view"] = e.View, ["name"] = e.Name, ["path"] = Strings(e.Path), ["flows"] = new JsonArray(e.Flows.Select(f => (JsonNode?)Json(f)).ToArray()),
                }).ToArray()),
                ["total"] = actual.Total,
            };
            var expected = new JsonObject { ["here"] = g["here"]!.DeepClone(), ["elsewhere"] = g["elsewhere"]!.DeepClone(), ["total"] = g["total"]!.DeepClone() };
            Assert.Equal(JsonDump.Pretty(expected), JsonDump.Pretty(json));
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

    // ---- partners ------------------------------------------------------------------------------------------------

    /// <summary>The flows of one partner case as the dump says them: a model on the compare case's shapes whose flows are replaced.</summary>
    private static Model PartnerModel(JsonNode flows)
    {
        var shapes = Load("compare").Model;
        var map = new IdMap<Flow>();
        var steps = new List<Step> { new("web", "api", "x", null) };
        foreach (var f in flows.AsArray())
        {
            object? raw = f!["compare"] switch { null => null, JsonObject o => o.ToDictionary(kv => kv.Key, kv => (object?)kv.Value!.GetValue<string>()), var v => v.GetValue<string>() };
            map.Add(f["id"]!.GetValue<string>(), new Flow(f["name"]!.GetValue<string>(), f["view"]!.GetValue<string>(), steps) { CompareRaw = raw });
        }
        return new Model { Objects = shapes.Objects, Connections = shapes.Connections, Flows = map };
    }

    private static string ListOf(IEnumerable<FlowRef> flows) => string.Join(" ", flows.Select(f => f.Linked ? $"{f.Id}*" : f.Id));

    public static IEnumerable<object[]> PartnerCases() =>
        Expected()["partners"]!.AsArray().Select((c, i) => new object[] { i, c!["name"]!.GetValue<string>() });

    [Theory]
    [MemberData(nameof(PartnerCases))]
    public void Partners_are_listed_together_as_the_TypeScript_lists_them(int index, string name)
    {
        var expected = Expected()["partners"]![index]!;
        Assert.Equal(name, expected["name"]!.GetValue<string>());
        var model = PartnerModel(expected["flows"]!);
        foreach (var g in expected["groups"]!.AsArray())
        {
            var actual = Outlines.Groups(model, g!["view"]!.GetValue<string>());
            var json = new JsonObject
            {
                ["view"] = g["view"]!.GetValue<string>(),
                ["here"] = new JsonArray(actual.Here.Select(f => (JsonNode?)new JsonObject { ["id"] = f.Id, ["linked"] = f.Linked }).ToArray()),
                ["elsewhere"] = new JsonArray(actual.Elsewhere.Select(e => (JsonNode?)new JsonObject
                {
                    ["view"] = e.View, ["flows"] = new JsonArray(e.Flows.Select(f => (JsonNode?)new JsonObject { ["id"] = f.Id, ["linked"] = f.Linked }).ToArray()),
                }).ToArray()),
            };
            Assert.Equal(JsonDump.Pretty(g), JsonDump.Pretty(json));
        }
    }

    private static Model Paired() => PartnerModel(Expected()["partners"]![0]!["flows"]!);

    [Fact]
    public void A_flow_in_a_pair_is_linked_and_one_that_tags_nothing_and_is_tagged_by_nothing_is_not()
    {
        var list = Outlines.Groups(Paired(), "shop").Here;
        Assert.Equal("a* b* c* d e", ListOf(list)); // a is tagged by b, b by c; d and e stand alone
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
    public void A_newer_flow_is_listed_right_after_its_older_partner_and_a_chain_reads_oldest_first()
    {
        var model = PartnerModel(Expected()["partners"]![1]!["flows"]!); // a is named Z oldest, d is A first
        Assert.Equal("d a* b* c* e", ListOf(Outlines.Groups(model, "shop").Here)); // the chain moves together to where its first member by name (B middle) sorts, oldest first
    }

    [Fact]
    public void A_flow_tagged_by_many_lists_them_in_key_order_and_a_mutual_pair_lists_once_each()
    {
        var many = PartnerModel(Expected()["partners"]![2]!["flows"]!); // b and c both tag a
        Assert.Equal("a* c* b* d e", ListOf(Outlines.Groups(many, "shop").Here)); // c comes before b in the keys
        var mutual = PartnerModel(Expected()["partners"]![3]!["flows"]!); // a and b tag each other, c tags b
        Assert.Equal("a* b* c* d e", ListOf(Outlines.Groups(mutual, "shop").Here));
    }

    [Fact]
    public void A_loop_of_tags_lists_every_flow_once_from_its_first_member_the_same_way_every_time()
    {
        var model = PartnerModel(Expected()["partners"]![4]!["flows"]!); // a -> b -> c -> a: nothing is oldest
        var ids = Outlines.Groups(model, "shop").Here.Select(f => f.Id).ToList();
        Assert.Equal(["a", "c", "b", "d", "e"], ids);
        Assert.Equal(ids, Outlines.Groups(model, "shop").Here.Select(f => f.Id));
    }

    [Fact]
    public void Flows_with_no_links_keep_their_order_exactly()
    {
        var model = PartnerModel(Expected()["partners"]![5]!["flows"]!);
        var list = Outlines.Groups(model, "shop").Here;
        Assert.Equal("a b c d e", ListOf(list));
    }

    [Fact]
    public void Partners_on_different_views_stay_in_their_own_groups_each_marked_linked()
    {
        var model = PartnerModel(Expected()["partners"]![6]!["flows"]!); // c plays at the top, and tags b on shop
        var groups = Outlines.Groups(model, "shop");
        Assert.Equal("a* b* d e", ListOf(groups.Here));
        var top = Assert.Single(groups.Elsewhere);
        Assert.Equal("root", top.View);
        Assert.Equal("c*", ListOf(top.Flows));
    }

    [Fact]
    public void A_tag_to_itself_or_to_a_flow_that_is_not_there_links_nothing()
    {
        var model = PartnerModel(Expected()["partners"]![7]!["flows"]!); // d tags d, e tags gone
        Assert.Equal("a* b* c* d e", ListOf(Outlines.Groups(model, "shop").Here));
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
