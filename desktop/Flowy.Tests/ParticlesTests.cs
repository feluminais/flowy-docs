using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>ui/src/traffic.ts and ui/src/pathpoints.ts, reproduced: how particles start, move and fail, and how a line's path becomes points to put them on.</summary>
public class ParticlesTests
{
    private static LineTraffic Line(double perSecond, double travelMs, double failed = 0) => new("a", "b", 2, perSecond, (int)travelMs, failed);

    /// <summary>Runs a stream for <paramref name="ms"/> in frames of 16 ms, like a screen would.</summary>
    private static void Run(ParticleStream stream, LineTraffic line, double ms, Func<double>? rand = null)
    {
        rand ??= () => 0.99;
        for (double t = 0; t < ms; t += 16) Particles.Advance(stream, line, 16, rand);
    }

    [Fact]
    public void A_line_with_traffic_holds_about_as_many_particles_as_calls_in_flight()
    {
        var stream = new ParticleStream();
        Run(stream, Line(10, 2000), 5000);
        Assert.InRange(stream.Motes.Count, 18, 22);
        Assert.All(stream.Motes, m =>
        {
            Assert.InRange(m.S, 0, 0.9999);
            Assert.Equal(0, m.Fails);
        });
        var ages = stream.Motes.Select(m => m.S).ToList();
        Assert.Equal(ages.OrderByDescending(a => a), ages); // the oldest is first
    }

    [Fact]
    public void A_particle_that_has_got_to_the_end_is_gone_and_a_line_with_no_traffic_has_none()
    {
        var stream = new ParticleStream();
        Run(stream, Line(5, 500), 1000);
        Assert.NotEmpty(stream.Motes);
        Run(stream, Line(0, 500), 600);
        Assert.Empty(stream.Motes);
    }

    [Fact]
    public void A_change_in_speed_applies_to_the_particles_already_on_the_line()
    {
        double Moved(double travelMs)
        {
            var stream = new ParticleStream();
            Particles.Advance(stream, Line(100, 1000), 16, () => 0.99);
            var before = stream.Motes[0].S;
            Particles.Advance(stream, Line(0, travelMs), 100, () => 0.99);
            return stream.Motes[0].S - before;
        }
        Assert.True(Moved(250) > Moved(1000) * 3.9);
    }

    [Fact]
    public void A_share_of_the_particles_the_share_of_calls_that_fail_give_out_between_30_and_80_percent_of_the_way()
    {
        var stream = new ParticleStream();
        double[] values = [0.1, 0.5, 0.9, 0.0, 0.7]; // a particle takes one number to say whether it fails, and another to say where
        var i = 0;
        Particles.Advance(stream, Line(3, 1000, 0.5), 1000, () => values[i++ % values.Length]);
        Assert.Equal(3, stream.Motes.Count);
        var failing = stream.Motes.Where(m => m.Fails > 0).ToList();
        Assert.NotEmpty(failing);
        Assert.All(failing, m => Assert.InRange(m.Fails, 0.3, 0.8));
        Assert.Contains(stream.Motes, m => m.Fails == 0);
    }

    [Fact]
    public void A_failing_particle_is_gone_once_it_reaches_where_it_gives_out()
    {
        var stream = new ParticleStream { Motes = [new Mote { S = 0.5, Fails = 0.6 }] };
        Particles.Advance(stream, Line(0, 1000), 50, () => 0.5);
        Assert.Single(stream.Motes);
        Particles.Advance(stream, Line(0, 1000), 100, () => 0.5);
        Assert.Empty(stream.Motes);
    }

    [Fact]
    public void A_busy_slow_line_holds_no_more_than_the_most()
    {
        var stream = new ParticleStream();
        Run(stream, Line(1000, 4000), 3000);
        Assert.Equal(Particles.Most, stream.Motes.Count);
    }

    [Fact]
    public void A_particle_is_fully_visible_until_it_is_nearly_out_then_fades_and_one_that_arrives_never_fades()
    {
        Assert.Equal(1, Particles.Visibility(new Mote { S = 0.9 }));
        Assert.Equal(1, Particles.Visibility(new Mote { S = 0.1, Fails = 0.5 }));
        Assert.Equal(1.0 / 3, Particles.Visibility(new Mote { S = 0.45, Fails = 0.5 }), 9);
        Assert.Equal(0, Particles.Visibility(new Mote { S = 0.6, Fails = 0.5 }));
    }

