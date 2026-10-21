using System.Globalization;

namespace Flowy.Core;

/// <summary>
/// Everything a run can measure. On an object: util, queue, errors. On a connection or overall: rate, bytes (a call's size), p50, p95, errors. A missing number
/// means "not measured", never zero. A port of <c>Metrics</c> in src/core/perf.ts.
/// </summary>
public record Metrics
{
    public double? Util { get; init; }

    public double? Queue { get; init; }

    public double? Errors { get; init; }

    public double? Rate { get; init; }

    public double? Bytes { get; init; }

    public double? P50 { get; init; }

    public double? P95 { get; init; }

    public double? this[string key] => key switch { "util" => Util, "queue" => Queue, "errors" => Errors, "rate" => Rate, "bytes" => Bytes, "p50" => P50, "p95" => P95, _ => null };

    internal Metrics With(string key, double? value) => key switch
    {
        "util" => this with { Util = value },
        "queue" => this with { Queue = value },
        "errors" => this with { Errors = value },
        "rate" => this with { Rate = value },
        "bytes" => this with { Bytes = value },
        "p50" => this with { P50 = value },
        "p95" => this with { P95 = value },
        _ => this,
    };

    /// <summary>Whether no number was measured.</summary>
    public bool IsEmpty => Util is null && Queue is null && Errors is null && Rate is null && Bytes is null && P50 is null && P95 is null;
}

/// <summary>What one connection measured, or one line in a view once connections are rolled up. <c>Failure</c> is how its failing share fails when it says (lost or rejected).</summary>
public sealed record Pair(string From, string To) : Metrics
{
    public string? Failure { get; init; }
}

public sealed record Level(double Load, Metrics Overall, IdMap<Metrics> Objects, IReadOnlyList<Pair> Connections);

/// <summary>A formula as the run wrote it. Only the text is kept, as in perf.ts, where a run travels to the browser as JSON: the formula is read from the text where it is used.</summary>
public sealed record SourceFormula(string Text);

/// <summary>Where a run's requests come from, and how to draw them: the dots' colour, and formulas for how many dots a line shows at once and for the area of a dot. Every part is optional.</summary>
public sealed record Source(string? Color = null, SourceFormula? Dot = null, SourceFormula? Size = null);

/// <summary>Something that happens at a time in a time run: a shape goes into a state. <c>Text</c> is empty when the run doesn't say; <see cref="Perf.EventText"/> then words it.</summary>
public sealed record RunEvent(double At, string On, string State, string Text);

/// <summary>
/// A load test, summarised, or a run measured over time (<c>Run</c> in perf.ts; renamed because the app already has things called Run). A time run says so
/// (<c>IsTime</c>) and may have events; its levels keep their time in <c>Load</c>, as in perf.ts. A load run has neither, as before time runs existed.
/// </summary>
public sealed record LoadRun(string Name, string? About, string Unit, string? Entry, IReadOnlyList<Level> Levels, Source? Source = null)
{
    public bool IsTime { get; init; }

    /// <summary>The events in time order (later in the file last among those at one time). None for a load run.</summary>
    public IReadOnlyList<RunEvent> Events { get; init; } = [];
}

/// <summary>How strained an object is: 0 to 1, whether its utilisation or its failures decided it, and the raw share that did.</summary>
public sealed record Strain(double Value, string By, double Share);

/// <summary>What decided a knee: the object that is worst, and why.</summary>
public sealed record KneeBy(string Id, string Kind, double Share);

/// <summary>Where a run first struggles: a tested level, and either the object worst there (<see cref="By"/>) or, with none to blame, the latency (<see cref="LatencyFrom"/> to <see cref="LatencyTo"/>).</summary>
public sealed record Knee(int Index, double Load, KneeBy? By, double? LatencyFrom = null, double? LatencyTo = null);

public sealed record BoxTraffic(double? Strain, int Queue);

