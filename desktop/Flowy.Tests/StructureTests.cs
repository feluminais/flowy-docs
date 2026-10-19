using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>The C# side of desktop/fixtures/structure.ts: the runs and the stops of every flow in the groups case must be what the TypeScript core made.</summary>
public class StructureTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "stops.json")))!;

    private static JsonArray Ints(IEnumerable<int> values) => new(values.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());

    private static JsonArray Strings(IEnumerable<string> values) => new(values.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());

    private static JsonNode RunNode(GroupRun r) => new JsonObject
    {
        ["group"] = r.Group,
        ["kind"] = r.Kind,
        ["start"] = r.Start,
        ["end"] = r.End,
        ["lanes"] = new JsonArray(r.Lanes.Select(l => (JsonNode?)new JsonObject { ["label"] = l.Label, ["steps"] = Ints(l.Steps) }).ToArray()),
    };

    // A field that is null is left out, as JSON.stringify leaves out undefined.
    private static JsonNode StopNode(Stop s)
    {
        var o = new JsonObject { ["steps"] = Ints(s.Steps) };
        if (s.Group is not null) o["group"] = s.Group;
        if (s.Kind is not null) o["kind"] = s.Kind;
        if (s.LaneLabels is not null) o["laneLabels"] = Strings(s.LaneLabels);
        if (s.Lanes is not null) o["lanes"] = Ints(s.Lanes);
        o["before"] = Ints(s.Before);
        return o;
    }

    [Fact]
    public void Every_flow_has_the_runs_and_the_stops_the_TypeScript_core_made()
    {
        var flows = Expected()["flows"]!.AsArray();
        Assert.Equal(6, flows.Count);
        var model = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "groups", "flowy")).Model;
        foreach (var f in flows)
        {
            var id = f!["id"]!.GetValue<string>();
            var flow = model.Flows[id];
            Assert.Equal(JsonDump.Pretty(f["runs"]), JsonDump.Pretty(new JsonArray(Structure.Runs(flow).Select(RunNode).ToArray())));
            var stops = Structure.Stops(flow);
            Assert.Equal(JsonDump.Pretty(f["stops"]), JsonDump.Pretty(new JsonArray(stops.Select(StopNode).ToArray())));
            Assert.Equal(JsonDump.Pretty(f["other"]), JsonDump.Pretty(new JsonArray(stops.Select((_, k) => (JsonNode?)Ints(Structure.OtherLaneSteps(stops, k))).ToArray())));
            Assert.Equal(JsonDump.Pretty(f["stopOfStep"]), JsonDump.Pretty(Ints(flow.Steps.Select((_, i) => Structure.StopIndexOf(stops, i)))));
        }
    }

    [Theory]
    [InlineData("\uFEFF", true)]
    [InlineData(" \t\r\n\u00A0\u2028", true)]
    [InlineData("\u0085", false)]
    [InlineData(" a ", false)]
    public void Blank_means_what_JavaScripts_trim_means(string text, bool blank)
    {
        Assert.Equal(blank, Structure.Blank(text));
        Assert.Equal(text.Trim('\uFEFF', ' ', '\t', '\r', '\n', '\u00A0', '\u2028'), Structure.JsTrim(text));
    }

    [Fact]
    public void A_value_that_is_not_text_is_blank()
    {
        Assert.True(Structure.Blank(null));
        Assert.True(Structure.Blank(new List<object?>()));
        Assert.False(Structure.Blank("x"));
    }
}
