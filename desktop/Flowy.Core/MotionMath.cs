namespace Flowy.Core;

/// <summary>
/// The maths for drawing a step's beats: a port of ui/src/motion.ts, with the same names and numbers. Nothing here draws, so the
/// tests can run it where the app can't rasterise. desktop/fixtures/beats.ts keeps the two equal.
/// </summary>
public static class MotionMath
{
    /// <summary>How long Autoplay rests after a step has finished moving, in ms.</summary>
    public const double Gap = 900;

    /// <summary>How long Autoplay stays on a step that doesn't move, or when motion is reduced, in ms.</summary>
    public const double Dwell = 2200;

    /// <summary>How far through a beat the moment <paramref name="t"/> is: 0 before it, 1 after it.</summary>
    public static double Progress(Beat b, double t) => Math.Min(1, Math.Max(0, (t - b.At) / b.Dur));

    /// <summary>Whether the beat is running at <paramref name="t"/>.</summary>
    public static bool Active(Beat b, double t) => t >= b.At && t < b.At + b.Dur;

    /// <summary>Slow at both ends, fast in the middle: a blob eases into the pipe and out of it.</summary>
    public static double Ease(double p) => p < 0.5 ? 4 * p * p * p : 1 - Math.Pow(-2 * p + 2, 3) / 2;

    /// <summary>0 at the ends of a beat and 1 in the middle: a squash, or a blob stretched at full speed.</summary>
    public static double Bump(double p) => Math.Sin(Math.PI * p);

    /// <summary>The tube fades in over the first 150 ms of its beat and out over the last 250.</summary>
    public static double TubeOpacity(Beat b, double t) => Math.Min(1, Math.Max(0, Math.Min((t - b.At) / 150, (b.At + b.Dur - t) / 250)));

    /// <summary>How far along a line of length <paramref name="length"/> a blob is at progress <paramref name="p"/>, running forward or back.</summary>
    public static double Distance(string? dir, double p, double length) => (dir == "back" ? 1 - Ease(p) : Ease(p)) * length;

    /// <summary>How hard each end of the step is squashed at <paramref name="t"/>: the strongest of the gulps running then.</summary>
    public static (double From, double To) Squash(IEnumerable<Beat> beats, double t)
    {
        double from = 0, to = 0;
        foreach (var b in beats.Where(b => b.Do == "gulp" && Active(b, t)))
        {
            var s = Bump(Progress(b, t));
            if (b.On == "to") to = Math.Max(to, s);
            else from = Math.Max(from, s);
        }
        return (from, to);
    }
}
