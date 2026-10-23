using System.Runtime.CompilerServices;

namespace Flowy.Core;

/// <summary>A run played back: events up to a time, and the numbers interpolated between tested levels. Twin of src/core/perf/analyse.ts.</summary>
public static partial class Perf
{
    /// <summary>The events at or before time <paramref name="x"/>, in time order. None for a load run, and for a time that is not a number.</summary>
    public static List<RunEvent> EventsPassed(LoadRun run, double x) => [.. run.Events.Where(e => e.At <= x)];

    /// <summary>
    /// Where each shape a time run has an event for stands at time <paramref name="x"/>: the latest event at or before it, and of two at one time the later in the file. Running is an
    /// entry like the others, so the shape shows itself and not what is inside it (see <see cref="States.Marks"/>). A shape with no event yet is not in it. Keys come in JavaScript's order.
    /// </summary>
    public static OrderedDictionary<string, string> RunStates(LoadRun run, double x)
    {
        var latest = new OrderedDictionary<string, string>();
        foreach (var e in EventsPassed(run, x)) latest[e.On] = e.State;
        var output = new OrderedDictionary<string, string>();
        foreach (var id in JsCompat.OrderKeys(latest.Keys)) output[id] = latest[id];
        return output;
    }

    /// <summary>What an event says: its own text, else the shape and the state the way a person reads them ("Stripe: Stopped"). <paramref name="nameOf"/> turns a shape id into the name a reader sees.</summary>
    public static string EventText(RunEvent e, Func<string, string> nameOf) => e.Text != "" ? e.Text : $"{nameOf(e.On)}: {States.Labels[e.State]}";

    /// <summary>A series' value at <paramref name="load"/>: exact at a point, a straight line between two, nothing outside the series.</summary>
    private static double? ValueAt(List<(double Load, double Value)> series, double load)
    {
        if (series.Count == 0 || load < series[0].Load || load > series[^1].Load) return null;
        for (var i = 0; i < series.Count; i++)
        {
            var (l1, v1) = series[i];
            if (load == l1) return v1;
            if (load < l1)
            {
                var (l0, v0) = series[i - 1];
                return v0 + (v1 - v0) * (load - l0) / (l1 - l0);
            }
        }
        return null;
    }

    private sealed class Series(int keys)
    {
        /// <summary>For each key, the level loads that carry it and what they carry, in level order.</summary>
        public readonly List<(double Load, double Value)>?[] ByKey = new List<(double, double)>?[keys];

        public readonly List<(double Load, string Failure)> Failures = [];

        public void Add(double load, Metrics? m, string[] keys)
        {
            if (m is null) return;
            for (var i = 0; i < keys.Length; i++)
                if (m[keys[i]] is { } v) (ByKey[i] ??= []).Add((load, v));
        }

        public Metrics At(string[] keys, double load)
        {
            var m = new Metrics();
            for (var i = 0; i < keys.Length; i++)
                if (ByKey[i] is { } series && ValueAt(series, load) is { } v) m = m.With(keys[i], v);
            return m;
        }
    }

    /// <summary>What a run says about each shape, line and the whole, level by level: the series <see cref="Interpolate"/> reads, kept for as long as the run is.</summary>
    private sealed class RunIndex
    {
        public IReadOnlyList<Level> Levels = [];
        public readonly List<string> ObjectIds = [];
        public readonly Dictionary<string, Series> Objects = [];
        public readonly List<(string From, string To)> PairIds = [];
        public readonly Dictionary<(string From, string To), Series> Pairs = [];
        public readonly Series Overall = new(EdgeKeys.Length);
    }

    private static readonly ConditionalWeakTable<LoadRun, RunIndex> Indexes = new();

    private static RunIndex IndexOf(LoadRun run) => Indexes.GetValue(run, r =>
    {
        var index = new RunIndex { Levels = IdleOf(r) is { } idle ? [idle, .. r.Levels] : (IReadOnlyList<Level>)r.Levels };
        foreach (var l in index.Levels)
        {
            foreach (var id in l.Objects.Keys)
            {
                if (!index.Objects.TryGetValue(id, out var series))
                {
                    index.Objects[id] = series = new Series(ObjectKeys.Length);
                    index.ObjectIds.Add(id);
                }
                series.Add(l.Load, l.Objects[id], ObjectKeys);
            }
            var here = new HashSet<(string, string)>(); // the first connection of a pair in a level is the one that counts
            foreach (var c in l.Connections)
            {
                var key = (c.From, c.To);
                if (!here.Add(key)) continue;
                if (!index.Pairs.TryGetValue(key, out var series))
                {
                    index.Pairs[key] = series = new Series(EdgeKeys.Length);
                    index.PairIds.Add(key);
                }
                series.Add(l.Load, c, EdgeKeys);
                if (c.Failure is { } f) series.Failures.Add((l.Load, f));
            }
            index.Overall.Add(l.Load, l.Overall, EdgeKeys);
        }
        return index;
    });

    /// <summary>How a connection's failing share fails at <paramref name="load"/>: what the nearest level at or below it says, else the lowest level above that says one. Not interpolated: it is a kind, not a number.</summary>
    private static string? FailureAt(List<(double Load, string Failure)> failures, double load)
    {
        string? below = null;
        string? above = null;
        foreach (var (at, f) in failures)
        {
            if (at <= load) below = f;
            else above ??= f;
        }
        return below ?? above;
    }

    /// <summary>
    /// The run at any load from no load to the top tested one, as a <see cref="Level"/>. Below the first tested level it runs toward the idle level (see <see cref="IdleOf"/>); a load outside that
    /// range is clamped to the nearest end, so nothing is ever extrapolated. Each metric is interpolated on the levels that carry it; one with no value at that load is left out (not measured),
    /// never zero. A load that isn't a number is the lowest level. What the run says about each shape and line is read once and kept with the run, so a frame only walks those series.
    /// </summary>
    public static Level Interpolate(LoadRun run, double load)
    {
        var index = IndexOf(run);
        var levels = index.Levels;
        var at = double.IsFinite(load) ? Math.Min(levels[^1].Load, Math.Max(levels[0].Load, load)) : run.Levels[0].Load;

        var objects = new IdMap<Metrics>();
        foreach (var id in index.ObjectIds)
        {
            var m = index.Objects[id].At(ObjectKeys, at);
            if (!m.IsEmpty) objects.Add(id, m);
        }

        var connections = new List<Pair>();
        foreach (var key in index.PairIds)
        {
            var series = index.Pairs[key];
            var m = series.At(EdgeKeys, at);
            if (!m.IsEmpty) connections.Add(new Pair(key.From, key.To) { Rate = m.Rate, Bytes = m.Bytes, P50 = m.P50, P95 = m.P95, Errors = m.Errors, Failure = FailureAt(series.Failures, at) });
        }
        return new Level(at, index.Overall.At(EdgeKeys, at), objects, connections);
    }
}