/// <summary>
/// How a line looks: how thick, how many particles a second, how long one takes to cross (ms), and the share of them that fail. What a run's source adds
/// is null (or false) when it adds nothing: <c>Color</c> as written, <c>Radius</c> times the usual dot's, <c>Capped</c> when the count was scaled down to fit the
/// screen, <c>Failure</c> how the failing share fails, <c>Dots</c> how many are on the line at once once the formula and the cap have decided.
/// </summary>
public sealed record LineTraffic(string From, string To, double Width, double PerSecond, int TravelMs, double Failed)
{
    public string? Color { get; init; }

    public double? Radius { get; init; }

    public bool Capped { get; init; }

    public string? Failure { get; init; }

    public double? Dots { get; init; }
}

/// <summary>The pieces the Performance key draws for a run's source (see <see cref="Perf.SourceKeyOf"/>).</summary>
public sealed record SourceKey(string Name, string? Color, string? Scale, bool Bigger, bool ScaledDown);

public sealed record Traffic(IdMap<BoxTraffic> Boxes, IReadOnlyList<LineTraffic> Lines);

/// <summary>
/// A run at one load as one view draws it: what each object and line reads, and the traffic made from that. Worked out once, so the canvas and the
/// panel's readouts share it instead of each interpolating and rolling the run up again.
/// </summary>
public sealed record LoadFrame(IdMap<Metrics> Objects, IReadOnlyList<Pair> Lines, Traffic Traffic)
{
    /// <summary>An object's numbers, or null when nothing was measured on it.</summary>
    public Metrics? Box(string id) => Objects.TryGetValue(id, out var m) ? m : null;

    /// <summary>The numbers of the line the view draws between two shapes, or null when none was measured.</summary>
    public Pair? Line(string from, string to) => Lines.FirstOrDefault(p => p.From == from && p.To == to);
}

/// <summary>
/// Load-test runs, read and played back. A port of src/core/perf.ts, kept equal to it by the fixtures in desktop/fixtures/perf.ts: a run
/// is parsed the same way (and its problems worded the same), and between two tested levels the numbers are interpolated and never predicted.
/// </summary>
public static class Perf
{
    private static readonly string[] ObjectKeys = ["util", "queue", "errors"];
    private static readonly string[] EdgeKeys = ["rate", "bytes", "p50", "p95", "errors"];
    private static readonly string[] SourceKeys = ["color", "dot", "size"];
    private static readonly string[] Failures = ["lost", "rejected"];
    private static readonly string[] Axes = ["load", "time"];
    private static readonly string UseState = $"use {string.Join(", ", States.Names)}";

    /// <summary>How much of a name a problem quotes, so a hostile key doesn't fill the problem list.</summary>
    private const int Quoted = 40;

    private static string Brief(string text) => text.Length > Quoted ? text[..Quoted] + "…" : text;

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

    /// <summary>The <c>source:</c> block of a run. A problem is reported through <paramref name="add"/> and what is wrong is left out; a block with nothing usable in it is no source.</summary>
    private static Source? ReadSource(object? raw, Action<string> add)
    {
        var block = ModelFiles.OrEmpty(raw, null);
        if (block is null) return null;
        if (block is not OrderedDictionary<string, object?> map)
        {
            add("source must be a mapping of color, dot and size");
            return null;
        }
        foreach (var key in map.Keys)
            if (!SourceKeys.Contains(key)) add($"source: unknown key \"{Brief(key)}\" (use {string.Join(", ", SourceKeys)})");
        string? color = null;
        if (ModelFiles.OrEmpty(map.TryGetValue("color", out var c) ? c : null, null) is { } colorValue)
        {
            if (colorValue is string text && Look.IsColor(text)) color = text;
            else add("source: color must be a colour name or a hex such as #1d9e75");
        }
        SourceFormula? ReadFormula(string key, string example)
        {
            if (ModelFiles.OrEmpty(map.TryGetValue(key, out var f) ? f : null, null) is not { } value) return null;
            if (value is not string text)
            {
                add($"source: {key} must be a formula such as {example}");
                return null;
            }
            var read = Formulas.Parse(text);
            if (read.Formula is null)
            {
                add($"source: {key} {read.Problem}"); // a formula that can't be read leaves the default curve in its place
                return null;
            }
            return new SourceFormula(text);
        }
        var dot = ReadFormula("dot", "rate / 50");
        var size = ReadFormula("size", "bytes / 400");
        return color is null && dot is null && size is null ? null : new Source(color, dot, size);
    }

