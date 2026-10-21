namespace Flowy.Core;

/// <summary>Where a run first struggles.</summary>
public static partial class Perf
{
    /// <summary>
    /// How strained an object is, 0 to 1: its utilisation, or its error share counted twenty times (5% failing is as bad as full), whichever is
    /// worse. Null when neither was measured.
    /// </summary>
    public static Strain? StrainOf(Metrics m)
    {
        if (m.Util is null && m.Errors is null) return null;
        var util = m.Util ?? 0;
        var errors = m.Errors ?? 0;
        var fromErrors = Math.Min(1, errors * 20);
        return m.Util is not null && util >= fromErrors ? new Strain(util, "util", util) : new Strain(fromErrors, "errors", errors);
    }

    /// <summary>A shape this strained is "struggling" (see <see cref="FindKnee"/>).</summary>
    public const double KneeStrain = 0.85;

    /// <summary>Overall p95 this many times the lowest level's counts as latency giving way.</summary>
    public const double KneeLatency = 3;

    /// <summary>
    /// The first tested level where an object's strain reaches <see cref="KneeStrain"/>, naming the worst one there; failing that, the first where
    /// overall p95 is <see cref="KneeLatency"/> times the lowest level's. Null when the run never struggles.
    /// </summary>
    public static Knee? FindKnee(LoadRun run)
    {
        var baseline = run.Levels[0].Overall.P95;
        for (var index = 0; index < run.Levels.Count; index++)
        {
            var level = run.Levels[index];
            if (Struggle(level, baseline) is { } found) return found with { Index = index, Load = level.Load };
        }
        return null;
    }

    /// <summary>What gives out at a level: the object that is worst there if it is strained to <see cref="KneeStrain"/>, else the latency if the slowest 5% passed <see cref="KneeLatency"/> times <paramref name="baseline"/>.</summary>
    private static Knee? Struggle(Level level, double? baseline)
    {
        (string Id, string Kind, double Share, double Value)? worst = null;
        foreach (var (id, m) in level.Objects)
        {
            if (StrainOf(m) is { } s && (worst is null || s.Value > worst.Value.Value)) worst = (id, s.By, s.Share, s.Value);
        }
        if (worst is { } w && w.Value >= KneeStrain) return new Knee(0, 0, new KneeBy(w.Id, w.Kind, w.Share));
        var p95 = level.Overall.P95;
        if (baseline is > 0 && p95 is { } p && p >= KneeLatency * baseline.Value) return new Knee(0, 0, null, baseline, p);
        return null;
    }
}
