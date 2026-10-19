namespace Flowy.Core;

/// <summary>A refused edit. The message is written for whoever asked for it.</summary>
public sealed class OpError(string message) : Exception(message);

/// <summary>An object to create or change. null leaves a field as it is; "" removes <c>in</c>, <c>shape</c>, <c>color</c>, <c>opacity</c>, <c>icon</c>, <c>tech</c> or <c>description</c>; an empty list removes <c>code</c> or <c>links</c>; <c>External: false</c> removes <c>external</c>. A link is a mapping that keeps its extra keys.</summary>
public sealed record ObjectInput(string Id, string? Type = null, string? Name = null, string? In = null, bool? External = null, string? Tech = null, string? Description = null, IReadOnlyList<string>? Code = null, IReadOnlyList<OrderedDictionary<string, object?>>? Links = null,
    string? Shape = null, string? Color = null, string? Opacity = null, string? Icon = null);

public sealed record ConnectionInput(string From, string To, string? Label = null);

/// <summary>
/// The edits, as functions from a <see cref="EditDoc"/> to a changed copy: a C# twin of src/core/ops.ts with the same rules, the same order of
/// keys in what they write and the same words in what they refuse. A script run through both (desktop/fixtures/ops.ts) must write equal files.
/// </summary>
public static class EditOps
{
    private static readonly string[] CopiedFields = ["type", "name", "in", "external", "shape", "color", "opacity", "icon", "tech", "description", "code", "links"];
    private static readonly string[] Clearable = ["in", "shape", "color", "opacity", "icon", "tech", "description"];

    private static OrderedDictionary<string, object?>? ObjectOf(EditDoc doc, string? id) =>
        id is not null && id != Names.Root && doc.Objects.TryGetValue(id, out var o) ? o as OrderedDictionary<string, object?> : null;

    private static string? Text(OrderedDictionary<string, object?> map, string key) => map.TryGetValue(key, out var v) ? v as string : null;

    private static OrderedDictionary<string, object?> Entry(object? node) => node as OrderedDictionary<string, object?> ?? [];

    // ---- objects -------------------------------------------------------------------------------------------------

    /// <summary>
    /// Create or update an object. Omitted fields stay as they are. Only the known fields are copied, so a new object's keys come out in the order
    /// type, name, in, external, shape, color, opacity, icon, tech, description, code, links, and a hand-written key on an existing object stays where it is.
    /// </summary>
    public static EditDoc PutObject(EditDoc doc, ObjectInput input)
    {
        if (!Names.IsValidId(input.Id)) throw new OpError($"\"{input.Id}\" is not a valid id: {Names.IdRule}");
        var prev = ObjectOf(doc, input.Id);
        if (prev is null && (string.IsNullOrEmpty(input.Type) || string.IsNullOrEmpty(input.Name)))
            throw new OpError($"\"{input.Id}\" doesn't exist yet, so type and name are required");
        var d = doc.Clone();
        var next = prev is null ? [] : Entry(d.Objects[input.Id]);
        foreach (var key in CopiedFields)
        {
            object? value = key switch
            {
                "type" => input.Type,
                "name" => input.Name,
                "in" => input.In,
                "external" => input.External is null ? null : input.External.Value ? "true" : "false",
                "shape" => input.Shape,
                "color" => input.Color,
                "opacity" => input.Opacity,
                "icon" => input.Icon,
                "tech" => input.Tech,
                "description" => input.Description,
                "code" => input.Code?.Select(c => (object?)c).ToList(),
                _ => input.Links?.Select(l => (object?)NormalizeLink(l)).ToList(),
            };
            if (value is not null) next[key] = value;
        }
        foreach (var key in Clearable)
            if (Text(next, key) == "") next.Remove(key);
        if (next.TryGetValue("code", out var code) && code is List<object?> { Count: 0 }) next.Remove("code");
        if (next.TryGetValue("links", out var links) && links is List<object?> { Count: 0 }) next.Remove("links");
        // On disk it's `external: true`, which reads back as the text "true". external: false is no key at all.
        if (Text(next, "external") == "false" && input.External == false) next.Remove("external");
        d.Objects[input.Id] = next;
        return d;
    }

