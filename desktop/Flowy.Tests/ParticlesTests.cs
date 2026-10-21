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
