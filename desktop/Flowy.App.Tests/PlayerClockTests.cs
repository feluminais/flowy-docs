using Flowy.App.Canvas;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>The flow player's time with no window: a wall clock and waits the test moves by hand. The browser's clock (ui/src/clock.ts) passes the same cases.</summary>
public class PlayerClockTests
{
    private sealed class Rig
    {
        public double Wall;
        public readonly List<(double At, Action Then, Wait Handle)> Waits = [];
        public readonly PlayerClock Clock;

        public sealed class Wait : IDisposable
        {
            public bool Cancelled;

            public void Dispose() => Cancelled = true;
        }

        public Rig() => Clock = new PlayerClock(() => Wall, (ms, then) =>
        {
            var handle = new Wait();
            Waits.Add((Wall + ms, then, handle));
            return handle;
        });

        /// <summary>Moves the wall clock on, running the waits that fall due on the way.</summary>
        public void Move(double ms)
        {
            var until = Wall + ms;
            while (Waits.Where(w => !w.Handle.Cancelled && w.At <= until).OrderBy(w => w.At).FirstOrDefault() is { Then: not null } due)
            {
                Wall = due.At;
                due.Handle.Cancelled = true;
                due.Then();
            }
            Wall = until;
        }
    }

    [Fact]
    public void The_speeds_are_half_normal_and_double() => Assert.Equal([0.5, 1, 2], PlayerClock.Speeds);

    [Fact]
    public void Elapsed_runs_at_the_rate()
    {
        var rig = new Rig();
        rig.Clock.SetRate(2);
        rig.Move(100);
        Assert.Equal(200, rig.Clock.Elapsed);
    }

    [Fact]
    public void Pause_freezes_and_Play_carries_on_from_the_same_moment()
    {
        var rig = new Rig();
        rig.Move(300);
        rig.Clock.Pause();
        rig.Move(500);
        Assert.Equal(300, rig.Clock.Elapsed);
        rig.Clock.Play();
        rig.Move(100);
        Assert.Equal(400, rig.Clock.Elapsed);
    }

    [Fact]
    public void Restart_keeps_paused()
    {
        var rig = new Rig();
        rig.Move(300);
        rig.Clock.Pause();
        rig.Clock.Restart();
        Assert.Equal(0, rig.Clock.Elapsed);
        Assert.True(rig.Clock.Paused);
        rig.Move(400);
        Assert.Equal(0, rig.Clock.Elapsed);
    }

    [Fact]
    public void Seek_clamps_to_the_length()
    {
        var rig = new Rig();
        rig.Clock.Declare(1000);
        rig.Clock.Seek(5000);
        Assert.Equal(1000, rig.Clock.Elapsed);
        rig.Clock.Seek(-1);
        Assert.Equal(0, rig.Clock.Elapsed);
    }

    [Fact]
    public void SeekFraction_waits_for_the_length()
    {
        var rig = new Rig();
        rig.Clock.Pause();
        rig.Clock.SeekFraction(0.5);
        Assert.Equal(0, rig.Clock.Elapsed);
        rig.Clock.Declare(800);
        Assert.Equal(400, rig.Clock.Elapsed);
    }

    [Fact]
    public void The_length_is_the_longest_motion()
    {
        var rig = new Rig();
        rig.Clock.Declare(500);
        var longer = rig.Clock.Declare(900);
        Assert.Equal(900, rig.Clock.Length);
        longer.Dispose();
        Assert.Equal(500, rig.Clock.Length);
    }

    [Fact]
    public void After_counts_running_time_only()
    {
        var rig = new Rig();
        var calls = 0;
        rig.Clock.After(900, () => calls++);
        rig.Move(400);
        rig.Clock.Pause();
        rig.Move(5000);
        Assert.Equal(0, calls);
        rig.Clock.Play();
        rig.Move(500);
        Assert.Equal(1, calls);
    }

    [Fact]
    public void After_follows_the_rate()
    {
        var rig = new Rig();
        var calls = 0;
        rig.Clock.SetRate(2);
        rig.Clock.After(900, () => calls++);
        rig.Move(450);
        Assert.Equal(1, calls);
    }

    [Fact]
    public void A_cancelled_wait_never_comes()
    {
        var rig = new Rig();
        var calls = 0;
        var wait = rig.Clock.After(900, () => calls++);
        wait.Dispose();
        rig.Clock.Pause();
        rig.Clock.Play();
        rig.Move(1000);
        Assert.Equal(0, calls);
    }

    [Fact]
    public void Changed_hears_every_change()
    {
        var rig = new Rig();
        var heard = 0;
        rig.Clock.Changed += () => heard++;
        rig.Clock.Pause();
        rig.Clock.Play();
        rig.Clock.SetRate(2);
        rig.Clock.Seek(10);
        rig.Clock.Restart();
        rig.Clock.Declare(100);
        Assert.Equal(6, heard);
    }

    [Fact]
    public void Begin_restarts_only_for_a_new_step()
    {
        var rig = new Rig();
        rig.Clock.Begin("a");
        rig.Move(300);
        rig.Clock.Begin("a");
        Assert.Equal(300, rig.Clock.Elapsed);
        rig.Clock.Begin("b");
        Assert.Equal(0, rig.Clock.Elapsed);
    }

    [Fact]
    public void A_seek_meant_for_a_step_lands_when_that_step_begins_and_says_how_long_it_is()
    {
        var rig = new Rig();
        rig.Clock.Begin("a");
        rig.Clock.Pause();
        rig.Clock.SeekFraction(0.25, "b");
        rig.Clock.Begin("b");
        Assert.Equal(0, rig.Clock.Elapsed);
        rig.Clock.Declare(800);
        Assert.Equal(200, rig.Clock.Elapsed);
    }

    [Fact]
    public void A_seek_meant_for_another_step_is_dropped_by_a_step_that_is_not_it()
    {
        var rig = new Rig();
        rig.Clock.Begin("a");
        rig.Clock.Pause();
        rig.Clock.SeekFraction(0.25, "b");
        rig.Clock.Begin("c");
        rig.Clock.Declare(800);
        Assert.Equal(0, rig.Clock.Elapsed);
    }

    [Fact]
    public void The_running_time_ignores_seeks_and_restarts_but_stops_while_paused()
    {
        var rig = new Rig();
        rig.Move(300);
        rig.Clock.Seek(0);
        rig.Clock.Restart();
        Assert.Equal(300, rig.Clock.Now());
        rig.Clock.Pause();
        rig.Move(1000);
        Assert.Equal(300, rig.Clock.Now());
        rig.Clock.SetRate(2);
        rig.Clock.Play();
        rig.Move(100);
        Assert.Equal(500, rig.Clock.Now());
    }
}
