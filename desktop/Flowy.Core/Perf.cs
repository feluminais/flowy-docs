using System.Globalization;

namespace Flowy.Core;

/// <summary>
/// Everything a run can measure. On an object: util, queue, errors. On a connection or overall: rate, p50, p95, errors. A missing number
/// means "not measured", never zero. A port of <c>Metrics</c> in src/core/perf.ts.
/// </summary>
public record Metrics
{
    public double? Util { get; init; }

    public double? Queue { get; init; }

    public double? Errors { get; init; }

    public double? Rate { get; init; }

    public double? P50 { get; init; }

    public double? P95 { get; init; }

    public double? this[string key] => key switch { "util" => Util, "queue" => Queue, "errors" => Errors, "rate" => Rate, "p50" => P50, "p95" => P95, _ => null };

    internal Metrics With(string key, double? value) => key switch
    {
        "util" => this with { Util = value },
        "queue" => this with { Queue = value },
        "errors" => this with { Errors = value },
        "rate" => this with { Rate = value },
        "p50" => this with { P50 = value },
        "p95" => this with { P95 = value },
        _ => this,
    };

    /// <summary>Whether no number was measured.</summary>
    public bool IsEmpty => Util is null && Queue is null && Errors is null && Rate is null && P50 is null && P95 is null;
}

/// <summary>What one connection measured, or one line in a view once connections are rolled up.</summary>
public sealed record Pair(string From, string To) : Metrics;

public sealed record Level(double Load, Metrics Overall, IdMap<Metrics> Objects, IReadOnlyList<Pair> Connections);

/// <summary>A load test, summarised (<c>Run</c> in perf.ts; renamed because the app already has things called Run).</summary>
public sealed record LoadRun(string Name, string? About, string Unit, string? Entry, IReadOnlyList<Level> Levels);

/// <summary>How strained an object is: 0 to 1, whether its utilisation or its failures decided it, and the raw share that did.</summary>
public sealed record Strain(double Value, string By, double Share);

/// <summary>What decided a knee: the object that is worst, and why.</summary>
public sealed record KneeBy(string Id, string Kind, double Share);

/// <summary>Where a run first struggles: a tested level, and either the object worst there (<see cref="By"/>) or, with none to blame, the latency (<see cref="LatencyFrom"/> to <see cref="LatencyTo"/>).</summary>
public sealed record Knee(int Index, double Load, KneeBy? By, double? LatencyFrom = null, double? LatencyTo = null);

public sealed record BoxTraffic(double? Strain, int Queue);

/// <summary>How a line looks: how thick, how many particles a second, how long one takes to cross (ms), and the share of them that fail.</summary>
public sealed record LineTraffic(string From, string To, double Width, double PerSecond, int TravelMs, double Failed);

public sealed record Traffic(IdMap<BoxTraffic> Boxes, IReadOnlyList<LineTraffic> Lines);

/// <summary>
/// Load-test runs, read and played back. A port of src/core/perf.ts, kept equal to it by the fixtures in desktop/fixtures/perf.ts: a run
/// is parsed the same way (and its problems worded the same), and between two tested levels the numbers are interpolated and never predicted.
/// </summary>
public static class Perf
{
    private static readonly string[] ObjectKeys = ["util", "queue", "errors"];
    private static readonly string[] EdgeKeys = ["rate", "p50", "p95", "errors"];

    /// <summary>The lowest and highest a metric may be.</summary>
    private static (double Lo, double Hi) Range(string key) => key is "util" or "errors" ? (0, 1) : (0, double.PositiveInfinity);

    private static string Js(double n) => n.ToString("R", CultureInfo.InvariantCulture);

    /// <summary>JavaScript's <c>Math.round</c>: halves go up, where .NET's goes to even.</summary>
    public static double JsRound(double x) => Math.Floor(x + 0.5);

    private static double Clamp(double n, double lo, double hi) => Math.Min(hi, Math.Max(lo, n));

    private static double Round2(double n) => JsRound(n * 100) / 100;