    /// <summary>A link with its title first, then its other keys in the order given, and no title at all when the title is blank: what <c>putObject</c> does in src/core/ops.ts.</summary>
    private static OrderedDictionary<string, object?> NormalizeLink(OrderedDictionary<string, object?> link)
    {
        var result = new OrderedDictionary<string, object?>();
        if (link.TryGetValue("title", out var t) && t is string title && title.Trim() != "") result["title"] = title;
        foreach (var (key, value) in link)
            if (key != "title") result[key] = value;
        return result;
    }

    public static EditDoc DeleteObject(EditDoc doc, string id)
    {
        if (id == Names.Root && doc.Objects.ContainsKey(Names.Root))
            throw new OpError("\"root\" is reserved, so this object can't be changed here. Rename or delete it in model.yaml by hand.");
        if (ObjectOf(doc, id) is null) throw new OpError($"unknown object \"{id}\"");
        var children = JsKeys.Order(doc.Objects.Keys).Where(other => other != id && Text(Entry(doc.Objects[other]), "in") == id).ToList();
        if (children.Count > 0) throw new OpError($"\"{id}\" still contains {string.Join(", ", children)}. Delete or move those first.");
        var flows = JsKeys.Order(doc.Flows.Keys).Where(fid =>
        {
            var flow = Entry(doc.Flows[fid]);
            return Text(flow, "view") == id || (flow.TryGetValue("steps", out var steps) && steps is List<object?> list && list.Any(s => Text(Entry(s), "from") == id || Text(Entry(s), "to") == id));
        }).ToList();
        if (flows.Count > 0) throw new OpError($"\"{id}\" is used by flow{(flows.Count > 1 ? "s" : "")} {string.Join(", ", flows)}. Change or delete those first.");
        var d = doc.Clone();
        d.Objects.Remove(id);
        d.Connections.RemoveAll(c => Text(Entry(c), "from") == id || Text(Entry(c), "to") == id);
        return d;
    }

    /// <summary>
    /// Delete several objects as one edit. A box and something inside it can go together (the inner one first); any refusal from
    /// <see cref="DeleteObject"/> stops the lot, so nothing is half deleted. The twin of <c>deleteObjects</c> in src/core/ops.ts.
    /// </summary>
    public static EditDoc DeleteObjects(EditDoc doc, IEnumerable<string> ids) =>
        ids.Distinct().OrderByDescending(id => DepthOf(doc, id)).Aggregate(doc, DeleteObject);

    /// <summary>How long the chain from an object up to the root is, as <c>chain</c> counts it in src/core/views.ts: the object, each box around it, and root.</summary>
    private static int DepthOf(EditDoc doc, string id)
    {
        var seen = new HashSet<string> { id };
        var current = id;
        while (current != Names.Root)
        {
            var parent = ObjectOf(doc, current) is { } o ? Text(o, "in") : null;
            current = parent is not null && parent != current && ObjectOf(doc, parent) is not null ? parent : Names.Root;
            if (!seen.Add(current)) break;
        }
        return seen.Contains(Names.Root) ? seen.Count : seen.Count + 1;
    }

    // ---- connections ---------------------------------------------------------------------------------------------

    /// <summary>Add a connection. An empty label means no label.</summary>
    public static EditDoc Connect(EditDoc doc, ConnectionInput input)
    {
        foreach (var end in new[] { input.From, input.To })
            if (ObjectOf(doc, end) is null) throw new OpError($"unknown object \"{end}\"");
        var d = doc.Clone();
        var c = new OrderedDictionary<string, object?> { ["from"] = input.From, ["to"] = input.To };
        if (!string.IsNullOrEmpty(input.Label)) c["label"] = input.Label;
        d.Connections.Add(c);
        return d;
    }

