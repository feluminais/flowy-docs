using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>
/// The C# side of desktop/fixtures/compare.ts: the diff of every pair of flows in desktop/fixtures/cases/flowdiff must be what the TypeScript core made
/// (src/core/flowdiff.ts), and a run file's <c>compare</c> tag must be written in the same bytes as src/core/perf/comparetag.ts writes them.
/// </summary>
public class FlowDiffTests
{
    private static JsonNode Expected(string name) => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", $"{name}.json")))!;

    private static string Word(Change c) => c switch { Change.New => "new", Change.Removed => "removed", _ => "changed" };

    private static JsonObject Sorted(IReadOnlyDictionary<string, Change> marks) =>
        new(marks.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => KeyValuePair.Create(kv.Key, (JsonNode?)JsonValue.Create(Word(kv.Value)))));

    private static JsonObject MarksNode(SideMarks m) => new()
    {
        ["steps"] = new JsonObject(m.Steps.OrderBy(kv => kv.Key).Select(kv => KeyValuePair.Create(kv.Key.ToString(), (JsonNode?)JsonValue.Create(Word(kv.Value))))),
        ["shapes"] = Sorted(m.Shapes),
        ["lines"] = Sorted(m.Lines),
    };

    [Fact]
    public void Every_pair_of_flows_diffs_to_the_marks_the_TypeScript_core_made()
    {
        var expected = Expected("flow-diffs");
        var model = FolderLoader.Load(Path.Combine(Repo.Root, expected["folder"]!.GetValue<string>())).Model;
        var pairs = expected["pairs"]!.AsArray();
        Assert.True(pairs.Count >= 16);
        foreach (var pair in pairs)
        {
            var older = pair!["older"]!.GetValue<string>();
            var newer = pair["newer"]!.GetValue<string>();
            var diff = FlowDiffs.Diff(model.Flows[older], model.Flows[newer]);
            var actual = new JsonObject
            {
                ["older"] = older, ["newer"] = newer, ["related"] = diff.Related,
                ["olderMarks"] = MarksNode(diff.Older), ["newerMarks"] = MarksNode(diff.Newer),
            };
            Assert.Equal(JsonDump.Pretty(pair), JsonDump.Pretty(actual));
        }
    }

    [Fact]
    public void Identical_flows_have_no_marks_and_unrelated_flows_none_either()
    {
        var model = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "flowdiff", "flowy")).Model;
        var same = FlowDiffs.Diff(model.Flows["base"], model.Flows["same"]);
        Assert.True(same.Related);
        Assert.Empty(same.Older.Steps);
        Assert.Empty(same.Newer.Shapes);
        var apart = FlowDiffs.Diff(model.Flows["base"], model.Flows["apart"]);
        Assert.False(apart.Related);
        Assert.Empty(apart.Older.Shapes);
        Assert.Empty(apart.Newer.Lines);
    }

    [Fact]
    public void A_run_files_compare_tag_is_written_in_the_bytes_the_TypeScript_core_writes()
    {
        var cases = Expected("run-compare-text").AsArray();
        Assert.True(cases.Count >= 30);
        foreach (var c in cases)
        {
            var name = c!["name"]!.GetValue<string>();
            var text = c["text"]!.GetValue<string>();
            var tag = c["tag"] is JsonObject t ? new CompareTag(t["with"]!.GetValue<string>(), t["note"]?.GetValue<string>()) : null;
            if (c["error"] is not null)
            {
                Assert.Throws<ParseError>(() => RunCompareText.Set(text, tag));
                continue;
            }
            Assert.True(name is not null);
            Assert.Equal(c["result"]!.GetValue<string>(), RunCompareText.Set(text, tag));
        }
    }

    [Fact]
    public void Setting_a_tag_and_taking_it_out_again_gives_back_the_text()
    {
        const string run = "# a run\nname: r\nunit: req/s\nlevels:\n  - { load: 1 }\n  - { load: 2 }\n";
        var tagged = RunCompareText.Set(run, new CompareTag("before", "Faster\nnow"));
        Assert.EndsWith("compare:\n  with: before\n  note: |-\n    Faster\n    now\n", tagged);
        Assert.Equal(run, RunCompareText.Set(tagged, null));
    }
}
