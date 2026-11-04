using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>
/// The store that says how far the lines of a pair are parted around the lit one (ui/src/parts.ts, createPartStore): with no window, a wall clock and animation frames the test moves by hand.
/// The pose is a pure function of the player's clock, so a pause holds it, a scrub sets it and the speed hurries it; the browser's store passes the same cases.
/// </summary>
public class PartStoreTests
{
    internal sealed class Rig : IDisposable
    {
        public double Wall;
        public readonly PlayerClock Clock;
        public readonly PartStore Store;
        public int Changes;
        private readonly List<Ask> _asked = [];

        private sealed class Ask(Action what) : IDisposable
        {
            public readonly Action What = what;
            public bool Cancelled;

            public void Dispose() => Cancelled = true;
        }

        public Rig()
        {
            Clock = new PlayerClock(() => Wall);
            Store = new PartStore(Clock, next =>
            {
                var ask = new Ask(next);
                _asked.Add(ask);
                return ask;
            });
            Store.Changed += () => Changes++;
        }

        public void Dispose() => Store.Dispose();

        /// <summary>Whether the store has asked for a frame it has not been given yet.</summary>
        public bool WantsFrame => _asked.Any(a => !a.Cancelled);

        /// <summary>Moves the wall clock on and gives the store the frame it asked for, if any.</summary>
        public void Move(double ms)
        {
            Wall += ms;
            var due = _asked.Where(a => !a.Cancelled).ToList();
            _asked.Clear();
            foreach (var ask in due) ask.What();
        }

        /// <summary>A stop begins: the player's clock goes back to its start and the store takes the plan, as the reader does for every new step.</summary>
        public void Begin(string key, string? flow, int stop, IReadOnlyDictionary<string, PartPlan> plans, bool still = false)
        {
            Clock.Begin(key);
            Store.Set(flow, stop, plans, still);
        }
    }

    private static IReadOnlyDictionary<string, PartPlan> Plan(double[] lit, (double At, double Dur)? beat = null) => new Dictionary<string, PartPlan> { ["p"] = new(lit, beat) };

    /// <summary>The lit amounts of a pair are exactly these (none: the pair has a motion, but its lanes are where they were).</summary>
    private static void Is(IReadOnlyList<double>? got, params double[] want) => Assert.Equal(want, got ?? throw new Xunit.Sdk.XunitException("the pair has no motion"));

    private static readonly IReadOnlyDictionary<string, PartPlan> None = new Dictionary<string, PartPlan>();

    [Fact]
    public void A_pair_parts_at_the_beat_and_holds_the_pose_until_the_stop_is_left()
    {
        using var rig = new Rig();
        Assert.Null(rig.Store.Lam("p"));
        rig.Begin("k1", "f", 0, Plan([0, 1, 0], (100, 225)));
        Is(rig.Store.Lam("p")); // the pair has a motion, and its lines are still where they were
        Assert.True(rig.Store.Moving);
        Assert.True(rig.WantsFrame); // it asks for frames while it is on its way

        rig.Move(100);
        Is(rig.Store.Lam("p")); // the beat starts here
        rig.Move(112.5);
        Is(rig.Store.Lam("p"), 0, 0.875, 0); // half way through, easing out: 0.875 of the way
        rig.Move(112.5);
        Is(rig.Store.Lam("p"), 0, 1, 0);
        Assert.False(rig.Store.Moving);
        Assert.False(rig.WantsFrame); // at rest it asks for none

        rig.Move(5000);
        Is(rig.Store.Lam("p"), 0, 1, 0); // held for as long as the stop is shown
        Assert.False(rig.WantsFrame);
    }

    [Fact]
    public void A_pause_holds_the_pose_a_scrub_sets_it_and_the_speed_hurries_it()
    {
        using var rig = new Rig();
        rig.Begin("k1", "f", 0, Plan([0, 1, 0], (100, 225)));
        rig.Move(212.5);
        Is(rig.Store.Lam("p"), 0, 0.875, 0);

        rig.Clock.Pause();
        rig.Move(3000);
        Is(rig.Store.Lam("p"), 0, 0.875, 0); // paused: nothing moves, and no frame is asked for
        Assert.False(rig.WantsFrame);

        rig.Clock.Seek(0); // a scrub to the start of the stop: the lines are where they were before the step
        Is(rig.Store.Lam("p"));
        rig.Clock.Seek(325);
        Is(rig.Store.Lam("p"), 0, 1, 0);
        rig.Clock.Seek(212.5);
        Is(rig.Store.Lam("p"), 0, 0.875, 0);

        rig.Clock.SetRate(2); // double speed: the same parting takes half the wall time
        rig.Clock.Seek(100);
        rig.Clock.Play();
        rig.Move(56.25);
        Is(rig.Store.Lam("p"), 0, 0.875, 0);
    }

