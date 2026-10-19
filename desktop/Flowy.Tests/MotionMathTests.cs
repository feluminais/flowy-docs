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
    public void The_pile_of_cards_slides_in_and_out_as_in_the_browser()
    {
        var all = Motion()["cards"]!.AsArray();
        Assert.True(all.Count > 400);
        foreach (var e in all)
        {
            var (beats, _) = Animations.BeatsFor(new StepAnimation("recurse", "inside", null, e!["depth"]!.GetValue<int>()), e["length"]!.GetValue<double>(), false);
            Assert.Equal(e["cards"]!.GetValue<double>(), MotionMath.CardsAt(beats, e["t"]!.GetValue<double>()), 9);
        }
    }

    [Fact]
    public void A_card_sits_where_the_browser_puts_it()
    {
        var all = Motion()["cardBoxes"]!.AsArray();
        Assert.Equal(16, all.Count);
        foreach (var e in all)
        {
            var box = MotionMath.CardBox(new Rect(10, 20, 200, 72), e!["k"]!.GetValue<int>(), e["amount"]!.GetValue<double>());
            var want = e["box"]!;
            Assert.Equal(want["x"]!.GetValue<double>(), box.X, 9);
            Assert.Equal(want["y"]!.GetValue<double>(), box.Y, 9);
            Assert.Equal(want["width"]!.GetValue<double>(), box.Width, 9);
            Assert.Equal(want["height"]!.GetValue<double>(), box.Height, 9);
        }
    }

    [Fact]
    public void The_counter_says_what_the_browsers_does_including_on_a_half()
    {
        var all = Motion()["pills"]!.AsArray();
        Assert.Equal(64, all.Count);
        foreach (var e in all)
            Assert.Equal(e!["text"]!.GetValue<string>(), MotionMath.PillText(e["playing"]!.GetValue<bool>(), e["cards"]!.GetValue<double>(), e["depth"]!.GetValue<int>()));
    }

    [Fact]
    public void With_one_box_at_both_ends_the_larger_squash_goes_on_the_first()
    {
        var all = Motion()["squashes"]!.AsArray();
        Assert.Equal(8, all.Count);
        foreach (var e in all)
        {
            var squash = e!["squash"]!;
            var (from, to) = MotionMath.TileSquash(e["sameBox"]!.GetValue<bool>(), (squash["from"]!.GetValue<double>(), squash["to"]!.GetValue<double>()));
            Assert.Equal(e["result"]!["from"]!.GetValue<double>(), from, 9);
            Assert.Equal(e["result"]!["to"]!.GetValue<double>(), to, 9);
        }
    }

    [Fact]
    public void A_gulp_squashes_the_box_it_is_on_while_it_runs()
    {
        var (beats, _) = Animations.BeatsFor(new StepAnimation("send", "inside", null), 250, false);
        Assert.Equal((1.0, 0.0), MotionMath.Squash(beats, 75)); // the sender's squeeze, half way
        Assert.Equal((0.0, 0.0), MotionMath.Squash(beats, 400)); // the blob is on its way
        Assert.Equal((0.0, 1.0), MotionMath.Squash(beats, 750)); // the receiver takes it in
        Assert.Equal((0.0, 0.0), MotionMath.Squash(beats, 5000));
    }
}
