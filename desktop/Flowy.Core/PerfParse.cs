using System.Globalization;

namespace Flowy.Core;

/// <summary>Reading a run file (<c>perf/&lt;id&gt;.yaml</c>): the keys a run may have, each part read with its own problems, and the checks that need only the file. Twin of src/core/perf/parse.ts.</summary>
public static partial class Perf
{
    private static readonly string[] ObjectKeys = ["util", "queue", "errors"];
    private static readonly string[] EdgeKeys = ["rate", "bytes", "p50", "p95", "errors"];
    private static readonly string[] SourceKeys = ["color", "dot", "size"];

    /// <summary>What a tested-together source may say: its own name, entry and unit, and the three of a single run's <c>source:</c>.</summary>
    private static readonly string[] SourceInfoKeys = ["name", "entry", "unit", .. SourceKeys];

    /// <summary>The numbers a source may give for one line (<c>by</c>).</summary>
    private static readonly string[] ByKeys = ["rate", "bytes", "p50", "errors"];

    /// <summary>Most runs one run may add, and most sources a run may be tested with.</summary>
    public const int MostAdded = 4;

    public const int MostTested = 3;

    private static readonly string[] Failures = ["lost", "rejected"];
    private static readonly string[] Axes = ["load", "time"];
    private static readonly string UseState = $"use {string.Join(", ", States.Names)}";

    /// <summary>How much of a name a problem quotes, so a hostile key doesn't fill the problem list.</summary>
    private const int Quoted = 40;

    private static string Brief(string text) => text.Length > Quoted ? text[..Quoted] + "…" : text;

    /// <summary>The lowest and highest a metric may be.</summary>
    private static (double Lo, double Hi) Range(string key) => key is "util" or "errors" ? (0, 1) : (0, double.PositiveInfinity);

