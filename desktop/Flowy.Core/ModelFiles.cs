using System.Globalization;

namespace Flowy.Core;

/// <summary>
/// Parses the three kinds of file in a flowy/ folder. Like src/core/model.ts, it checks only a file's shape (a
/// list where a list is needed, text where text is needed); <see cref="Checks"/> reports what the values mean.
/// </summary>
public static class ModelFiles
{
    private static readonly string[] ObjectFields = ["type", "name", "in", "external", "shape", "color", "opacity", "icon", "tech", "description"];
    private static readonly string[] ConnectionFields = ["from", "to", "label"];
    private static readonly string[] FlowFields = ["name", "view"];
    private static readonly string[] StepFields = ["from", "to", "text", "description", "group", "lane", "flow"];
    private static readonly string[] GroupFields = ["kind", "text", "times", "until"];
    private static readonly string[] AnalysisFields = ["name", "about", "scope"];
    private static readonly string[] ModeFields = ["mode", "on", "from", "to", "effect", "cause", "severity", "occurrence", "detection", "controls", "action", "owner", "status", "flow", "step", "run", "description"];
    private static readonly string[] RatingFields = ["severity", "occurrence", "detection"];
    private static readonly string[] ScaleFields = ["low", "high"];
    private const double MaxCoordinate = 1_000_000;

    /// <summary>The model.yaml part of a <see cref="Model"/>; the folder loader adds flows and layout.</summary>
    public sealed record ParsedModel(IdMap<FlowyObject> Objects, IReadOnlyList<Connection> Connections, IReadOnlyDictionary<string, object?> Meta);

    private static OrderedDictionary<string, object?> NewMap() => [];

    private static string? Text(OrderedDictionary<string, object?> map, string key) => map.TryGetValue(key, out var v) ? v as string : null;

    private static void CheckEntry(string file, string what, object? entry, string[] fields)
    {
        if (entry is not OrderedDictionary<string, object?> map) throw new ParseError(file, $"{what} must be a mapping");
        foreach (var field in fields)
            if (map.TryGetValue(field, out var v) && v is not string)
                throw new ParseError(file, $"{what}: \"{field}\" must be plain text, not a list or a mapping");
    }

    public static ParsedModel ParseModel(string text)
    {
        const string file = FolderLayout.ModelFile;
        if (JsCompat.OrEmpty(YamlText.Parse(file, text), NewMap()) is not OrderedDictionary<string, object?> top)
            throw new ParseError(file, "expected a mapping with \"objects\" and \"connections\"");

        top.TryGetValue("objects", out var rawObjects);
        top.TryGetValue("connections", out var rawConnections);
        var objects = JsCompat.OrEmpty(rawObjects, NewMap());
        var connections = JsCompat.OrEmpty(rawConnections, new List<object?>());
        if (objects is not OrderedDictionary<string, object?> objectMap) throw new ParseError(file, "\"objects\" must map ids to mappings");
        foreach (var (id, o) in objectMap) CheckEntry(file, $"object \"{id}\"", o, ObjectFields);
        if (connections is not List<object?> connectionList) throw new ParseError(file, "\"connections\" must be a list");
        for (var i = 0; i < connectionList.Count; i++) CheckEntry(file, $"connection {i + 1}", connectionList[i], ConnectionFields);

        var map = new IdMap<FlowyObject>();
        foreach (var (id, o) in objectMap)
        {
            var m = (OrderedDictionary<string, object?>)o!;
            m.TryGetValue("code", out var code);
            m.TryGetValue("links", out var links);
            m.TryGetValue("data", out var data);
            m.TryGetValue("snippets", out var snippets);
            map.Add(id, new FlowyObject(Text(m, "type"), Text(m, "name"), Text(m, "in"), Text(m, "external"), Text(m, "tech"), Text(m, "description"), code, links)
            {
                Shape = Text(m, "shape"), Color = Text(m, "color"), Opacity = Text(m, "opacity"), Icon = Text(m, "icon"), Data = data, Snippets = snippets,
            });
        }
        var list = connectionList.Select(c =>
        {
            var m = (OrderedDictionary<string, object?>)c!;
            return new Connection(Text(m, "from"), Text(m, "to"), Text(m, "label"));
        }).ToList();
        var meta = top.Where(kv => kv.Key is not ("objects" or "connections")).ToDictionary(kv => kv.Key, kv => kv.Value);
        return new ParsedModel(map, list, meta);
    }

