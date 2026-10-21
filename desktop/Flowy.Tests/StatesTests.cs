using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>
/// The C# side of desktop/fixtures/states.ts: where every shape stands at every stop of every flow that uses states, what is drawn for it, and what the
/// checks say about a bad file must be what the TypeScript core made. The cases live in desktop/fixtures/cases/states, the demo and the showcase.
/// </summary>
public class StatesTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "state-folds.json")))!;

    private static JsonNode? Int(int? n) => n is { } v ? JsonValue.Create(v) : null;

    private static JsonObject StatesNode(IEnumerable<KeyValuePair<string, string>> states) =>
        new(states.Select(kv => KeyValuePair.Create(kv.Key, (JsonNode?)JsonValue.Create(kv.Value))));

    private static JsonObject MarkNode(IEnumerable<KeyValuePair<string, StateMark>> marks) =>
        new(marks.Select(kv => KeyValuePair.Create(kv.Key, (JsonNode?)new JsonObject { ["state"] = kv.Value.State, ["inside"] = kv.Value.Inside })));

    private static JsonNode ProblemNode((int? Step, string Message) p)
    {
        var o = new JsonObject();
        if (p.Step is { } step) o["step"] = step;
        o["message"] = p.Message;
        return o;
    }

    [Fact]
    public void The_six_states_have_the_names_and_the_words_the_TypeScript_core_has()
    {
        var expected = Expected();
        Assert.Equal(JsonDump.Pretty(expected["names"]), JsonDump.Pretty(new JsonArray(States.Names.Select(n => (JsonNode?)JsonValue.Create(n)).ToArray())));
        Assert.Equal(JsonDump.Pretty(expected["labels"]), JsonDump.Pretty(new JsonArray(States.Names.Select(n => (JsonNode?)JsonValue.Create(States.Labels[n])).ToArray())));
        Assert.True(States.IsName("stopped"));
        foreach (var v in new object?[] { "Stopped", "stop", "", null, 3, new List<object?> { "stopped" } }) Assert.False(States.IsName(v), v?.ToString());
    }

    [Fact]
    public void Every_flow_folds_to_the_states_marks_and_problems_the_TypeScript_core_made()
    {
        var folders = Expected()["folders"]!.AsArray();
        Assert.Equal(3, folders.Count);
        var checked_ = 0;
        foreach (var f in folders)
        {
            var folder = f!["folder"]!.GetValue<string>();
            var model = FolderLoader.Load(Path.Combine(Repo.Root, folder)).Model;
            foreach (var expected in f["flows"]!.AsArray())
            {
                var id = expected!["id"]!.GetValue<string>();
                var flow = model.Flows[id];
                var stops = Structure.Stops(flow);
                                Assert.Equal(JsonDump.Pretty(expected["problems"]), JsonDump.Pretty(new JsonArray(States.Problems(flow, stops, shape => model.GetObject(shape) is not null).Select(ProblemNode).ToArray())));

                var at = stops.Select((_, k) => States.At(flow, stops, k)).ToList();
                Assert.Equal(JsonDump.Pretty(expected["at"]), JsonDump.Pretty(new JsonArray(at.Select(s => (JsonNode?)StatesNode(s)).ToArray())));
                Assert.Equal(JsonDump.Pretty(expected["marks"]), JsonDump.Pretty(new JsonArray(at.Select(s => (JsonNode?)MarkNode(States.Marks(model, s))).ToArray())));
                Assert.Equal(JsonDump.Pretty(expected["before"]), JsonDump.Pretty(new JsonArray(stops.Select((_, k) => Int(Structure.StopBefore(stops, k))).ToArray())));
                foreach (var o in expected["outside"]!.AsArray())
                {
                    var k = o!["k"]!.GetValue<int>();
                    Assert.Equal(JsonDump.Pretty(o["states"]), JsonDump.Pretty(StatesNode(States.At(flow, stops, k))));
                    Assert.Equal(JsonDump.Pretty(o["before"]), JsonDump.Pretty(Int(Structure.StopBefore(stops, k))));
                }
                checked_++;
            }
        }
        Assert.True(checked_ >= 9, "the states case has nine flows");
    }

    [Fact]
    public void A_flow_with_no_states_anywhere_folds_to_nothing_and_a_k_that_is_no_stop_gives_the_start()
    {
        var model = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "states", "flowy")).Model;
        var flow = model.Flows["hold"];
        var stops = Structure.Stops(flow);
        Assert.Equal(["stripe"], States.At(flow, stops, -1).Keys.ToArray());
        Assert.Equal(["stripe"], States.At(flow, [], 0).Keys.ToArray());
        var plain = new Flow("F", "shop", [new Step("web", "api", "t", null)]);
        Assert.Empty(States.At(plain, Structure.Stops(plain), 0));
    }

    [Fact]
    public void Hostile_ids_are_data()
    {
        var model = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "states", "flowy")).Model;
        var flow = model.Flows["hostile"];
        var states = States.At(flow, Structure.Stops(flow), 0);
        Assert.Equal("degraded", states["__proto__"]);
        Assert.Empty(States.Marks(model, new Dictionary<string, string> { ["__proto__"] = "stopped", ["constructor"] = "stopped" }));
    }
}
