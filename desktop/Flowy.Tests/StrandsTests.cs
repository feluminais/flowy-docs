using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>
/// The lines between two shapes where a project draws a line for each connection (src/core/strands.ts, views.ts): the words of the setting, how a via is compared, the strands a step
/// can ride, what is wrong with a via and which vias a change of the connections leaves pointing at nothing (desktop/fixtures/pairs.ts). The strands themselves, the line each step rides
/// and the problems of the folder are in the folder dump of the same case (ParityTests).
/// </summary>
public class StrandsTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "pair-lines.json")))!;

    private static Model ModelOf(JsonNode files) => EditDoc.FromFiles(files.AsObject().ToDictionary(f => f.Key, f => f.Value!.GetValue<string>()));

    private static (string, string) Placed(JsonNode n) => (n[0]!.GetValue<string>(), n[1]!.GetValue<string>());

    private static List<string> Ids(JsonNode n) => n.AsArray().Select(i => i!.GetValue<string>()).ToList();

    [Fact]
    public void The_two_modes_and_the_words_of_the_setting_are_the_ones_the_TypeScript_has()
    {
        var e = Expected();
        Assert.Equal(Ids(e["modes"]!), Names.PairModes);
        Assert.Equal(Names.PairsField, e["field"]!.GetValue<string>());
        foreach (var mode in Names.PairModes) Assert.Equal(e["names"]![mode]!.GetValue<string>(), Names.PairName(mode));
    }

    [Fact]
    public void A_via_is_compared_trimmed_and_whatever_the_case()
    {
        foreach (var row in Expected()["viaKeys"]!.AsArray())
        {
            var text = row!["value"] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
            Assert.Equal(row["key"]!.GetValue<string>(), Strands.ViaKey(text));
        }
    }

    [Fact]
    public void The_strands_a_step_can_ride_are_the_ones_that_run_its_way_then_the_requests_that_run_against_it()
    {
        var e = Expected();
        var model = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "pairs", "flowy")).Model;
        var view = Views.Compute(model, "root");
        foreach (var row in e["candidates"]!.AsArray())
            Assert.Equal(Ids(row!["strands"]!), Strands.Candidates(view, Placed(row["placed"]!)).Select(s => s.Id));
        var merged = ModelOf(e["merged"]!["files"]!);
        Assert.Null(Views.Compute(merged, "root").Strands);
        foreach (var row in e["merged"]!["candidates"]!.AsArray())
            Assert.Empty(Strands.Candidates(Views.Compute(merged, "root"), Placed(row!["placed"]!)));
    }

    [Fact]
    public void A_via_is_wrong_when_it_names_no_connection_between_the_two_shapes_and_nothing_else_is()
    {
        var e = Expected();
        var model = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "pairs", "flowy")).Model;
        var labels = Strands.PairLabels(model, "root");
        var found = labels.OrderBy(kv => kv.Key, StringComparer.Ordinal).ToList();
        var expectedLabels = e["labels"]!.AsArray();
        Assert.Equal(expectedLabels.Count, found.Count);
        foreach (var row in expectedLabels)
        {
            var pair = row!["pair"]!.GetValue<string>();
            Assert.Equal(Ids(row["labels"]!), labels[pair].Order(StringComparer.Ordinal));
        }
        foreach (var row in e["problems"]!.AsArray())
        {
            var step = model.Flows[row!["flow"]!.GetValue<string>()].Steps[row["step"]!.GetValue<int>()];
            var placed = Views.PlaceStep(model, "root", step.From, step.To);
            Assert.Equal(row["problem"]?.GetValue<string>(), Strands.ViaProblem(labels, step, placed));
        }
    }

    [Fact]
    public void A_change_of_the_connections_leaves_the_same_vias_pointing_at_nothing_as_in_the_TypeScript()
    {
        var e = Expected();
        var model = ModelOf(e["before"]!);
        foreach (var change in e["changes"]!.AsArray())
        {
            var broken = Strands.ViaBroken(model, ModelOf(change!["files"]!)).Select(b => $"{b.Flow}:{b.Step}").ToList();
            var expected = change["broken"]!.AsArray().Select(b => $"{b!["flow"]!.GetValue<string>()}:{b["step"]!.GetValue<int>()}").ToList();
            Assert.True(expected.SequenceEqual(broken), $"{change["name"]}: expected [{string.Join(", ", expected)}], got [{string.Join(", ", broken)}]");
        }
    }

    [Fact]
    public void A_project_that_does_not_say_has_merged_lines_and_a_wrong_word_is_merged_too()
    {
        var plain = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "edit", "flowy")).Model;
        Assert.Equal("merged", plain.Pairs);
        Assert.Null(Views.Compute(plain, "root").Strands);
        var bad = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "bad-pairs", "flowy"));
        Assert.Equal("merged", bad.Model.Pairs);
        Assert.Contains(bad.Problems, p => p.Message == "pairs can be merged or separate");
        var separate = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "pairs", "flowy")).Model;
        Assert.Equal("separate", separate.Pairs);
    }
}