    [Fact]
    public void The_next_step_on_another_lane_goes_on_from_the_pose_before_it_and_never_closes_the_pair()
    {
        using var rig = new Rig();
        rig.Begin("k1", "f", 0, Plan([0, 1, 0], (0, 225)));
        rig.Move(300);
        Is(rig.Store.Lam("p"), 0, 1, 0);

        rig.Begin("k2", "f", 1, Plan([0, 0, 1], (0, 225)));
        Is(rig.Store.Lam("p"), 0, 1, 0); // the clock went back to the start of the stop, and the lanes stand as they did
        rig.Move(97.5);
        Is(rig.Store.Lam("p"), 0, 0.5, 0.5); // half of the 195 ms shift, smooth
        rig.Move(97.5);
        Is(rig.Store.Lam("p"), 0, 0, 1);
    }

    [Fact]
    public void Leaving_the_stop_closes_the_pair_and_a_pair_at_rest_is_forgotten()
    {
        using var rig = new Rig();
        rig.Begin("k1", "f", 0, Plan([0, 1, 0], (0, 225)));
        rig.Move(300);
        rig.Begin("", null, 0, None); // no flow plays now
        Is(rig.Store.Lam("p"), 0, 1, 0);
        rig.Move(97.5);
        Is(rig.Store.Lam("p"), 0, 0.5, 0); // closing over the same 195 ms
        rig.Move(97.5);
        Assert.Null(rig.Store.Lam("p"));
        Assert.Empty(rig.Store.Pairs);
        Assert.False(rig.WantsFrame);
    }

    [Fact]
    public void A_flow_other_than_the_last_or_a_stop_far_from_it_is_a_jump_from_where_the_lanes_are()
    {
        using var rig = new Rig();
        rig.Begin("k1", "f", 0, Plan([0, 0.4, 0]));
        rig.Move(1000);
        rig.Begin("k2", "f", 5, Plan([1, 0, 0], (600, 225))); // five stops on: a jump, from the pose it has, over 225 ms starting at once (not at the beat)
        Is(rig.Store.Lam("p"), 0, 0.40625, 0); // 0.4 cut to the 32 steps the lane store keeps a path for
        rig.Move(225);
        Is(rig.Store.Lam("p"), 1, 0, 0);

        rig.Begin("k3", "g", 0, Plan([0, 0, 1], (600, 225))); // another flow: a jump too
        rig.Move(225);
        Is(rig.Store.Lam("p"), 0, 0, 1);
    }

    [Fact]
    public void With_motion_reduced_the_lanes_are_parted_at_once()
    {
        using var rig = new Rig();
        rig.Begin("k1", "f", 0, Plan([0, 1, 0], (100, 225)), still: true);
        Is(rig.Store.Lam("p"), 0, 1, 0);
        Assert.False(rig.WantsFrame);
    }

    [Fact]
    public void The_same_key_again_does_nothing_and_a_pair_that_does_not_change_says_nothing()
    {
        using var rig = new Rig();
        rig.Begin("k1", "f", 0, Plan([0, 1, 0], (0, 225)));
        rig.Move(300);
        var told = rig.Changes;
        var lam = rig.Store.Lam("p");
        rig.Clock.Begin("k1"); // the same step shown again (a hover redraws): the clock does not restart
        rig.Move(100);
        rig.Store.Tick();
        Assert.Equal(told, rig.Changes);
        Assert.Same(lam, rig.Store.Lam("p")); // the very same list while it does not change
    }

    [Fact]
    public void Two_pairs_part_on_their_own()
    {
        using var rig = new Rig();
        var plans = new Dictionary<string, PartPlan> { ["p"] = new([0, 1], (0, 225)), ["q"] = new([1, 0, 0], (150, 225)) };
        rig.Begin("k1", "f", 0, plans);
        rig.Move(112.5);
        Is(rig.Store.Lam("p"), 0, 0.875);
        Is(rig.Store.Lam("q"));
        rig.Move(300);
        Is(rig.Store.Lam("p"), 0, 1);
        Is(rig.Store.Lam("q"), 1, 0, 0);
    }

    [Fact]
    public void The_same_plan_again_does_nothing_and_another_plan_goes_on_from_where_the_lines_are()
    {
        using var rig = new Rig();
        rig.Begin("k1", "f", 0, Plan([0, 1, 0], (0, 225)));
        rig.Move(112.5);
        Is(rig.Store.Lam("p"), 0, 0.875, 0);

        rig.Store.Set("f", 0, Plan([0, 1, 0], (0, 225)), false); // a redraw for a hover: the same stop, the same plan
        Is(rig.Store.Lam("p"), 0, 0.875, 0);
        rig.Move(112.5);
        Is(rig.Store.Lam("p"), 0, 1, 0); // it was not started over

        rig.Store.Set("f", 0, Plan([0, 0, 1]), false); // the model changed under the step: another line is lit now
        Is(rig.Store.Lam("p"), 0, 1, 0);
        rig.Move(97.5);
        Is(rig.Store.Lam("p"), 0, 0.5, 0.5);
        rig.Move(97.5);
        Is(rig.Store.Lam("p"), 0, 0, 1);
    }
}