    [Fact]
    public void A_particle_goes_from_clear_to_well_behind_over_the_ramp_either_side_of_an_outline_never_in_a_step()
    {
        Assert.Equal(0, Particles.HowBehind(-6, 6)); // a ramp outside: clear
        Assert.Equal(0, Particles.HowBehind(-20, 6));
        Assert.Equal(0.5, Particles.HowBehind(0, 6)); // on the outline: half way
        Assert.Equal(1, Particles.HowBehind(6, 6)); // a ramp inside: well behind
        Assert.Equal(1, Particles.HowBehind(40, 6));
        Assert.InRange(Particles.HowBehind(-3, 6), double.Epsilon, Particles.HowBehind(3, 6));
        Assert.True(Particles.HowBehind(3, 6) < 1);
    }

    [Fact]
    public void A_particle_behind_something_is_a_fainter_smaller_one_and_in_front_it_is_as_always()
    {
        Assert.Equal((1.0, 1.0), Particles.Ghost(0));
        Assert.Equal((Particles.GhostAlpha, 0.75), Particles.Ghost(1));
        var (alpha, scale) = Particles.Ghost(0.5);
        Assert.True(alpha < 1 && alpha > Particles.GhostAlpha && scale < 1 && scale > 0.75);
    }

    [Fact]
    public void A_particle_going_into_a_shape_that_opens_is_whole_outside_it_cut_by_the_outline_while_it_crosses_and_gone_once_it_is_wholly_in()
    {
        Assert.Equal(Particles.Cut.Clear, Particles.CutBy(-30, 3));
        Assert.Equal(Particles.Cut.Clear, Particles.CutBy(-3, 3)); // just touching the outline from outside
        Assert.Equal(Particles.Cut.Cut, Particles.CutBy(-2.9, 3));
        Assert.Equal(Particles.Cut.Cut, Particles.CutBy(0, 3)); // half way in
        Assert.Equal(Particles.Cut.Cut, Particles.CutBy(2.9, 3));
        Assert.Equal(Particles.Cut.Gone, Particles.CutBy(3, 3)); // all of it inside
        Assert.Equal(Particles.Cut.Gone, Particles.CutBy(40, 3));
    }

    // ---- a source's numbers drawn: dots at once, the cap, and how a failing share fails -----------------------------------

    [Fact]
    public void A_line_holds_the_number_of_dots_its_numbers_promise_and_ten_times_the_dots_reads_ten_to_one()
    {
        int Held(double dots, int travelMs)
        {
            var stream = new ParticleStream();
            Run(stream, Line(dots / (travelMs / 1000.0), travelMs), 12_000);
            return stream.Motes.Count;
        }
        Assert.InRange(Held(2, 800), 1, 3);
        Assert.InRange(Held(20, 800), 19, 21);
        Assert.InRange(Held(20, 3000), 19, 21); // the same count at a slower speed: equal dots, different speed
        Assert.InRange(Held(24, 500), 23, 25);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("lost")]
    [InlineData("rejected")]
    public void A_line_whose_count_is_far_past_the_cap_still_holds_no_more_than_the_most(string? failure)
    {
        var stream = new ParticleStream();
        var line = new LineTraffic("a", "b", 2, 1e9, 4000, 0.5) { Failure = failure };
        Run(stream, line, 3000, () => 0.4);
        Assert.True(stream.Motes.Count <= Particles.Most, $"{failure}: {stream.Motes.Count}");
    }

    [Fact]
    public void A_lost_call_is_an_ordinary_particle_until_it_pops_a_ring_that_grows_and_is_gone()
    {
        double[] rolls = [0.1, 0.5]; // fails, and gives out at 0.3 + 0.5 * 0.5 = 0.55
        var i = 0;
        var stream = new ParticleStream();
        var lost = new LineTraffic("a", "b", 2, 1, 1000, 1) { Failure = "lost" };
        Particles.Advance(stream, lost, 1000, () => rolls[i++ % 2]);
        var m = Assert.Single(stream.Motes);
        Assert.Equal(0.55 + Particles.Pop, m.Fails, 9);
        Assert.Equal(new MoteLook(0.2, false, 1), Particles.Look(new Mote { S = 0.2, Fails = m.Fails }, "lost"));
        var pop = Particles.Look(new Mote { S = 0.55 + Particles.Pop / 2, Fails = m.Fails }, "lost");
        Assert.Equal(0.55, pop.At, 9);
        Assert.True(pop.Bad);
        Assert.Equal(0, pop.Alpha);
        Assert.Equal(0.5, pop.Pop!.Value, 9);
        Assert.Equal(0, Particles.Look(new Mote { S = 0.55, Fails = m.Fails }, "lost").Pop!.Value, 9);
        Assert.Equal(1, Particles.Look(new Mote { S = 0.55 + Particles.Pop, Fails = m.Fails }, "lost").Pop!.Value, 9);
        stream.Motes[0].S = 0.55 + Particles.Pop + 0.001;
        Particles.Advance(stream, new LineTraffic("a", "b", 2, 0, 1000, 0) { Failure = "lost" }, 16, () => 0.5);
        Assert.Empty(stream.Motes); // once the pop is over it is gone
    }

