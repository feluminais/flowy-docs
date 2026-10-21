using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>ui/src/motion.ts, reproduced: what desktop/fixtures/beats.ts says about easing, progress and distance.</summary>
public class MotionMathTests
{
    private static JsonNode Motion() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "beats.json")))!["motion"]!;

    private static readonly Beat Span = new("blob", "line", 100, 400);
    private static readonly Beat Tube = new("pipe", "line", 0, 1000);

    [Fact]
    public void Autoplay_rests_as_long_as_the_browser_does()
    {
        Assert.Equal(MotionMath.Gap, Motion()["gap"]!.GetValue<double>());
        Assert.Equal(MotionMath.Dwell, Motion()["dwell"]!.GetValue<double>());
    }

    [Fact]
    public void Easing_and_bumps_agree()
    {
        var all = Motion()["ease"]!.AsArray();
        Assert.True(all.Count > 5);
        foreach (var e in all)
        {
            var p = e!["p"]!.GetValue<double>();
            Assert.Equal(e["ease"]!.GetValue<double>(), MotionMath.Ease(p), 9);
            Assert.Equal(e["bump"]!.GetValue<double>(), MotionMath.Bump(p), 9);
        }
    }

    [Fact]
    public void Every_effect_poses_a_blob_as_the_browser_does()
    {
        var all = Motion()["effects"]!.AsArray();
        Assert.Equal(360, all.Count);
        foreach (var e in all)
        {
            var effect = e!["effect"]?.GetValue<string>();
            var label = e["label"]!.GetValue<bool>();
            var angle = e["angle"]!.GetValue<double>() * Math.PI / 180;
            var want = e["pose"]!;
            var got = MotionMath.PoseOf(effect, label, angle, e["p"]!.GetValue<double>());
            var at = $"{effect} label={label} angle={e["angle"]} p={e["p"]}";
            Assert.True(Math.Abs(want["dy"]!.GetValue<double>() - got.Dy) < 1e-9, at);
            Assert.True(Math.Abs(want["turn"]!.GetValue<double>() * Math.PI / 180 - got.Turn) < 1e-9, at);
            Assert.True(Math.Abs(want["grow"]!.GetValue<double>() - got.Grow) < 1e-9, at);
            Assert.True(Math.Abs(want["rotate"]!.GetValue<double>() * Math.PI / 180 - got.Rotation) < 1e-9, at);
            Assert.True(Math.Abs(want["x"]!.GetValue<double>() - got.Sx) < 1e-9, at);
            Assert.True(Math.Abs(want["y"]!.GetValue<double>() - got.Sy) < 1e-9, at);
        }
    }

    [Fact]
    public void An_effect_leaves_and_lands_a_blob_as_it_is_and_never_turns_a_label_to_squish_it()
    {
        foreach (var effect in Animations.Effects)
        foreach (var label in new[] { true, false })
        foreach (var angle in new[] { 0.0, 0.4, 1.57, -1.2 })
        {
            foreach (var p in new[] { 0.0, 1.0 })
            {
                var ends = MotionMath.PoseOf(effect, label, angle, p);
                Assert.True(Math.Abs(ends.Dy) < 1e-9 && Math.Abs(ends.Turn) < 1e-9 && Math.Abs(ends.Grow - 1) < 1e-9 && Math.Abs(ends.Sx - 1) < 1e-9 && Math.Abs(ends.Sy - 1) < 1e-9, $"{effect} at {p}");
            }
            if (effect == "squish" && label) Assert.Equal(0, MotionMath.PoseOf(effect, label, angle, 0.5).Rotation); // so its edges stay level and upright
        }
        Assert.Equal(MotionMath.Still, MotionMath.PoseOf(null, true, 0.5, 0.5));
        Assert.Equal(MotionMath.Still, MotionMath.PoseOf("spin", true, 0.5, 0.5));
    }

    [Fact]
    public void Progress_activity_and_the_tube_fade_agree()
    {
        var all = Motion()["progress"]!.AsArray();
        Assert.True(all.Count > 5);
        foreach (var e in all)
        {
            var t = e!["t"]!.GetValue<double>();
            Assert.Equal(e["progress"]!.GetValue<double>(), MotionMath.Progress(Span, t), 9);
            Assert.Equal(e["active"]!.GetValue<bool>(), MotionMath.Active(Span, t));
            Assert.Equal(e["tube"]!.GetValue<double>(), MotionMath.TubeOpacity(Tube, t), 9);
        }
    }

    [Fact]
    public void A_blob_runs_forward_or_back_along_the_line()
    {
        var all = Motion()["distance"]!.AsArray();
        Assert.True(all.Count >= 6);
        foreach (var e in all)
            Assert.Equal(e!["distance"]!.GetValue<double>(), MotionMath.Distance(e["dir"]!.GetValue<string>(), e["p"]!.GetValue<double>(), 200), 9);
    }

    [Fact]
    public void A_blob_runs_between_the_fractions_of_the_line_it_is_given()
    {
        var all = Motion()["spans"]!.AsArray();
        Assert.True(all.Count >= 40);
        foreach (var e in all)
        {
            var span = e!["span"]!;
            Assert.Equal(
                e["distance"]!.GetValue<double>(),
                MotionMath.Distance(e["dir"]!.GetValue<string>(), e["p"]!.GetValue<double>(), 200, span["start"]?.GetValue<double>(), span["end"]?.GetValue<double>()), 9);
        }
        Assert.Equal(80, MotionMath.Distance("fwd", 1, 200, end: 0.4), 9);
        Assert.Equal(80, MotionMath.Distance("fwd", 0.3, 200, 0.4, 0.4), 9); // it waits where it is
    }

    [Fact]
    public void A_request_that_meets_an_outcome_has_the_same_colour_as_in_the_browser()
    {
        var all = Motion()["tints"]!.AsArray();
        Assert.True(all.Count >= 6);
        foreach (var e in all)
        {
            var (light, dark) = MotionMath.TintPair(e!["slot"]!.GetValue<int>());
            Assert.Equal(e["pair"]![0]!.GetValue<string>(), light);
            Assert.Equal(e["pair"]![1]!.GetValue<string>(), dark);
        }
        Assert.Equal(MotionMath.TintPair(0), MotionMath.TintPair(Animations.Tints.Length));
        foreach (var taken in new[] { "blue", "red", "amber", "gray" }) Assert.DoesNotContain(taken, Animations.Tints);
    }

    [Fact]
    public void A_note_and_a_marker_sit_on_the_lower_side_of_the_line_as_in_the_browser()
    {
        var all = Motion()["sides"]!.AsArray();
        Assert.True(all.Count >= 9);
        var size = MotionMath.MarkerSize("Café wifi proxy");
        foreach (var e in all)
        {
            double dx = e!["dx"]!.GetValue<double>(), dy = e["dy"]!.GetValue<double>();
            void Same(JsonNode? expected, (double X, double Y) actual)
            {
                Assert.Equal(expected!["x"]!.GetValue<double>(), actual.X, 9);
                Assert.Equal(expected["y"]!.GetValue<double>(), actual.Y, 9);
            }
            Same(e["label"], MotionMath.LabelOffset(dx, dy, 6));
            Same(e["lower"], MotionMath.LowerSide(dx, dy));
            Same(e["note"], MotionMath.NoteSpot(dx, dy, 10));
            Same(e["marker"], MotionMath.MarkerSpot(dx, dy, size));
            var (up, down) = (MotionMath.LabelOffset(dx, dy, 6), MotionMath.LowerSide(dx, dy));
            Assert.True(up.X * down.X + up.Y * down.Y < 0, "the label is on the other side");
        }
        Assert.Equal((0.0, 1.0), MotionMath.LowerSide(300, 0));
        Assert.Equal((-1.0, 0.0), MotionMath.LowerSide(0, 300));
    }

    [Fact]
    public void A_marker_is_as_wide_as_its_name()
    {
        foreach (var e in Motion()["markers"]!.AsArray())
        {
            var (width, height) = MotionMath.MarkerSize(e!["name"]!.GetValue<string>());
            Assert.Equal(e["size"]!["width"]!.GetValue<double>(), width);
            Assert.Equal(e["size"]!["height"]!.GetValue<double>(), height);
        }
    }

    [Fact]
    public void A_blob_taken_in_by_a_box_stops_at_its_edge()
    {
        var all = Motion()["entries"]!.AsArray();
        Assert.True(all.Count >= 8);
        foreach (var e in all)
        {
            var box = e!["box"]!;
            var (x, y) = MotionMath.EntryPoint((e["from"]!["x"]!.GetValue<double>(), e["from"]!["y"]!.GetValue<double>()),
                new Rect(box["x"]!.GetValue<double>(), box["y"]!.GetValue<double>(), box["width"]!.GetValue<double>(), box["height"]!.GetValue<double>()));
            Assert.Equal(e["point"]!["x"]!.GetValue<double>(), x, 9);
            Assert.Equal(e["point"]!["y"]!.GetValue<double>(), y, 9);
        }
    }

    [Fact]
    public void A_gulp_squashes_the_box_it_is_on_while_it_runs()
    {
        var (beats, _) = Animations.BeatsFor(new StepAnimation("send", "inside", null), 250, false);
        Assert.Equal((1.0, 0.0), MotionMath.Squash(beats, 125)); // the sender's squeeze, half way
        Assert.Equal((0.0, 0.0), MotionMath.Squash(beats, 700)); // the blob is on its way
        Assert.Equal((0.0, 1.0), MotionMath.Squash(beats, 1600)); // the receiver takes it in
        Assert.Equal((0.0, 0.0), MotionMath.Squash(beats, 5000));
    }

    [Fact]
    public void A_timeout_dims_the_lit_line_and_leaves_it_dimmed()
    {
        var all = Motion()["lit"]!.AsArray();
        Assert.True(all.Count >= 6);
        var (beats, _) = Animations.BeatsFor(new StepAnimation("call", "inside", null, "timeout"), 250, false);
        foreach (var e in all)
            Assert.Equal(e!["lit"]!.GetValue<double>(), MotionMath.LitOpacity(beats, e["t"]!.GetValue<double>()), 9);
        Assert.Equal(0.25, MotionMath.LitFloor);
    }

    [Fact]
    public void Beats_with_no_fade_leave_the_lit_line_at_full_strength()
    {
        var (beats, _) = Animations.BeatsFor(new StepAnimation("send", "inside", null), 250, false);
        foreach (var t in new[] { 0.0, 1000, 9000 }) Assert.Equal(1.0, MotionMath.LitOpacity(beats, t));
    }

    [Fact]
    public void A_box_several_steps_squash_takes_the_largest_squash_and_none_is_none()
    {
        Assert.Equal(0, MotionMath.Largest([]));
        Assert.Equal(0.5, MotionMath.Largest([0.2, 0.5, 0.1]));
    }
}
