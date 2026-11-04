using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;
using static Flowy.Tests.LanesTests;

namespace Flowy.Tests;

/// <summary>
/// Curved and right-angled lanes (src/core/lanes.ts, desktop/fixtures/lanes.ts): the pairs of shapes in which the sides facing each other have room between them (a curve, a staircase), and the
/// ones that do not (their lanes fall back to straight ones, in either style): where each lane runs for pairs of 1 to 8 lines, in every pose, how much room the neighbours of a lit lane leave,
/// and where the labels of the lanes go. Every number is the browser's, to the last digit of the rounding.
/// </summary>
public class LaneCurvesTests
{
    private static JsonNode Curves() => Expected("curves");

    private static string Word(Side side) => side.ToString().ToLowerInvariant();

    [Fact]
    public void The_constants_that_say_where_a_pair_runs_curved_or_right_angled_are_the_browsers()
    {
        var k = Curves()["constants"]!;
        Same(D(k["MIN_ROUTE_GAP"]), Lanes.MinRouteGap, "MIN_ROUTE_GAP");
        Same(D(k["KAPPA_MAX"]), Lanes.KappaMax, "KAPPA_MAX");
        Same(D(k["GAP_LEAST"]), Lanes.GapLeast, "GAP_LEAST");
        Same(D(k["ANGLE_RUN"]), Lanes.AngleRun, "ANGLE_RUN");
        Same(D(k["CORNER"]), Lanes.Corner, "CORNER");
        Same(D(k["CORNER_AIR"]), Lanes.CornerAir, "CORNER_AIR");
        Same(D(k["CORNER_LEAST"]), Lanes.CornerLeast, "CORNER_LEAST");
        Same(D(k["SIDE_AIR"]), Lanes.SideAir, "SIDE_AIR");
        Same(D(k["LEG_AIR"]), Lanes.LegAir, "LEG_AIR");
    }

    [Fact]
    public void The_ports_of_a_pair_and_the_line_alone_between_two_shapes_are_the_browsers_in_all_three_styles()
    {
        var configs = Curves()["configs"]!.AsArray();
        Assert.Equal(14, configs.Count);
        foreach (var config in configs)
        {
            var (a, b) = (Box(config!["a"]!), Box(config["b"]!));
            var name = config["name"]!.GetValue<string>();
            var ports = BoxGeometry.PortsBetween(a.Rect, b.Rect, a.Edge, b.Edge);
            var want = config["ports"]!;
            Same(want["from"]!, Rounded(ports.From), name + " from");
            Same(want["to"]!, Rounded(ports.To), name + " to");
            Assert.Equal(want["fromSide"]!.GetValue<string>(), Word(ports.FromSide));
            Assert.Equal(want["toSide"]!.GetValue<string>(), Word(ports.ToSide));
            foreach (var single in config["single"]!.AsArray())
            {
                var style = single!["style"]!.GetValue<string>();
                var made = LinePaths.Build(style, a.Rect, b.Rect, a.Edge, b.Edge);
                Assert.Equal(single["path"]!.GetValue<string>(), made.Data);
                Same(single["anchor"]!, made.Label, $"{name} {style} anchor");
                Assert.True(single["sameWithASlotOfOne"]!.GetValue<bool>()); // the browser draws a pair of one line as a lone line; the lane store of the desktop does the same (LaneStoreTests)
            }
        }
    }

    private static Pt Rounded(Pt p) => new(Lanes.Round3(p.X), Lanes.Round3(p.Y));

    [Fact]
    public void Curved_and_right_angled_lanes_at_rest_run_where_the_browser_runs_them_for_every_arrangement_and_number_of_lines()
    {
        var lanesChecked = 0;
        foreach (var config in Curves()["configs"]!.AsArray())
        {
            var (a, b) = (Box(config!["a"]!), Box(config["b"]!));
            foreach (var styled in config["styles"]!.AsArray())
            {
                var style = styled!["style"]!.GetValue<string>();
                Same(D(styled["room"]), Lanes.Round3(Lanes.RoomOf(a, b, style)), $"{config["name"]} {style} room");
                foreach (var mix in styled["mixes"]!.AsArray())
                {
                    var (lanes, back) = (mix!["lanes"]!.GetValue<int>(), mix["back"]!.GetValue<int>());
                    var what = $"{config["name"]} {style} {lanes} lanes, {back} back";
                    Same(D(mix["pitch"]), Lanes.Round3(Lanes.PitchFor(Lanes.RoomOf(a, b, style), new LaneSlot(0, lanes, back))), what + " pitch");
                    var made = Bundle(a, b, lanes, back, LanePose.Rest, style);
                    var lines = mix["lines"]!.AsArray();
                    Assert.Equal(lanes, lines.Count);
                    for (var i = 0; i < lanes; i++)
                    {
                        Assert.Equal(Slot(lines[i]!["slot"]!), new LaneSlot(i, lanes, back));
                        SameLane(lines[i]!, made[i], $"{what} lane {i}");
                        lanesChecked++;
                    }
                }
            }
        }
        Assert.True(lanesChecked > 500, $"only {lanesChecked} lanes were checked");
    }