    [Fact]
    public void A_rejected_call_runs_to_the_end_of_the_line_stops_at_a_bar_and_comes_back_in_the_danger_tone()
    {
        var stream = new ParticleStream();
        Particles.Advance(stream, new LineTraffic("a", "b", 2, 1, 1000, 1) { Failure = "rejected" }, 1000, () => 0.2);
        Assert.Equal(Particles.RejectedEnd, stream.Motes[0].Fails);
        MoteLook At(double s) => Particles.Look(new Mote { S = s, Fails = Particles.RejectedEnd }, "rejected");
        Assert.Equal(new MoteLook(0.4, false, 1, null, 0), At(0.4));
        var near = At(0.95);
        Assert.True(near.Bar > 0 && near.Bar < 1 && !near.Bad); // the bar starts to show as it nears
        Assert.Equal(new MoteLook(1, false, 1, null, 1), At(1));
        Assert.Equal(new MoteLook(1, true, 1, null, 1), At(1 + Particles.Hold / 2)); // stopped at the bar, now red
        var back = At(1 + Particles.Hold + Particles.Back / 2);
        Assert.Equal(1 - Particles.Back / 2, back.At, 9);
        Assert.True(back.Bad);
        Assert.Equal(0.5, back.Alpha, 9); // half way back, half faded
        Assert.Equal(1 - Particles.Back, At(Particles.RejectedEnd).At, 9);
        Assert.Equal(0, At(Particles.RejectedEnd).Alpha, 9);
        stream.Motes[0].S = Particles.RejectedEnd - 0.001;
        Particles.Advance(stream, new LineTraffic("a", "b", 2, 0, 1000, 0) { Failure = "rejected" }, 16, () => 0.5);
        Assert.Empty(stream.Motes);
    }

    [Fact]
    public void A_rejected_call_that_gets_to_the_end_is_not_gone_at_the_end_as_one_that_arrives_is()
    {
        var stream = new ParticleStream { Motes = [new Mote { S = 0.99, Fails = Particles.RejectedEnd }, new Mote { S = 0.99, Fails = 0 }] };
        Particles.Advance(stream, new LineTraffic("a", "b", 2, 0, 1000, 0) { Failure = "rejected" }, 50, () => 0.5);
        Assert.Equal([Particles.RejectedEnd], stream.Motes.Select(m => m.Fails));
    }

    [Fact]
    public void Without_a_style_a_failing_particle_is_danger_toned_from_the_start_and_fades_and_one_that_arrives_is_ordinary()
    {
        Assert.Equal(new MoteLook(0.3, false, 1), Particles.Look(new Mote { S = 0.3 }, null));
        Assert.Equal(new MoteLook(0.3, true, 1), Particles.Look(new Mote { S = 0.3, Fails = 0.6 }, null));
        var fading = Particles.Look(new Mote { S = 0.45, Fails = 0.5 }, null);
        Assert.Equal(1.0 / 3, fading.Alpha, 9);
        Assert.True(fading.Bad);
        Assert.Null(fading.Pop);
        Assert.Null(fading.Bar);
        foreach (var failure in new[] { "lost", "rejected" })
            Assert.Equal(new MoteLook(0.7, false, 1), Particles.Look(new Mote { S = 0.7, Fails = 0 }, failure)); // arriving particles look alike in every style
    }

    [Fact]
    public void The_number_of_random_draws_does_not_change_with_the_style_so_a_test_that_fixes_them_draws_the_same_dots()
    {
        int Draws(string? failure)
        {
            var n = 0;
            Particles.Advance(new ParticleStream(), new LineTraffic("a", "b", 2, 10, 1000, 1) { Failure = failure }, 1000, () =>
            {
                n++;
                return 0.4;
            });
            return n;
        }
        Assert.Equal(Draws(null), Draws("lost"));
        Assert.True(Draws("rejected") < Draws("lost")); // a rejected call goes the whole way, so there is no place to draw
    }