    private static readonly Dictionary<string, Formula?> Read = [];

    /// <summary>The formula a source's text says, read once and kept (a line is drawn twenty times a second), or null for a text that doesn't read.</summary>
    private static Formula? FormulaOf(SourceFormula f)
    {
        lock (Read)
        {
            if (!Read.TryGetValue(f.Text, out var formula))
            {
                if (Read.Count >= 64) Read.Clear();
                Read[f.Text] = formula = Formulas.Parse(f.Text).Formula;
            }
            return formula;
        }
    }

    /// <summary>The <c>failure:</c> of a connection: lost or rejected, or nothing. Anything else is a problem.</summary>
    private static string? ReadFailure(object? raw, string where, Action<string> add)
    {
        if (ModelFiles.OrEmpty(raw, null) is not { } value) return null;
        if (value is string text && Failures.Contains(text)) return text;
        add($"{where}: failure must be {string.Join(" or ", Failures)}");
        return null;
    }

    /// <summary>
    /// The <c>events:</c> of a time run, in time order (a stable sort, so of two at one time the later in the file stays later). A problem is reported through <paramref name="add"/>
    /// and the event it is about is left out: one with no time inside the run (<paramref name="lo"/> to <paramref name="hi"/>), no shape or no state word. A text that is not
    /// plain text only loses the text. The shape is not looked up here (<see cref="CheckRun"/> does, once the model is known).
    /// </summary>
    private static List<RunEvent> ReadEvents(object? raw, double lo, double hi, string unit, Action<string> add)
    {
        var output = new List<RunEvent>();
        if (ModelFiles.OrEmpty(raw, new List<object?>()) is not List<object?> list)
        {
            add("events must be a list");
            return output;
        }
        for (var i = 0; i < list.Count; i++)
        {
            var where = $"event {i + 1}";
            if (list[i] is not OrderedDictionary<string, object?> e)
            {
                add($"{where} must be a mapping of at, on, state and text");
                continue;
            }
            var ok = true;
            e.TryGetValue("at", out var atValue);
            var at = Num(atValue);
            if (at is null)
            {
                add($"{where}: at must be a number");
                ok = false;
            }
            else if (at < lo || at > hi)
            {
                add($"{where}: at {Js(at.Value)} is outside the run ({Js(lo)} to {Js(hi)} {unit})");
                ok = false;
            }
            e.TryGetValue("on", out var on);
            if (on is not string { Length: > 0 })
            {
                add($"{where}: on must name a shape");
                ok = false;
            }
            e.TryGetValue("state", out var state);
            if (state is not string stateWord)
            {
                add($"{where}: state needs a state word ({UseState})");
                ok = false;
            }
            else if (!States.Names.Contains(stateWord))
            {
                add($"{where}: unknown state \"{Brief(stateWord)}\" ({UseState})");
                ok = false;
            }
            var said = ModelFiles.OrEmpty(e.TryGetValue("text", out var textValue) ? textValue : null, null);
            if (said is not null and not string) add($"{where}: text must be plain text");
            if (ok && at is { } time && on is string shape && state is string word) output.Add(new RunEvent(time, shape, word, said is string text ? text.Trim() : ""));
        }
        return [.. output.OrderBy(e => e.At)];
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
        doc.TryGetValue("source", out var sourceValue);
        var source = ReadSource(sourceValue, Add);
        var axisValue = ModelFiles.OrEmpty(doc.TryGetValue("axis", out var a) ? a : null, null);
        var axis = Axes.FirstOrDefault(x => x.Equals(axisValue)) ?? "load"; // a run says what it is measured over, or is a load run
        if (axisValue is not null && !Axes.Any(x => x.Equals(axisValue))) Add($"axis must be {string.Join(" or ", Axes)}");
        // The key a level carries its number under, and the other one, which is the commonest slip: a time run written with load, or a load run with at.
        var key = axis == "time" ? "at" : "load";
        var other = axis == "time" ? "load" : "at";

        doc.TryGetValue("levels", out var levelsValue);
        if (ModelFiles.OrEmpty(levelsValue, new List<object?>()) is not List<object?> rawLevels) throw new ParseError(file, "\"levels\" must be a list");
        if (rawLevels.Count < 2) throw new ParseError(file, "needs at least two levels, so there is something to play between");

        Level ReadLevel(object? raw, int i)
        {
            var at = $"level {i + 1}";
            if (raw is not OrderedDictionary<string, object?> map) throw new ParseError(file, $"{at} must be a mapping");
            if (map.ContainsKey(other)) Add($"{at}: a {axis} run uses {key}, not {other}");
            // The wrong key is told off above and still gives the number, so the run plays.
            var loadValue = map.TryGetValue(key, out var own) && own is not null ? own : map.TryGetValue(other, out var wrong) ? wrong : null;
            if (Num(loadValue) is not { } load || load < 0) throw new ParseError(file, $"{at}: {key} must be a number, 0 or more");
            string Where(string what) => $"{key} {Js(load)}, {what}";

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
                var label = Where($"{f} → {t}");
                var failure = ReadFailure(c.TryGetValue("failure", out var failureValue) ? failureValue : null, label, Add);
                var read = ReadMetrics(EdgeKeys, c, label, Add);
                connections.Add(new Pair(f, t) { Rate = read.Rate, Bytes = read.Bytes, P50 = read.P50, P95 = read.P95, Errors = read.Errors, Failure = failure });
            }
            return new Level(load, overall, objects, connections);
        }

