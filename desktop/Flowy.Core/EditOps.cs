namespace Flowy.Core;

/// <summary>A refused edit. The message is written for whoever asked for it.</summary>
public sealed class OpError(string message) : Exception(message);

/// <summary>An object to create or change. null leaves a field as it is; "" removes <c>in</c>, <c>shape</c>, <c>color</c>, <c>opacity</c>, <c>icon</c>, <c>tech</c> or <c>description</c>; an empty list removes <c>code</c>, <c>links</c>, <c>snippets</c> or <c>data</c>; <c>External: false</c> removes <c>external</c>. A link is a mapping that keeps its extra keys. <c>Snippets</c> replaces the whole list (see <see cref="Snippets.Tidy"/>). <c>Data</c> is a store's data as the YAML tree it is written as: a list replaces the whole list (see <see cref="StoreData.Tidy"/>), anything else is carried through for the checks to report.</summary>
public sealed record ObjectInput(string Id, string? Type = null, string? Name = null, string? In = null, bool? External = null, string? Tech = null, string? Description = null, IReadOnlyList<string>? Code = null, IReadOnlyList<OrderedDictionary<string, object?>>? Links = null,
    string? Shape = null, string? Color = null, string? Opacity = null, string? Icon = null, object? Data = null,
    IReadOnlyList<OrderedDictionary<string, object?>>? Snippets = null);

public sealed record ConnectionInput(string From, string To, string? Label = null);

/// <summary>
/// The edits, as functions from a <see cref="EditDoc"/> to a changed copy: a C# twin of src/core/ops.ts with the same rules, the same order of
/// keys in what they write and the same words in what they refuse. A script run through both (desktop/fixtures/ops.ts) must write equal files.
/// </summary>
public static class EditOps
{
    private static readonly string[] CopiedFields = ["type", "name", "in", "external", "shape", "color", "opacity", "icon", "tech", "description", "code", "links", "snippets", "data"];
    private static readonly string[] Clearable = ["in", "shape", "color", "opacity", "icon", "tech", "description"];

    private static OrderedDictionary<string, object?>? ObjectOf(EditDoc doc, string? id) =>
        id is not null && id != Names.Root && doc.Objects.TryGetValue(id, out var o) ? o as OrderedDictionary<string, object?> : null;

    private static string? Text(OrderedDictionary<string, object?> map, string key) => map.TryGetValue(key, out var v) ? v as string : null;

    private static OrderedDictionary<string, object?> Entry(object? node) => node as OrderedDictionary<string, object?> ?? [];

    // ---- objects -------------------------------------------------------------------------------------------------