    [Fact]
    public void A_number_that_is_not_a_number_starts_nothing_and_does_not_stick()
    {
        var stream = new ParticleStream();
        Particles.Advance(stream, Line(double.NaN, 1000), 16, () => 0.5);
        Particles.Advance(stream, Line(double.PositiveInfinity, 1000), 16, () => 0.5);
        Assert.Empty(stream.Motes);
        Particles.Advance(stream, Line(100, 1000), 100, () => 0.5);
        Assert.NotEmpty(stream.Motes);
    }

    // ---- path points ------------------------------------------------------------------------------------------------

    [Fact]
    public void A_straight_line_is_two_points_and_a_particle_halfway_is_in_the_middle()
    {
        var line = PathPoints.Flatten("M 10,20L 110,20");
        Assert.Equal([10d, 110d], line.Xs);
        Assert.Equal(100, line.Total);
        Assert.Equal((10d, 20d), PathPoints.PointAt(line, 0));
        Assert.Equal((60d, 20d), PathPoints.PointAt(line, 0.5));
        Assert.Equal((110d, 20d), PathPoints.PointAt(line, 1));
        Assert.Equal(5, PathPoints.Flatten("M0,0L3,4").Total);
    }

    [Fact]
    public void PointAt_stops_at_the_ends_of_the_line()
    {
        var line = PathPoints.Flatten("M0,0L100,0");
        Assert.Equal((0d, 0d), PathPoints.PointAt(line, -3));
        Assert.Equal((100d, 0d), PathPoints.PointAt(line, 7));
    }

    [Fact]
    public void Extend_runs_a_line_on_before_its_start_and_after_its_end_each_the_way_the_line_runs_there()
    {
        var line = PathPoints.Extend(PathPoints.Flatten("M0,0L100,0L100,50"), 10, 20);
        Assert.Equal([-10d, 0d, 100d, 100d, 100d], line.Xs);
        Assert.Equal([0d, 0d, 0d, 50d, 70d], line.Ys);
        Assert.Equal(10 + 100 + 50 + 20, line.Total);
        Assert.Equal((-10d, 0d), PathPoints.PointAt(line, 0));
        Assert.Equal((100d, 70d), PathPoints.PointAt(line, 1));
    }

    [Fact]
    public void Extend_by_nothing_or_a_line_with_no_length_leaves_the_line_as_it_was()
    {
        var line = PathPoints.Flatten("M0,0L100,0");
        Assert.Same(line, PathPoints.Extend(line, 0, 0));
        var point = PathPoints.Flatten("M5,5L5,5");
        Assert.Same(point, PathPoints.Extend(point, 10, 10));
        Assert.Equal([0d, 100d, 104d], PathPoints.Extend(line, 0, 4).Xs);
        Assert.Equal([-4d, 0d, 100d], PathPoints.Extend(line, 4, 0).Xs);
    }

    [Theory]
    [InlineData("straight")]
    [InlineData("curved")]
    [InlineData("angled")]
    public void The_paths_written_for_a_line_in_each_style_are_read_and_end_where_the_line_ends(string style)
    {
        var path = LinePaths.Build(style, new Rect(0, 0, 200, 72), new Rect(0, 300, 200, 72));
        var line = PathPoints.Flatten(path.Data);
        Assert.True(line.Xs.Length >= 2);
        var (x, y) = PathPoints.PointAt(line, 1);
        Assert.Equal(path.End.X, x, 6);
        Assert.Equal(path.End.Y, y, 6);
        Assert.True(line.Total >= Math.Sqrt(Math.Pow(x - line.Xs[0], 2) + Math.Pow(y - line.Ys[0], 2)) - 1e-9);
        if (style != "straight") Assert.True(line.Xs.Length > 2);
        var last = double.NegativeInfinity;
        for (var s = 0.0; s <= 1; s += 0.05)
        {
            var (_, py) = PathPoints.PointAt(line, s);
            Assert.True(py >= last - 1e-9, "a line from a shape down to one below never goes back up");
            last = py;
        }
    }

    [Fact]
    public void A_quadratic_curve_is_flattened_through_its_midpoint()
    {
        var line = PathPoints.Flatten("M0,0Q50,0 100,100");
        Assert.Contains(Enumerable.Range(0, line.Xs.Length), i => Math.Abs(line.Xs[i] - 50) < 1e-9 && Math.Abs(line.Ys[i] - 25) < 1e-9);
    }

    [Fact]
    public void An_empty_path_is_a_point_at_the_origin_and_one_it_cannot_read_is_skipped()
    {
        Assert.Equal((0d, 0d), PathPoints.PointAt(PathPoints.Flatten(""), 0.5));
        Assert.Single(PathPoints.Flatten("Z").Xs);
    }
}
