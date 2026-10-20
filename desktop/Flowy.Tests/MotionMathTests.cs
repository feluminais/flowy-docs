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
    public void A_gulp_squashes_the_box_it_is_on_while_it_runs()
    {
        var (beats, _) = Animations.BeatsFor(new StepAnimation("send", "inside", null), 250, false);
        Assert.Equal((1.0, 0.0), MotionMath.Squash(beats, 125)); // the sender's squeeze, half way
        Assert.Equal((0.0, 0.0), MotionMath.Squash(beats, 700)); // the blob is on its way
        Assert.Equal((0.0, 1.0), MotionMath.Squash(beats, 1600)); // the receiver takes it in
        Assert.Equal((0.0, 0.0), MotionMath.Squash(beats, 5000));
    }

    [Fact]
    public void A_box_several_steps_squash_takes_the_largest_squash_and_none_is_none()
    {
        Assert.Equal(0, MotionMath.Largest([]));
        Assert.Equal(0.5, MotionMath.Largest([0.2, 0.5, 0.1]));
    }
}
