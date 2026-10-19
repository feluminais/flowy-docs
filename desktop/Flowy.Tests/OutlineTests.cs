using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>Everything desktop/fixtures/outline.ts says about the navigator, reproduced by Flowy.Core: the rows, the flow groups, expandTo and the keys.</summary>
public class OutlineTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "outline.json")))!;

    private static JsonObject Folders() => Expected()["folders"]!.AsObject();

    public static IEnumerable<object[]> Names() => Folders().Where(kv => kv.Value!["parseError"] is null).Select(kv => new object[] { kv.Key });

    private static Folder Load(string name) =>
        FolderLoader.Load(Path.Combine(Repo.Root, JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "fixtures.json")))![name]!.GetValue<string>()));

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
        return o;
    }

    private static JsonObject Json(FlowRef f)
    {
        var o = new JsonObject { ["id"] = f.Id, ["name"] = f.Name, ["steps"] = f.Steps };
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