    [Fact]
    public void Curved_and_right_angled_lanes_in_every_pose_move_as_the_browser_moves_them()
    {
        var poses = Expected("curve-poses")["poses"]!.AsArray();
        Assert.Equal(4, poses.Count);
        foreach (var config in poses)
        {
            var (a, b) = (Box(config!["a"]!), Box(config["b"]!));
            foreach (var styled in config["styles"]!.AsArray())
            {
                var style = styled!["style"]!.GetValue<string>();
                foreach (var pose in styled["poses"]!.AsArray())
                    foreach (var mix in pose!["lanes"]!.AsArray())
                    {
                        var (lanes, back) = (mix!["lanes"]!.GetValue<int>(), mix["back"]!.GetValue<int>());
                        var made = Bundle(a, b, lanes, back, Pose(pose), style);
                        var lines = mix["lines"]!.AsArray();
                        for (var i = 0; i < lanes; i++) SameLane(lines[i]!, made[i], $"{config["name"]}, {style}, {pose["pose"]}, {lanes} lanes, lane {i}");
                    }
            }
        }
    }

    [Fact]
    public void The_room_the_neighbours_of_a_lit_lane_leave_and_the_reach_of_a_mark_by_style_are_the_browsers()
    {
        var gaps = Expected("curve-poses")["gaps"]!.AsArray();
        Assert.Equal(48, gaps.Count);
        var boxes = Expected("curve-poses")["poses"]!.AsArray().ToDictionary(c => c!["name"]!.GetValue<string>(), c => (Box(c!["a"]!), Box(c["b"]!)));
        foreach (var g in gaps)
        {
            var (a, b) = boxes[g!["name"]!.GetValue<string>()];
            var style = g["style"]!.GetValue<string>();
            var (lanes, back, lit) = (g["lanes"]!.GetValue<int>(), g["back"]!.GetValue<int>(), g["lit"]!.GetValue<int>());
            var slot = new LaneSlot(lit, lanes, back);
            var parted = new LanePose(0, Enumerable.Range(0, lanes).Select(k => k == lit ? 1.0 : 0.0).ToList());
            var what = $"{g["name"]}, {style}, {lanes} lanes, lit {lit}";
            foreach (var at in g["at"]!.AsArray())
            {
                var t = D(at!["t"]);
                Same(D(at["rest"]), Lanes.GapBeside(a, b, slot, LanePose.Rest, t, style), $"{what}: gap at rest, t {t}");
                Same(D(at["parted"]), Lanes.GapBeside(a, b, slot, parted, t, style), $"{what}: gap parted, t {t}");
            }
            Same(D(g["reach"]), Lanes.BundleReach(a, b, slot, style), what + ": reach");
        }
    }