    /// <summary>An empty file gives a flow with no steps; the checks report what's missing.</summary>
    public static Flow ParseFlow(string id, string text)
    {
        var file = FolderLayout.FlowFile(id);
        if (JsCompat.OrEmpty(YamlText.Parse(file, text), NewMap()) is not OrderedDictionary<string, object?> doc)
            throw new ParseError(file, "expected a mapping with \"name\", \"view\" and \"steps\"");
        CheckEntry(file, "flow", doc, FlowFields);
        doc.TryGetValue("steps", out var rawSteps);
        if (JsCompat.OrEmpty(rawSteps, new List<object?>()) is not List<object?> steps) throw new ParseError(file, "\"steps\" must be a list");
        for (var i = 0; i < steps.Count; i++) CheckEntry(file, $"step {i + 1}", steps[i], StepFields);
        doc.TryGetValue("groups", out var rawGroups);
        OrderedDictionary<string, object?>? groups = null;
        if (JsCompat.OrEmpty(rawGroups, null) is { } declared)
        {
            if (declared is not OrderedDictionary<string, object?> map) throw new ParseError(file, "\"groups\" must map ids to mappings");
            foreach (var gid in JsCompat.OrderKeys(map.Keys)) CheckEntry(file, $"group \"{gid}\"", map[gid], GroupFields);
            groups = map;
        }

        var parsed = steps.Select(s =>
        {
            var m = (OrderedDictionary<string, object?>)s!;
            m.TryGetValue("animation", out var animation);
            m.TryGetValue("states", out var states);
            return new Step(Text(m, "from"), Text(m, "to"), Text(m, "text"), Text(m, "description"), animation, Text(m, "group"), Text(m, "lane"), Text(m, "flow"), states);
        }).ToList();
        doc.TryGetValue("states", out var flowStates);
        return new Flow(Text(doc, "name"), Text(doc, "view"), parsed, groups, flowStates);
    }

