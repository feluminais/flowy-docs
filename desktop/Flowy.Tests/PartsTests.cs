using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;
using static Flowy.Tests.LanesTests;

namespace Flowy.Tests;

/// <summary>
/// The lines of a pair parting around the one a step rides (src/core/lanes.ts, src/core/animation.ts and ui/src/parts.ts, desktop/fixtures/lanes.ts `dumpParts`): the beat, the easings, the pose of the
/// player's clock, the lanes at those poses, what each stop asks of a pair, how far the marks of an outcome may reach and how a lit line fades. Every number is the browser's.
/// </summary>
public class PartsTests
{
    private static JsonNode Parts() => Expected("parts");

    private static IReadOnlyList<double> Lam(JsonNode? n) => n!.AsArray().Select(D).ToList();

    /// <summary>An animation as the dump has it (the TypeScript's <c>Animation</c>, already read), as the record Flowy.Core plays beats from.</summary>
    private static StepAnimation AnimationOf(JsonNode a) => new(
        a["kind"]!.GetValue<string>(), a["trigger"]!.GetValue<string>(), a["carries"]?.GetValue<string>(), a["outcome"]?.GetValue<string>(), a["share"]?.GetValue<int>(), a["reason"]?.GetValue<string>(),
        a["by"] is { } by ? new Interceptor(by["shape"]?.GetValue<string>(), by["name"]?.GetValue<string>()) : null, a["at"]?.GetValue<double>(), a["effect"]?.GetValue<string>(),
        a["opens"]?.GetValue<string>(), a["name"]?.GetValue<string>(), a["towards"]?.GetValue<string>(), a["closes"]?.GetValue<string>(), a["depth"]?.GetValue<int>(), a["returns"]?.GetValue<string>(), a["replies"]?.GetValue<string>());

    private static Lanes.PartEasing Ease(JsonNode? n) => n!.GetValue<string>() == "out" ? Lanes.PartEasing.Out : Lanes.PartEasing.Smooth;

    private static JsonObject PartingJson(Lanes.Parting p) => new()
    {
        ["from"] = new JsonArray(p.From.Select(l => (JsonNode?)l).ToArray()),
        ["to"] = new JsonArray(p.To.Select(l => (JsonNode?)l).ToArray()),
        ["at"] = p.At,
        ["dur"] = p.Dur,
        ["ease"] = p.Ease == Lanes.PartEasing.Out ? "out" : "smooth",
    };

    [Fact]
    public void The_constants_are_the_browsers()
    {
        var c = Parts()["constants"]!;
        Assert.Equal(Animations.PartMs, D(c["PART_MS"]));
        Assert.Equal(Animations.PartLead, D(c["PART_LEAD"]));
        Assert.Equal(Lanes.PartClear, D(c["PART_CLEAR"]));
        Assert.Equal(Lanes.ShiftMs, D(c["SHIFT_MS"]));
        Assert.Equal(Lanes.JumpMs, D(c["JUMP_MS"]));
        Assert.Equal(Lanes.KinOpacity, D(c["KIN_OPACITY"]));
        Assert.Equal(Lanes.LitFloorLanes, D(c["LIT_FLOOR_LANES"]));
        Assert.Equal(MotionMath.LitFloor, D(c["LIT_FLOOR"]));
        Assert.Equal(Flowy.Core.Parts.Steps, D(c["STEPS"]));
    }

    [Fact]
    public void The_two_easings_go_as_the_browsers_do()
    {
        var all = Parts()["eases"]!.AsArray();
        Assert.Equal(14, all.Count);
        foreach (var e in all) Same(D(e!["e"]), Lanes.Round3(Lanes.PartEase(Ease(e["kind"]), D(e["p"]))), $"{e["kind"]} at {e["p"]}");
    }

