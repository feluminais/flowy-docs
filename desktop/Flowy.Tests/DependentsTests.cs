using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>src/core/dependents.ts, reproduced: the rows for deleting each shape and each line of some folders, and for targets that go together (desktop/fixtures/dependents.ts).</summary>
public class DependentsTests
{
    private static readonly Dictionary<string, string> Folders = new()
    {
        ["shop"] = "desktop/fixtures/cases/failures/flowy",
        ["plum"] = "docs/demo/flowy",
        ["delete-case"] = "desktop/fixtures/cases/delete/flowy",
        ["states"] = "desktop/fixtures/cases/states/flowy",
    };

    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "dependents.json")))!;

    private static JsonNode? Strings(IEnumerable<string>? items) => items is null ? null : new JsonArray(items.Select(s => (JsonNode?)JsonValue.Create(s)).ToArray());

    private static JsonNode Flat(Dependent r) => JsonDump.Obj(
        ("key", r.Key), ("kind", r.Kind), ("of", r.Of), ("flow", r.Flow), ("step", r.Step), ("ends", Strings(r.Ends)), ("analysis", r.Analysis), ("mode", r.Mode), ("part", r.Part),
        ("child", r.Child),
        ("line", r.Line is null ? null : JsonDump.Obj(("from", r.Line.From), ("to", r.Line.To), ("label", r.Line.Label))),
        ("actions", Strings(r.Actions)), ("emptiesFlow", JsonValue.Create(r.EmptiesFlow)), ("needsDecision", JsonValue.Create(r.NeedsDecision)), ("described", Dependents.Describe(r)));

    private static List<Target> TargetsOf(JsonNode? list) => list!.AsArray().Select(t => t!["line"] is { } l
        ? new Target(Line: new LineTarget(l["from"]!.GetValue<string>(), l["to"]!.GetValue<string>(), l["label"]?.GetValue<string>(), l["all"]!.GetValue<bool>()))
        : new Target(Object: t["object"]!.GetValue<string>())).ToList();

    [Theory]
    [InlineData("shop")]
    [InlineData("plum")]
    [InlineData("delete-case")]
    [InlineData("states")]
    public void What_depends_on_a_shape_or_a_line_is_found_row_for_row_as_the_TypeScript_finds_it(string name)
    {
        var model = FolderLoader.Load(Path.Combine(Repo.Root, Folders[name])).Model;
        var expected = Expected()[name]!;
        var count = 0;
        foreach (var group in new[] { "objects", "lines", "together" })
            foreach (var entry in expected[group]!.AsArray())
            {
                var targets = TargetsOf(entry!["targets"]);
                var rows = Dependents.Of(model, targets);
                Assert.Equal(JsonDump.Pretty(entry["rows"]), JsonDump.Pretty(new JsonArray(rows.Select(r => (JsonNode?)Flat(r)).ToArray())));
                if (group == "lines") Assert.Equal(JsonDump.Pretty(entry["indices"]), JsonDump.Pretty(new JsonArray(Dependents.LineIndices(model, targets[0].Line!).Select(i => (JsonNode?)JsonValue.Create(i)).ToArray())));
                count++;
            }
        Assert.True(count > 0);
    }

    [Fact]
    public void The_delete_case_has_every_kind_of_row()
    {
        var kinds = Expected()["delete-case"]!["objects"]!.AsArray().SelectMany(e => e!["rows"]!.AsArray()).Select(r => r!["kind"]!.GetValue<string>()).ToHashSet();
        foreach (var kind in new[] { "step", "view", "mode", "scope", "child", "line", "start", "stepState", "affects" }) Assert.Contains(kind, kinds);
    }
}
