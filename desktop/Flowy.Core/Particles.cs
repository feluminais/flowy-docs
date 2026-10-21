namespace Flowy.Core;

/// <summary>
/// One particle on a line: how far along it is (0 to 1), and where it is done, if it is going to fail: a failed call is drawn as a particle that fades and
/// drops short of the end. 0 means it arrives. What "done" looks like depends on how the line says its failing share fails (see <see cref="Particles.Look"/>):
/// without a style it is where the particle fades away, for a lost call a little after the place it pops, for a rejected one past the end of the line, after
/// it has come back.
/// </summary>
public sealed class Mote
{
    public double S { get; set; }

    public double Fails { get; set; }
}

/// <summary>A line's particles and the part of the next one already due.</summary>
public sealed class ParticleStream
{
    public List<Mote> Motes { get; set; } = [];

    public double Due { get; set; }
}

/// <summary>
/// How a particle draws now: where along the line it is (<c>At</c>, 0 to 1), whether it is in the danger tone, how visible it is, and for the styles that
/// have one, the pop of a lost call (<c>Pop</c>, 0 as it bursts to 1 as it is gone, drawn as a ring where the call died) and the bar a rejected call hits
/// (<c>Bar</c>, 0 to 1, how strongly it shows at the end of the line). All numbers, so the browser and the desktop app draw the same thing.
/// </summary>
public readonly record struct MoteLook(double At, bool Bad, double Alpha, double? Pop = null, double? Bar = null);

/// <summary>Particles on a line: how they start, move and fail. A port of ui/src/traffic.ts. No drawing in here.</summary>
public static class Particles
{
    /// <summary>Most particles one line holds at once, so a slow, busy line stays cheap.</summary>
    public const int Most = 64;

    /// <summary>How long a lost call's pop lasts, in the same units as <c>S</c> (a fraction of the line).</summary>
    public const double Pop = 0.08;

    /// <summary>How long a rejected call waits at the bar, and how far back along the line it comes before it is gone.</summary>
    public const double Hold = 0.05;

    public const double Back = 0.25;

    /// <summary>Where a rejected call is done: past the end by the wait and the way back.</summary>
    public const double RejectedEnd = 1 + Hold + Back;

    /// <summary>
    /// Moves a line's particles on by <paramref name="ms"/> and starts the ones that are due, at the rate and speed this much traffic has. Taking the
    /// numbers each time means a ramp changes them smoothly: what is already on the line keeps going and new particles use the new speed.
    /// <paramref name="rand"/> is 0 to 1; a failing particle is one in <c>Failed</c> of them and gives out between 30% and 80% of the way (a rejected one goes
    /// the whole way to the end, and comes back). The line's <c>PerSecond</c> already says how many are on it at once (see <see cref="Perf.TrafficFor"/>), so this
    /// never has to look at a cap: <see cref="Most"/> is only the last safeguard against a number that got through.
    /// </summary>
    public static void Advance(ParticleStream stream, LineTraffic line, double ms, Func<double> rand)
    {
        var step = ms / line.TravelMs;
        foreach (var m in stream.Motes) m.S += step;
        stream.Motes = stream.Motes.Where(m => m.S < (m.Fails != 0 ? m.Fails : 1)).ToList();
        stream.Due += line.PerSecond * ms / 1000;
        if (!double.IsFinite(stream.Due)) stream.Due = 0; // a number that is not one starts nothing, and doesn't stick
        // The whole particles that are due, no more than there is room for: a rate far past what a line can hold costs one step, not millions.
        var whole = Math.Floor(stream.Due);
        stream.Due -= whole;
        for (var i = (int)Math.Min(whole, Most - stream.Motes.Count); i > 0; i--)
            stream.Motes.Add(new Mote { S = 0, Fails = rand() < line.Failed ? EndOf(line.Failure, rand) : 0 });
    }

    /// <summary>Where a failing particle is done, from how its line says it fails. The place it gives out or pops is drawn from <paramref name="rand"/>, between 30% and 80% of the way.</summary>
    private static double EndOf(string? failure, Func<double> rand)
    {
        if (failure == "rejected") return RejectedEnd;
        var gives = 0.3 + 0.5 * rand();
        return failure == "lost" ? gives + Pop : gives;
    }

    /// <summary>How faint a particle is at its faintest, when it is well behind something: still there, so the flow reads, but a ghost.</summary>
    public const double GhostAlpha = 0.3;

    /// <summary>
    /// How far behind something a particle is, 0 to 1, from how deep inside it the particle sits: 0 until it is <paramref name="ramp"/> outside, 1 once it is
    /// <paramref name="ramp"/> inside, and in between a slope, so it fades as it goes behind and comes back as it comes out, never in a step.
    /// </summary>
    public static double HowBehind(double depth, double ramp) => Math.Min(1, Math.Max(0, (depth + ramp) / (2 * ramp)));

    /// <summary>How a particle <paramref name="behind"/> of the way draws: fainter, and a little smaller, as something does when it is further back.</summary>
    public static (double Alpha, double Scale) Ghost(double behind) => (1 - behind + behind * GhostAlpha, 1 - behind * 0.25);

    /// <summary>How visible a particle is: full until it is nearly out, then fading, so one that fails dies away instead of vanishing.</summary>
    public static double Visibility(Mote m) => m.Fails == 0 ? 1 : Math.Min(1, Math.Max(0, (m.Fails - m.S) / 0.15));

    /// <summary>
    /// How a particle draws now. Without a style a failing particle is danger-toned from the start and fades; a lost one is an ordinary particle until it pops;
    /// a rejected one is ordinary until it reaches the end, then turns danger-toned, waits at the bar and comes back, fading.
    /// </summary>
    public static MoteLook Look(Mote m, string? failure)
    {
        if (m.Fails == 0) return new MoteLook(m.S, false, 1);
        if (failure == "lost")
        {
            var dies = m.Fails - Pop;
            if (m.S < dies) return new MoteLook(m.S, false, 1);
            return new MoteLook(dies, true, 0, Math.Min(1, Math.Max(0, (m.S - dies) / Pop)));
        }
        if (failure == "rejected")
        {
            if (m.S <= 1) return new MoteLook(m.S, false, 1, null, Math.Min(1, Math.Max(0, 1 - (1 - m.S) / 0.1)));
            if (m.S <= 1 + Hold) return new MoteLook(1, true, 1, null, 1);
            var back = Math.Min(1, Math.Max(0, (m.S - 1 - Hold) / Back));
            return new MoteLook(1 - back * Back, true, 1 - back, null, 1 - back);
        }
        return new MoteLook(m.S, true, Visibility(m));
    }
}
