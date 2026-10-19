using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>The C# side of desktop/fixtures/structure.ts: the words and the progress bar of every flow in the groups case must be what the TypeScript core said.</summary>
public class CaptionsTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "captions.json")))!;

    private static JsonArray Strings(IEnumerable<string> values) => new(values.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());

    private static JsonNode CaptionNode(Caption c) => new JsonObject
    {
        ["chip"] = c.Chip,
        ["text"] = c.Text,
        ["tabs"] = Strings(c.Tabs),
        ["tab"] = c.Tab,
        ["lanes"] = Strings(c.Lanes),
        ["marks"] = Strings(c.Marks),
    };

    private static JsonNode ProgressNode(Progress p) => new JsonObject
    {
        ["cols"] = p.Cols,
        ["rows"] = p.Rows,
        ["cells"] = new JsonArray(p.Cells.Select(c => (JsonNode?)new JsonObject { ["stop"] = c.Stop, ["col"] = c.Col, ["row"] = c.Row, ["title"] = c.Title }).ToArray()),
        ["brackets"] = new JsonArray(p.Brackets.Select(b => (JsonNode?)new JsonObject { ["kind"] = b.Kind, ["from"] = b.From, ["to"] = b.To, ["text"] = b.Text, ["title"] = b.Title }).ToArray()),
    };

    [Fact]
    public void Every_flow_says_what_the_TypeScript_core_says()
    {
        var flows = Expected()["flows"]!.AsArray();
        Assert.Equal(6, flows.Count);
        var model = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "groups", "flowy")).Model;
        foreach (var f in flows)
        {
            var id = f!["id"]!.GetValue<string>();
            var flow = model.Flows[id];
            var stops = Structure.Stops(flow);
            Assert.Equal(JsonDump.Pretty(f["captions"]), JsonDump.Pretty(new JsonArray(stops.Select(s => (JsonNode?)CaptionNode(Captions.Of(flow, s))).ToArray())));
            Assert.Equal(JsonDump.Pretty(f["progress"]), JsonDump.Pretty(ProgressNode(Captions.ProgressOf(flow, stops))));
        }
    }

    [Fact]
    public void A_stop_in_no_group_says_nothing()
    {
        var flow = ModelFiles.ParseFlow("f", "name: F\nview: root\nsteps:\n  - { from: a, to: b, text: t }\n");
        var caption = Captions.Of(flow, Assert.Single(Structure.Stops(flow)));
        Assert.Equal(new Caption("", "", [], -1, [], [""]).Chip, caption.Chip);
        Assert.Equal(-1, caption.Tab);
        Assert.Equal([""], caption.Marks);
    }
}
