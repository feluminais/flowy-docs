using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>The playhead, Play and Pause, and Autoplay with no window: a flow of five stops, a player clock on a wall the test moves, and waits the test lets go by hand.</summary>
public class PlaybackTests
{
    private sealed class Rig
    {
        public const int Stops = 5;
        public bool Moving;
        public bool Playing = true;
        public int Redraws;
        public double Wall;
        public readonly List<(double Milliseconds, Action Then, Wait Handle)> Waits = [];
        public Playback Playback = null!;
        public PlayerClock Clock = null!;

        public sealed class Wait : IDisposable
        {
            public bool Cancelled;

            public void Dispose() => Cancelled = true;
        }

        public Rig()
        {
            Clock = new PlayerClock(() => Wall, (ms, then) =>
            {
                var handle = new Wait();
                Waits.Add((ms, then, handle));
                return handle;
            });
            Playback = new Playback(new PlaybackHooks(
                () => Playing && Playback.Head is { } head ? (head.Step, Stops) : null,
                () => Moving,
                () => Redraws++,
                Clock.After,
                Clock));
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
    public void Autoplay_waits_on_the_last_stop_and_stays_on()
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
        Assert.True(rig.Playback.Auto);
        Assert.DoesNotContain(rig.Waits, w => !w.Handle.Cancelled); // nothing comes after the last
        Assert.False(rig.Playback.ShowsPause); // the button says Play
        Assert.Equal(Rig.Stops - 1, rig.Playback.Head.Step);
    }

    [Fact]
    public void Play_with_Autoplay_on_the_last_stop_begins_again_from_the_first()
    {
        var rig = new Rig();
        rig.Playback.Head = new Playhead("order", Rig.Stops - 1, []);
        rig.Playback.Begin("order", Rig.Stops - 1, out var key);
        rig.Playback.ToggleAuto();
        rig.Playback.Settled(key);
        rig.Playback.TogglePlay();
        Assert.True(rig.Playback.Auto);
        Assert.Equal(0, rig.Playback.Head!.Step);
    }

    [Fact]
    public void Play_on_a_step_that_has_played_out_runs_it_again()
    {
        var rig = new Rig { Moving = true };
        rig.Playback.Head = new Playhead("order", 2, []);
        rig.Playback.Begin("order", 2, out var key);
        rig.Moving = false;
        rig.Playback.Settled(key);
        Assert.False(rig.Playback.ShowsPause);
        rig.Moving = true;
        rig.Playback.TogglePlay();
        Assert.Equal(2, rig.Playback.Head!.Step);
        Assert.True(rig.Playback.Begin("order", 2, out _)); // a new play of the same step
        Assert.True(rig.Playback.ShowsPause);
        Assert.False(rig.Playback.Auto);
    }

    [Fact]
    public void A_step_that_does_not_move_can_be_paused_too()
    {
        var rig = new Rig();
        rig.Playback.Begin("order", 0, out _);
        Assert.True(rig.Playback.ShowsPause);
        rig.Playback.TogglePlay();
        Assert.True(rig.Playback.Paused);
        rig.Playback.TogglePlay();
        Assert.False(rig.Playback.Paused);
        Assert.False(rig.Playback.Auto);
        Assert.Equal(0, rig.Playback.Head!.Step);
    }

    [Fact]
    public void Autoplay_does_not_start_a_paused_step()
    {
        var rig = new Rig();
        rig.Playback.Begin("order", 0, out _);
        rig.Playback.TogglePlay();
        rig.Playback.ToggleAuto();
        Assert.True(rig.Playback.Paused);
        Assert.DoesNotContain(rig.Waits, w => !w.Handle.Cancelled); // the wait stands still with the clock
        rig.Playback.TogglePlay();
        Assert.Equal(MotionMath.Dwell, rig.Waits[^1].Milliseconds);
    }