    [Fact]
    public void The_labels_of_curved_and_right_angled_lanes_go_where_the_browser_puts_them()
    {
        var all = Expected("curve-labels");
        foreach (var style in new[] { "curved", "angled" })
        {
            var cases = all[style]!.AsArray();
            Assert.Equal(11, cases.Count);
            foreach (var c in cases)
            {
                Assert.Equal(style, c!["style"]!.GetValue<string>());
                var (a, b) = (Box(c["a"]!), Box(c["b"]!));
                var (lanes, back) = (c["lanes"]!.GetValue<int>(), c["back"]!.GetValue<int>());
                var items = c["items"]!.AsArray();
                // The lanes the labels sit on are the ones the core makes in that style, not only whatever the dump says.
                var pose = c["spread"]!.GetValue<bool>() ? LanePose.Spread : c["name"]!.GetValue<string>().Contains("parted") ? new LanePose(0, [0, 1, 0]) : LanePose.Rest;
                var made = Bundle(a, b, lanes, back, pose, style);
                for (var i = 0; i < items.Count; i++)
                {
                    Assert.Equal(items[i]!["path"]!.GetValue<string>(), made[i].Path);
                    Same(D(items[i]!["mid"]!["x"]), made[i].X, $"{c["name"]} anchor {i} x");
                    Same(D(items[i]!["mid"]!["y"]), made[i].Y, $"{c["name"]} anchor {i} y");
                }
                var labelItems = items.Select(i => new LabelItem(i!["id"]!.GetValue<string>(), i["path"]!.GetValue<string>(), new Pt(D(i["mid"]!["x"]), D(i["mid"]!["y"])), D(i["width"]), D(i["height"]),
                    i["pinned"]!.GetValue<bool>(), i["across"]!.AsArray().Select(line => (IReadOnlyList<Pt>)line!.AsArray().Select(p => new Pt(D(p!["x"]), D(p["y"]))).ToList()).ToList(), D(i["extra"]), D(i["clear"]), i["pair"]?.GetValue<string>())).ToList();
                var spots = LineLabels.PlaceSpots(labelItems, c["boxes"]!.AsArray().Select(r => new Rect(D(r!["x"]), D(r["y"]), D(r["width"]), D(r["height"]))).ToList());
                var want = c["spots"]!.AsArray();
                for (var i = 0; i < labelItems.Count; i++)
                {
                    Same(D(want[i]!["x"]), spots[labelItems[i].Id].At.X, $"{style} {c["name"]} label {i} x");
                    Same(D(want[i]!["y"]), spots[labelItems[i].Id].At.Y, $"{style} {c["name"]} label {i} y");
                    Assert.Equal(want[i]!["side"]?.GetValue<int>() ?? 0, spots[labelItems[i].Id].Side);
                    Assert.Equal(want[i]!["hidden"]?.GetValue<bool>() ?? false, spots[labelItems[i].Id].Hidden);
                }
            }
        }
    }

    [Fact]
    public void The_worked_example_of_a_staircase_has_the_corners_the_spec_gives()
    {
        // Two boxes whose facing sides meet at (0, 0) and (100, 50), 40 high so that three lanes are 10 apart (the room across is 20, less the margin of 10 each side).
        var a = new LaneBox("a", new Rect(-100, -20, 100, 40), []);
        var b = new LaneBox("b", new Rect(100, 30, 100, 40), []);
        var ports = BoxGeometry.PortsBetween(a.Rect, b.Rect);
        Assert.Equal((new Pt(0, 0), Side.Right, new Pt(100, 50), Side.Left), (ports.From, ports.FromSide, ports.To, ports.ToSide));
        Assert.Equal(10, Lanes.PitchFor(Lanes.RoomOf(a, b, "angled"), new LaneSlot(0, 3, 0)));
        var lanes = Bundle(a, b, 3, 0, LanePose.Rest, "angled");
        Assert.Equal("M0 10L34 10Q40 10 40 16L40 35Q40 60 65 60L100 60", lanes[2].Path);
        Assert.Equal(new Pt(40, 35), new Pt(lanes[2].X, lanes[2].Y));
        Assert.Equal("M0 0L34 0Q50 0 50 16L50 34Q50 50 66 50L100 50", lanes[1].Path);
        Assert.Equal("M0 -10L35 -10Q60 -10 60 15L60 34Q60 40 66 40L100 40", lanes[0].Path);
    }

    [Fact]
    public void The_worked_example_of_a_curve_is_a_curve_a_pitch_from_the_line_between_the_centres()
    {
        // Boxes 400 apart on one level, one lane each way, 9 above and below the line between the centres.
        var a = new LaneBox("a", new Rect(-100, -36, 200, 72), []);
        var b = new LaneBox("b", new Rect(300, -36, 200, 72), []);
        var (back, there) = (Lanes.LaneGeometry(b, a, new LaneSlot(0, 2, 1), LanePose.Rest, "curved"), Lanes.LaneGeometry(a, b, new LaneSlot(1, 2, 1), LanePose.Rest, "curved"));
        Assert.Equal("M100 9C200 9 200 9 300 9", there.Path);
        Assert.Equal("M300 -9C200 -9 200 -9 100 -9", back.Path);
        Assert.Equal(new Pt(200, 9), new Pt(there.X, there.Y));
        Assert.Equal(new Pt(200, -9), new Pt(back.X, back.Y));
        Assert.Equal(new Pt(100, -9), back.AsLinePath().End); // the head is at the end of the path whichever way the lane runs
        Assert.Equal(new Pt(300, 9), there.AsLinePath().End);
        Assert.Equal(new Pt(1, 0), there.AsLinePath().Direction);
    }

