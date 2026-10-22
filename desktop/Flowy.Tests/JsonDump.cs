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

    internal static JsonObject Obj(params (string Key, object? Value)[] pairs)
    {
        var o = new JsonObject();
        foreach (var (key, value) in pairs)
            if (value is not null) o[key] = Node(value);
        return o;
    }

    internal static JsonArray Arr(IEnumerable<object?> items) => new(items.Select(Node).ToArray());

    /// <summary>A value as the YAML held it: text, a list, or a mapping.</summary>
    private static JsonNode? Raw(object? v) => v switch
    {
        null => null,
        string s => JsonValue.Create(s),
        List<object?> list => new JsonArray(list.Select(Raw).ToArray()),
        OrderedDictionary<string, object?> map => new JsonObject(map.Select(kv => KeyValuePair.Create(kv.Key, Raw(kv.Value)))),
        _ => throw new ArgumentException($"can't dump a {v.GetType()}"),
    };

    /// <summary>What a store's data shows, in the shape dump.ts gives it; null (so the key is left out) when it shows nothing.</summary>
    private static JsonNode? Shown(FlowyObject o)
    {
        var entries = StoreData.Shown(o);
        if (entries.Count == 0) return null;
        return new JsonArray(entries.Select(e => (JsonNode?)Obj(
            ("name", e.Name), ("kind", e.Kind), ("limits", e.Limits), ("note", e.Note), ("summary", e.Summary),
            ("columns", Arr(e.Columns.Select(c => Obj(("name", c.Name), ("type", c.Type), ("nullable", c.Nullable ? JsonValue.Create(true) : null), ("key", c.Key), ("to", c.To), ("note", c.Note))))),
            ("rows", new JsonArray(e.Rows.Select(row => (JsonNode?)new JsonArray(row.Select(cell => (JsonNode?)JsonValue.Create(cell)).ToArray())).ToArray())),
            ("lines", Arr(e.Lines.Select(l => Obj(("depth", l.Depth), ("key", l.Key), ("value", l.Value), ("path", l.Path), ("noted", JsonValue.Create(l.Noted)))))),
            ("notes", Arr(e.Notes.Select(n => Obj(("name", n.Name), ("text", n.Text))))))).ToArray());
    }

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
        // Partners and links are dumped only where some flow holds a compare, and the runs only where some run reads one, so older cases dump as before.
        var tags = m.Flows.ToDictionary(kv => kv.Key, kv => kv.Value.CompareRaw);
        var tagged = tags.Values.Any(v => v is not null);
        var runsTagged = folder.Runs is { } loaded && loaded.Any(kv => kv.Value.Compare is not null);
        var result = Obj(
            ("lineStyle", m.LineStyle),
            ("projectName", m.ProjectName),
            ("projectAbout", m.ProjectAbout),
            ("objects", Arr(m.Objects.Select(kv => Obj(
                ("id", kv.Key), ("type", kv.Value.Type), ("name", kv.Value.Name), ("in", kv.Value.In), ("external", kv.Value.External),
                ("shape", kv.Value.Shape), ("color", kv.Value.Color), ("opacity", kv.Value.Opacity), ("icon", kv.Value.Icon),
                ("tech", kv.Value.Tech), ("description", kv.Value.Description), ("code", Raw(kv.Value.Code)), ("links", Raw(kv.Value.Links)), ("snippets", Raw(kv.Value.Snippets)),
                ("data", Raw(kv.Value.Data)), ("shown", Shown(kv.Value)))))),
            ("icons", m.Meta.TryGetValue("icons", out var icons) ? Raw(icons) : null),
            ("connections", Arr(m.Connections.Select(c => Obj(("from", c.From), ("to", c.To), ("label", c.Label))))),
            ("layout", new JsonObject(m.Layout.Select(view => KeyValuePair.Create(view.Key, (JsonNode?)new JsonObject(
                view.Value.Select(box => KeyValuePair.Create(box.Key, (JsonNode?)Arr([box.Value.X, box.Value.Y])))))))),
            ("flows", Arr(m.Flows.Select(kv => FlowNode(kv.Key, kv.Value, m)))),
            ("problems", Arr(folder.Problems.Select(p => Obj(("file", p.File), ("id", p.Id), ("message", p.Message), ("connection", p.Connection), ("step", p.Step))))),
            // Left out when there is none, as in dump.ts.
            ("failures", m.Failures.Count == 0 ? null : Arr(m.Failures.Select(kv => AnalysisNode(kv.Key, kv.Value)))),
            ("failureProblems", folder.FailureProblems is not { Count: > 0 } found ? null : Arr(found.Select(p => Obj(("file", p.File), ("id", p.Id), ("message", p.Message))))),
            ("partners", tagged ? PartnersNode(tags) : null),
            ("linked", tagged ? Arr(Compares.Linked(tags).Order(StringComparer.Ordinal)) : null),
            ("runs", runsTagged ? Arr(folder.Runs!.Select(kv => RunNode(kv.Key, kv.Value))) : null),
            ("runProblems", runsTagged ? Arr((folder.RunProblems ?? []).Select(p => Obj(("file", p.File), ("id", p.Id), ("message", p.Message)))) : null),
            ("views", new JsonObject(views)));
        return result;
    }

    private static JsonNode TagNode(CompareTag tag) => Obj(("with", tag.With), ("note", tag.Note));

    /// <summary>A flow as dump.ts shows it. Its compare and the problem with it are left out when the file has none, so a flow without the key dumps as before.</summary>
    private static JsonNode FlowNode(string id, Flow flow, Model m)
    {
        var node = Obj(
                ("id", id), ("name", flow.Name), ("view", flow.View), ("groups", Raw(flow.Groups)), ("states", Raw(flow.States)),
                ("steps", Arr(flow.Steps.Select(s =>
                {
                    var placed = Views.PlaceStep(m, flow.View, s.From, s.To);
                    var step = Obj(("from", s.From), ("to", s.To), ("text", s.Text), ("description", s.Description), ("animation", Raw(s.Animation)), ("group", s.Group), ("lane", s.Lane), ("flow", s.FlowId), ("states", Raw(s.States)));
                    step["placed"] = Pair(placed); // null stays in the JSON here, as it does in dump.ts
                    step["ends"] = s.From is null ? null : JsonValue.Create(Views.StepEnds(m, s.From, s.To, placed));
                    return step;
                }))));
        if (flow.CompareRaw is not null)
        {
            node["compare"] = flow.Compare is { } tag ? TagNode(tag) : null;
            node["compareProblem"] = Compares.Problem(flow.CompareRaw, "flow");
        }
        return node;
    }

    private static JsonNode PartnersNode(IReadOnlyDictionary<string, object?> tags) =>
        new JsonObject(tags.Keys.Select(id => KeyValuePair.Create(id, (JsonNode?)Arr(Compares.Partners(tags, id).Select(p => Obj(("id", p.Id), ("side", p.Side), ("note", p.Note)))))));

    private static JsonNode RunNode(string id, LoadRun run)
    {
        var node = Obj(("id", id), ("name", run.Name));
        node["compare"] = run.Compare is { } tag ? TagNode(tag) : null; // null stays in the JSON, as it does in dump.ts
        return node;
    }

    private static JsonNode AnalysisNode(string id, FailureAnalysis a) => Obj(
        ("id", id), ("name", a.Name), ("about", a.About), ("scope", a.Scope),
        ("scale", a.Scale is null ? null : new JsonObject(a.Scale.Select(kv => KeyValuePair.Create(kv.Key, (JsonNode?)Obj(("low", kv.Value.Low), ("high", kv.Value.High)))))),
        ("modes", Arr(a.Modes.Select(kv => Obj(
            ("id", kv.Key), ("mode", kv.Value.Mode), ("on", kv.Value.On), ("from", kv.Value.From), ("to", kv.Value.To), ("effect", kv.Value.Effect), ("cause", kv.Value.Cause),
            ("severity", kv.Value.Severity), ("occurrence", kv.Value.Occurrence), ("detection", kv.Value.Detection), ("controls", kv.Value.Controls), ("action", kv.Value.Action),
            ("owner", kv.Value.Owner), ("status", kv.Value.Status), ("flow", kv.Value.Flow), ("step", kv.Value.Step), ("run", kv.Value.Run), ("description", kv.Value.Description),
            ("after", kv.Value.After is null ? null : Obj(("severity", kv.Value.After.Severity), ("occurrence", kv.Value.After.Occurrence), ("detection", kv.Value.After.Detection))),
            ("affects", kv.Value.Affects is null ? null : Arr(kv.Value.Affects)))))));

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