    [Fact]
    public void Autoplay_turned_on_after_a_step_is_over_goes_on_to_the_next()
    {
        var rig = new Rig { Moving = true };
        rig.Playback.Begin("order", 0, out var key);
        rig.Moving = false;
        rig.Playback.Settled(key);
        rig.Playback.ToggleAuto();
        Assert.Equal(MotionMath.Gap, rig.Waits[^1].Milliseconds);
        rig.Elapse();
        Assert.Equal(1, rig.Playback.Head!.Step);
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
    public void Stopping_cancels_the_wait_and_Pause_leaves_Autoplay_on()
    {
        var rig = new Rig();
        rig.Playback.Begin("order", 0, out _);
        rig.Playback.ToggleAuto();
        var waiting = rig.Waits[^1];
        rig.Playback.StopAuto();
        Assert.True(waiting.Handle.Cancelled);
        Assert.False(rig.Playback.Auto);

        rig.Playback.ToggleAuto();
        rig.Playback.TogglePlay();
        Assert.True(rig.Playback.Paused);
        Assert.True(rig.Playback.Auto);
    }

    [Fact]
    public void Nothing_playing_ignores_Play_and_Replay()
    {
        var rig = new Rig { Playing = false };
        rig.Playback.TogglePlay();
        rig.Playback.Replay();
        Assert.False(rig.Playback.Auto);
        Assert.Equal(0, rig.Redraws);
    }

    [Fact]
    public void Pause_holds_a_moving_step_and_Play_carries_on_from_there()
    {
        var rig = new Rig { Moving = true };
        rig.Playback.Begin("order", 0, out _);
        Assert.True(rig.Playback.ShowsPause);
        rig.Wall += 300;
        rig.Playback.TogglePlay();
        Assert.True(rig.Playback.Paused);
        Assert.False(rig.Playback.Auto);
        Assert.False(rig.Playback.ShowsPause);
        rig.Wall += 1000;
        Assert.Equal(300, rig.Clock.Elapsed);
        rig.Playback.TogglePlay();
        Assert.False(rig.Playback.Paused);
        Assert.False(rig.Playback.Auto); // Play is the clock: it doesn't turn Autoplay on
        Assert.Equal(300, rig.Clock.Elapsed); // it carries on where it was, not from the start
    }

    [Fact]
    public void Pausing_in_the_rest_does_not_move_on()
    {
        var rig = new Rig();
        rig.Playback.Begin("order", 0, out _);
        rig.Playback.ToggleAuto();
        rig.Elapse(); // the still step's moment is over: the rest before the next
        var resting = rig.Waits[^1];
        Assert.Equal(MotionMath.Gap, resting.Milliseconds);
        rig.Playback.TogglePlay();
        Assert.True(resting.Handle.Cancelled);
        Assert.Equal(0, rig.Playback.Head!.Step);
        rig.Playback.TogglePlay();
        rig.Elapse();
        Assert.Equal(1, rig.Playback.Head.Step);
    }

    [Fact]
    public void Next_while_paused_stays_paused_on_the_first_moment_of_the_next_step()
    {
        var rig = new Rig { Moving = true };
        rig.Playback.Begin("order", 0, out _);
        rig.Wall += 300;
        rig.Playback.TogglePlay();
        rig.Playback.Head = rig.Playback.Head! with { Step = 1 };
        rig.Playback.Begin("order", 1, out _);
        Assert.True(rig.Playback.Paused);
        Assert.Equal(0, rig.Clock.Elapsed);
    }

    [Fact]
    public void Another_flow_plays_again()
    {
        var rig = new Rig { Moving = true };
        rig.Playback.Begin("order", 0, out _);
        rig.Playback.TogglePlay();
        Assert.True(rig.Playback.Paused);
        rig.Playback.Begin("refund", 0, out _);
        Assert.False(rig.Playback.Paused);
    }

    [Fact]
    public void A_step_you_took_that_stops_moving_redraws_so_the_button_says_Play()
    {
        var rig = new Rig { Moving = true };
        rig.Playback.Begin("order", 0, out var key);
        Assert.True(rig.Playback.ShowsPause);
        rig.Moving = false;
        rig.Playback.Settled(key);
        Assert.Equal(1, rig.Redraws);
        Assert.False(rig.Playback.ShowsPause);
    }

    [Fact]
    public void Nudge_moves_a_paused_step_a_moment_back_or_on()
    {
        var rig = new Rig { Moving = true };
        rig.Playback.Begin("order", 0, out _);
        rig.Clock.Declare(1000);
        rig.Playback.Nudge(1);
        Assert.Equal(0, rig.Clock.Elapsed); // not while it plays
        rig.Playback.TogglePlay();
        rig.Playback.Nudge(1);
        Assert.Equal(100, rig.Clock.Elapsed);
        rig.Playback.Nudge(-1);
        rig.Playback.Nudge(-1);
        Assert.Equal(0, rig.Clock.Elapsed);
    }

    [Fact]
    public void Dragging_the_bar_holds_the_player_goes_to_the_moment_and_lets_go_as_it_was()
    {
        var rig = new Rig();
        rig.Playback.Begin("order", 0, out _);
        rig.Playback.ScrubStart();
        Assert.True(rig.Playback.Paused);
        rig.Playback.ScrubTo(2, 0.5);
        Assert.Equal(2, rig.Playback.Head!.Step);
        rig.Playback.Begin("order", 2, out _); // the reader draws the stop
        rig.Clock.Declare(1000); // and its motion says how long it is
        Assert.Equal(500, rig.Clock.Elapsed);
        rig.Playback.ScrubTo(2, 0.25);
        Assert.Equal(250, rig.Clock.Elapsed);
        rig.Playback.ScrubEnd();
        Assert.False(rig.Playback.Paused);
    }

    [Fact]
    public void Dragging_the_bar_while_paused_stays_paused_when_let_go()
    {
        var rig = new Rig { Moving = true };
        rig.Playback.Begin("order", 0, out _);
        rig.Playback.TogglePlay();
        rig.Playback.ScrubStart();
        rig.Playback.ScrubTo(0, 0.5);
        rig.Playback.ScrubEnd();
        Assert.True(rig.Playback.Paused);
    }

    [Fact]
    public void Play_after_dragging_back_into_a_step_plays_the_rest_of_it_and_the_button_says_Play_at_its_end()
    {
        var rig = new Rig { Moving = true };
        rig.Playback.Begin("order", 0, out var key);
        rig.Clock.Declare(1000);
        rig.Wall += 1000;
        rig.Moving = false;
        rig.Playback.Settled(key);
        Assert.False(rig.Playback.ShowsPause);
        rig.Playback.ScrubStart();
        rig.Playback.ScrubTo(0, 0.5);
        rig.Playback.ScrubEnd();
        rig.Moving = true;
        rig.Playback.TogglePlay(); // it stayed paused there, as it had played out
        Assert.False(rig.Playback.Begin("order", 0, out _)); // the same play: it carries on
        Assert.True(rig.Playback.ShowsPause);
        var before = rig.Redraws;
        rig.Wall += 500;
        rig.Elapse();
        Assert.Equal(before + 1, rig.Redraws);
        Assert.False(rig.Playback.ShowsPause);
    }

    [Fact]
    public void The_bar_takes_the_cell_under_the_pointer_or_the_nearest_and_how_far_along_it_is()
    {
        // Two cells side by side, and a branch's second lane under the second.
        var cells = new List<PlayerCard.CellBox> { new(0, 0, 100, 4, 0), new(103, 0, 100, 4, 1), new(103, 26, 100, 4, 2) };
        Assert.Equal((1, 0.5), PlayerCard.CellAt(cells, 153, 2));
        Assert.Equal((0, 1.0), PlayerCard.CellAt(cells, 101, 6)); // between two cells and a little below them: the nearer
        Assert.Equal((2, 0.5), PlayerCard.CellAt(cells, 153, 27)); // the lane below: its cell
    }

    [Fact]
    public void Dragging_back_into_a_step_that_has_played_waits_for_its_motion_before_the_rest()
    {
        var rig = new Rig { Moving = true };
        rig.Playback.Begin("order", 0, out var key);
        rig.Clock.Declare(1000);
        rig.Playback.ToggleAuto();
        rig.Wall += 1000;
        rig.Moving = false;
        rig.Playback.Settled(key);
        Assert.Equal(MotionMath.Gap, rig.Waits[^1].Milliseconds);
        rig.Playback.ScrubStart();
        rig.Playback.ScrubTo(0, 0.5); // back to the middle of its motion
        rig.Playback.ScrubEnd();
        Assert.Equal(500 + MotionMath.Gap, rig.Waits[^1].Milliseconds); // the rest of the motion, then the rest before the next
    }
}

