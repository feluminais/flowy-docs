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
    private const double MaxCoordinate = 1_000_000;

    /// <summary>The model.yaml part of a <see cref="Model"/>; the folder loader adds flows and layout.</summary>
    public sealed record ParsedModel(IdMap<FlowyObject> Objects, IReadOnlyList<Connection> Connections, IReadOnlyDictionary<string, object?> Meta);

    private static OrderedDictionary<string, object?> NewMap() => [];

    /// <summary>For sections: an empty value, <c>~</c> or <c>null</c> means empty.</summary>
    internal static object? OrEmpty(object? v, object? empty) => v is null or "" or "~" or "null" or "Null" or "NULL" ? empty : v;

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
        const string file = "model.yaml";
        if (OrEmpty(YamlText.Parse(file, text), NewMap()) is not OrderedDictionary<string, object?> top)
            throw new ParseError(file, "expected a mapping with \"objects\" and \"connections\"");

        top.TryGetValue("objects", out var rawObjects);
        top.TryGetValue("connections", out var rawConnections);
        var objects = OrEmpty(rawObjects, NewMap());
        var connections = OrEmpty(rawConnections, new List<object?>());
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
        var file = $"flows/{id}.yaml";
        if (OrEmpty(YamlText.Parse(file, text), NewMap()) is not OrderedDictionary<string, object?> doc)
            throw new ParseError(file, "expected a mapping with \"name\", \"view\" and \"steps\"");
        CheckEntry(file, "flow", doc, FlowFields);
        doc.TryGetValue("steps", out var rawSteps);
        if (OrEmpty(rawSteps, new List<object?>()) is not List<object?> steps) throw new ParseError(file, "\"steps\" must be a list");
        for (var i = 0; i < steps.Count; i++) CheckEntry(file, $"step {i + 1}", steps[i], StepFields);
        doc.TryGetValue("groups", out var rawGroups);
        OrderedDictionary<string, object?>? groups = null;
        if (OrEmpty(rawGroups, null) is { } declared)
        {
            if (declared is not OrderedDictionary<string, object?> map) throw new ParseError(file, "\"groups\" must map ids to mappings");
            foreach (var gid in JsKeys.Order(map.Keys)) CheckEntry(file, $"group \"{gid}\"", map[gid], GroupFields);
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
        const string file = "layout.yaml";
        if (OrEmpty(YamlText.Parse(file, text), NewMap()) is not OrderedDictionary<string, object?> doc)
            throw new ParseError(file, "expected view → object → [x, y]");

        var layout = new Dictionary<string, IReadOnlyDictionary<string, LayoutPoint>>();
        foreach (var (view, rawBoxes) in doc)
        {
            if (OrEmpty(rawBoxes, NewMap()) is not OrderedDictionary<string, object?> boxes)
                throw new ParseError(file, $"view \"{view}\" must map object ids to [x, y]");
            var points = new Dictionary<string, LayoutPoint>();
            foreach (var (id, p) in boxes)
                points[id] = ToPoint(p) ?? throw new ParseError(file, $"{view} → {id} must be [x, y]");
            layout[view] = points;
        }
        return layout;
    }
}
