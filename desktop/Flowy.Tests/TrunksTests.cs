using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;
using static Flowy.Tests.LanesTests;

namespace Flowy.Tests;

/// <summary>
/// Many lines between two shapes (src/core/trunks.ts, and the room a trunk takes in src/core/lanes.ts; desktop/fixtures/trunks.ts): how many lanes fit, how a pair that has more folds into trunks, how a
/// trunk opens, where its lanes and hairlines run, the trunks case's views in each line style, the key items, and what the layout makes of a bundle. Every number is the browser's.
/// </summary>
public class TrunksTests
{
    private static JsonNode Dump() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "trunks.json")))!;

    private static JsonNode LayoutDump() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "layout-lanes.json")))!;

    // ---- JSON on both sides --------------------------------------------------------------------------------------

    private static JsonArray Strings(IEnumerable<string> items) => new(items.Select(i => (JsonNode?)JsonValue.Create(i)).ToArray());

    private static JsonArray Ints(IEnumerable<int> items) => new(items.Select(i => (JsonNode?)JsonValue.Create(i)).ToArray());

    private static JsonObject TrunkJson(Trunk t) => new() { ["size"] = t.Size, ["members"] = Strings(t.Members) };

    /// <summary>A strand as the dump has it: all it says, with null for what it leaves out.</summary>
    private static JsonObject StrandJson(Strand s) => new()
    {
        ["id"] = s.Id, ["pair"] = s.Pair, ["from"] = s.From, ["to"] = s.To, ["label"] = s.Label, ["connections"] = Ints(s.Connections), ["lane"] = s.Lane, ["lanes"] = s.Lanes, ["kind"] = s.Kind,
        ["look"] = s.Look is null ? null : new JsonObject { ["pattern"] = s.Look.Pattern, ["head"] = s.Look.Head, ["tail"] = s.Look.Tail },
        ["trunk"] = s.Trunk is null ? null : TrunkJson(s.Trunk),
    };

    private static JsonObject SlotJson(LaneSlot s)
    {
        var o = new JsonObject { ["lane"] = s.Lane, ["lanes"] = s.Lanes, ["back"] = s.Back };
        if (s.Stack is not null) o["stack"] = Ints(s.Stack);
        if (s.Fan is not null) o["fan"] = Ints(s.Fan);
        if (s.Within is { } within) o["within"] = within;
        return o;
    }

    internal static LaneSlot SlotOf(JsonNode n) => new(n["lane"]!.GetValue<int>(), n["lanes"]!.GetValue<int>(), n["back"]!.GetValue<int>(),
        n["stack"]?.AsArray().Select(i => i!.GetValue<int>()).ToList(), n["fan"]?.AsArray().Select(i => i!.GetValue<int>()).ToList(), n["within"]?.GetValue<int>());

    private static Strand StrandOf(JsonNode n) => new(n["id"]!.GetValue<string>(), n["pair"]!.GetValue<string>(), n["from"]!.GetValue<string>(), n["to"]!.GetValue<string>(), n["label"]!.GetValue<string>(),
        n["connections"]!.AsArray().Select(i => i!.GetValue<int>()).ToList(), n["lane"]!.GetValue<int>(), n["lanes"]!.GetValue<int>(), n["kind"]?.GetValue<string>(),
        n["look"] is { } look ? new LineLook(look["pattern"]!.GetValue<string>(), look["head"]!.GetValue<string>(), look["tail"]!.GetValue<string>()) : null,
        n["trunk"] is { } trunk ? new Trunk(trunk["size"]!.GetValue<int>(), trunk["members"]!.AsArray().Select(m => m!.GetValue<string>()).ToList()) : null);

    /// <summary>Two dumps are the same: the same keys, the same text, the same numbers (to the last digit), the same nulls.</summary>
    private static void SameJson(JsonNode? want, JsonNode? got, string what)
    {
        if (want is null || got is null)
        {
            Assert.True(want is null && got is null, $"{what}: wanted {want?.ToJsonString() ?? "null"}, got {got?.ToJsonString() ?? "null"}");
            return;
        }
        switch (want)
        {
            case JsonObject wo:
                var go = Assert.IsType<JsonObject>(got);
                Assert.Equal(wo.Select(kv => kv.Key).Order(StringComparer.Ordinal), go.Select(kv => kv.Key).Order(StringComparer.Ordinal));
                foreach (var (key, value) in wo) SameJson(value, go[key], $"{what}.{key}");
                break;
            case JsonArray wa:
                var ga = Assert.IsType<JsonArray>(got);
                Assert.True(wa.Count == ga.Count, $"{what}: wanted {wa.Count} items, got {ga.Count}");
                for (var i = 0; i < wa.Count; i++) SameJson(wa[i], ga[i], $"{what}[{i}]");
                break;
            default:
                var wv = want.AsValue();
                if (wv.TryGetValue<string>(out var text)) Assert.Equal(text, got.GetValue<string>());
                else if (wv.TryGetValue<bool>(out var flag)) Assert.Equal(flag, got.GetValue<bool>());
                else Same(double.Parse(want.ToJsonString(), System.Globalization.CultureInfo.InvariantCulture), double.Parse(got.ToJsonString(), System.Globalization.CultureInfo.InvariantCulture), what);
                break;
        }
    }

    // ---- the lines of a pair as the dump makes them --------------------------------------------------------------

    private sealed record Spec(string Way, string? Kind = null, int Connections = 1);

    private static IEnumerable<Spec> Many(int n, string way, string? kind = null) => Enumerable.Range(0, n).Select(_ => new Spec(way, kind));

    /// <summary>A pair a &lt; b the way computeView makes its strands: the ones that run from b to a first, then the others, each in the order given.</summary>
    private static List<Strand> PairOf(IEnumerable<Spec> specs)
    {
        var all = specs.ToList();
        var ordered = all.Where(s => s.Way == "back").Concat(all.Where(s => s.Way == "ahead")).ToList();
        var next = 0;
        var strands = new List<Strand>();
        for (var lane = 0; lane < ordered.Count; lane++)
        {
            var s = ordered[lane];
            var (from, to) = s.Way == "back" ? ("b", "a") : ("a", "b");
            var label = $"{s.Way} {lane}";
            var connections = new List<int>();
            for (var i = 0; i < s.Connections; i++) connections.Add(next++);
            strands.Add(new Strand($"a b|{from}>{to}|{label}", "a b", from, to, label, connections, lane, ordered.Count, s.Kind));
        }
        return strands;
    }

    private static readonly string[] KindIds = [.. Kinds.All.Select(k => k.Id)];

    // ---- the room, the capacity, the offsets ---------------------------------------------------------------------

    [Fact]
    public void The_constants_the_words_and_the_room_a_trunk_takes_are_the_browsers()
    {
        var room = Dump()["room"]!;
        var k = room["constants"]!;
        Same(D(k["TRUNK_EXTRA"]), Lanes.TrunkExtra, "TRUNK_EXTRA");
        Same(D(k["HAIRLINE_GAP"]), Lanes.HairlineGap, "HAIRLINE_GAP");
        Same(D(k["OPEN_MOST"]), Lanes.OpenMost, "OPEN_MOST");
        Same(D(k["FOLD_FROM"]), Lanes.FoldFrom, "FOLD_FROM");
        Same(D(k["MOST"]), Lanes.Most, "MOST");
        Same(D(k["GUTTER"]), Lanes.Gutter, "GUTTER");
        Assert.Equal(Trunks.Mark, k["TRUNK_MARK"]!.GetValue<string>());
        var words = (room["words"]!["inUse"]!.GetValue<string>(), room["words"]!["stacked"]!.GetValue<string>());
        Assert.Equal(("In use", "Stacked lines"), words);
        Assert.Equal(words, (Lanes.KeyInUse, Lanes.KeyStacked));

        foreach (var c in room["capacity"]!.AsArray())
            Assert.Equal(c!["lanes"]!.GetValue<int>(), Lanes.LaneCapacity(D(c["half"]), c["bothWays"]!.GetValue<bool>(), c["trunks"]!.GetValue<int>()));
        foreach (var o in room["offsets"]!.AsArray())
        {
            var slot = SlotOf(o!["slot"]!);
            var offsets = Lanes.OffsetsOf(slot).Select(Lanes.Round3).ToArray();
            Assert.Equal(o["offsets"]!.AsArray().Count, offsets.Length);
            for (var lane = 0; lane < offsets.Length; lane++)
            {
                Same(D(o["offsets"]![lane]), offsets[lane], $"offsets of {o["slot"]!.ToJsonString()}, lane {lane}");
                Same(D(o["at"]![lane]), Lanes.Round3(Lanes.OffsetOf(slot with { Lane = lane })), $"offset of {o["slot"]!.ToJsonString()}, lane {lane}");
            }
        }
        foreach (var p in room["pitches"]!.AsArray())
            Same(D(p!["pitch"]), Lanes.Round3(Lanes.PitchFor(D(p["half"]), SlotOf(p["slot"]!))), $"pitch at {p["half"]} for {p["slot"]!.ToJsonString()}");
        foreach (var l in room["labels"]!.AsArray())
            Assert.Equal(l!["label"]!.GetValue<string>(), Trunks.TrunkLabel(l["kind"]?.GetValue<string>(), l["size"]!.GetValue<int>()));
        foreach (var i in room["ids"]!.AsArray())
            Assert.Equal(i!["id"]!.GetValue<string>(), Trunks.TrunkId(i["pair"]!.GetValue<string>(), i["from"]!.GetValue<string>(), i["to"]!.GetValue<string>(), i["kind"]?.GetValue<string>()));
    }

    [Fact]
    public void Slots_that_have_trunks_or_open_ones_are_equal_when_their_numbers_are()
    {
        var plain = new LaneSlot(1, 3, 0);
        Assert.Equal(plain, new LaneSlot(1, 3, 0));
        Assert.Equal(new LaneSlot(0, 2, 1, [0, 1], [5, 4], 2), new LaneSlot(0, 2, 1, new List<int> { 0, 1 }, new[] { 5, 4 }, 2));
        Assert.NotEqual(plain, plain with { Stack = [1] });
        Assert.NotEqual(new LaneSlot(0, 2, 1, [0], [5, 4], 2), new LaneSlot(0, 2, 1, [0], [5, 4], 3));
        Assert.True(Lanes.IsLaned(new LaneSlot(0, 2, 0)));
        Assert.True(Lanes.IsLaned(new LaneSlot(0, 1, 0, [0], [3], 0)));
        Assert.False(Lanes.IsLaned(new LaneSlot(0, 1, 0, [0])));
        Assert.False(Lanes.IsLaned(null));
    }

    // ---- folding ---------------------------------------------------------------------------------------------------

    [Fact]
    public void A_pair_with_more_lines_than_fit_folds_into_trunks_as_the_browser_folds_it()
    {
        var folds = Dump()["folds"]!.AsArray();
        Assert.Equal(20, folds.Count);
        foreach (var f in folds)
        {
            var what = $"{f!["name"]} across {f["half"]}";
            var strands = f["strands"]!.AsArray().Select(s => StrandOf(s!)).ToList();
            var folded = Trunks.FoldPair(strands, D(f["half"]));
            SameJson(f["folded"], new JsonArray(folded.Strands.Select(s => (JsonNode?)StrandJson(s)).ToArray()), what + " folded");
            SameJson(f["stands"], new JsonArray(folded.Stands.Select(kv => (JsonNode?)new JsonArray(JsonValue.Create(kv.Key), JsonValue.Create(kv.Value))).ToArray()), what + " stands");
        }
        Assert.Contains(folds, f => f!["folded"]!.AsArray().Any(s => s!["trunk"] is not null));
        Assert.Contains(folds, f => f!["folded"]!.AsArray().Count == f["strands"]!.AsArray().Count); // some fit
    }

    [Fact]
    public void Folding_a_view_asks_for_the_room_only_of_a_pair_with_enough_lines_and_leaves_the_others_as_they_are()
    {
        var want = Dump()["foldStrands"]!;
        var two = PairOf(Many(3, "ahead")).Select(s => s with { Pair = "c d", Id = $"c d|{s.Id}" });
        var third = PairOf(Many(2, "back")).Select(s => s with { Pair = "e f", From = "f", To = "e", Id = $"e f|{s.Id}" });
        var mixed = two.Concat(PairOf(Many(9, "ahead"))).Concat(third).ToList();
        var asked = new List<string>();
        var folded = Trunks.FoldStrands(mixed, (from, to) =>
        {
            asked.Add($"{from} {to}");
            return 100;
        })!;
        SameJson(want["asked"], Strings(asked), "pairs asked about");
        SameJson(want["strands"], new JsonArray(folded.Strands.Select(s => (JsonNode?)StrandJson(s)).ToArray()), "strands");
        SameJson(want["stands"], new JsonArray(folded.Stands.Select(kv => (JsonNode?)new JsonArray(JsonValue.Create(kv.Key), JsonValue.Create(kv.Value))).ToArray()), "stands");
        Assert.Null(Trunks.FoldStrands(null, (_, _) => 36)); // a view that draws one line for each pair has nothing to fold
        Assert.Null(want["none"]);
    }

    [Fact]
    public void A_selected_pair_opens_its_trunks_into_their_lines_unless_there_are_too_many()
    {
        var dump = Dump();
        var folds = dump["folds"]!.AsArray().Where(f => D(f!["half"]) == 100).ToDictionary(f => f!["name"]!.GetValue<string>(), f => f!);
        var opens = dump["opens"]!.AsArray();
        Assert.True(opens.Count >= 8);
        foreach (var o in opens)
        {
            var name = o!["name"]!.GetValue<string>();
            var strands = folds[name]["strands"]!.AsArray().Select(s => StrandOf(s!)).ToList();
            var folded = Trunks.FoldPair(strands, 100).Strands;
            var unfolded = strands.ToDictionary(s => s.Id);
            var opened = Trunks.OpenTrunks(folded, unfolded, new HashSet<string> { "a b" });
            var slots = Lanes.SlotsOf(opened);
            SameJson(o["folded"], Strings(folded.Select(s => s.Id)), name + " folded");
            SameJson(o["opened"], new JsonArray(opened.Select(s => (JsonNode?)new JsonObject { ["id"] = s.Id, ["lane"] = s.Lane, ["lanes"] = s.Lanes }).ToArray()), name + " opened");
            SameJson(o["slots"], new JsonArray(opened.Select(s => (JsonNode?)SlotJson(slots[s.Id])).ToArray()), name + " slots");
            var closed = Lanes.SlotsOf(folded);
            SameJson(o["closedSlots"], new JsonArray(folded.Select(s => (JsonNode?)SlotJson(closed[s.Id])).ToArray()), name + " slots shut");
            SameJson(o["laned"], new JsonArray(opened.Select(s => (JsonNode?)JsonValue.Create(Lanes.IsLaned(slots[s.Id]))).ToArray()), name + " laned");
            Assert.Equal(folded.Count, Trunks.OpenTrunks(folded, unfolded, new HashSet<string>()).Count); // nothing selected: nothing opens
        }
        // A trunk of more than OpenMost lines stays shut, and the panel lists its connections.
        var big = opens.Single(o => o!["name"]!.GetValue<string>().StartsWith("fourteen"))!;
        Assert.Equal(big["folded"]!.AsArray().Count, big["opened"]!.AsArray().Count);
        Assert.All(big["opened"]!.AsArray(), s => Assert.Contains("\u0002", s!["id"]!.GetValue<string>()));

        var selected = PairOf(Many(3, "ahead"));
        foreach (var o in dump["opened"]!.AsArray())
            SameJson(o!["pairs"], Strings(Trunks.PairsOpenedBy(selected, o["selected"]?.GetValue<string>())), $"pairs opened by {o["selected"]}");
    }

    // ---- where lanes and hairlines run --------------------------------------------------------------------------

    [Fact]
    public void The_step_a_trunks_hairlines_lie_along_is_the_browsers()
    {
        foreach (var place in Dump()["places"]!.AsArray())
        {
            var (a, b) = (Box(place!["a"]!), Box(place["b"]!));
            foreach (var s in place["step"]!.AsArray())
            {
                var step = Lanes.StackStep(a, b, SlotOf(s!["slot"]!));
                Same(D(s["step"]!["x"]), step.X, $"{place["name"]} step x");
                Same(D(s["step"]!["y"]), step.Y, $"{place["name"]} step y");
            }
        }
    }

    private static void SameLaneDump(JsonNode want, LaneBox source, LaneBox target, LaneSlot slot, LanePose pose, string style, string what)
    {
        Assert.Equal(want["slot"]!.ToJsonString(), SlotJson(slot).ToJsonString());
        SameLane(want, Lanes.LaneGeometry(source, target, slot, pose, style), what);
        if (want["step"] is { } step)
        {
            var got = Lanes.StackStep(source, target, slot);
            Same(D(step["x"]), got.X, what + " step x");
            Same(D(step["y"]), got.Y, what + " step y");
        }
        else Assert.Null(slot.Stack);
    }

    private static List<Spec> SpecsNamed(string name) => name switch
    {
        "nine one way and the one the other" => [.. Many(9, "ahead", "stream"), .. Many(1, "back", "publish")],
        "eight in four kinds" => [.. Many(2, "back", "request"), .. Many(2, "back", "cached"), .. Many(2, "ahead", "object"), .. Many(2, "ahead", "extension")],
        "two trunks beside a lane, one way and the other" => [.. Many(6, "back", "request"), new Spec("back"), .. Many(7, "ahead", "publish")],
        _ => throw new ArgumentException(name),
    };

    [Fact]
    public void Trunks_and_the_lines_of_an_open_one_run_where_the_browser_runs_them_in_every_arrangement_and_style()
    {
        var cases = Dump()["lanes"]!.AsArray();
        Assert.Equal(45, cases.Count);
        foreach (var c in cases)
        {
            var (a, b) = (Box(c!["a"]!), Box(c["b"]!));
            var style = c["style"]!.GetValue<string>();
            var what = $"{c["place"]} in {style}: {c["name"]}";
            Same(D(c["room"]), Lanes.Round3(Lanes.RoomOf(a, b, style)), what + " room");
            var strands = PairOf(SpecsNamed(c["name"]!.GetValue<string>()));
            var folded = Trunks.FoldStrands(strands, (_, _) => Lanes.Round3(Lanes.RoomOf(a, b, style)))!;
            var unfolded = strands.ToDictionary(s => s.Id);
            var closed = folded.Strands;
            var open = Trunks.OpenTrunks(closed, unfolded, new HashSet<string> { "a b" });
            var closedSlots = Lanes.SlotsOf(closed);
            var openSlots = Lanes.SlotsOf(open);
            (LaneBox, LaneBox) Ends(Strand s) => s.From == "a" ? (a, b) : (b, a);

            var wantClosed = c["closed"]!.AsArray();
            Assert.Equal(wantClosed.Count, closed.Count);
            for (var i = 0; i < closed.Count; i++)
            {
                SameJson(wantClosed[i]!["strand"], StrandJson(closed[i]), $"{what} strand {i}");
                var (source, target) = Ends(closed[i]);
                SameLaneDump(wantClosed[i]!["rest"]!, source, target, closedSlots[closed[i].Id], LanePose.Rest, style, $"{what} lane {i} at rest");
                SameLaneDump(wantClosed[i]!["spread"]!, source, target, closedSlots[closed[i].Id], LanePose.Spread, style, $"{what} lane {i} spread");
            }
            var wantOpen = c["open"]!.AsArray();
            Assert.Equal(wantOpen.Count, open.Count);
            for (var i = 0; i < open.Count; i++)
            {
                Assert.Equal(wantOpen[i]!["id"]!.GetValue<string>(), open[i].Id);
                var (source, target) = Ends(open[i]);
                SameLaneDump(wantOpen[i]!["rest"]!, source, target, openSlots[open[i].Id], LanePose.Rest, style, $"{what} open line {i} at rest");
                SameLaneDump(wantOpen[i]!["spread"]!, source, target, openSlots[open[i].Id], LanePose.Spread, style, $"{what} open line {i} spread");
            }
        }
    }

    [Fact]
    public void The_lines_of_an_open_trunk_fan_out_of_its_place_as_the_browser_fans_them()
    {
        foreach (var f in Dump()["fan"]!.AsArray())
        {
            var counts = f!["counts"]!.AsArray().Select(n => n!.GetValue<int>()).ToList();
            foreach (var m in f["moved"]!.AsArray())
                Same(D(m!["moved"]), Lanes.Round3(Lanes.Displacement(new LaneSlot(m["lane"]!.GetValue<int>(), counts.Count, 0, null, counts, m["within"]!.GetValue<int>()), LanePose.Rest, 400, 12)), $"fan {f["counts"]!.ToJsonString()} lane {m["lane"]} line {m["within"]}");
        }
    }

    // ---- the trunks case, drawn ----------------------------------------------------------------------------------------

    private static Model Case() => FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "trunks", "flowy")).Model;

    [Fact]
    public void The_trunks_case_is_drawn_in_each_line_style_with_the_trunks_the_browser_makes()
    {
        var model = Case();
        var drawn = Dump()["drawn"]!;
        var flow = model.Flows["tour"];
        var unfolded = Views.Compute(model, "root");
        var ends = flow.Steps.Select(s => Views.PlaceStep(model, flow.View, s.From, s.To)).ToList();
        var styles = drawn["styles"]!.AsArray();
        Assert.Equal(["straight", "curved", "angled"], styles.Select(s => s!["style"]!.GetValue<string>()));
        foreach (var s in styles)
        {
            var style = s!["style"]!.GetValue<string>();
            var view = Trunks.Draw(model, "root", style);
            var slots = Lanes.SlotsOf(view.View.Strands!);
            SameJson(s["strands"], new JsonArray(view.View.Strands!.Select(t =>
            {
                var o = StrandJson(t);
                o["slot"] = SlotJson(slots[t.Id]);
                return (JsonNode?)o;
            }).ToArray()), style + " strands");
            string LabelOf(string id) => unfolded.Strands!.Single(t => t.Id == id).Label;
            SameJson(s["stands"], new JsonArray(view.Stands.Select(kv => (JsonNode?)new JsonObject { ["member"] = LabelOf(kv.Key), ["trunk"] = kv.Value }).ToArray()), style + " stands");
            SameJson(s["rides"], new JsonArray(flow.Steps.Select((step, i) => (JsonNode?)new JsonObject
            {
                ["step"] = i, ["ride"] = ends[i] is { } placed ? Trunks.DrawnStrandOf(model, view, step, placed) : null,
            }).ToArray()), style + " rides");
            var all = unfolded.Strands!.ToDictionary(t => t.Id);
            SameJson(s["opens"], new JsonArray(new[] { "hub ui", "hub store", "hub bus", "hub sensor", "nowhere" }.Select(pair =>
            {
                var opened = Trunks.OpenTrunks(view.View.Strands!, all, Trunks.PairsOpenedBy(unfolded.Strands!, pair));
                var openSlots = Lanes.SlotsOf(opened);
                return (JsonNode?)new JsonObject
                {
                    ["pair"] = pair,
                    ["lines"] = new JsonArray(opened.Select(t => (JsonNode?)new JsonObject { ["id"] = t.Id, ["lane"] = t.Lane, ["lanes"] = t.Lanes, ["slot"] = SlotJson(openSlots[t.Id]) }).ToArray()),
                };
            }).ToArray()), style + " opens");
        }
    }

    [Fact]
    public void A_trunk_stands_for_every_one_of_its_lines_when_one_is_pointed_at_or_picked()
    {
        var model = Case();
        var trunks = SceneBuilder.Build(model, "root").Edges.Where(e => e.Trunk is not null).ToList();
        var want = Dump()["drawn"]!["membership"]!.AsArray();
        Assert.Equal(want.Select(m => m!["trunk"]!.GetValue<string>()), trunks.Select(e => e.Id));
        for (var i = 0; i < trunks.Count; i++)
            foreach (var t in want[i]!["tests"]!.AsArray())
                Assert.Equal(t!["in"]!.GetValue<bool>(), trunks[i].Stands(t["id"]!.GetValue<string>()));
        // A click on a trunk picks the first of its lines; a line alone picks itself.
        Assert.All(trunks, e => Assert.Equal(e.Trunk!.Members[0], e.PickedId));
        Assert.Equal("a|b", new SceneEdge("a|b", "a", "b", null, EdgeFlags.None, false).PickedId);
    }

    // ---- the key -----------------------------------------------------------------------------------------------------

    [Fact]
    public void The_key_shows_stacked_lines_and_a_lane_in_use_only_while_the_canvas_draws_them()
    {
        var cases = Dump()["key"]!.AsArray();
        Assert.Equal(8, cases.Count);
        foreach (var c in cases)
        {
            var lines = c!["lines"]!.AsArray().Select(l =>
            {
                var flags = (l!["className"]?.GetValue<string>() ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries).Aggregate(EdgeFlags.None, (all, token) => all | token switch
                {
                    "active" => EdgeFlags.Active,
                    "kin" => EdgeFlags.Kin,
                    "several" => EdgeFlags.Several,
                    "step" => EdgeFlags.Step,
                    _ => EdgeFlags.None,
                });
                var data = l["data"];
                return new SceneEdge(l["id"]!.GetValue<string>(), "a", "b", null, flags, false)
                {
                    Lanes = data?["lanes"]?.GetValue<int>() ?? 1,
                    Trunk = data?["trunk"] is { } t ? new Trunk(t["size"]!.GetValue<int>(), t["members"]!.AsArray().Select(m => m!.GetValue<string>()).ToList()) : null,
                };
            }).ToList();
            var got = KindKey.OnScreen(lines);
            var result = c["result"]!;
            Assert.Equal(result["kinds"]!.AsArray().Select(k => k!.GetValue<string>()), got.Kinds);
            Assert.Equal(result["plain"]!.GetValue<bool>(), got.Plain);
            Assert.Equal(result["stacked"]!.GetValue<bool>(), got.Stacked);
            Assert.Equal(result["inUse"]!.GetValue<bool>(), got.InUse);
        }
    }

    // ---- the layout --------------------------------------------------------------------------------------------------

    private static OrderedDictionary<string, Pt> At(params (string Id, double X, double Y)[] spots)
    {
        var at = new OrderedDictionary<string, Pt>();
        foreach (var (id, x, y) in spots) at[id] = new Pt(x, y);
        return at;
    }

    [Fact]
    public void A_crossing_of_bundles_counts_every_lane_against_every_lane_and_a_bundle_runs_through_a_box_sooner()
    {
        var want = LayoutDump();
        var cross = At(("a", 0, 0), ("b", 600, 0), ("c", 300, -300), ("d", 300, 300));
        foreach (var c in want["crossings"]!.AsArray())
        {
            var (n, m) = (c!["lanes"]![0]!.GetValue<int>(), c["lanes"]![1]!.GetValue<int>());
            Assert.Equal(c["score"]!.GetValue<int>(), Layout.Tangle(cross, [new Ends("a", "b", n), new Ends("c", "d", m)]));
        }
        foreach (var t in want["through"]!.AsArray())
        {
            var lanes = t!["lanes"]?.GetValue<int>() ?? 1;
            Assert.Equal(t["score"]!.GetValue<int>(), Layout.Tangle(At(("a", -500, 0), ("b", 500, 0), ("c", 0, t["y"]!.GetValue<double>())), [new Ends("a", "b", lanes)]));
        }
        var moved = want["moved"]!;
        var edges = new[] { new Ends("a", "b", 3), new Ends("c", "d", 2), new Ends("a", "d") };
        var before = At(("a", 0, 0), ("b", 600, 0), ("c", 300, -300), ("d", 300, 300));
        var after = At(("a", 0, 0), ("b", 600, 0), ("c", 300, 100), ("d", 300, 400));
        Assert.Equal(moved["whole"]!.AsArray().Select(n => n!.GetValue<int>()), [Layout.Tangle(before, edges), Layout.Tangle(after, edges)]);
        var only = new HashSet<string> { "c", "d" };
        Assert.Equal(moved["onlyMoved"]!.AsArray().Select(n => n!.GetValue<int>()), [Layout.Tangle(before, edges, only), Layout.Tangle(after, edges, only)]);
    }

    [Fact]
    public void A_view_hands_the_layout_the_lanes_of_each_pair_that_has_several_and_a_single_line_is_left_out()
    {
        var want = LayoutDump();
        var model = Case();
        var counts = Layout.LaneCounts(Views.Compute(model, "root"));
        Assert.Equal(Lanes.Most, want["mostLanes"]!.GetValue<int>());
        SameJson(want["counts"], new JsonArray(counts.Select(kv => (JsonNode?)new JsonArray(JsonValue.Create(kv.Key), JsonValue.Create(kv.Value))).ToArray()), "lane counts");
        Assert.All(counts, kv => Assert.InRange(kv.Value, 2, Lanes.Most));
        // A model that draws one line for each pair hands the layout nothing, so a project that does not draw lines apart is placed as it always was.
        Assert.Empty(Layout.LaneCounts(Views.Compute(TestModels.Shop(), "shop")));
    }

    [Fact]
    public void The_folding_code_uses_only_the_arithmetic_the_two_cores_agree_on()
    {
        var text = File.ReadAllText(Path.Combine(Repo.Root, "desktop", "Flowy.Core", "Trunks.cs"));
        var code = string.Join('\n', text.Split('\n').Select(l => l.TrimStart()).Where(l => !l.StartsWith("///") && !l.StartsWith("//")));
        Assert.DoesNotMatch(@"Math\.(Hypot|Atan2?|Sin|Cos|Tan|Pow|Exp|Log)\b|double\.Hypot", code);
    }
}