    // A file text hands over a number as text, so "0.35" is read here, as plain decimal text only (see JsCompat.PlainNumber).
    private static double? Num(object? v) => JsCompat.PlainNumber(v);


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
            else if (n < lo || n > hi) add($"{where}: {key} must be {(double.IsPositiveInfinity(hi) ? $"{JsCompat.Raw(lo)} or more" : $"between {JsCompat.Raw(lo)} and {JsCompat.Raw(hi)}")}");
            else m = m.With(key, n);
        }
        if (m.P50 is { } p50 && m.P95 is { } p95 && p95 < p50) add($"{where}: p95 is below p50");
        return m;
    }

    /// <summary>The <c>source:</c> block of a run. A problem is reported through <paramref name="add"/> and what is wrong is left out; a block with nothing usable in it is no source.</summary>
    private static Source? ReadSource(object? raw, Action<string> add)
    {
        var block = JsCompat.OrEmpty(raw, null);
        if (block is null) return null;
        if (block is not OrderedDictionary<string, object?> map)
        {
            add("source must be a mapping of color, dot and size");
            return null;
        }
        return ReadSourceKeys(map, SourceKeys, "source", add);
    }

    /// <summary>
    /// The colour and the two formulas in a mapping: a single run's <c>source:</c> block, or one of the sources of a run tested together (which also says its name, entry and unit, so
    /// <paramref name="allowed"/> is wider). <paramref name="label"/> starts each problem. What is wrong is left out; a block with nothing usable in it is no source.
    /// </summary>
    private static Source? ReadSourceKeys(OrderedDictionary<string, object?> map, string[] allowed, string label, Action<string> add)
    {
        foreach (var key in JsCompat.OrderKeys(map.Keys))
            if (!allowed.Contains(key)) add($"{label}: unknown key \"{Brief(key)}\" (use {string.Join(", ", allowed)})");
        string? color = null;
        if (JsCompat.OrEmpty(map.TryGetValue("color", out var c) ? c : null, null) is { } colorValue)
        {
            if (colorValue is string text && Look.IsColor(text)) color = text;
            else add($"{label}: color must be a colour name or a hex such as #1d9e75");
        }
        SourceFormula? ReadFormula(string key, string example)
        {
            if (JsCompat.OrEmpty(map.TryGetValue(key, out var f) ? f : null, null) is not { } value) return null;
            if (value is not string text)
            {
                add($"{label}: {key} must be a formula such as {example}");
                return null;
            }
            var read = Formulas.Parse(text);
            if (read.Formula is null)
            {
                add($"{label}: {key} {read.Problem}"); // a formula that can't be read leaves the default curve in its place
                return null;
            }
            return new SourceFormula(text, read.Formula);
        }
        var dot = ReadFormula("dot", "rate / 50");
        var size = ReadFormula("size", "bytes / 400");
        return color is null && dot is null && size is null ? null : new Source(color, dot, size);
    }

    /// <summary>Whether two colours draw the same: a name and its own hex are one colour.</summary>
    private static bool SameColor(string a, string b) => Look.ColorPair(a) is { } pa && Look.ColorPair(b) is { } pb && pa.Light == pb.Light && pa.Dark == pb.Dark;

    /// <summary>A problem for each of the colours (in the order they come) that draws the same as an earlier one, naming the sources by <paramref name="names"/>.</summary>
    private static void SharedColors(IReadOnlyList<string?> colors, IReadOnlyList<string> names, Action<string> add)
    {
        for (var i = 0; i < colors.Count; i++)
        {
            if (colors[i] is not { } c) continue;
            var first = -1;
            for (var j = 0; j < colors.Count && first < 0; j++)
                if (colors[j] is { } d && SameColor(c, d)) first = j;
            if (first != i) add($"{names[first]} and {names[i]} both draw in {Brief(c)}: give each its own colour");
        }
    }

    /// <summary>The <c>failure:</c> of a connection: lost or rejected, or nothing. Anything else is a problem.</summary>
    private static string? ReadFailure(object? raw, string where, Action<string> add)
    {
        if (JsCompat.OrEmpty(raw, null) is not { } value) return null;
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
        if (JsCompat.OrEmpty(raw, new List<object?>()) is not List<object?> list)
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
                add($"{where}: at {JsCompat.Raw(at.Value)} is outside the run ({JsCompat.Raw(lo)} to {JsCompat.Raw(hi)} {unit})");
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
            var said = JsCompat.OrEmpty(e.TryGetValue("text", out var textValue) ? textValue : null, null);
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
        var file = FolderLayout.PerfFile(id);
        var problems = new List<Problem>();
        void Add(string message) => problems.Add(new Problem(file, null, message));
        if (JsCompat.OrEmpty(YamlText.Parse(file, text), new OrderedDictionary<string, object?>()) is not OrderedDictionary<string, object?> doc)
            throw new ParseError(file, "expected a mapping with \"name\", \"unit\" and \"levels\"");

        string? Word(string key)
        {
            if (!doc.TryGetValue(key, out var v)) return null;
            if (v is not string s) throw new ParseError(file, $"\"{key}\" must be plain text, not a list or a mapping");
            return JsCompat.Blank(s) ? null : s;
        }
        var name = Word("name");
        if (name is null) Add("name is missing");
        var about = Word("about");
        var axisValue = JsCompat.OrEmpty(doc.TryGetValue("axis", out var a) ? a : null, null);
        // The run it compares with. Whether that run exists is for CheckRuns, which sees the other runs.
        var compareValue = JsCompat.OrEmpty(doc.TryGetValue("compare", out var c) ? c : null, null);
        if (Compares.Problem(compareValue, "run") is { } compareWhy) Add(compareWhy);
        var compare = Compares.Of(compareValue);

        // A run that adds others is a list of runs and nothing else: no levels of its own, no source (each run it adds has its own).
        if (JsCompat.OrEmpty(doc.TryGetValue("adds", out var addsValue) ? addsValue : null, null) is { } addsText)
        {
            if (addsText is not List<object?> addsList) throw new ParseError(file, "\"adds\" must be a list of run ids");
            var adds = ReadAdds(id, file, addsList, Add);
            foreach (var own in new[] { "levels", "sources", "source" })
                if (JsCompat.OrEmpty(doc.TryGetValue(own, out var ownValue) ? ownValue : null, null) is not null) Add($"a run that adds others has no {own} of its own");
            if (axisValue is "time") Add("a run that adds others is measured over load, not time");
            return (new LoadRun(name ?? id, about, "", null, [], null) { Adds = adds, Compare = compare }, problems);
        }

        // A run tested with several sources at once: its levels name a load for each.
        var sources = JsCompat.OrEmpty(doc.TryGetValue("sources", out var sourcesValue) ? sourcesValue : null, null) is { } sourcesText ? ReadSources(file, sourcesText, Add) : null;
        var unit = Word("unit");
        var entry = Word("entry");
        if (sources is not null)
        {
            if (entry is not null) Add("entry is for a single run: a run with sources gives each source its own entry");
            if (JsCompat.OrEmpty(doc.TryGetValue("source", out var ownSource) ? ownSource : null, null) is not null)
                Add("source is for a single run: a run with sources gives each source its own color, dot and size");
            if (axisValue is "time") Add("a run with sources is measured over load, not time");
        }
        doc.TryGetValue("source", out var sourceValue);
        var source = sources is null ? ReadSource(sourceValue, Add) : null;
        var axis = sources is null ? Axes.FirstOrDefault(x => x.Equals(axisValue)) ?? "load" : "load"; // a run says what it is measured over, or is a load run
        if (sources is null && axisValue is not null && !Axes.Any(x => x.Equals(axisValue))) Add($"axis must be {string.Join(" or ", Axes)}");
        // The key a level carries its number under, and the other one, which is the commonest slip: a time run written with load, or a load run with at.
        var key = axis == "time" ? "at" : "load";
        var other = axis == "time" ? "load" : "at";

        doc.TryGetValue("levels", out var levelsValue);
        if (JsCompat.OrEmpty(levelsValue, new List<object?>()) is not List<object?> rawLevels) throw new ParseError(file, "\"levels\" must be a list");
        if (rawLevels.Count < 2) throw new ParseError(file, "needs at least two levels, so there is something to play between");

        Level ReadLevel(object? raw, int i)
        {
            var at = $"level {i + 1}";
            if (raw is not OrderedDictionary<string, object?> map) throw new ParseError(file, $"{at} must be a mapping");
            if (map.ContainsKey(other)) Add($"{at}: a {axis} run uses {key}, not {other}");
            // The wrong key is told off above and still gives the number, so the run plays.
            var loadValue = map.TryGetValue(key, out var own) && own is not null ? own : map.TryGetValue(other, out var wrong) ? wrong : null;
            // A run with sources names a load for each (and has no single one); any other run has one number.
            var loads = sources is null ? null : ReadLoads(file, at, loadValue, sources);
            var number = loads is null ? Num(loadValue) : 0;
            if (number is not { } load || load < 0)
                throw new ParseError(file, loadValue is OrderedDictionary<string, object?> ? $"{at}: {key} is a mapping of sources, but the run has no sources" : $"{at}: {key} must be a number, 0 or more");
            var lead = loads is null ? $"{key} {JsCompat.Raw(load)}" : DescribeLoads(loads);
            string Where(string what) => $"{lead}, {what}";

            map.TryGetValue("overall", out var overallValue);
            if (JsCompat.OrEmpty(overallValue, new OrderedDictionary<string, object?>()) is not OrderedDictionary<string, object?> rawOverall)
                throw new ParseError(file, $"{at}: overall must be a mapping of numbers");
            var overall = ReadMetrics(EdgeKeys, rawOverall, Where("overall"), Add);

            map.TryGetValue("objects", out var objectsValue);
            if (JsCompat.OrEmpty(objectsValue, new OrderedDictionary<string, object?>()) is not OrderedDictionary<string, object?> rawObjects)
                throw new ParseError(file, $"{at}: objects must map ids to numbers");
            var objects = new IdMap<Metrics>();
            foreach (var (oid, m) in rawObjects)
            {
                if (JsCompat.OrEmpty(m, new OrderedDictionary<string, object?>()) is not OrderedDictionary<string, object?> entryMap)
                    throw new ParseError(file, $"{at}: {oid} must be a mapping of numbers");
                objects.Add(oid, ReadMetrics(ObjectKeys, entryMap, Where(oid), Add));
            }

            map.TryGetValue("connections", out var pairsValue);
            if (JsCompat.OrEmpty(pairsValue, new List<object?>()) is not List<object?> rawPairs) throw new ParseError(file, $"{at}: connections must be a list");
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
                var by = ReadBy(c.TryGetValue("by", out var byValue) ? byValue : null, sources, label, Add);
                var read = ReadMetrics(EdgeKeys, c, label, Add);
                connections.Add(new Pair(f, t) { Rate = read.Rate, Bytes = read.Bytes, P50 = read.P50, P95 = read.P95, Errors = read.Errors, Failure = failure, By = by });
            }
            return new Level(load, overall, objects, connections) { Loads = loads };
        }

        var parsed = rawLevels.Select(ReadLevel).ToList();
        if (sources is null)
        {
            for (var i = 1; i < parsed.Count; i++)
                if (parsed[i].Load <= parsed[i - 1].Load)
                    throw new ParseError(file, $"level {i + 1}: {key} {JsCompat.Raw(parsed[i].Load)} must be above {JsCompat.Raw(parsed[i - 1].Load)} (levels go up in {axis})");
        }
        var levels = sources is null ? parsed : GridOf(file, sources, parsed);
        // Events belong to a time run. On a load run they are a problem and are not read.
        var rawEvents = JsCompat.OrEmpty(doc.TryGetValue("events", out var ev) ? ev : null, null);
        if (axis == "load" && rawEvents is not null) Add("events are only for a time run (set axis: time)");
        var runUnit = sources is null ? unit ?? (axis == "time" ? "s" : "load") : ""; // a run with sources has no unit of its own: each source has one
        var events = axis == "time" ? ReadEvents(rawEvents, levels[0].Load, levels[^1].Load, runUnit, Add) : [];
        return (new LoadRun(name ?? id, about, runUnit, sources is null ? entry : null, levels, source) { IsTime = axis == "time", Events = events, Sources = sources, Compare = compare }, problems);
    }

    /// <summary>
    /// The runs a run that adds others lists. A slip is a problem and what is wrong is left out: an item that isn't a run id, the run itself, an id listed twice, more than
    /// <see cref="MostAdded"/> (the rest are left out). Fewer than two left can't be played, so that is a <see cref="ParseError"/>. Whether the runs exist is for <see cref="CheckRuns"/>.
    /// </summary>
    private static List<string> ReadAdds(string id, string file, List<object?> list, Action<string> add)
    {
        var output = new List<string>();
        for (var i = 0; i < list.Count; i++)
        {
            if (list[i] is not string { } item || JsCompat.Blank(item))
            {
                add($"adds: item {i + 1} must be a run id");
                continue;
            }
            var run = JsCompat.JsTrim(item);
            if (run == id) add($"adds: {id} can't add itself");
            else if (output.Contains(run)) add($"adds: {Brief(run)} is listed twice");
            else output.Add(run);
        }
        if (output.Count > MostAdded)
        {
            add($"adds: at most four runs, so {string.Join(", ", output.Skip(MostAdded).Select(Brief))} left out");
            output.RemoveRange(MostAdded, output.Count - MostAdded);
        }
        if (output.Count < 2) throw new ParseError(file, $"adds needs two to four runs, not {output.Count}");
        return output;
    }

    /// <summary>
    /// The <c>sources:</c> of a run tested together: 2 to <see cref="MostTested"/>, each a mapping with a name, a unit, an entry and the colour and formulas of a single run's source.
    /// A slip in one is a problem and is left out of it. What can't be played is a <see cref="ParseError"/>: not a mapping, the wrong count, an id that isn't one, a source that isn't a mapping.
    /// </summary>
    private static IdMap<SourceInfo> ReadSources(string file, object raw, Action<string> add)
    {
        if (raw is not OrderedDictionary<string, object?> map) throw new ParseError(file, "\"sources\" must map each source id to its name, unit and entry");
        var ids = JsCompat.OrderKeys(map.Keys);
        if (ids.Count < 2 || ids.Count > MostTested) throw new ParseError(file, $"sources needs two or three sources, not {ids.Count}");
        var output = new IdMap<SourceInfo>();
        foreach (var sid in ids)
        {
            if (!Names.IsValidId(sid)) throw new ParseError(file, $"source \"{Brief(sid)}\" is not a valid id: the id must {Names.IdRule}");
            if (JsCompat.OrEmpty(map[sid], new OrderedDictionary<string, object?>()) is not OrderedDictionary<string, object?> block)
                throw new ParseError(file, $"source {sid} must be a mapping of name, unit and entry");
            var label = $"source {sid}";
            var source = ReadSourceKeys(block, SourceInfoKeys, label, add);
            string? Text(string key)
            {
                var v = JsCompat.OrEmpty(block.TryGetValue(key, out var found) ? found : null, null);
                if (v is null) return null;
                if (v is not string s)
                {
                    add($"{label}: {key} must be plain text");
                    return null;
                }
                return JsCompat.Blank(s) ? null : s;
            }
            var name = Text("name");
            if (name is null) add($"{label}: name is missing");
            var entry = Text("entry");
            output.Add(sid, new SourceInfo(name ?? sid, entry, Text("unit") ?? "load", source));
        }
        SharedColors([.. ids.Select(sid => output[sid].Source?.Color)], [.. ids.Select(sid => output[sid].Name)], add);
        return output;
    }

    /// <summary>The load a level of a run tested together names for each source. Anything else is a <see cref="ParseError"/>: a level that can't be placed on the grid.</summary>
    private static IdMap<double> ReadLoads(string file, string at, object? raw, IdMap<SourceInfo> sources)
    {
        var ids = string.Join(", ", sources.Keys);
        if (raw is not OrderedDictionary<string, object?> map) throw new ParseError(file, $"{at}: load must give a number for each source ({ids})");
        foreach (var sid in JsCompat.OrderKeys(map.Keys))
            if (!sources.Contains(sid)) throw new ParseError(file, $"{at}: load names \"{Brief(sid)}\", which is not a source ({ids})");
        var output = new IdMap<double>();
        foreach (var sid in sources.Keys)
        {
            if (Num(map.TryGetValue(sid, out var v) ? v : null) is not { } n || n < 0) throw new ParseError(file, $"{at}: load: {sid} must be a number, 0 or more");
            output.Add(sid, n);
        }
        return output;
    }

    /// <summary>The loads of a level, in words: "orders 100 and pings 50".</summary>
    private static string DescribeLoads(IdMap<double> loads) => string.Join(" and ", loads.Select(kv => $"{kv.Key} {JsCompat.Raw(kv.Value)}"));

    /// <summary>
    /// The levels of a run tested together as a full grid: every load that any level names for a source, with every load of the others. Each source needs two loads, a combination may be
    /// listed once, and a combination that is not listed is the one problem, naming the first in grid order (the first source changes slowest). The levels come back in that order.
    /// </summary>
    private static List<Level> GridOf(string file, IdMap<SourceInfo> sources, List<Level> levels)
    {
        var ids = sources.Keys;
        var values = ids.Select(sid => levels.Select(l => l.Loads![sid]).Distinct().Order().ToList()).ToList();
        for (var i = 0; i < ids.Count; i++)
            if (values[i].Count < 2) throw new ParseError(file, $"source {ids[i]} needs at least two loads, so there is something to play between");
        string KeyOf(IdMap<double> loads) => string.Join(",", ids.Select(sid => JsCompat.Raw(loads[sid])));
        var listed = new Dictionary<string, int>();
        for (var i = 0; i < levels.Count; i++)
        {
            var key = KeyOf(levels[i].Loads!);
            if (listed.TryGetValue(key, out var first)) throw new ParseError(file, $"level {i + 1}: {DescribeLoads(levels[i].Loads!)} is listed twice (level {first + 1} has it)");
            listed[key] = i;
        }
        var ordered = new List<Level>();
        void Walk(int i, List<double> picked)
        {
            if (i == ids.Count)
            {
                var loads = new IdMap<double>();
                for (var j = 0; j < ids.Count; j++) loads.Add(ids[j], picked[j]);
                if (!listed.TryGetValue(KeyOf(loads), out var at))
                    throw new ParseError(file, $"no level for {DescribeLoads(loads)}: a run tested together needs every load of each source with every load of the others");
                ordered.Add(levels[at]);
                return;
            }
            foreach (var v in values[i]) Walk(i + 1, [.. picked, v]);
        }
        Walk(0, []);
        return ordered;
    }

    /// <summary>
    /// The <c>by:</c> of a connection: what each source of a run with sources carries on that line, as its own rate, bytes, p50 and errors. A slip is a problem and is left out: <c>by</c> in a
    /// run without sources, one that isn't a mapping, a source it doesn't have, a key that isn't one of the four. A source with no usable number is left out.
    /// </summary>
    private static IdMap<Metrics>? ReadBy(object? raw, IdMap<SourceInfo>? sources, string where, Action<string> add)
    {
        var block = JsCompat.OrEmpty(raw, null);
        if (block is null) return null;
        if (sources is null)
        {
            add($"{where}: by is for a run with sources");
            return null;
        }
        if (block is not OrderedDictionary<string, object?> map)
        {
            add($"{where}: by must map a source to its numbers");
            return null;
        }
        var output = new IdMap<Metrics>();
        foreach (var sid in JsCompat.OrderKeys(map.Keys))
        {
            if (!sources.Contains(sid))
            {
                add($"{where}: by names \"{Brief(sid)}\", which is not a source");
                continue;
            }
            if (JsCompat.OrEmpty(map[sid], new OrderedDictionary<string, object?>()) is not OrderedDictionary<string, object?> entry)
            {
                add($"{where}: by {sid} must be a mapping of numbers");
                continue;
            }
            foreach (var key in JsCompat.OrderKeys(entry.Keys))
                if (!ByKeys.Contains(key)) add($"{where}: by {sid}: unknown key \"{Brief(key)}\" (use {string.Join(", ", ByKeys)})");
            var m = ReadMetrics(ByKeys, entry, $"{where}, {sid}", add);
            if (!m.IsEmpty) output.Add(sid, m);
        }
        return output.Count == 0 ? null : output;
    }
}
