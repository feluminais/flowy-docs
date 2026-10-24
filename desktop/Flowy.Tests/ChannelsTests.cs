using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>
/// The C# side of desktop/fixtures/channels.ts: the channels open at every stop of every flow that opens or closes one, the kinds on screen, and what the checks
/// say about a bad file must be what the TypeScript core made. The cases live in desktop/fixtures/cases/channels, the demo and the showcase.
/// </summary>
public class ChannelsTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "channel-folds.json")))!;

    private static JsonNode? Int(int? n) => n is { } v ? JsonValue.Create(v) : null;

    private static JsonNode ChannelNode(Channel c)
    {
        var o = new JsonObject { ["step"] = c.Step, ["kind"] = c.Kind };
        if (c.Name is not null) o["name"] = c.Name;
        o["from"] = c.From;
        o["to"] = c.To;
        o["end"] = c.End;
        o["opening"] = c.Opening;
        o["closing"] = c.Closing;
        return o;
    }

    private static JsonArray ChannelsNode(IEnumerable<Channel> channels) => new(channels.Select(ChannelNode).ToArray());

    private static JsonNode ProblemNode(Finding p)
    {
        var o = new JsonObject();
        if (p.Step is { } step) o["step"] = step;
        o["message"] = p.Message;
        return o;
    }

    [Fact]
    public void The_three_kinds_have_the_names_the_words_and_the_default_ends_the_TypeScript_core_has()
    {
        var expected = Expected();
        Assert.Equal(JsonDump.Pretty(expected["kinds"]), JsonDump.Pretty(new JsonArray(Animations.ChannelKinds.Select(k => (JsonNode?)JsonValue.Create(k)).ToArray())));
        Assert.Equal(JsonDump.Pretty(expected["labels"]), JsonDump.Pretty(new JsonArray(Animations.ChannelKinds.Select(k => (JsonNode?)JsonValue.Create(Channels.Labels[k])).ToArray())));
        Assert.Equal(JsonDump.Pretty(expected["defaultEnd"]), JsonDump.Pretty(new JsonArray(Animations.ChannelKinds.Select(k => (JsonNode?)JsonValue.Create(Animations.DefaultEnd[k])).ToArray())));
        var asked = expected["isKind"]!.AsArray();
        Assert.True(asked.Count >= 8);
        foreach (var v in asked)
        {
            var value = v!["value"] is JsonValue text && text.TryGetValue<string>(out var s) ? s : (object?)v["value"];
            Assert.Equal(v["is"]!.GetValue<bool>(), Animations.IsChannelKind(value));
        }
    }

    [Fact]
    public void Every_flow_folds_to_the_channels_kinds_and_problems_the_TypeScript_core_made()
    {
        var folders = Expected()["folders"]!.AsArray();
        Assert.Equal(3, folders.Count);
        var checked_ = 0;
        foreach (var f in folders)
        {
            var folder = f!["folder"]!.GetValue<string>();
            var model = FolderLoader.Load(Path.Combine(Repo.Root, folder)).Model;
            var uses = model.Flows.Where(kv => Channels.Uses(kv.Value)).Select(kv => kv.Key).ToList();
            Assert.Equal(f["flows"]!.AsArray().Select(x => x!["id"]!.GetValue<string>()), uses);
            foreach (var expected in f["flows"]!.AsArray())
            {
                var flow = model.Flows[expected!["id"]!.GetValue<string>()];
                var stops = Structure.Stops(flow);
                Assert.Equal(JsonDump.Pretty(expected["problems"]), JsonDump.Pretty(new JsonArray(Channels.Problems(flow, stops).Select(ProblemNode).ToArray())));

                var at = stops.Select((_, k) => Channels.At(flow, stops, k)).ToList();
                Assert.Equal(JsonDump.Pretty(expected["at"]), JsonDump.Pretty(new JsonArray(at.Select(c => (JsonNode?)ChannelsNode(c)).ToArray())));
                Assert.Equal(JsonDump.Pretty(expected["kinds"]), JsonDump.Pretty(new JsonArray(at.Select(c => (JsonNode?)new JsonArray(Channels.KindsOf(c).Select(k => (JsonNode?)JsonValue.Create(k)).ToArray())).ToArray())));
                Assert.Equal(JsonDump.Pretty(expected["closable"]), JsonDump.Pretty(new JsonArray(flow.Steps.Select((_, i) => (JsonNode?)new JsonArray(Channels.ClosableAt(flow, stops, i)
                    .Select(c => (JsonNode?)new JsonObject { ["name"] = c.Name, ["kind"] = c.Kind }).ToArray())).ToArray())));
                Assert.Equal(JsonDump.Pretty(expected["before"]), JsonDump.Pretty(new JsonArray(stops.Select((_, k) => Int(Structure.StopBefore(stops, k))).ToArray())));
                foreach (var o in expected["outside"]!.AsArray())
                    Assert.Equal(JsonDump.Pretty(o!["channels"]), JsonDump.Pretty(ChannelsNode(Channels.At(flow, stops, o["k"]!.GetValue<int>()))));
                checked_++;
            }
        }
        Assert.True(checked_ >= 7, "the channels case has seven flows");
    }

    [Fact]
    public void A_flow_with_no_channels_folds_to_nothing_and_a_k_that_is_no_stop_gives_none()
    {
        var plain = new Flow("F", "shop", [new Step("web", "api", "t", null), new Step("web", "api", "t", null, "call")]);
        Assert.False(Channels.Uses(plain));
        Assert.Empty(Channels.At(plain, Structure.Stops(plain), 1));
        var model = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "channels", "flowy")).Model;
        var flow = model.Flows["lifecycle"];
        Assert.True(Channels.Uses(flow));
        var stops = Structure.Stops(flow);
        foreach (var k in new[] { -1, stops.Count, stops.Count + 5 }) Assert.Empty(Channels.At(flow, stops, k));
        Assert.Empty(Channels.At(flow, [], 0));
    }

    [Fact]
    public void A_channel_stays_open_until_a_step_closes_it_and_the_closing_step_still_shows_it()
    {
        var model = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "channels", "flowy")).Model;
        var flow = model.Flows["lifecycle"];
        var stops = Structure.Stops(flow);
        Assert.Empty(Channels.At(flow, stops, 0));
        var opened = Assert.Single(Channels.At(flow, stops, 1));
        Assert.Equal(new Channel(1, "stream", "Orders", "api", "db", "to", true, false), opened);
        Assert.Equal([("Orders", false, false)], Channels.At(flow, stops, 2).Select(c => (c.Name!, c.Opening, c.Closing)));
        Assert.Equal([("Orders", false, true), ("Charge", false, false)], Channels.At(flow, stops, 5).Select(c => (c.Name!, c.Opening, c.Closing)));
        Assert.Equal(["Charge"], Channels.At(flow, stops, 6).Select(c => c.Name!));
        Assert.Equal(["Charge", "Orders"], Channels.At(flow, stops, 7).Select(c => c.Name!));
        Assert.Equal(["listener", "job", "stream", "stream"], Channels.At(model.Flows["unnamed"], Structure.Stops(model.Flows["unnamed"]), 4).Select(c => c.Kind));
    }
}