    // ponytail: plain decimal numbers only. JavaScript's Number() also takes 0x10, 0o7 and 0b11; a run is written by a tool that writes decimals.
    // A file text hands over a number as text, so "0.35" is read here.
    private static double? Num(object? v)
    {
        if (v is not string s || s.Trim() == "") return null;
        return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) ? n : null;
    }

    private static bool IsMap(object? v) => v is OrderedDictionary<string, object?>;

    /// <summary>The numbers <paramref name="keys"/> name in <paramref name="raw"/>. One that isn't a number, or is out of range, is reported through <paramref name="add"/> and left out.</summary>
    private static Metrics ReadMetrics(string[] keys, OrderedDictionary<string, object?> raw, string where, Action<string> add)
    {
        var m = new Metrics();
        foreach (var key in keys)
        {
            if (!raw.TryGetValue(key, out var v)) continue;
            var n = Num(v);
            var (lo, hi) = Range(key);
            if (n is null) add($"{where}: {key} must be a number");
            else if (n < lo || n > hi) add($"{where}: {key} must be {(double.IsPositiveInfinity(hi) ? $"{Js(lo)} or more" : $"between {Js(lo)} and {Js(hi)}")}");
            else m = m.With(key, n);
        }
        if (m.P50 is { } p50 && m.P95 is { } p95 && p95 < p50) add($"{where}: p95 is below p50");
        return m;
    }

    /// <summary>
    /// Reads one run file (<c>perf/&lt;id&gt;.yaml</c>). Throws a <see cref="ParseError"/> for a file that can't be played: bad YAML, the wrong shape,
    /// fewer than two levels, loads that don't go up. A number that is wrong is a problem instead, and is left out of the run.
    /// </summary>
    public static (LoadRun Run, IReadOnlyList<Problem> Problems) ParseRun(string id, string text)
    {
        var file = $"perf/{id}.yaml";
        var problems = new List<Problem>();
        void Add(string message) => problems.Add(new Problem(file, null, message));
        if (ModelFiles.OrEmpty(YamlText.Parse(file, text), new OrderedDictionary<string, object?>()) is not OrderedDictionary<string, object?> doc)
            throw new ParseError(file, "expected a mapping with \"name\", \"unit\" and \"levels\"");

        string? Word(string key)
        {
            if (!doc.TryGetValue(key, out var v)) return null;
            if (v is not string s) throw new ParseError(file, $"\"{key}\" must be plain text, not a list or a mapping");
            return s.Trim() == "" ? null : s;
        }
        var name = Word("name");
        if (name is null) Add("name is missing");
        var about = Word("about");
        var unit = Word("unit");
        var entry = Word("entry");

        doc.TryGetValue("levels", out var levelsValue);
        if (ModelFiles.OrEmpty(levelsValue, new List<object?>()) is not List<object?> rawLevels) throw new ParseError(file, "\"levels\" must be a list");
        if (rawLevels.Count < 2) throw new ParseError(file, "needs at least two levels, so there is something to play between");

        Level ReadLevel(object? raw, int i)
        {
            var at = $"level {i + 1}";
            if (raw is not OrderedDictionary<string, object?> map) throw new ParseError(file, $"{at} must be a mapping");
            map.TryGetValue("load", out var loadValue);
            if (Num(loadValue) is not { } load || load < 0) throw new ParseError(file, $"{at}: load must be a number, 0 or more");
            string Where(string what) => $"load {Js(load)}, {what}";

            map.TryGetValue("overall", out var overallValue);
            if (ModelFiles.OrEmpty(overallValue, new OrderedDictionary<string, object?>()) is not OrderedDictionary<string, object?> rawOverall)
                throw new ParseError(file, $"{at}: overall must be a mapping of numbers");
            var overall = ReadMetrics(EdgeKeys, rawOverall, Where("overall"), Add);

            map.TryGetValue("objects", out var objectsValue);
            if (ModelFiles.OrEmpty(objectsValue, new OrderedDictionary<string, object?>()) is not OrderedDictionary<string, object?> rawObjects)
                throw new ParseError(file, $"{at}: objects must map ids to numbers");
            var objects = new IdMap<Metrics>();
            foreach (var (oid, m) in rawObjects)
            {
                if (ModelFiles.OrEmpty(m, new OrderedDictionary<string, object?>()) is not OrderedDictionary<string, object?> entryMap)
                    throw new ParseError(file, $"{at}: {oid} must be a mapping of numbers");
                objects.Add(oid, ReadMetrics(ObjectKeys, entryMap, Where(oid), Add));
            }

            map.TryGetValue("connections", out var pairsValue);
            if (ModelFiles.OrEmpty(pairsValue, new List<object?>()) is not List<object?> rawPairs) throw new ParseError(file, $"{at}: connections must be a list");
            var seen = new HashSet<(string, string)>();
            var connections = new List<Pair>();
            for (var j = 0; j < rawPairs.Count; j++)
            {
                if (rawPairs[j] is not OrderedDictionary<string, object?> c) throw new ParseError(file, $"{at}: connection {j + 1} must be a mapping");
                c.TryGetValue("from", out var from);
                c.TryGetValue("to", out var to);
                if (from is not string { Length: > 0 } f || to is not string { Length: > 0 } t)
                    throw new ParseError(file, $"{at}: connection {j + 1} needs a \"from\" and a \"to\"");
                if (!seen.Add((f, t)))
                {
                    Add($"{Where($"{f} → {t}")}: listed twice");
                    continue;
                }
                var read = ReadMetrics(EdgeKeys, c, Where($"{f} → {t}"), Add);
                connections.Add(new Pair(f, t) { Rate = read.Rate, P50 = read.P50, P95 = read.P95, Errors = read.Errors });
            }
            return new Level(load, overall, objects, connections);
        }

        var levels = rawLevels.Select(ReadLevel).ToList();
        for (var i = 1; i < levels.Count; i++)
            if (levels[i].Load <= levels[i - 1].Load)
                throw new ParseError(file, $"level {i + 1}: load {Js(levels[i].Load)} must be above {Js(levels[i - 1].Load)} (levels go up in load)");
        return (new LoadRun(name ?? id, about, unit ?? "load", entry, levels), problems);
    }

    /// <summary>
    /// What a run says that the model doesn't back up: an <c>entry</c> or an object that isn't there, a connection that isn't one of the model's.
    /// Each is reported once, however many levels repeat it.
    /// </summary>
    public static IReadOnlyList<Problem> CheckRun(string id, LoadRun run, Model model)
    {
        var file = $"perf/{id}.yaml";
        var problems = new List<Problem>();
        var said = new HashSet<string>();
        void Once(string message)
        {
            if (said.Add(message)) problems.Add(new Problem(file, null, message));
        }
        if (run.Entry is { } entry && model.GetObject(entry) is null) Once($"entry \"{entry}\" is not an object");
        foreach (var level in run.Levels)
        {
            foreach (var oid in level.Objects.Keys)
                if (model.GetObject(oid) is null) Once($"unknown object \"{oid}\"");
            foreach (var c in level.Connections)
            {
                var unknown = new[] { c.From, c.To }.Where(end => model.GetObject(end) is null).ToList();
                foreach (var end in unknown) Once($"unknown object \"{end}\"");
                if (unknown.Count == 0 && !model.Connections.Any(m => m.From == c.From && m.To == c.To)) Once($"{c.From} → {c.To} is not a connection in the model");
            }
        }
        return problems;
    }

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
            var m = MetricsAt(levels, l => l.Connections.FirstOrDefault(c => c.From == from && c.To == to), EdgeKeys, at);
            if (!m.IsEmpty) connections.Add(new Pair(from, to) { Rate = m.Rate, P50 = m.P50, P95 = m.P95, Errors = m.Errors });
        }
        return new Level(at, MetricsAt(levels, l => l.Overall, EdgeKeys, at), objects, connections);
    }

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

    /// <summary>One of two numbers when only one exists, else <paramref name="f"/> of both.</summary>
    private static double? Either(double? x, double? y, Func<double, double, double> f) => x is null ? y : y is null ? x : f(x.Value, y.Value);

    /// <summary>
    /// A level as one view draws it. Each object takes the worst of what it holds and of itself (highest util and errors, queues added). Each line
    /// the view draws takes the connections that land on it: rates added, worst latency, worst errors. A connection the model doesn't have is left out.
    /// </summary>
    public static (IdMap<Metrics> Objects, IReadOnlyList<Pair> Lines) RollUp(Model model, Level level, string view)
    {
        var held = new Dictionary<string, Metrics>();
        var order = new List<string>();
        foreach (var (id, m) in level.Objects)
        {
            if (model.GetObject(id) is null) continue;
            foreach (var holder in Views.Chain(model, id))
            {
                if (holder == Names.Root) continue;
                var so = held.TryGetValue(holder, out var found) ? found : new Metrics();
                if (!held.ContainsKey(holder)) order.Add(holder);
                held[holder] = new Metrics { Util = Either(so.Util, m.Util, Math.Max), Errors = Either(so.Errors, m.Errors, Math.Max), Queue = Either(so.Queue, m.Queue, (a, b) => a + b) };
            }
        }
        var objects = new IdMap<Metrics>();
        foreach (var id in order) objects.Add(id, held[id]);

        var lines = new List<Pair>();
        var index = new Dictionary<(string, string), int>();
        foreach (var c in level.Connections)
        {
            if (!model.Connections.Any(m => m.From == c.From && m.To == c.To)) continue;
            if (Views.PlaceEnds(model, view, c.From, c.To) is not { } ends) continue;
            var so = index.TryGetValue(ends, out var at) ? lines[at] : null;
            var line = new Pair(ends.From, ends.To)
            {
                Rate = Either(so?.Rate, c.Rate, (a, b) => a + b), P50 = Either(so?.P50, c.P50, Math.Max), P95 = Either(so?.P95, c.P95, Math.Max), Errors = Either(so?.Errors, c.Errors, Math.Max),
            };
            if (so is null)
            {
                index[ends] = lines.Count;
                lines.Add(line);
            }
            else lines[at] = line;
        }
        return (objects, lines);
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
            (string Id, string Kind, double Share, double Value)? worst = null;
            foreach (var (id, m) in level.Objects)
            {
                if (StrainOf(m) is { } s && (worst is null || s.Value > worst.Value.Value)) worst = (id, s.By, s.Share, s.Value);
            }
            if (worst is { } w && w.Value >= KneeStrain) return new Knee(index, level.Load, new KneeBy(w.Id, w.Kind, w.Share));
            var p95 = level.Overall.P95;
            if (baseline is > 0 && p95 is { } p && p >= KneeLatency * baseline.Value) return new Knee(index, level.Load, null, baseline, p);
        }
        return null;
    }

    private static string Pct(double n) => $"{Js(JsRound(n * 100))}%";

    /// <summary>The sentence under the Performance panel's strip. <paramref name="nameOf"/> turns an object id into the name a reader sees.</summary>
    public static string KneeText(LoadRun run, Knee k, Func<string, string> nameOf)
    {
        var at = $"{Js(k.Load)} {run.Unit}";
        if (k.By is { } by)
            return $"First struggles at {at}: {nameOf(by.Id)} {(by.Kind == "util" ? $"at {Pct(by.Share)} of capacity" : $"failing {Pct(by.Share)} of calls")}";
        return $"Latency passes {Js(KneeLatency)}× its starting point at {at}: overall p95 goes from {Js(JsRound(k.LatencyFrom!.Value))} ms to {Js(JsRound(k.LatencyTo!.Value))} ms";
    }

    /// <summary>A line that carried <paramref name="rate"/> calls a second: logarithmic and capped, because a screen can't draw 1000 particles a second.</summary>
    private static LineTraffic LineTrafficOf(Pair l, double rate)
    {
        var errors = Round2(l.Errors ?? 0);
        return new LineTraffic(
            l.From,
            l.To,
            Round2(Clamp(1.5 + 1.5 * Math.Log10(1 + rate), 1.5, 6)),
            rate > 0 ? Round2(Clamp(1.5 + 4 * Math.Log10(1 + rate), 1.5, 14)) : 0,
            l.P50 is null ? 1000 : (int)JsRound(Clamp(500 + 1000 * Math.Log10(1 + l.P50.Value / 10), 500, 4000)),
            errors >= 0.01 ? Math.Max(errors, 0.05) : errors);
    }

    /// <summary>
    /// Everything the Performance panel draws for one view at one load, as plain numbers so a renderer needs no logic: the strain (0 green to 1 red,
    /// null when nothing was measured) and queue of each shape that was measured or holds something that was, and the traffic on each line that has
    /// a rate. Shapes and lines with nothing measured are left out: they stay neutral, never drawn as zero.
    /// </summary>
    public static Traffic TrafficFor(Model model, LoadRun run, double load, string view)
    {
        var (objects, lines) = RollUp(model, Interpolate(run, load), view);
        var boxes = new IdMap<BoxTraffic>();
        foreach (var (id, m) in objects)
        {
            var s = StrainOf(m)?.Value;
            if (s is null && m.Queue is null) continue;
            boxes.Add(id, new BoxTraffic(s is null ? null : Round2(s.Value), (int)JsRound(m.Queue ?? 0)));
        }
        return new Traffic(boxes, lines.Where(l => l.Rate is not null).Select(l => LineTrafficOf(l, l.Rate!.Value)).ToList());
    }
}
