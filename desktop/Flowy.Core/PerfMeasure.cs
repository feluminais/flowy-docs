namespace Flowy.Core;

/// <summary>
/// What the Performance panel draws on its lines: stripes moving along them for the calls a second (Calls), blobs for the data a second, the calls times the size of a call (Data), or both on one line
/// (Mixed). Twin of <c>Measure</c> in src/core/perf/measure.ts.
/// </summary>
public enum LoadMeasure
{
    Calls,
    Data,
    Mixed,
}

public static partial class Perf
{
    /// <summary>Why a run has no Data (it gives no size of a call), as the switch says it in its tooltip.</summary>
    public const string NoData = "No size of a call in this run";

    /// <summary>Why Data is blocked for a run: <see cref="NoData"/>, or null when the run gives the size of a call.</summary>
    public static string? DataOff(IdMap<LoadRun> runs, string id) => CallSize(runs, id) is null ? NoData : null;

    /// <summary>The nearest of 1, 2 and 5 times a power of ten (on a log scale), so a scale in words reads "2 KB/s" and not "1.6 KB/s".</summary>
    private static double RoundNice(double x)
    {
        var power = Math.Pow(10, Math.Floor(Math.Log10(x)));
        var m = x / power;
        var best = 1.0;
        foreach (var s in new[] { 2.0, 5.0, 10.0 })
            if (Math.Abs(Math.Log(m / s)) < Math.Abs(Math.Log(m / best))) best = s;
        return best * power;
    }

    /// <summary>The runs whose levels a run plays: itself, or the runs it adds.</summary>
    private static IEnumerable<LoadRun> PartsOf(IdMap<LoadRun> runs, string id)
    {
        if (!runs.Contains(id)) yield break;
        var run = runs[id];
        if (run.Adds is null) { yield return run; yield break; }
        foreach (var part in run.Adds)
            if (runs.Contains(part)) yield return runs[part];
    }

    /// <summary>
    /// The size of a call the Data measure counts against: the mean size of a call over the whole run (weighted by rate), rounded to 1, 2 or 5 times a power of ten. A call that size gets the dots
    /// and the thickness it gets under Calls, so a bigger one gets more and a smaller one less. Null when the run gives no size at all: then there is no Data.
    /// </summary>
    public static double? CallSize(IdMap<LoadRun> runs, string id)
    {
        var mean = new Mean();
        foreach (var run in PartsOf(runs, id))
            foreach (var level in run.Levels)
                foreach (var c in level.Connections)
                {
                    if (c.Bytes is not null) mean.TakeBytes(c.Bytes, c.Rate);
                    else if (c.By is { } by) foreach (var (_, m) in by) mean.TakeBytes(m.Bytes, m.Rate);
                }
        return mean.Bytes is { } size && size > 0 ? RoundNice(size) : null;
    }

    /// <summary>
    /// The most calls a second the run has on any line at any load, which the stripes are busy against: the busiest line at the top of the run has its stripes as close and quick as they get, so the stripes of
    /// a run that goes from 100 to 1,200 orders a minute visibly speed up. A run of added runs adds their peaks (a line they share carries the sum). Null when the run gives no rate.
    /// </summary>
    public static double? CallPeak(IdMap<LoadRun> runs, string id)
    {
        double sum = 0;
        var any = false;
        foreach (var run in PartsOf(runs, id))
        {
            double most = 0;
            foreach (var level in run.Levels)
                foreach (var c in level.Connections)
                {
                    if (c.Rate is { } rate && rate > most) most = rate;
                    if (c.By is { } by) foreach (var (_, m) in by) if (m.Rate is { } byRate && byRate > most) most = byRate;
                }
            if (most > 0) any = true;
            sum += most;
        }
        return any ? sum : null;
    }

    /// <summary>
    /// What a line carries under a measure, as a rate: its calls a second under Calls, and under Data its data a second in units of <paramref name="size"/> (so a call of that size is one). Null where
    /// the line gives nothing to count: no rate, or under Data no size of a call.
    /// </summary>
    public static double? AmountOf(Metrics m, LoadMeasure measure, double? size)
    {
        if (m.Rate is not { } rate) return null;
        if (measure == LoadMeasure.Calls) return rate;
        return m.Bytes is { } bytes && size is { } s ? rate * bytes / s : null;
    }
}
