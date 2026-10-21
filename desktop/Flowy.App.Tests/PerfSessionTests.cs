using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>Where the Performance panel stands along a run, and the ramp, on the fixtures' small shop ("ramp" has four levels), with no window: a clock and frames the test turns by hand.</summary>
public class PerfSessionTests
{
    private sealed class Screen
    {
        public double Clock;
        public int Draws;
        public int Snaps;
        public bool Reduced;
        public readonly Queue<Action> Frames = new();
        public IdMap<LoadRun> Runs = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "perf", "flowy")).Runs!;

        public PerfSession Session() => new(new PerfHooks(() => Runs, _ => Draws++, () => Snaps++, (_, _) => { }, Frames.Enqueue, () => Reduced, () => Clock));

        /// <summary>Lets <paramref name="milliseconds"/> go by in frames of 20 ms, as an animation would.</summary>
        public void Run(double milliseconds)
        {
            for (var t = 0.0; t < milliseconds && Frames.Count > 0; t += 20)
            {
                Clock += 20;
                Frames.Dequeue()();
            }
        }
    }

    private static PerfSession Opened(Screen screen)
    {
        var session = screen.Session();
        Assert.True(session.PickRun("ramp"));
        session.Open();
        return session;
    }

    [Fact]
    public void A_run_that_is_not_there_is_not_picked()
    {
        var screen = new Screen();
        var session = screen.Session();
        Assert.False(session.PickRun("nowhere"));
        Assert.Equal("", session.RunId);
    }

    [Fact]
    public void Opening_goes_to_a_tested_level_and_stops_a_ramp()
    {
        var screen = new Screen();
        var session = Opened(screen);
        Assert.Equal("ramp", session.RunId);
        Assert.False(session.Ramping);
        Assert.Equal(Math.Floor(session.Pos), session.Pos);
        Assert.InRange(session.Pos, 0, 3);
    }

    [Fact]
    public void Stepping_snaps_to_a_level_and_draws_it_once()
    {
        var screen = new Screen();
        var session = Opened(screen);
        session.StepLevel(1.4);
        Assert.Equal(1, session.Pos);
        Assert.Equal(1, screen.Draws);
        session.StepLevel(0.9); // the same level: the slider's thumb goes back, nothing is drawn again
        Assert.Equal(1, session.Pos);
        Assert.Equal(1, screen.Draws);
        Assert.Equal(1, screen.Snaps);
    }

    [Fact]
    public void A_position_is_held_to_the_levels()
    {
        var screen = new Screen();
        var session = Opened(screen);
        session.StepLevel(99);
        Assert.Equal(3, session.Pos);
        session.StepLevel(-5);
        Assert.Equal(0, session.Pos);
    }

    [Fact]
    public void A_ramp_from_the_top_starts_again_from_the_bottom_and_moves_with_the_clock()
    {
        var screen = new Screen();
        var session = Opened(screen);
        session.StepLevel(3);
        session.ToggleRamp();
        Assert.True(session.Ramping);
        Assert.Equal(0, session.Pos);
        Assert.Single(screen.Frames);
        screen.Run(3_000);
        Assert.InRange(session.Pos, 0.2, 0.4); // three levels in 30 s: a tenth of a level a second
    }

    [Fact]
    public void Pausing_a_ramp_keeps_where_it_has_got_to_and_asks_for_no_more_frames()
    {
        var screen = new Screen();
        var session = Opened(screen);
        session.StepLevel(0);
        session.ToggleRamp();
        screen.Run(5_000);
        session.ToggleRamp();
        var paused = session.Pos;
        Assert.False(session.Ramping);
        Assert.True(paused > 0);
        screen.Run(1_000); // the frame already asked for finds the ramp stopped
        Assert.Equal(paused, session.Pos);
        Assert.Empty(screen.Frames);
    }

    [Fact]
    public void A_ramp_ends_at_the_top()
    {
        var screen = new Screen();
        var session = Opened(screen);
        session.StepLevel(0);
        session.ToggleRamp();
        screen.Run(40_000);
        Assert.False(session.Ramping);
        Assert.Equal(3, session.Pos);
    }

    [Fact]
    public void Any_move_stops_a_ramp()
    {
        var screen = new Screen();
        var session = Opened(screen);
        session.StepLevel(0);
        session.ToggleRamp();
        session.JumpTo(2);
        Assert.False(session.Ramping);
        Assert.Equal(2, session.Pos);
    }

    [Fact]
    public void Reduced_motion_does_not_ramp()
    {
        var screen = new Screen { Reduced = true };
        var session = Opened(screen);
        session.ToggleRamp();
        Assert.False(session.Ramping);
        Assert.Empty(screen.Frames);
    }

    [Fact]
    public void A_window_that_was_asleep_does_not_jump()
    {
        var screen = new Screen();
        var session = Opened(screen);
        session.StepLevel(0);
        session.ToggleRamp();
        screen.Clock += 600_000; // ten minutes asleep
        screen.Frames.Dequeue()();
        Assert.InRange(session.Pos, 0, 0.05); // one step of at most 100 ms
    }
}