    /// <summary>Where the first from → to connection labelled <paramref name="label"/> ("" or none: unlabelled) is.</summary>
    private static int FindConnection(EditDoc doc, ConnectionInput input)
    {
        var label = input.Label ?? "";
        var i = doc.Connections.FindIndex(c => Text(Entry(c), "from") == input.From && Text(Entry(c), "to") == input.To && (Text(Entry(c), "label") ?? "") == label);
        if (i == -1) throw new OpError($"no connection {input.From} → {input.To} {(label != "" ? $"labelled \"{label}\"" : "without a label")}");
        return i;
    }

    /// <summary>Remove one connection: the first that matches. Exact duplicates go one at a time.</summary>
    public static EditDoc RemoveConnection(EditDoc doc, ConnectionInput which)
    {
        var i = FindConnection(doc, which);
        var d = doc.Clone();
        d.Connections.RemoveAt(i);
        return d;
    }

    /// <summary>Give one connection (the first that matches) a new label, in place. "" removes the label.</summary>
    public static EditDoc Relabel(EditDoc doc, ConnectionInput which, string label)
    {
        var i = FindConnection(doc, which);
        var d = doc.Clone();
        var c = Entry(d.Connections[i]);
        if (label != "") c["label"] = label;
        else c.Remove("label");
        return d;
    }

    // ---- flows ---------------------------------------------------------------------------------------------------

    private static OrderedDictionary<string, object?> ExistingFlow(EditDoc doc, string id)
    {
        if (!doc.Flows.TryGetValue(id, out var flow)) throw new OpError($"unknown flow \"{id}\"");
        if (!Names.IsValidId(id)) throw new OpError($"flows/{id}.yaml has an invalid file name, so it can't be changed here. Rename or delete it by hand.");
        return Entry(flow);
    }

    /// <summary>A step: from, optionally to, the text, and optionally the longer detail. A blank detail is no detail.</summary>
    public static OrderedDictionary<string, object?> NewStep(string from, string? to, string text, string? description = null)
    {
        var step = new OrderedDictionary<string, object?> { ["from"] = from };
        if (to is not null) step["to"] = to;
        step["text"] = text;
        if (description is not null && description.Trim() != "") step["description"] = description;
        return step;
    }

    /// <summary>Create or replace a flow. Replacing drops everything the old flow had, hand-written extra keys included.</summary>
    public static EditDoc PutFlow(EditDoc doc, string id, string name, string view, IEnumerable<OrderedDictionary<string, object?>> steps)
    {
        if (!Names.IsValidId(id)) throw new OpError($"\"{id}\" is not a valid flow id: {Names.IdRule}");
        // Flow ids are file names, and Windows and macOS don't tell Visit.yaml from visit.yaml.
        string? clash = doc.Flows.Keys.Cast<string?>().FirstOrDefault(other => other != id && string.Equals(other, id, StringComparison.OrdinalIgnoreCase));
        if (clash is not null) throw new OpError($"flows/{clash}.yaml already exists and differs only in case. Rename or delete that file by hand.");
        var d = doc.Clone();
        var copies = new List<object?>();
        foreach (var s in steps)
        {
            var copy = Clone(s);
            // A blank detail is no detail, as on the canvas, so the file stays as short as it can be.
            if (copy.TryGetValue("description", out var detail) && detail is string text && text.Trim() == "") copy.Remove("description");
            copies.Add(copy);
        }
        d.Flows[id] = new OrderedDictionary<string, object?> { ["name"] = name, ["view"] = view, ["steps"] = copies };
        return d;
    }

    private static OrderedDictionary<string, object?> Clone(OrderedDictionary<string, object?> step)
    {
        var holder = new EditDoc();
        holder.Objects["x"] = step;
        return (OrderedDictionary<string, object?>)holder.Clone().Objects["x"]!;
    }

    /// <summary>Change an existing flow's name or steps, keeping everything else it has.</summary>
    public static EditDoc UpdateFlow(EditDoc doc, string id, string? name = null, IEnumerable<OrderedDictionary<string, object?>>? steps = null)
    {
        ExistingFlow(doc, id);
        var d = doc.Clone();
        var flow = Entry(d.Flows[id]);
        if (name is not null) flow["name"] = name;
        if (steps is not null) flow["steps"] = steps.Select(s => (object?)Clone(s)).ToList();
        return d;
    }

    public static EditDoc DeleteFlow(EditDoc doc, string id)
    {
        ExistingFlow(doc, id);
        var d = doc.Clone();
        d.Flows.Remove(id);
        return d;
    }

    // ---- layout and settings -------------------------------------------------------------------------------------

    /// <summary>Save where boxes sit in one view (layout.yaml). Positions of objects and views that no longer exist are dropped.</summary>
    public static EditDoc PlaceBoxes(EditDoc doc, string view, IEnumerable<(string Id, double X, double Y)> boxes)
    {
        var d = doc.Clone();
        var merged = new OrderedDictionary<string, object?>();
        foreach (var (v, saved) in d.Layout) merged[v] = saved;
        var here = merged.TryGetValue(view, out var existing) ? Entry(existing) : [];
        foreach (var (id, x, y) in boxes) here[id] = new List<object?> { EditDoc.Number(x), EditDoc.Number(y) };
        merged[view] = here;

        var layout = new OrderedDictionary<string, object?>();
        foreach (var (v, saved) in merged)
        {
            var kept = new OrderedDictionary<string, object?>();
            foreach (var (id, p) in Entry(saved))
                if (ObjectOf(d, id) is not null) kept[id] = p;
            if ((v == Names.Root || ObjectOf(d, v) is not null) && kept.Count > 0) layout[v] = kept;
        }
        return new EditDoc { Meta = d.Meta, Objects = d.Objects, Connections = d.Connections, Flows = d.Flows, Layout = layout };
    }

    /// <summary>Set the project's line style: the top-level <c>lines:</c> in model.yaml. Straight is the default, so straight or null removes the key. A new key goes first; one that's there keeps its place.</summary>
    public static EditDoc SetLines(EditDoc doc, string? style)
    {
        var d = doc.Clone();
        if (style is null or "straight")
        {
            d.Meta.Remove("lines");
            return d;
        }
        if (d.Meta.ContainsKey("lines"))
        {
            d.Meta["lines"] = style;
            return d;
        }
        var meta = new OrderedDictionary<string, object?> { ["lines"] = style };
        foreach (var (key, value) in d.Meta) meta[key] = value;
        return new EditDoc { Meta = meta, Objects = d.Objects, Connections = d.Connections, Flows = d.Flows, Layout = d.Layout };
    }

    /// <summary>Forget where boxes were dragged in one view, so the computed layout shows again.</summary>
    public static EditDoc ForgetLayout(EditDoc doc, string view)
    {
        if (!doc.Layout.ContainsKey(view)) throw new OpError("Nothing to tidy: no shape here was moved by hand.");
        var d = doc.Clone();
        d.Layout.Remove(view);
        return d;
    }

    // ---- problems ------------------------------------------------------------------------------------------------

    // A step's number is left out: deleting or moving a step renumbers the problems after it, and they're still the same problems.
    private static string Key(Problem p) =>
        string.Join('\u0001', p.File, p.Id ?? "", p.Step is null ? p.Message : System.Text.RegularExpressions.Regex.Replace(p.Message, @"^step \d+: ", ""));

    /// <summary>Problems in <paramref name="after"/> that weren't already in <paramref name="before"/>. Repeats count: a second copy of an old problem is new.</summary>
    public static List<Problem> NewProblems(IEnumerable<Problem> before, IEnumerable<Problem> after)
    {
        var remaining = new Dictionary<string, int>();
        foreach (var p in before) remaining[Key(p)] = remaining.GetValueOrDefault(Key(p)) + 1;
        var added = new List<Problem>();
        foreach (var p in after)
        {
            var left = remaining.GetValueOrDefault(Key(p));
            remaining[Key(p)] = left - 1;
            if (left <= 0) added.Add(p);
        }
        return added;
    }

    /// <summary>Refuse an edit that adds problems, naming them. Problems that were already there never block it.</summary>
    public static void RefuseNewProblems(Model before, Model after, ISet<string>? absent = null)
    {
        var added = NewProblems(Checks.Run(before, absent), Checks.Run(after, absent));
        if (added.Count > 0) throw new OpError("Refused, nothing saved. This would add:\n" + string.Join("\n", added.Select(p => $"- {p.File}: {p.Message}")));
    }
}
