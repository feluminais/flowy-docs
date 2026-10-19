namespace Flowy.Core;

/// <summary>
/// One particle on a line: how far along it is (0 to 1), and where it gives out, if it is going to: a failed call is drawn as a particle that fades and
/// drops short of the end. 0 means it arrives.
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

/// <summary>Particles on a line: how they start, move and fail. A port of ui/src/traffic.ts. No drawing in here.</summary>
public static class Particles
{
    /// <summary>Most particles one line holds at once, so a slow, busy line stays cheap.</summary>
    public const int Most = 64;

    /// <summary>
    /// Moves a line's particles on by <paramref name="ms"/> and starts the ones that are due, at the rate and speed this much traffic has. Taking the
    /// numbers each time means a ramp changes them smoothly: what is already on the line keeps going and new particles use the new speed.
    /// <paramref name="rand"/> is 0 to 1; a failing particle is one in <c>Failed</c> of them and drops out between 30% and 80% of the way.
    /// </summary>
    public static void Advance(ParticleStream stream, LineTraffic line, double ms, Func<double> rand)
    {
        var step = ms / line.TravelMs;
        foreach (var m in stream.Motes) m.S += step;
        stream.Motes = stream.Motes.Where(m => m.S < (m.Fails != 0 ? m.Fails : 1)).ToList();
        stream.Due += line.PerSecond * ms / 1000;
        while (stream.Due >= 1)
        {
            stream.Due -= 1;
            if (stream.Motes.Count < Most) stream.Motes.Add(new Mote { S = 0, Fails = rand() < line.Failed ? 0.3 + 0.5 * rand() : 0 });
        }
    }

    /// <summary>How visible a particle is: full until it is nearly out, then fading, so one that fails dies away instead of vanishing.</summary>
    public static double Visibility(Mote m) => m.Fails == 0 ? 1 : Math.Min(1, Math.Max(0, (m.Fails - m.S) / 0.15));
}