    /// <summary>
    /// Create or update an object. Omitted fields stay as they are. Only the known fields are copied, so a new object's keys come out in the order
    /// type, name, in, external, shape, color, opacity, icon, tech, description, code, links, snippets, data, and a hand-written key on an existing object stays where it is.
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
                "links" => input.Links?.Select(l => (object?)NormalizeLink(l)).ToList(),
                "snippets" => Snippets.Tidy(input.Snippets?.Select(s => (object?)s).ToList()),
                _ => StoreData.Tidy(input.Data),
            };
            if (value is not null) next[key] = value;
        }
        foreach (var key in Clearable)
            if (Text(next, key) == "") next.Remove(key);
        if (next.TryGetValue("code", out var code) && code is List<object?> { Count: 0 }) next.Remove("code");
        if (next.TryGetValue("links", out var links) && links is List<object?> { Count: 0 }) next.Remove("links");
        if (next.TryGetValue("snippets", out var snippets) && snippets is List<object?> { Count: 0 }) next.Remove("snippets");
        if (next.TryGetValue("data", out var data) && data is List<object?> { Count: 0 }) next.Remove("data");
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
        // A shape that only a `states` names (the flow's or a step's) is used too: its state would be left pointing at nothing.
        bool Staged(object? states) => states is OrderedDictionary<string, object?> map && map.ContainsKey(id);
        var flows = JsKeys.Order(doc.Flows.Keys).Where(fid =>
        {
            var flow = Entry(doc.Flows[fid]);
            return Text(flow, "view") == id
                || (flow.TryGetValue("steps", out var steps) && steps is List<object?> list && list.Any(s => Text(Entry(s), "from") == id || Text(Entry(s), "to") == id || (Entry(s).TryGetValue("states", out var own) && Staged(own))))
                || (flow.TryGetValue("states", out var start) && Staged(start));
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

    /// <summary>
    /// Create or replace a flow. Replacing drops everything the old flow had, hand-written extra keys included. <paramref name="groups"/> (group id → its options, all text) is written between the view and the steps; none or an empty set writes no <c>groups:</c>.
    /// <paramref name="states"/> (shape id → state word) is where shapes stand before step 1, written right after the view; none or an empty set writes no <c>states:</c>, and neither does an empty one on a step.
    /// </summary>
    public static EditDoc PutFlow(EditDoc doc, string id, string name, string view, IEnumerable<OrderedDictionary<string, object?>> steps, OrderedDictionary<string, object?>? groups = null, OrderedDictionary<string, object?>? states = null)
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
            if (copy.TryGetValue("states", out var own) && own is OrderedDictionary<string, object?> { Count: 0 }) copy.Remove("states");
            copies.Add(copy);
        }
        var flow = new OrderedDictionary<string, object?> { ["name"] = name, ["view"] = view };
        if (states is { Count: > 0 }) flow["states"] = Clone(states);
        if (groups is { Count: > 0 }) flow["groups"] = Clone(groups);
        flow["steps"] = copies;
        d.Flows[id] = flow;
        return d;
    }

    private static OrderedDictionary<string, object?> Clone(OrderedDictionary<string, object?> step)
    {
        var holder = new EditDoc();
        holder.Objects["x"] = step;
        return (OrderedDictionary<string, object?>)holder.Clone().Objects["x"]!;
    }

    /// <summary>The flow with these groups: replaced where its <c>groups:</c> already is, else put just before the steps, so the file reads name, view, groups, steps. No groups, or none left, takes the section out.</summary>
    private static OrderedDictionary<string, object?> WithGroups(OrderedDictionary<string, object?> flow, OrderedDictionary<string, object?>? groups)
    {
        var none = groups is null || groups.Count == 0;
        var had = flow.ContainsKey("groups");
        var result = new OrderedDictionary<string, object?>();
        foreach (var (key, value) in flow)
        {
            if (key == "groups")
            {
                if (!none) result["groups"] = groups;
                continue;
            }
            if (key == "steps" && !none && !had) result["groups"] = groups;
            result[key] = value;
        }
        return result;
    }

    /// <summary>Change an existing flow's name, steps or groups, keeping everything else it has (and its groups when not given any).</summary>
    public static EditDoc UpdateFlow(EditDoc doc, string id, string? name = null, IEnumerable<OrderedDictionary<string, object?>>? steps = null, OrderedDictionary<string, object?>? groups = null)
    {
        ExistingFlow(doc, id);
        var d = doc.Clone();
        var flow = Entry(d.Flows[id]);
        if (name is not null) flow["name"] = name;
        if (steps is not null) flow["steps"] = steps.Select(s => (object?)Clone(s)).ToList();
        if (groups is not null) d.Flows[id] = WithGroups(flow, Clone(groups));
        return d;
    }

    /// <summary>The keys of a step in the order the guide shows them; a key set later goes after the nearest earlier one that is there.</summary>
    private static readonly string[] StepOrder = ["from", "to", "text", "description", "animation", "states", "group", "lane", "flow"];

    /// <summary>
    /// Set which shapes step <paramref name="index"/> changes, as a whole: <paramref name="states"/> replaces what the step had, so pass the entries to keep too, and an empty map takes
    /// <c>states</c> out. Refused for a shape that does not exist or a word that is not a state, in the checks' words. Every other key of the step is kept.
    /// </summary>
    public static EditDoc SetStepStates(EditDoc doc, string id, int index, IReadOnlyDictionary<string, string> states)
    {
        ExistingFlow(doc, id);
        var d = doc.Clone();
        var flow = Entry(d.Flows[id]);
        var steps = StepsOf(flow);
        if (index < 0 || index >= steps.Count) throw NoStep(id, index);
        var tree = new OrderedDictionary<string, object?>();
        foreach (var shape in JsKeys.Order(states.Keys)) tree[shape] = states[shape];
        var probe = new Flow("", "", [new Step("", null, "", null, States: tree)]);
        if (States.Problems(probe, [], shape => ObjectOf(doc, shape) is not null) is [var (_, why), ..]) throw new OpError(why);
        var entries = Entry(steps[index]).ToList();
        var at = entries.FindIndex(e => e.Key == "states");
        if (tree.Count == 0)
        {
            if (at != -1) entries.RemoveAt(at);
        }
        else if (at != -1) entries[at] = new("states", tree);
        else
        {
            var rank = Array.IndexOf(StepOrder, "states");
            int after = -1, nearest = -1;
            for (var i = 0; i < entries.Count; i++)
            {
                var r = Array.IndexOf(StepOrder, entries[i].Key);
                if (r != -1 && r < rank && r > nearest) (nearest, after) = (r, i);
            }
            entries.Insert(after + 1, new("states", tree));
        }
        var next = new OrderedDictionary<string, object?>();
        foreach (var (key, value) in entries) next[key] = value;
        steps[index] = next;
        return d;
    }

    private static string GroupOf(object? step) => Text(Entry(step), "group") is { } g ? Structure.JsTrim(g) : "";

    private static string LaneOf(object? step) => Text(Entry(step), "lane") is { } l ? Structure.JsTrim(l) : "";

    private static OrderedDictionary<string, object?>? GroupsOf(OrderedDictionary<string, object?> flow) =>
        flow.TryGetValue("groups", out var g) ? g as OrderedDictionary<string, object?> : null;

    private static List<object?> StepsOf(OrderedDictionary<string, object?> flow) =>
        flow.TryGetValue("steps", out var raw) && raw is List<object?> list ? list : [];

    private static OpError NoStep(string id, int index) => new($"flow \"{id}\" has no step {index + 1}");

    /// <summary>
    /// Take step <paramref name="index"/> out of its group, in <paramref name="steps"/> (it stays in the list, without <c>group</c> and <c>lane</c>), and return the
    /// groups without any that this left empty. When it started a lane and the next step of the group has none, that step takes the label.
    /// </summary>
    private static OrderedDictionary<string, object?>? LeaveGroup(OrderedDictionary<string, object?> flow, List<object?> steps, int index)
    {
        var groups = GroupsOf(flow);
        var g = GroupOf(steps[index]);
        if (g == "") return groups;
        var step = Entry(steps[index]);
        var lane = LaneOf(step) != "" ? step["lane"] : null;
        if (lane is not null && index + 1 < steps.Count && GroupOf(steps[index + 1]) == g && LaneOf(steps[index + 1]) == "") Entry(steps[index + 1])["lane"] = lane;
        step.Remove("group");
        step.Remove("lane");
        if (groups is not null && !steps.Any(s => GroupOf(s) == g)) groups = Without(groups, g);
        return groups;
    }

    private static OrderedDictionary<string, object?> Without(OrderedDictionary<string, object?> map, string drop)
    {
        var kept = new OrderedDictionary<string, object?>();
        foreach (var (key, value) in map)
            if (key != drop) kept[key] = value;
        return kept;
    }

    /// <summary>A step with <c>lane</c> taken out of it, in the order it had.</summary>
    private static OrderedDictionary<string, object?> WithoutLane(object? step) => Without(Entry(step), "lane");

    /// <summary>
    /// Remove step <paramref name="index"/> of a flow without breaking its groups: when it started a lane and the next step of that group has none, that step takes
    /// the label, and a group whose last member goes is taken out with it.
    /// </summary>
    public static EditDoc RemoveStep(EditDoc doc, string id, int index)
    {
        ExistingFlow(doc, id);
        var d = doc.Clone();
        var flow = Entry(d.Flows[id]);
        var steps = StepsOf(flow);
        if (index < 0 || index >= steps.Count) throw NoStep(id, index);
        var groups = LeaveGroup(flow, steps, index);
        steps.RemoveAt(index);
        d.Flows[id] = WithGroups(flow, groups);
        return d;
    }

    /// <summary>
    /// Set what step <paramref name="index"/> of a flow plays: a kind (text), or a mapping with a kind, as put_flow takes it. Null takes the animation away. The step keeps its
    /// other keys, and an <c>animation</c> it already has keeps its place. Whether the animation is allowed is the checks' to say when the edit is saved.
    /// </summary>
    public static EditDoc SetStepAnimation(EditDoc doc, string id, int index, object? animation)
    {
        ExistingFlow(doc, id);
        var d = doc.Clone();
        var flow = Entry(d.Flows[id]);
        var steps = StepsOf(flow);
        if (index < 0 || index >= steps.Count) throw NoStep(id, index);
        var step = Entry(steps[index]);
        if (animation is null or "") step.Remove("animation");
        else step["animation"] = animation;
        return d;
    }

    /// <summary>
    /// Put step <paramref name="index"/> in the declared group <paramref name="group"/> ("" takes it out of its group). It leaves its old group first, as in
    /// <see cref="RemoveStep"/>. A repeat has no lanes. In a branch or parallel group a step that comes before the others takes over the label of the first lane,
    /// which it joins at the front, and in a group with no other step it starts "Lane 1".
    /// </summary>
    public static EditDoc SetStepGroup(EditDoc doc, string id, int index, string group)
    {
        ExistingFlow(doc, id);
        var d = doc.Clone();
        var flow = Entry(d.Flows[id]);
        var steps = StepsOf(flow);
        if (index < 0 || index >= steps.Count) throw NoStep(id, index);
        var to = Structure.JsTrim(group);
        var declared = GroupsOf(flow);
        if (to != "" && !(declared is not null && declared.ContainsKey(to))) throw new OpError($"unknown group \"{group}\"");
        if (GroupOf(steps[index]) == to) return doc;
        var left = LeaveGroup(flow, steps, index);
        if (to != "")
        {
            var joined = WithoutLane(steps[index]);
            joined["group"] = to;
            steps[index] = joined;
            var kind = Text(Entry(declared![to]), "kind");
            if (kind is "branch" or "parallel")
            {
                var first = -1;
                for (var i = 0; i < steps.Count && first == -1; i++)
                    if (i != index && GroupOf(steps[i]) == to) first = i;
                if (first == -1) joined["lane"] = "Lane 1";
                else if (first > index)
                {
                    var has = LaneOf(steps[first]) != "";
                    joined["lane"] = has ? Entry(steps[first])["lane"] : "Lane 1";
                    if (has) steps[first] = WithoutLane(steps[first]);
                }
            }
        }
        d.Flows[id] = WithGroups(flow, left);
        return d;
    }

    /// <summary>
    /// Give an existing group another kind. A repeat keeps its <c>times</c> and <c>until</c> (and gets <c>times: "3"</c> when it has neither), the others drop
    /// them; members lose their lanes when it becomes a repeat, and when it becomes a branch or parallel group its first step starts "Lane 1".
    /// </summary>
    public static EditDoc SetGroupKind(EditDoc doc, string id, string group, string kind)
    {
        ExistingFlow(doc, id);
        var d = doc.Clone();
        var flow = Entry(d.Flows[id]);
        var groups = GroupsOf(flow);
        if (groups is null || !groups.ContainsKey(group)) throw new OpError($"unknown group \"{group}\"");
        if (!Structure.Kinds.Contains(kind)) throw new OpError($"unknown kind \"{kind}\" (use {string.Join(", ", Structure.Kinds)})");
        var old = Entry(groups[group]);
        var next = new OrderedDictionary<string, object?>();
        foreach (var (key, value) in old)
            if (key is not ("times" or "until")) next[key] = value;
        next["kind"] = kind;
        if (kind == "repeat")
        {
            old.TryGetValue("times", out var times);
            old.TryGetValue("until", out var until);
            if (old.ContainsKey("times")) next["times"] = times;
            if (old.ContainsKey("until")) next["until"] = until;
            if (Structure.Blank(times) && Structure.Blank(until)) next["times"] = "3";
        }
        var steps = StepsOf(flow);
        var members = Enumerable.Range(0, steps.Count).Where(i => GroupOf(steps[i]) == group).ToList();
        if (kind == "repeat")
        {
            foreach (var i in members)
                if (Entry(steps[i]).ContainsKey("lane")) steps[i] = WithoutLane(steps[i]);
        }
        else if (members.Count > 0)
        {
            if (LaneOf(steps[members[0]]) == "") Entry(steps[members[0]])["lane"] = "Lane 1";
            // Parallel lanes are at least two: every step that starts no lane starts one of its own, as GroupSteps does.
            if (kind == "parallel" && members.Count(i => LaneOf(steps[i]) != "") < 2)
                foreach (var i in members)
                {
                    if (LaneOf(steps[i]) != "") continue;
                    var used = members.Select(j => LaneOf(steps[j])).ToHashSet();
                    var n = 1;
                    while (used.Contains($"Lane {n}")) n++;
                    Entry(steps[i])["lane"] = $"Lane {n}";
                }
        }
        var all = new OrderedDictionary<string, object?>();
        foreach (var (key, value) in groups) all[key] = key == group ? next : value;
        d.Flows[id] = WithGroups(flow, all);
        return d;
    }

    /// <summary>
    /// Declare a group and put the steps <paramref name="first"/> to <paramref name="last"/> (0-based, both included) in it. A repeat is written with <c>times: "3"</c>;
    /// in a branch or parallel group every step starts a lane of its own ("Lane 1", "Lane 2"…), which the steps' lane labels then reshape.
    /// </summary>
    public static EditDoc GroupSteps(EditDoc doc, string id, string group, string kind, int first, int last)
    {
        ExistingFlow(doc, id);
        if (!Names.IsValidId(group)) throw new OpError($"\"{group}\" is not a valid group id: {Names.IdRule}");
        var d = doc.Clone();
        var flow = Entry(d.Flows[id]);
        var groups = GroupsOf(flow);
        if (groups is not null && groups.ContainsKey(group)) throw new OpError($"group \"{group}\" already exists");
        if (!Structure.Kinds.Contains(kind)) throw new OpError($"unknown kind \"{kind}\" (use {string.Join(", ", Structure.Kinds)})");
        var steps = StepsOf(flow);
        if (first < 0 || first >= steps.Count) throw NoStep(id, first);
        if (last < 0 || last >= steps.Count) throw NoStep(id, last);
        if (last < first) throw new OpError($"step {last + 1} comes before step {first + 1}");
        for (var i = first; i <= last; i++)
        {
            var other = GroupOf(steps[i]);
            if (other != "") throw new OpError($"step {i + 1} is already in group \"{other}\"");
            var kept = WithoutLane(steps[i]);
            kept["group"] = group;
            if (kind != "repeat") kept["lane"] = $"Lane {i - first + 1}";
            steps[i] = kept;
        }
        var declared = new OrderedDictionary<string, object?> { ["kind"] = kind };
        if (kind == "repeat") declared["times"] = "3";
        var all = new OrderedDictionary<string, object?>();
        if (groups is not null)
            foreach (var (key, value) in groups) all[key] = value;
        all[group] = declared;
        d.Flows[id] = WithGroups(flow, all);
        return d;
    }

    /// <summary>Create or replace a group of a flow. A blank <c>times</c>, <c>until</c> or <c>text</c> is left out.</summary>
    public static EditDoc PutGroup(EditDoc doc, string flowId, string id, OrderedDictionary<string, object?> group)
    {
        ExistingFlow(doc, flowId);
        if (!Names.IsValidId(id)) throw new OpError($"\"{id}\" is not a valid group id: {Names.IdRule}");
        var d = doc.Clone();
        var flow = Entry(d.Flows[flowId]);
        var next = new OrderedDictionary<string, object?>();
        foreach (var (key, value) in group)
        {
            if (value is null) continue;
            if (key is "times" or "until" or "text" && Structure.Blank(value)) continue;
            next[key] = value;
        }
        // The checks only refuse a problem that is new, so a bad `times` over an old bad `times` would pass them: this says no first.
        if (next.TryGetValue("times", out var times) && !Structure.TimesOk(times))
            throw new OpError($"group \"{id}\": times must be a whole number from {Structure.TimesMin} to {Structure.TimesMax}");
        var groups = new OrderedDictionary<string, object?>();
        if (flow.TryGetValue("groups", out var existing) && existing is OrderedDictionary<string, object?> map)
            foreach (var (key, value) in map) groups[key] = value;
        groups[id] = next;
        d.Flows[flowId] = WithGroups(flow, groups);
        return d;
    }

    /// <summary>Remove a group's declaration, and the group and lane of every step that named it.</summary>
    public static EditDoc RemoveGroup(EditDoc doc, string flowId, string id)
    {
        ExistingFlow(doc, flowId);
        var d = doc.Clone();
        var flow = Entry(d.Flows[flowId]);
        if (!(flow.TryGetValue("groups", out var existing) && existing is OrderedDictionary<string, object?> map && map.ContainsKey(id))) throw new OpError($"unknown group \"{id}\"");
        var rest = new OrderedDictionary<string, object?>();
        foreach (var (key, value) in map)
            if (key != id) rest[key] = value;
        if (flow.TryGetValue("steps", out var raw) && raw is List<object?> steps)
            for (var i = 0; i < steps.Count; i++)
            {
                if (GroupOf(steps[i]) != id) continue;
                var kept = new OrderedDictionary<string, object?>();
                foreach (var (key, value) in Entry(steps[i]))
                    if (key is not ("group" or "lane")) kept[key] = value;
                steps[i] = kept;
            }
        d.Flows[flowId] = WithGroups(flow, rest);
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