        var levels = rawLevels.Select(ReadLevel).ToList();
        for (var i = 1; i < levels.Count; i++)
            if (levels[i].Load <= levels[i - 1].Load)
                throw new ParseError(file, $"level {i + 1}: {key} {Js(levels[i].Load)} must be above {Js(levels[i - 1].Load)} (levels go up in {axis})");
        // Events belong to a time run. On a load run they are a problem and are not read.
        var rawEvents = ModelFiles.OrEmpty(doc.TryGetValue("events", out var ev) ? ev : null, null);
        if (axis == "load" && rawEvents is not null) Add("events are only for a time run (set axis: time)");
        var runUnit = unit ?? (axis == "time" ? "s" : "load");
        var events = axis == "time" ? ReadEvents(rawEvents, levels[0].Load, levels[^1].Load, runUnit, Add) : [];
        return (new LoadRun(name ?? id, about, runUnit, entry, levels, source) { IsTime = axis == "time", Events = events }, problems);
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
        // A shape deleted after the run was written shows up here at the next load, never as a crash: runs are outside the edit pipeline.
        foreach (var e in run.Events)
            if (model.GetObject(e.On) is null) Once($"unknown object \"{e.On}\"");
        return problems;
    }

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
        foreach (var id in JsKeys.Order(latest.Keys)) output[id] = latest[id];
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
        var sizes = new List<Sizes>();
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
            var size = so is null ? new Sizes() : sizes[at];
            if (c.Bytes is { } bytes)
            {
                size.Sum += bytes;
                size.N++;
                if (c.Rate is { } rate)
                {
                    size.Weighted += bytes * rate;
                    size.Weight += rate;
                }
            }
            if (c.Failure is { } failure && !size.Failures.Contains(failure)) size.Failures.Add(failure);
            if (so is null)
            {
                index[ends] = lines.Count;
                lines.Add(line);
                sizes.Add(size);
            }
            else lines[at] = line;
        }
        return (objects, lines.Select((line, i) => WithSizes(line, sizes[i])).ToList());
    }

    /// <summary>What the connections that land on one line say about the size of a call and how its failing share fails, as <see cref="RollUp"/> collects them.</summary>
    private sealed class Sizes
    {
        public double Weighted { get; set; }

        public double Weight { get; set; }

        public double Sum { get; set; }

        public int N { get; set; }

        public List<string> Failures { get; } = [];
    }

    /// <summary>
    /// A rolled-up line with its size of a call and how it fails. Bytes is the mean of the connections that give one, weighted by their rates (a connection
    /// with no rate has no weight; with no rates at all it is the plain mean). The failure style is the one the connections that name one agree on; if they
    /// differ there is none, and a connection that names none doesn't veto.
    /// </summary>
    private static Pair WithSizes(Pair line, Sizes size) => new(line.From, line.To)
    {
        Rate = line.Rate,
        Bytes = size.Weight > 0 ? size.Weighted / size.Weight : size.N > 0 ? size.Sum / size.N : null,
        P50 = line.P50,
        P95 = line.P95,
        Errors = line.Errors,
        Failure = size.Failures.Count == 1 ? size.Failures[0] : null,
    };

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
        return $"First struggles at {at}: the slowest 5% of calls go from {Js(JsRound(k.LatencyFrom!.Value))} ms to {Js(JsRound(k.LatencyTo!.Value))} ms";
    }

    /// <summary>
    /// Most dots a source puts on a line at once. A screen line is a hundred to three hundred pixels long and a dot is a few pixels across, so past about
    /// this many they run together and stop being countable. Past it a line is scaled down and says so (see <see cref="CapCounts"/>).
    /// </summary>
    public const int AtOnce = 24;

    /// <summary>The radius of a dot, as a multiple of the usual one, is the square root of the <c>size</c> formula's area, kept between these.</summary>
    public const double RadiusMin = 0.5;

    public const double RadiusMax = 2.5;

    /// <summary>
    /// The dot counts of the sources on one line, scaled down by one common factor when the busiest passes <see cref="AtOnce"/>, so their ratio stays true.
    /// Part 3a has one source on a line; the list is here for the several of Part 3b.
    /// </summary>
    public static (double[] Counts, bool Capped) CapCounts(IReadOnlyList<double> counts)
    {
        var most = counts.Count == 0 ? 0 : Math.Max(0, counts.Max());
        return most <= AtOnce ? (counts.ToArray(), false) : (counts.Select(c => c * AtOnce / most).ToArray(), true);
    }

    /// <summary>The crossing time of a line in ms: what its expected call says, in steps from half a second to four. A line with no p50 is a middling trip.</summary>
    private static int TravelOf(double? p50) => p50 is null ? 1000 : (int)JsRound(Clamp(500 + 1000 * Math.Log10(1 + p50.Value / 10), 500, 4000));

    /// <summary>A line that carried <paramref name="rate"/> calls a second: logarithmic and capped, because a screen can't draw 1000 particles a second, unless the run's source says how many dots to show.</summary>
    private static LineTraffic LineTrafficOf(Pair l, double rate, Source? source)
    {
        var errors = Round2(l.Errors ?? 0);
        var travelMs = TravelOf(l.P50);
        var perSecond = rate > 0 ? Round2(Clamp(1.5 + 4 * Math.Log10(1 + rate), 1.5, 14)) : 0;
        double? dots = null;
        var capped = false;
        double? radius = null;
        var vars = new FormulaVars(rate, l.Bytes, l.P50);
        // How many dots: the formula's count when it has a value (a missing number or a negative result leaves today's curve for this line).
        if (source?.Dot is { } dot && FormulaOf(dot) is { } dotFormula && Formulas.Eval(dotFormula, vars) is { } count && count >= 0)
        {
            var (counts, wasCapped) = CapCounts([count]);
            // The count is dots on the line at once; the speed stays with p50, so dots start as often as they take to cross.
            perSecond = Round2(counts[0] / (travelMs / 1000.0));
            dots = Round2(counts[0]);
            capped = wasCapped;
        }
        if (source?.Size is { } size && FormulaOf(size) is { } sizeFormula && Formulas.Eval(sizeFormula, vars) is { } area && area >= 0) radius = Round2(Clamp(Math.Sqrt(area), RadiusMin, RadiusMax));
        return new LineTraffic(l.From, l.To, Round2(Clamp(1.5 + 1.5 * Math.Log10(1 + rate), 1.5, 6)), perSecond, travelMs, errors >= 0.01 ? Math.Max(errors, 0.05) : errors)
        {
            Color = source?.Color,
            Radius = radius,
            Capped = capped,
            Failure = l.Failure,
            Dots = dots,
        };
    }

    /// <summary>The number in a scale, as short as it reads: 50, 0.5, 12.5, with the float noise of a division (3.0000000000000004) rounded off.</summary>
    private static string Plain(double n) => Js(double.Parse(n.ToString("G6", CultureInfo.InvariantCulture), CultureInfo.InvariantCulture));

    /// <summary>
    /// "1 dot = 50 calls/s" for a run whose <c>dot</c> formula is a constant times the rate and nothing else; null for any other, because a scale in words
    /// that is not true for every line is worse than none. Also null for a scale nobody reads (under a thousandth of a call or over a billion).
    /// </summary>
    public static string? ScaleText(LoadRun run)
    {
        if (run.Source?.Dot is not { } dot || FormulaOf(dot) is not { } formula || Formulas.LinearInRate(formula) is not { } k) return null;
        var calls = 1 / k;
        return calls >= 0.001 && calls < 1e9 ? $"1 dot = {Plain(calls)} calls/s" : null;
    }

    /// <summary>
    /// The pieces the Performance key draws for a run's source, from the lines on screen now: its name and the colour of its dots; the scale in words when the
    /// formula is a plain ratio of the rate and a line follows it; whether any dot is bigger or smaller than usual; whether any line is scaled down to fit.
    /// Null when the run sets no source or no line is on screen, so the key shows only what the picture shows.
    /// </summary>
    public static SourceKey? SourceKeyOf(LoadRun run, IReadOnlyList<LineTraffic> lines)
    {
        if (run.Source is not { } source || lines.Count == 0) return null;
        var scale = lines.Any(l => l.Dots is not null) ? ScaleText(run) : null;
        return new SourceKey(run.Name, source.Color, scale, lines.Any(l => l.Radius is not null), lines.Any(l => l.Capped));
    }

    /// <summary>
    /// Everything the Performance panel draws for one view at one load, as plain numbers so a renderer needs no logic: the strain (0 green to 1 red,
    /// null when nothing was measured) and queue of each shape that was measured or holds something that was, and the traffic on each line that has
    /// a rate. Shapes and lines with nothing measured are left out: they stay neutral, never drawn as zero.
    /// </summary>
    public static Traffic TrafficFor(Model model, LoadRun run, double load, string view) => FrameAt(model, run, load, view).Traffic;

    /// <summary>The run at a load as a view draws it, interpolated and rolled up once: <see cref="TrafficFor"/> and the panel's readouts are both made from it.</summary>
    public static LoadFrame FrameAt(Model model, LoadRun run, double load, string view)
    {
        var (objects, lines) = RollUp(model, Interpolate(run, load), view);
        var boxes = new IdMap<BoxTraffic>();
        foreach (var (id, m) in objects)
        {
            var s = StrainOf(m)?.Value;
            if (s is null && m.Queue is null) continue;
            boxes.Add(id, new BoxTraffic(s is null ? null : Round2(s.Value), (int)JsRound(m.Queue ?? 0)));
        }
        return new LoadFrame(objects, lines, new Traffic(boxes, lines.Where(l => l.Rate is not null).Select(l => LineTrafficOf(l, l.Rate!.Value, run.Source)).ToList()));
    }
}
