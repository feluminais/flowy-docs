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

    private static Metrics MetricsAt(IReadOnlyList<Level> levels, Func<Level, Metrics?> pick, string[] keys, double load)
    {
        var m = new Metrics();
        foreach (var key in keys)
        {
            var series = levels.Select(l => (l.Load, Value: pick(l)?[key])).Where(p => p.Value is not null).Select(p => (p.Load, p.Value!.Value)).ToList();
            if (ValueAt(series, load) is { } v) m = m.With(key, v);
        }
        return m;
    }

    /// <summary>How a connection's failing share fails at <paramref name="load"/>: what the nearest level at or below it says, else the lowest level above that says one. Not interpolated: it is a kind, not a number.</summary>
    private static string? FailureAt(IReadOnlyList<Level> levels, Func<Level, Pair?> pick, double load)
    {
        string? below = null;
        string? above = null;
        foreach (var l in levels)
        {
            if (pick(l)?.Failure is not { } f) continue;
            if (l.Load <= load) below = f;
            else above ??= f;
        }
        return below ?? above;
    }

    /// <summary>
    /// The run at any load inside the tested range, as a <see cref="Level"/>. A load outside it is clamped to the nearest end, so nothing is
    /// ever extrapolated. Each metric is interpolated on the levels that carry it; one with no value at that load is left out (not measured),
    /// never zero. A load that isn't a number is the lowest level.
    /// </summary>
    public static Level Interpolate(LoadRun run, double load)
    {
        var levels = run.Levels;
        var at = double.IsFinite(load) ? Math.Min(levels[^1].Load, Math.Max(levels[0].Load, load)) : levels[0].Load;

        var objects = new IdMap<Metrics>();
        var ids = new List<string>();
        foreach (var id in levels.SelectMany(l => l.Objects.Keys)) if (!ids.Contains(id)) ids.Add(id);
        foreach (var id in ids)
        {
            var m = MetricsAt(levels, l => l.Objects.TryGetValue(id, out var found) ? found : null, ObjectKeys, at);
            if (!m.IsEmpty) objects.Add(id, m);
        }

        var pairs = new List<(string From, string To)>();
        foreach (var l in levels) foreach (var c in l.Connections) if (!pairs.Contains((c.From, c.To))) pairs.Add((c.From, c.To));
        var connections = new List<Pair>();
        foreach (var (from, to) in pairs)
        {
            Pair? Pick(Level l) => l.Connections.FirstOrDefault(c => c.From == from && c.To == to);
            var m = MetricsAt(levels, Pick, EdgeKeys, at);
            if (!m.IsEmpty) connections.Add(new Pair(from, to) { Rate = m.Rate, Bytes = m.Bytes, P50 = m.P50, P95 = m.P95, Errors = m.Errors, Failure = FailureAt(levels, Pick, at) });
        }
        return new Level(at, MetricsAt(levels, l => l.Overall, EdgeKeys, at), objects, connections);
    }
}
