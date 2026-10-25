namespace Flowy.Core;

/// <summary>
/// What the Performance panel's dots show: the calls a second (Calls), the data a second, the calls times the size of a call (Data), or the calls a second with each dot as big as the size of its call
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
    public const string NoData = "No call sizes in this run";

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
    /// How loaded the run is at a setting, 0 (nothing asked of it) to 1 (the top of what was tested): the load over the highest tested load, and for a run with several sources the mean of its dials. Plain
    /// stripes follow it, so they speed up as the load climbs even on a line the run gives no numbers. Null for a run over time, which has no load, and for a setting that is not a number.
    /// </summary>
    public static double? LoadPace(IdMap<LoadRun> runs, string id, IdMap<double> setting)
    {
        if (DialsOf(runs, id) is not { } found || (found.Mode == ModeSingle && runs[id].IsTime)) return null;
        var shares = new List<double>();
        foreach (var d in found.Items)
        {
            var top = d.Values[^1];
            var x = SettingFor(setting, d.Id);
            if (top > 0 && double.IsFinite(x)) shares.Add(Math.Min(1, Math.Max(0, x / top)));
        }
        return shares.Count == 0 ? null : shares.Sum() / shares.Count;
    }

    /// <summary>
    /// What a line carries under a measure, as a rate: its calls a second under Calls, and under Data its data a second in units of <paramref name="size"/> (so a call of that size is one). Null where
    /// the line gives nothing to count: no rate, or under Data no size of a call.
    /// </summary>
    public static double? AmountOf(Metrics m, LoadMeasure measure, double? size)
    {
        if (m.Rate is not { } rate) return null;
        if (measure != LoadMeasure.Data) return rate;
        return m.Bytes is { } bytes && size is { } s ? rate * bytes / s : null;
    }
}