    [Theory]
    [InlineData("curved")]
    [InlineData("angled")]
    public void Where_the_sides_do_not_face_each_other_with_room_between_them_the_lanes_are_straight_in_either_style(string style)
    {
        LaneBox Box(string id, double cx, double cy) => new(id, new Rect(cx - 100, cy - 36, 200, 72), []);
        var cases = new List<(LaneBox, LaneBox)>
        {
            (Box("a", 0, 0), Box("b", 150, 0)), // overlapping
            (Box("a", 0, 0), Box("b", 200 + Lanes.MinRouteGap - 1, 0)), // less than the least gap between the sides
            (Box("a", 0, 0), Box("b", 0, 0)), // at one spot
        };
        if (style == "angled")
        {
            cases.Add((Box("a", 0, 0), Box("b", 400, 12))); // a staircase with a run shorter than the least
            cases.Add((Box("a", 0, 0), Box("b", 400, Lanes.AngleRun - 1)));
        }
        else cases.Add((Box("a", 0, 0), Box("b", 330, 230))); // a curve that runs along the sides in the middle
        foreach (var (a, b) in cases)
            foreach (var (lanes, back) in new[] { (2, 0), (3, 0), (3, 1) })
            {
                var made = Bundle(a, b, lanes, back, LanePose.Rest, style);
                var straight = Bundle(a, b, lanes, back, LanePose.Rest, "straight");
                Assert.Equal(straight.Select(l => l.Path), made.Select(l => l.Path));
                Same(Lanes.RoomOf(a, b, "straight"), Lanes.RoomOf(a, b, style), "room");
            }
    }

    [Fact]
    public void The_least_curve_and_the_least_staircase_are_drawn_and_a_little_less_is_not()
    {
        LaneBox Box(string id, double cx, double cy) => new(id, new Rect(cx - 100, cy - 36, 200, 72), []);
        string First(LaneBox a, LaneBox b, string style) => Bundle(a, b, 2, 0, LanePose.Rest, style)[0].Path;
        var (left, right) = (Box("a", 0, 0), Box("b", 200 + Lanes.MinRouteGap, 0));
        Assert.NotEqual(First(left, right, "straight"), First(left, right, "curved"));
        Assert.Contains('Q', First(Box("a", 0, 0), Box("b", 400, Lanes.AngleRun), "angled"));
        Assert.DoesNotContain('Q', First(Box("a", 0, 0), Box("b", 400, Lanes.AngleRun - 1), "angled"));
        // The share of the curve's middle that must run the way out of the sides, 40 between the sides: the rise at which a curve stops being drawn.
        var m = Lanes.GapLeast / Lanes.KappaMax;
        var rise = 40 * Math.Sqrt(1 / (m * m) - 1) / 2;
        bool Curve(double r) => First(Box("a", 0, 0), Box("b", 240, r), "curved").Contains('C');
        Assert.True(Curve(Math.Floor(rise) - 1));
        Assert.False(Curve(Math.Ceiling(rise) + 1));
    }

    [Fact]
    public void A_pair_that_is_spread_or_parted_keeps_its_ends_where_they_were_and_its_lanes_in_order_in_every_style()
    {
        var a = new LaneBox("a", new Rect(-100, -36, 200, 72), []);
        var b = new LaneBox("b", new Rect(300, 44, 200, 72), []);
        foreach (var style in new[] { "curved", "angled" })
        {
            var rest = Bundle(a, b, 4, 1, LanePose.Rest, style);
            foreach (var pose in new[] { LanePose.Spread, new LanePose(0, [0, 1, 0, 0]), new LanePose(1, [0, 0, 0.5, 0]) })
            {
                var moved = Bundle(a, b, 4, 1, pose, style);
                for (var i = 0; i < 4; i++)
                {
                    Assert.Equal(rest[i].Points[0], moved[i].Points[0]); // the shapes and the heads never move
                    Assert.Equal(rest[i].Points[^1], moved[i].Points[^1]);
                    Assert.Equal(rest[i].AsLinePath().End, moved[i].AsLinePath().End);
                    Assert.Equal(rest[i].AsLinePath().Start, moved[i].AsLinePath().Start);
                }
            }
        }
    }
}