    [Fact]
    public void A_step_among_several_lines_has_a_part_beat_and_the_same_total()
    {
        var all = Parts()["beats"]!.AsArray();
        Assert.Equal(56, all.Count);
        foreach (var b in all)
        {
            var lanes = b!["lanes"]!.GetValue<int>();
            var animation = b["animation"]!;
            var a = AnimationOf(animation);
            var (beats, total) = Animations.BeatsFor(a, 250, b["afterLanding"]!.GetValue<bool>(), lanes);
            var what = $"{animation["kind"]} {animation["outcome"]} after landing {b["afterLanding"]}, {lanes} lanes";
            Assert.True(b["total"]!.GetValue<int>() == total, what);
            Assert.Equal(JsonDump.Pretty(b["beats"]), JsonDump.Pretty(new JsonArray(beats.Select(x => (JsonNode?)BeatsTests.Json(x)).ToArray())));
            var part = Animations.PartOf(beats);
            Assert.Equal(b["part"] is null, part is null);
            if (part is { } p)
            {
                Assert.Equal(b["part"]!["at"]!.GetValue<int>(), p.At);
                Assert.Equal(b["part"]!["dur"]!.GetValue<int>(), p.Dur);
            }
            // The part beat opens inside the lead-ins every step has: it never changes how long the step takes.
            Assert.Equal(total, Animations.BeatsFor(a, 250, b["afterLanding"]!.GetValue<bool>()).Total);
        }
    }

    /// <summary>The six partings the fixture works out, by name, as the TypeScript asks for them.</summary>
    private static Lanes.Parting Named(string name) => name switch
    {
        "a first parting at the beat" => Lanes.PartingFor([0, 0, 0], [0, 1, 0], (200, Animations.PartMs)),
        "a first parting of a step with no motion" => Lanes.PartingFor([0, 0, 0], [1, 0, 0]),
        "the next step on another lane" => Lanes.PartingFor([0, 1, 0], [0, 0, 1], (200, Animations.PartMs)),
        "the stop is left" => Lanes.PartingFor([0, 0, 1], [0, 0, 0], (200, Animations.PartMs)),
        "a jump from half way" => Lanes.PartingFor([0, 0.4, 0], [1, 0, 0], (600, Animations.PartMs), jump: true),
        "two lit lanes at once" => Lanes.PartingFor([0, 0, 0, 0, 0], [0, 1, 1, 0, 0]),
        _ => throw new ArgumentException(name),
    };

    [Fact]
    public void A_parting_goes_from_pose_to_pose_over_the_clock_as_the_browser_has_it()
    {
        var all = Parts()["partings"]!.AsArray();
        Assert.Equal(6, all.Count);
        foreach (var p in all)
        {
            var name = p!["name"]!.GetValue<string>();
            var want = p["parting"]!;
            var parting = Named(name);
            Assert.Equal(JsonDump.Pretty(want), JsonDump.Pretty(PartingJson(parting)));
            // The parting a fixture is read back from is the same one: the pose comes from it alone.
            var read = new Lanes.Parting(Lam(want["from"]), Lam(want["to"]), D(want["at"]), D(want["dur"]), Ease(want["ease"]));
            foreach (var at in p["poses"]!.AsArray())
            {
                var pose = Lanes.PoseAt(read, D(at!["clock"]));
                Same(D(at["s"]), pose.S, $"{name} s at {at["clock"]}");
                Assert.Equal(at["rest"]!.GetValue<bool>(), ReferenceEquals(pose, LanePose.Rest));
                var lam = at["lam"]!.AsArray();
                Assert.Equal(lam.Count, pose.Lam.Count);
                for (var j = 0; j < lam.Count; j++) Same(D(lam[j]), pose.Lam[j], $"{name} lane {j} at {at["clock"]}");
                Assert.Equal(pose, Lanes.PoseAt(parting, D(at["clock"])), new PoseComparer());
            }
        }
    }

    private sealed class PoseComparer : IEqualityComparer<LanePose>
    {
        public bool Equals(LanePose? a, LanePose? b) => a is not null && b is not null && a.S == b.S && a.Lam.SequenceEqual(b.Lam);

        public int GetHashCode(LanePose p) => p.S.GetHashCode();
    }

    [Fact]
    public void A_pair_at_rest_is_the_one_rest_pose_and_the_pose_never_spreads()
    {
        var closed = Lanes.PoseAt(Lanes.PartingFor([0, 1, 0], [0, 0, 0]), 5000);
        Assert.Same(LanePose.Rest, closed);
        foreach (var clock in new[] { -50.0, 0, 60, 120, 400 }) Assert.Equal(0, Lanes.PoseAt(Lanes.PartingFor([0, 0, 0], [0, 1, 0], (0, 225)), clock).S);
        // A parting with no length is over at once.
        Assert.Equal(new[] { 0.0, 1 }, Lanes.PoseAt(new Lanes.Parting([0, 0], [0, 1], 0, 0, Lanes.PartEasing.Out), 0).Lam);
    }

