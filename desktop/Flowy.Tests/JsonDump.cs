using System.Text.Json;
using System.Text.Json.Nodes;
using Flowy.Core;

namespace Flowy.Tests;

/// <summary>The C# side of desktop/fixtures/dump.ts: the same shape, built from Flowy.Core. A field that is null is left out, as JSON.stringify leaves out undefined.</summary>
internal static class JsonDump
{
    private static JsonNode? Node(object? v) => v switch
    {
        null => null,
        string s => JsonValue.Create(s),
        int i => JsonValue.Create(i),
        double d => JsonValue.Create(d),
        JsonNode n => n,
        _ => throw new ArgumentException($"can't dump a {v.GetType()}"),
    };

    private static JsonObject Obj(params (string Key, object? Value)[] pairs)
    {
        var o = new JsonObject();
        foreach (var (key, value) in pairs)
            if (value is not null) o[key] = Node(value);
        return o;
    }

    private static JsonArray Arr(IEnumerable<object?> items) => new(items.Select(Node).ToArray());

    /// <summary>A value as the YAML held it: text, a list, or a mapping.</summary>
    private static JsonNode? Raw(object? v) => v switch
    {
        null => null,
        string s => JsonValue.Create(s),
        List<object?> list => new JsonArray(list.Select(Raw).ToArray()),
        OrderedDictionary<string, object?> map => new JsonObject(map.Select(kv => KeyValuePair.Create(kv.Key, Raw(kv.Value)))),
        _ => throw new ArgumentException($"can't dump a {v.GetType()}"),
    };

    private static JsonNode? Pair((string From, string To)? ends) => ends is { } e ? Arr([e.From, e.To]) : null;

    public static JsonNode Dump(string dir)
    {
        Folder folder;
        try
        {
            folder = FolderLoader.Load(dir);
        }
        catch (ParseError e)
        {
            return Obj(("parseError", Obj(("file", e.File), ("line", e.Line), ("message", e.Reason))));
        }
        var m = folder.Model;
        var views = new[] { Names.Root }.Concat(m.Objects.Keys).Where(id => Views.IsView(m, id)).Select(id =>
        {
            var v = Views.Compute(m, id);
            return KeyValuePair.Create(id, (JsonNode?)Obj(
                ("id", v.Id),
                ("members", Arr(v.Members)),
                ("outsiders", Arr(v.Outsiders)),
                ("edges", Arr(v.Edges.Select(e => Obj(("from", e.From), ("to", e.To), ("label", e.Label), ("count", e.Count)))))));
        });
        var result = Obj(
            ("lineStyle", m.LineStyle),
            ("objects", Arr(m.Objects.Select(kv => Obj(
                ("id", kv.Key), ("type", kv.Value.Type), ("name", kv.Value.Name), ("in", kv.Value.In), ("external", kv.Value.External),
                ("shape", kv.Value.Shape), ("color", kv.Value.Color), ("opacity", kv.Value.Opacity), ("icon", kv.Value.Icon),
                ("tech", kv.Value.Tech), ("description", kv.Value.Description), ("code", Raw(kv.Value.Code)), ("links", Raw(kv.Value.Links)))))),
            ("icons", m.Meta.TryGetValue("icons", out var icons) ? Raw(icons) : null),
            ("connections", Arr(m.Connections.Select(c => Obj(("from", c.From), ("to", c.To), ("label", c.Label))))),
            ("layout", new JsonObject(m.Layout.Select(view => KeyValuePair.Create(view.Key, (JsonNode?)new JsonObject(
                view.Value.Select(box => KeyValuePair.Create(box.Key, (JsonNode?)Arr([box.Value.X, box.Value.Y])))))))),
            ("flows", Arr(m.Flows.Select(kv => Obj(
                ("id", kv.Key), ("name", kv.Value.Name), ("view", kv.Value.View),
                ("steps", Arr(kv.Value.Steps.Select(s =>
                {
                    var placed = Views.PlaceStep(m, kv.Value.View, s.From, s.To);
                    var step = Obj(("from", s.From), ("to", s.To), ("text", s.Text), ("description", s.Description), ("animation", Raw(s.Animation)));
                    step["placed"] = Pair(placed); // null stays in the JSON here, as it does in dump.ts
                    step["ends"] = s.From is null ? null : JsonValue.Create(Views.StepEnds(m, s.From, s.To, placed));
                    return step;
                }))))))),
            ("problems", Arr(folder.Problems.Select(p => Obj(("file", p.File), ("id", p.Id), ("message", p.Message), ("connection", p.Connection), ("step", p.Step))))),
            ("views", new JsonObject(views)));
        return result;
    }

    /// <summary>Sorted keys and indentation, so two equal dumps print the same and a difference reads as a diff.</summary>
    public static string Pretty(JsonNode? node) => Sorted(node)?.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) ?? "null";

    private static JsonNode? Sorted(JsonNode? n) => n switch
    {
        JsonObject o => new JsonObject(o.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => KeyValuePair.Create(kv.Key, Sorted(kv.Value)))),
        JsonArray a => new JsonArray(a.Select(Sorted).ToArray()),
        JsonValue v => JsonNode.Parse(v.ToJsonString()),
        _ => null,
    };
}