    /// <summary>
    /// Checks the file's shape only, as parseAnalysisFile does: the right kinds of value in the right places. Whether a part exists, a rating is in range or a
    /// status is known is for <see cref="Failures.AnalysisProblems"/>. A blank <c>after</c> or <c>affects</c> is no section; a missing name reads as "".
    /// </summary>
    public static FailureAnalysis ParseAnalysis(string id, string text)
    {
        var file = FolderLayout.FailureFile(id);
        if (JsCompat.OrEmpty(YamlText.Parse(file, text), NewMap()) is not OrderedDictionary<string, object?> doc)
            throw new ParseError(file, "expected a mapping with \"name\" and \"modes\"");
        CheckEntry(file, "analysis", doc, AnalysisFields);
        doc.TryGetValue("modes", out var rawModes);
        if (JsCompat.OrEmpty(rawModes, NewMap()) is not OrderedDictionary<string, object?> modeMap) throw new ParseError(file, "\"modes\" must map ids to mappings");
        var modes = new IdMap<FailureMode>();
        foreach (var mid in JsCompat.OrderKeys(modeMap.Keys))
        {
            var at = $"mode \"{mid}\"";
            var raw = modeMap[mid];
            CheckEntry(file, at, raw, ModeFields);
            var m = (OrderedDictionary<string, object?>)raw!;
            m.TryGetValue("after", out var rawAfter);
            FailureRatings? after = null;
            if (JsCompat.OrEmpty(rawAfter, null) is { } declaredAfter)
            {
                if (declaredAfter is not OrderedDictionary<string, object?> afterMap) throw new ParseError(file, $"{at}: \"after\" must be a mapping of ratings");
                CheckEntry(file, $"{at} after", afterMap, RatingFields);
                after = new FailureRatings(Text(afterMap, "severity"), Text(afterMap, "occurrence"), Text(afterMap, "detection"));
            }
            m.TryGetValue("affects", out var rawAffects);
            IReadOnlyList<string>? affects = null;
            if (JsCompat.OrEmpty(rawAffects, null) is { } declaredAffects)
            {
                if (declaredAffects is not List<object?> items || items.Any(a => a is not string)) throw new ParseError(file, $"{at}: \"affects\" must be a list of ids");
                affects = items.Cast<string>().ToList();
            }
            modes.Add(mid, new FailureMode(
                Text(m, "mode"), Text(m, "on"), Text(m, "from"), Text(m, "to"), Text(m, "effect"), Text(m, "cause"), Text(m, "severity"), Text(m, "occurrence"), Text(m, "detection"),
                Text(m, "controls"), Text(m, "action"), Text(m, "owner"), Text(m, "status"), Text(m, "flow"), Text(m, "step"), Text(m, "run"), Text(m, "description"), after, affects));
        }
        doc.TryGetValue("scale", out var rawScale);
        OrderedDictionary<string, RatingEnds>? scale = null;
        if (JsCompat.OrEmpty(rawScale, null) is { } declaredScale)
        {
            if (declaredScale is not OrderedDictionary<string, object?> scaleMap) throw new ParseError(file, "\"scale\" must map ratings to a low and a high");
            scale = [];
            foreach (var rating in JsCompat.OrderKeys(scaleMap.Keys))
            {
                CheckEntry(file, $"scale \"{rating}\"", scaleMap[rating], ScaleFields);
                var ends = (OrderedDictionary<string, object?>)scaleMap[rating]!;
                scale.Add(rating, new RatingEnds(Text(ends, "low"), Text(ends, "high")));
            }
        }
        return new FailureAnalysis(Text(doc, "name") ?? "", Text(doc, "about"), Text(doc, "scope"), scale, modes);
    }

    // ponytail: plain decimal numbers only. JavaScript's Number() also takes 0x10 and 0b11; layout.yaml is written
    // by the canvas, which writes decimals. Accept the others here if a hand-written file ever needs them.
    private static LayoutPoint? ToPoint(object? v)
    {
        if (v is not List<object?> { Count: 2 } pair) return null;
        double[] n = new double[2];
        for (var i = 0; i < 2; i++)
        {
            // Past a million the line paths overflow to NaN and can't be drawn; nobody drags a box that far.
            if (pair[i] is not string s || s.Trim() == "" || !double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out n[i]) || !double.IsFinite(n[i]) || Math.Abs(n[i]) > MaxCoordinate)
                return null;
        }
        return new LayoutPoint(n[0], n[1]);
    }

    public static Dictionary<string, IReadOnlyDictionary<string, LayoutPoint>> ParseLayout(string text)
    {
        const string file = FolderLayout.LayoutFile;
        if (JsCompat.OrEmpty(YamlText.Parse(file, text), NewMap()) is not OrderedDictionary<string, object?> doc)
            throw new ParseError(file, "expected view → object → [x, y]");

        var layout = new Dictionary<string, IReadOnlyDictionary<string, LayoutPoint>>();
        foreach (var (view, rawBoxes) in doc)
        {
            if (JsCompat.OrEmpty(rawBoxes, NewMap()) is not OrderedDictionary<string, object?> boxes)
                throw new ParseError(file, $"view \"{view}\" must map object ids to [x, y]");
            var points = new Dictionary<string, LayoutPoint>();
            foreach (var (id, p) in boxes)
                points[id] = ToPoint(p) ?? throw new ParseError(file, $"{view} → {id} must be [x, y]");
            layout[view] = points;
        }
        return layout;
    }
}
