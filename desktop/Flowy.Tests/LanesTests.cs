using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>
/// The lines of a pair of shapes side by side (src/core/lanes.ts, desktop/fixtures/lanes.ts): where each lane runs for pairs of 1 to 9 lines, in every arrangement and pose; the capacity of a
/// pair; which lane a pointer means; where the labels of the lanes go; and, for the separate-lanes case, the slot, lane and name of each line of its view and the line each step rides.
/// Every number is the browser's, to the last digit of the rounding.
/// </summary>
public class LanesTests
{
    internal static JsonNode Expected(string name) => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "lanes", name + ".json")))!;

    internal static double D(JsonNode? n) => n!.GetValue<double>();

    internal static void Same(double want, double got, string what) => Assert.True(Math.Abs(want - got) < 1e-9, $"{what}: wanted {want}, got {got}");

    internal static void Same(JsonNode want, Pt got, string what)
    {
        Same(D(want[0]), got.X, what + " x");
        Same(D(want[1]), got.Y, what + " y");
    }

    private static void SameXY(JsonNode want, Pt got, string what)
    {
        Same(D(want["x"]), got.X, what + " x");
        Same(D(want["y"]), got.Y, what + " y");
    }

    internal static LaneBox Box(JsonNode b) =>
        new(b["id"]!.GetValue<string>(), new Rect(D(b["x"]), D(b["y"]), D(b["width"]), D(b["height"])), LookData.Shapes[b["shape"]!.GetValue<string>()].Edge);

    internal static LanePose Pose(JsonNode n) => new(D(n["s"]), n["lam"]!.AsArray().Select(D).ToList());

    internal static LaneSlot Slot(JsonNode n) => new(n["lane"]!.GetValue<int>(), n["lanes"]!.GetValue<int>(), n["back"]!.GetValue<int>());

    /// <summary>The lanes of a pair, as the dump has them: the first <paramref name="back"/> run from b to a, the others from a to b.</summary>
    internal static List<LaneLine> Bundle(LaneBox a, LaneBox b, int lanes, int back, LanePose pose, string style = "straight") =>
        Enumerable.Range(0, lanes).Select(lane => lane < back
            ? Lanes.LaneGeometry(b, a, new LaneSlot(lane, lanes, back), pose, style)
            : Lanes.LaneGeometry(a, b, new LaneSlot(lane, lanes, back), pose, style)).ToList();

    internal static void SameLane(JsonNode want, LaneLine got, string what)
    {
        Assert.Equal(want["path"]!.GetValue<string>(), got.Path);
        Same(want["anchor"]!, new Pt(got.X, got.Y), what + " anchor");
        var points = want["points"]!.AsArray();
        Assert.Equal(points.Count, got.Points.Count);
        for (var i = 0; i < points.Count; i++) Same(points[i]!, got.Points[i], $"{what} point {i}");
        // The heads: where the lane ends and which way it points out of the line at each end.
        var ends = got.AsLinePath();
        Same(want["head"]!["at"]!, Rounded(ends.End), what + " head");
        Same(want["head"]!["dir"]!, Rounded(ends.Direction), what + " head direction");
        Same(want["tail"]!["at"]!, Rounded(ends.Start), what + " tail");
        Same(want["tail"]!["dir"]!, Rounded(ends.StartDirection), what + " tail direction");
    }

    [Fact]
    public void Lanes_at_rest_run_where_the_browser_runs_them_for_every_arrangement_and_number_of_lines()
    {
        var configs = Expected("rest")!.AsArray();
        Assert.Equal(8, configs.Count);
        foreach (var config in configs)
        {
            var (a, b) = (Box(config!["a"]!), Box(config["b"]!));
            Same(D(config["room"]), Lanes.Round3(Lanes.RoomOf(a, b)), $"{config["name"]} room");
            foreach (var mix in config["mixes"]!.AsArray())
            {
                var (lanes, back) = (mix!["lanes"]!.GetValue<int>(), mix["back"]!.GetValue<int>());
                var what = $"{config["name"]} {lanes} lanes, {back} back";
                Same(D(mix["pitch"]), Lanes.Round3(Lanes.PitchFor(Lanes.RoomOf(a, b), new LaneSlot(0, lanes, back))), what + " pitch");
                var made = Bundle(a, b, lanes, back, LanePose.Rest);
                var lines = mix["lines"]!.AsArray();
                Assert.Equal(lanes, lines.Count);
                for (var i = 0; i < lanes; i++)
                {
                    Assert.Equal(Slot(lines[i]!["slot"]!), new LaneSlot(i, lanes, back));
                    SameLane(lines[i]!, made[i], $"{what} lane {i}");
                }
            }
        }
    }

    [Fact]
    public void Lanes_in_every_pose_move_as_the_browser_moves_them()
    {
        var poses = Expected("poses");
        foreach (var w in poses["bulge"]!.AsArray()) Same(D(w!["w"]), Lanes.Round3(Lanes.Bulge(D(w["t"]))), $"bulge at {w["t"]}");
        var easing = poses["easing"]!;
        Same(D(easing["ms"]), Lanes.SpreadMs, "the time a pair takes to spread");
        Same(D(easing["sibling"]), Lanes.SiblingOpacity, "the opacity of the other lanes of a pair");
        foreach (var p in easing["progress"]!.AsArray()) Same(D(p!["to"]), Lanes.Round3(Lanes.SpreadProgress(D(p["from"]), D(p["goal"]), D(p["ms"]))), $"progress from {p["from"]} to {p["goal"]} in {p["ms"]} ms");
        foreach (var e in easing["eased"]!.AsArray()) Same(D(e!["s"]), Lanes.Round3(Lanes.EasedSpread(D(e["progress"]))), $"eased spread at {e["progress"]}");
        var rows = poses["displacements"]!.AsArray();
        Assert.Equal(42, rows.Count);
        foreach (var row in rows)
        {
            var (lanes, back, length) = (row!["lanes"]!.GetValue<int>(), row["back"]!.GetValue<int>(), D(row["length"]));
            var moved = row["moved"]!.AsArray();
            for (var lane = 0; lane < lanes; lane++)
                Same(D(moved[lane]), Lanes.Round3(Lanes.Displacement(new LaneSlot(lane, lanes, back), Pose(row), length, 12)), $"{row["pose"]} of {lanes} lanes at length {length}, lane {lane}");
        }
        foreach (var config in poses["lanes"]!.AsArray())
        {
            var (a, b) = (Box(config!["a"]!), Box(config["b"]!));
            foreach (var pose in config["poses"]!.AsArray())
                foreach (var mix in pose!["lanes"]!.AsArray())
                {
                    var (lanes, back) = (mix!["lanes"]!.GetValue<int>(), mix["back"]!.GetValue<int>());
                    var made = Bundle(a, b, lanes, back, Pose(pose));
                    var lines = mix["lines"]!.AsArray();
                    for (var i = 0; i < lanes; i++) SameLane(lines[i]!, made[i], $"{config["name"]}, {pose["pose"]}, {lanes} lanes, lane {i}");
                }
        }
    }

    /// <summary>Where a lane is after <paramref name="k"/> of the <see cref="Lanes.Samples"/> steps along it: a lane at rest is a straight line of two points.</summary>
    private static Pt At(LaneLine lane, int k) =>
        lane.Points.Count == Lanes.Samples + 1 ? lane.Points[k] : new Pt(lane.Points[0].X + (lane.Points[1].X - lane.Points[0].X) * k / Lanes.Samples, lane.Points[0].Y + (lane.Points[1].Y - lane.Points[0].Y) * k / Lanes.Samples);

    [Fact]
    public void A_pair_that_is_spread_or_parted_keeps_its_ends_where_they_were_and_its_lanes_in_order()
    {
        var a = new LaneBox("a", new Rect(-100, -36, 200, 72), []);
        var b = new LaneBox("b", new Rect(300, -36, 200, 72), []);
        var rest = Bundle(a, b, 4, 1, LanePose.Rest);
        foreach (var pose in new[] { LanePose.Spread, new LanePose(0, [0, 1, 0, 0]), new LanePose(1, [0, 0, 0.5, 0]) })
        {
            var moved = Bundle(a, b, 4, 1, pose);
            for (var i = 0; i < 4; i++)
            {
                Assert.Equal(rest[i].Points[0], moved[i].Points[0]); // the shapes and the heads never move
                Assert.Equal(rest[i].Points[^1], moved[i].Points[^1]);
            }
            for (var k = 0; k <= Lanes.Samples; k++)
                for (var i = 0; i + 1 < 4; i++) Assert.True(At(moved[i], k).Y <= At(moved[i + 1], k).Y, $"lane {i} stays above lane {i + 1} at {k}"); // nothing crosses
        }
    }

    [Fact]
    public void The_capacity_the_offsets_the_constants_and_the_rounding_are_the_browsers()
    {
        var e = Expected("capacity");
        foreach (var u in e["usable"]!.AsArray()) Same(D(u!["usable"]), Lanes.UsableOf(D(u["half"])), $"usable at {u["half"]}");
        foreach (var c in e["capacity"]!.AsArray())
        {
            Assert.Equal(c!["oneWay"]!.GetValue<int>(), Lanes.LaneCapacity(D(c["half"]), false));
            Assert.Equal(c["bothWays"]!.GetValue<int>(), Lanes.LaneCapacity(D(c["half"]), true));
        }
        foreach (var o in e["offsets"]!.AsArray())
        {
            var (lanes, back) = (o!["lanes"]!.GetValue<int>(), o["back"]!.GetValue<int>());
            for (var lane = 0; lane < lanes; lane++) Same(D(o["at"]![lane]), Lanes.Round3(Lanes.OffsetOf(new LaneSlot(lane, lanes, back))), $"offset of lane {lane} of {lanes}, {back} back");
        }
        foreach (var p in e["pitches"]!.AsArray()) Same(D(p!["pitch"]), Lanes.Round3(Lanes.PitchFor(D(p["half"]), new LaneSlot(0, p["lanes"]!.GetValue<int>(), p["back"]!.GetValue<int>()))), $"pitch at {p["half"]}");
        foreach (var r in e["round3"]!.AsArray()) Same(D(r!["rounded"]), Lanes.Round3(D(r["value"])), $"round3 of {r["value"]}");
        var k = e["constants"]!;
        Same(D(k["PITCH"]), Lanes.Pitch, "PITCH");
        Same(D(k["GUTTER"]), Lanes.Gutter, "GUTTER");
        Same(D(k["MARGIN"]), Lanes.Margin, "MARGIN");
        Same(D(k["MOST"]), Lanes.Most, "MOST");
        Same(D(k["SAMPLES"]), Lanes.Samples, "SAMPLES");
        Same(D(k["SPREAD_PITCH"]), Lanes.SpreadPitch, "SPREAD_PITCH");
        Same(D(k["REACH"]), Lanes.Reach, "REACH");
        Same(D(k["HIT_WIDTH"]), Lanes.HitWidth, "HIT_WIDTH");
        Same(D(k["SAMPLE"]), LineLabels.Sample, "SAMPLE");
    }

    [Fact]
    public void A_ray_meets_the_outline_from_the_centre_and_from_a_point_away_from_it_as_in_the_browser()
    {
        var cases = Expected("capacity")["leaveAt"]!.AsArray();
        Assert.True(cases.Count >= 7);
        foreach (var c in cases)
        {
            var shape = c!["shape"]!.GetValue<string>();
            var rect = new Rect(-50, -6, 200, 72);
            Pt? from = c["from"] is { } f ? new Pt(D(f[0]), D(f[1])) : null;
            foreach (var ray in c["rays"]!.AsArray())
                Same(ray!["at"]!, Rounded(BoxGeometry.LeaveAt(rect, LookData.Shapes[shape].Edge, D(ray["dx"]), D(ray["dy"]), from)), $"{c["name"]} ray {ray["dx"]},{ray["dy"]}");
        }
    }

    private static Pt Rounded(Pt p) => new(Lanes.Round3(p.X), Lanes.Round3(p.Y));

    [Fact]
    public void A_pointer_means_the_lane_it_is_nearest_within_reach_and_the_lower_lane_when_two_are_as_near()
    {
        var cases = Expected("hits")!.AsArray();
        Assert.Equal(18, cases.Count);
        foreach (var c in cases)
        {
            var (a, b) = (Box(c!["a"]!), Box(c["b"]!));
            var (lanes, back) = (c["lanes"]!.GetValue<int>(), c["back"]!.GetValue<int>());
            var pose = c["s"]!.GetValue<double>() == 0 ? LanePose.Rest : LanePose.Spread;
            var zoom = c["zoom"]!.GetValue<double>();
            var hit = Bundle(a, b, lanes, back, pose).Select((l, lane) => new HitLane($"l{lane}", "p", lane, l.Points)).ToList();
            foreach (var probe in c["probes"]!.AsArray())
            {
                var at = new Pt(D(probe!["at"]![0]), D(probe["at"]![1]));
                Assert.Equal(probe["strand"]?.GetValue<string>(), Lanes.NearestStrand(hit, at, zoom));
            }
        }
    }

    [Fact]
    public void A_label_of_a_lane_starts_with_a_sample_of_its_line_and_keeps_off_the_others_as_in_the_browser()
    {
        var cases = Expected("labels")!.AsArray();
        Assert.Equal(6, cases.Count);
        foreach (var c in cases)
        {
            var items = c!["items"]!.AsArray().Select(i => new LabelItem(i!["id"]!.GetValue<string>(), i["path"]!.GetValue<string>(), new Pt(D(i["mid"]!["x"]), D(i["mid"]!["y"])), D(i["width"]), D(i["height"]),
                i["pinned"]!.GetValue<bool>(), i["across"]!.AsArray().Select(line => (IReadOnlyList<Pt>)line!.AsArray().Select(p => new Pt(D(p!["x"]), D(p["y"]))).ToList()).ToList(), D(i["extra"]))).ToList();
            var spots = LineLabels.Place(items, c["boxes"]!.AsArray().Select(r => new Rect(D(r!["x"]), D(r["y"]), D(r["width"]), D(r["height"]))).ToList());
            var want = c["spots"]!.AsArray();
            for (var i = 0; i < items.Count; i++) SameXY(want[i]!, spots[items[i].Id], $"{c["name"]} label {i}");
        }
    }

    [Fact]
    public void The_separate_lanes_case_has_the_slots_names_lanes_and_rides_the_browser_works_out()
    {
        var e = Expected("separate");
        var model = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "separate-lanes", "flowy")).Model;
        var view = Views.Compute(model, "root");
        Assert.NotNull(view.Strands);
        Assert.Equal(Lanes.MoveUp, e["words"]!["up"]!.GetValue<string>());
        Assert.Equal(Lanes.MoveDown, e["words"]!["down"]!.GetValue<string>());
        Assert.Equal(Lanes.AlreadyFirst, e["words"]!["first"]!.GetValue<string>());
        Assert.Equal(Lanes.AlreadyLast, e["words"]!["last"]!.GetValue<string>());
        Assert.Equal(Lanes.OnlyLineThisWay, e["words"]!["alone"]!.GetValue<string>());

        var slots = Lanes.SlotsOf(view.Strands!);
        var want = e["slots"]!.AsArray();
        Assert.Equal(want.Select(s => s!["id"]!.GetValue<string>()), slots.Keys);
        foreach (var s in want) Assert.Equal(Slot(s!["slot"]!), slots[s["id"]!.GetValue<string>()]);

        foreach (var n in e["names"]!.AsArray())
        {
            var strand = view.Strands!.Single(s => s.Id == n!["id"]!.GetValue<string>());
            Assert.Equal(n!["name"]!.GetValue<string>(), SceneBuilder.StrandName(model, strand));
            Assert.Equal(n["pair"]!.GetValue<string>(), strand.Pair);
        }

        var spots = e["spots"]!.AsArray().ToDictionary(s => s!["id"]!.GetValue<string>(), s => new LaneBox(s!["id"]!.GetValue<string>(), new Rect(D(s["x"]) - 100, D(s["y"]) - 36, 200, 72), LookData.Shapes[s["shape"]!.GetValue<string>()].Edge));
        foreach (var (name, pick) in new[] { ("rest", (string?)null), ("spread", "management ui") })
            foreach (var line in e[name]!.AsArray())
            {
                var strand = view.Strands!.Single(s => s.Id == line!["id"]!.GetValue<string>());
                var pose = pick is not null && strand.Pair == pick ? LanePose.Spread : LanePose.Rest;
                SameLane(line!["lane"]!, Lanes.LaneGeometry(spots[strand.From], spots[strand.To], slots[strand.Id], pose), $"{name} {strand.Id}");
            }

        foreach (var ride in e["rides"]!.AsArray())
        {
            var flow = model.Flows[ride!["flow"]!.GetValue<string>()];
            var step = flow.Steps[ride["step"]!.GetValue<int>()];
            var placed = Views.PlaceStep(model, flow.View, step.From, step.To);
            var got = placed is { } at ? Strands.StrandOf(model, view, step, at)?.Id : null;
            Assert.Equal(ride["strand"]?.GetValue<string>(), got);
        }
    }

    [Fact]
    public void The_lane_code_uses_only_the_arithmetic_the_two_cores_agree_on()
    {
        // No hypot, trigonometry or pow in the lane geometry: the browser and the desktop would round them differently, and the lanes would drift apart.
        var text = File.ReadAllText(Path.Combine(Repo.Root, "desktop", "Flowy.Core", "Lanes.cs"));
        var code = string.Join('\n', text.Split('\n').Select(l => l.TrimStart()).Where(l => !l.StartsWith("///") && !l.StartsWith("//")));
        Assert.DoesNotMatch(@"Math\.(Hypot|Atan2?|Sin|Cos|Tan|Pow|Exp|Log)\b|double\.Hypot", code);
    }
}