    [Fact]
    public void The_lanes_of_a_pair_parted_around_a_lit_one_are_drawn_where_the_browser_draws_them()
    {
        var all = Parts()["lanes"]!.AsArray();
        Assert.Equal(10, all.Count);
        var rest = Expected("rest").AsArray();
        foreach (var item in all)
        {
            var e = item!;
            var config = rest.Single(c => c!["name"]!.GetValue<string>() == e["name"]!.GetValue<string>())!;
            var (a, b) = (Box(config["a"]!), Box(config["b"]!));
            var (lanes, back, lit) = (e["lanes"]!.GetValue<int>(), e["back"]!.GetValue<int>(), e["lit"]!.GetValue<int>());
            var parting = Lanes.PartingFor(new double[lanes], Enumerable.Range(0, lanes).Select(k => k == lit ? 1.0 : 0).ToList(), (0, Animations.PartMs));
            var made = Bundle(a, b, lanes, back, Lanes.PoseAt(parting, D(e["clock"])));
            var lines = e["lines"]!.AsArray();
            for (var i = 0; i < lanes; i++) SameLane(lines[i]!, made[i], $"{e["name"]} at {e["clock"]}, lane {i}");
        }
    }

    [Fact]
    public void A_stop_asks_each_pair_for_its_lit_lanes_and_the_earliest_part_beat()
    {
        var model = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "separate-lanes", "flowy")).Model;
        var strands = Views.Compute(model, "root").Strands!;
        var all = Parts()["plans"]!.AsArray();
        Assert.Equal(6, all.Count);
        foreach (var c in all)
        {
            var steps = new List<(string? Strand, IReadOnlyList<Beat>? Beats)>();
            foreach (var s in c!["steps"]!.AsArray())
            {
                var strand = s!["strand"]?.GetValue<string>();
                if (s["animation"] is not { } animation || strand is null)
                {
                    steps.Add((strand, null));
                    continue;
                }
                steps.Add((strand, Animations.BeatsFor(AnimationOf(animation), 250, false, strands.Single(x => x.Id == strand).Lanes).Beats));
            }
            var plan = Flowy.Core.Parts.PlanOf(strands, steps);
            var want = c["plan"]!.AsArray();
            Assert.Equal(want.Count, plan.Count);
            for (var i = 0; i < want.Count; i++)
            {
                Assert.Equal(want[i]![0]!.GetValue<string>(), plan.GetAt(i).Key);
                var (wantLit, got) = (want[i]![1]!, plan.GetAt(i).Value);
                Assert.Equal(Lam(wantLit["lit"]), got.Lit);
                Assert.Equal(wantLit["beat"] is null, got.Beat is null);
                if (got.Beat is { } beat)
                {
                    Same(D(wantLit["beat"]!["at"]), beat.At, $"{c["name"]} beat start");
                    Same(D(wantLit["beat"]!["dur"]), beat.Dur, $"{c["name"]} beat length");
                }
            }
            var lit = Lanes.LitLanes(strands, steps.Select(s => s.Strand).OfType<string>());
            var wantLanes = c["lit"]!.AsArray();
            Assert.Equal(wantLanes.Count, lit.Count);
            for (var i = 0; i < wantLanes.Count; i++)
            {
                Assert.Equal(wantLanes[i]![0]!.GetValue<string>(), lit.GetAt(i).Key);
                Assert.Equal(Lam(wantLanes[i]![1]), lit.GetAt(i).Value);
            }
        }
    }

    [Fact]
    public void The_gap_beside_a_lane_and_how_far_its_marks_may_reach_are_the_browsers()
    {
        var rest = Expected("rest").AsArray();
        var boxes = new Dictionary<string, (LaneBox A, LaneBox B)>();
        foreach (var name in new[] { "beside (short sides)", "diamond and ellipse", "close together" })
        {
            var config = rest.Single(c => c!["name"]!.GetValue<string>() == name)!;
            boxes[name] = (Box(config["a"]!), Box(config["b"]!));
        }
        // The cases the dump asks about, in its order: the fourth pairs the first box of the first pair with the second of the last.
        var sets = new (string Name, LaneBox A, LaneBox B)[]
        {
            ("beside, 3 lanes", boxes["beside (short sides)"].A, boxes["beside (short sides)"].B),
            ("beside, 5 lanes, 2 back", boxes["beside (short sides)"].A, boxes["beside (short sides)"].B),
            ("diamond and ellipse, 5 lanes, 2 back", boxes["diamond and ellipse"].A, boxes["diamond and ellipse"].B),
            ("close together, 3 lanes", boxes["beside (short sides)"].A, boxes["close together"].B),
        };
        var all = Parts()["gaps"]!.AsArray();
        Assert.Equal(12, all.Count);
        foreach (var g in all)
        {
            var name = g!["name"]!.GetValue<string>();
            var (_, a, b) = sets.Single(s => s.Name == name);
            var (lanes, back, lit) = (g["lanes"]!.GetValue<int>(), g["back"]!.GetValue<int>(), g["lit"]!.GetValue<int>());
            var slot = new LaneSlot(lit, lanes, back);
            var parted = new LanePose(0, Enumerable.Range(0, lanes).Select(k => k == lit ? 1.0 : 0).ToList());
            foreach (var at in g["at"]!.AsArray())
            {
                Same(D(at!["rest"]), Lanes.GapBeside(a, b, slot, LanePose.Rest, D(at["t"])), $"{name}, lane {lit}, rest at {at["t"]}");
                Same(D(at["parted"]), Lanes.GapBeside(a, b, slot, parted, D(at["t"])), $"{name}, lane {lit}, parted at {at["t"]}");
            }
            Same(D(g["reach"]), Lanes.BundleReach(a, b, slot), $"{name}, lane {lit} reach");
        }
        var alone = Parts()["alone"]!;
        var one = boxes["beside (short sides)"];
        Assert.Equal(alone["gapIsInfinite"]!.GetValue<bool>(), double.IsPositiveInfinity(Lanes.GapBeside(one.A, one.B, new LaneSlot(0, 1, 0), LanePose.Rest, 0.5)));
        Same(D(alone["reach"]), Lanes.BundleReach(one.A, one.B, new LaneSlot(0, 1, 0)), "reach of a lone line");
    }

    [Fact]
    public void A_mark_keeps_to_the_gap_beside_its_lane_and_streams_start_out_of_step()
    {
        foreach (var m in Parts()["marks"]!.AsArray()) Same(D(m!["reach"]), Lanes.MarkReach(D(m["half"]), D(m["gap"])), $"reach of {m["half"]} in a gap of {m["gap"]}");
        Same(D(Parts()["markReachAlone"]), Lanes.MarkReach(22, double.PositiveInfinity), "a lone line keeps the whole extent");
        foreach (var p in Parts()["phases"]!.AsArray()) Same(D(p!["px"]), Lanes.DashPhase(p["lane"]!.GetValue<int>(), p["lanes"]!.GetValue<int>()), $"phase of lane {p["lane"]} of {p["lanes"]}");
    }

    [Fact]
    public void A_lit_line_among_others_fades_to_half_and_a_marker_clears_the_whole_bundle()
    {
        var (beats, _) = Animations.BeatsFor(new StepAnimation("call", "inside", null), 250, false);
        var timesOut = new[] { new Beat("fade", "line", 1000, 600) };
        Assert.DoesNotContain(beats, b => b.Do == "fade");
        foreach (var l in Parts()["motion"]!["litOpacity"]!.AsArray())
        {
            var floor = l!["floor"] is null ? MotionMath.LitFloor : D(l["floor"]);
            Same(D(l["opacity"]), MotionMath.LitOpacity(timesOut, D(l["t"]), floor), $"lit opacity at {l["t"]}, floor {l["floor"]}");
        }
        foreach (var m in Parts()["motion"]!["markerSpot"]!.AsArray())
        {
            var (x, y) = MotionMath.MarkerSpot(D(m!["dx"]), D(m["dy"]), (100, 28), D(m["clear"]));
            Same(D(m["at"]!["x"]), x, $"marker x from {m["dx"]},{m["dy"]} clear {m["clear"]}");
            Same(D(m["at"]!["y"]), y, $"marker y from {m["dx"]},{m["dy"]} clear {m["clear"]}");
        }
    }
}
