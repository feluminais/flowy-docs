using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>The playhead and Autoplay with no window: a flow of five stops, and waits the test lets go by hand.</summary>
public class PlaybackTests
{
    private sealed class Rig
    {
        public const int Stops = 5;
        public bool Moving;
        public bool Playing = true;
        public int Redraws;
        public readonly List<(double Milliseconds, Action Then, Wait Handle)> Waits = [];
        public Playback Playback = null!;

        public sealed class Wait : IDisposable
        {
            public bool Cancelled;

            public void Dispose() => Cancelled = true;
        }

        public Rig()
        {
            Playback = new Playback(new PlaybackHooks(
                () => Playing && Playback.Head is { } head ? (head.Step, Stops) : null,
                () => Moving,
                () => Redraws++,
                (ms, then) =>
                {
                    var handle = new Wait();
                    Waits.Add((ms, then, handle));
                    return handle;
                }));
            Playback.Head = new Playhead("order", 0, []);
        }

        /// <summary>Lets the latest wait that was not cancelled run out.</summary>
        public void Elapse()
        {
            var live = Waits.Last(w => !w.Handle.Cancelled);
            live.Handle.Cancelled = true;
            live.Then();
        }
    }

    [Fact]
    public void A_step_starts_its_motion_once_and_a_replay_starts_it_again()
    {
        var rig = new Rig();
        Assert.True(rig.Playback.Begin("order", 0, out var first));
        Assert.False(rig.Playback.Begin("order", 0, out _)); // a hover or a theme redraws: no new motion
        Assert.True(rig.Playback.Begin("order", 1, out _));
        Assert.False(rig.Playback.Begin("order", 1, out _));
        rig.Playback.Replay();
        Assert.True(rig.Playback.Begin("order", 1, out var replayed));
        Assert.NotEqual(first, replayed);
        Assert.Equal(1, rig.Redraws);
    }

    [Fact]
    public void No_flow_playing_has_an_empty_key()
    {
        var rig = new Rig();
        rig.Playback.Begin("order", 0, out _);
        Assert.True(rig.Playback.Begin(null, 0, out var key));
        Assert.Equal("", key);
    }

    [Fact]
    public void Autoplay_waits_for_the_motion_then_rests_and_goes_on()
    {
        var rig = new Rig { Moving = true };
        rig.Playback.Begin("order", 0, out var key);
        rig.Playback.ToggleAuto();
        Assert.True(rig.Playback.Auto);
        Assert.Empty(rig.Waits); // the step is moving: its end settles it
        rig.Playback.Settled(key);
        Assert.Equal(MotionMath.Gap, rig.Waits[^1].Milliseconds);
        rig.Elapse();
        Assert.Equal(1, rig.Playback.Head!.Step);
        Assert.True(rig.Redraws >= 2);
    }

    [Fact]
    public void A_step_that_does_not_move_settles_after_a_moment()
    {
        var rig = new Rig();
        rig.Playback.Begin("order", 0, out _);
        rig.Playback.ToggleAuto();
        Assert.Equal(MotionMath.Dwell, rig.Waits[^1].Milliseconds);
        rig.Elapse();
        Assert.Equal(MotionMath.Gap, rig.Waits[^1].Milliseconds);
    }

    [Fact]
    public void Autoplay_stops_after_the_last_stop()
    {
        var rig = new Rig();
        rig.Playback.Head = new Playhead("order", Rig.Stops - 2, []);
        rig.Playback.Begin("order", Rig.Stops - 2, out var key);
        rig.Playback.ToggleAuto();
        rig.Playback.Settled(key);
        rig.Elapse();
        Assert.Equal(Rig.Stops - 1, rig.Playback.Head!.Step);
        rig.Playback.Begin("order", Rig.Stops - 1, out key);
        rig.Playback.ArmAuto();
        rig.Playback.Settled(key);
        rig.Elapse();
        Assert.False(rig.Playback.Auto);
        Assert.Equal(Rig.Stops - 1, rig.Playback.Head.Step);
    }

    [Fact]
    public void Autoplay_started_on_the_last_stop_begins_again_from_the_first()
    {
        var rig = new Rig();
        rig.Playback.Head = new Playhead("order", Rig.Stops - 1, []);
        rig.Playback.ToggleAuto();
        Assert.True(rig.Playback.Auto);
        Assert.Equal(0, rig.Playback.Head!.Step);
    }

    [Fact]
    public void A_wait_for_a_step_that_has_been_left_does_nothing()
    {
        var rig = new Rig();
        rig.Playback.Begin("order", 0, out var key);
        rig.Playback.ToggleAuto();
        rig.Playback.Settled(key);
        var waiting = rig.Waits[^1];
        rig.Playback.Begin("order", 1, out _); // the reader stepped on by hand
        waiting.Then();
        Assert.Equal(0, rig.Playback.Head!.Step);
    }

    [Fact]
    public void Stopping_cancels_the_wait_and_Toggling_again_ends_Autoplay()
    {
        var rig = new Rig();
        rig.Playback.Begin("order", 0, out _);
        rig.Playback.ToggleAuto();
        var waiting = rig.Waits[^1];
        rig.Playback.StopAuto();
        Assert.True(waiting.Handle.Cancelled);
        Assert.False(rig.Playback.Auto);

        rig.Playback.ToggleAuto();
        rig.Playback.ToggleAuto();
        Assert.False(rig.Playback.Auto);
    }

    [Fact]
    public void Nothing_playing_ignores_Autoplay_and_Replay()
    {
        var rig = new Rig { Playing = false };
        rig.Playback.ToggleAuto();
        rig.Playback.Replay();
        Assert.False(rig.Playback.Auto);
        Assert.Equal(0, rig.Redraws);
    }
}
