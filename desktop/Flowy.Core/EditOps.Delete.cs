using static Flowy.Core.YamlTree;

namespace Flowy.Core;

/// <summary>How one row of <see cref="Dependents"/> is settled: its key, what to do, and where to when the action points somewhere (reroute, repoint, changeView, changeScope, moveOut).</summary>
public sealed record Resolution(string Key, string Action, string? To = null);

public static partial class EditOps
{
    /// <summary>The failure modes of every analysis, with the analysis id: the mode maps are edited in place.</summary>
    private static IEnumerable<(string Analysis, string Mode, OrderedDictionary<string, object?> Map)> ModesOf(EditDoc doc) =>
        doc.Failures.SelectMany(a => Entry(Get(Entry(a.Value), "modes")).Select(m => (a.Key, m.Key, Entry(m.Value)))).ToList();

    private static bool WholeFrom1(string s) => s.Length > 0 && s[0] is >= '1' and <= '9' && s.All(c => c is >= '0' and <= '9');

    /// <summary>
    /// Failure modes that name a step of this flow, once step <paramref name="removed"/> (counting from 1) is taken out: a mode on a later step moves up one,
    /// and a mode on the removed step keeps its flow and loses its step. Edits the document in place.
    /// </summary>
    private static void RenumberModes(EditDoc doc, string flowId, int removed)
    {
        foreach (var (_, _, mode) in ModesOf(doc))
        {
            if (Text(mode, "flow") != flowId || Text(mode, "step") is not { } step || !WholeFrom1(step) || !int.TryParse(step, out var n) || n < removed) continue;
            if (n == removed) mode.Remove("step");
            else mode["step"] = (n - 1).ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
    }

    /// <summary>
    /// Delete shapes and lines as one edit, settling what depends on them the way <paramref name="resolutions"/> say (see <see cref="Dependents"/>). A row that goes with the shape
    /// needs no resolution. Refused, nothing changed, when a row that needs one has none, when a resolution does not fit its row or points at something that is going too,
    /// or when removing steps would leave a flow with none. Deleting a flow also takes the flow and step off the failure modes that named it, and removing a step moves the
    /// modes on later steps up. The twin of <c>deleteWith</c> in src/core/ops.ts.
    /// </summary>
    public static EditDoc DeleteWith(EditDoc doc, IReadOnlyList<Target> targets, IReadOnlyList<Resolution> resolutions)
    {
        var model = doc.ToModel();
        foreach (var t in targets)
        {
            if (t.Object is { } obj)
            {
                if (obj == Names.Root && doc.Objects.ContainsKey(Names.Root))
                    throw new OpError("\"root\" is reserved, so this object can't be changed here. Rename or delete it in model.yaml by hand.");
                if (ObjectOf(doc, obj) is null) throw new OpError($"unknown object \"{obj}\"");
            }
            else if (Dependents.LineIndices(model, t.Line!).Count == 0)
                throw new OpError($"no connection {t.Line!.From} → {t.Line.To}{(string.IsNullOrEmpty(t.Line.Label) ? "" : $" labelled \"{t.Line.Label}\"")}");
        }
        var chosen = new Dictionary<string, Resolution>();
        foreach (var r in resolutions)
        {
            if (!chosen.TryAdd(r.Key, r)) throw new OpError($"\"{r.Key}\" is settled twice");
        }
        // A shape inside a deleted one goes too when it was chosen to, and then what depends on it is a row of its own.
        var all = targets.ToList();
        var rows = Dependents.Of(model, all);
        var known = rows.Select(r => r.Key).ToHashSet();
        while (true)
        {
            var more = rows.Where(r => r.Kind == "child" && chosen.TryGetValue(r.Key, out var c) && c.Action == "deleteWith").Select(r => r.Child!).ToList();
            if (more.Count == 0) break;
            all.AddRange(more.Select(o => new Target(Object: o)));
            rows = Dependents.Of(model, all);
            foreach (var r in rows) known.Add(r.Key);
        }
        if (resolutions.FirstOrDefault(r => !known.Contains(r.Key)) is { } unknown) throw new OpError($"nothing is waiting on \"{unknown.Key}\"");
        if (rows.FirstOrDefault(r => !r.NeedsDecision && chosen.ContainsKey(r.Key)) is { } needless)
            throw new OpError($"{Dependents.Describe(needless)} goes along with the shape, so it needs no choice");

        var gone = all.Where(t => t.Object is not null).Select(t => t.Object!).ToHashSet();
        var doomed = rows.Where(r => chosen.TryGetValue(r.Key, out var c) && c.Action == "deleteFlow").Select(r => r.Flow!).ToList().Distinct().ToList();
        var decided = rows.Where(r => r.NeedsDecision && (r.Flow is null || !doomed.Contains(r.Flow))).Select(row =>
        {
            if (!chosen.TryGetValue(row.Key, out var r)) throw new OpError($"{Dependents.Describe(row)} needs a choice: {string.Join(", ", row.Actions)}");
            if (!row.Actions.Contains(r.Action)) throw new OpError($"{r.Action} is not one of the choices for {Dependents.Describe(row)}: {string.Join(", ", row.Actions)}");
            return (Row: row, Res: r);
        }).ToList();
        string Pointed(Dependent row, Resolution r)
        {
            if (r.To is null || model.GetObject(r.To) is null || gone.Contains(r.To)) throw new OpError($"{r.Action} for {Dependents.Describe(row)} needs \"to\": a shape that stays");
            return r.To;
        }
        string Viewed(Dependent row, Resolution r)
        {
            var to = r.To ?? Names.Root;
            if (gone.Contains(to) || !Views.IsView(model, to)) throw new OpError($"{r.Action} for {Dependents.Describe(row)} needs \"to\": \"root\" or a shape with shapes inside it that stays");
            return to;
        }
        List<(Dependent Row, Resolution Res)> Of(string kind, string? action = null) => decided.Where(x => x.Row.Kind == kind && (action is null || x.Res.Action == action)).ToList();

        var d = doc.Clone();
        foreach (var fid in doomed)
        {
            ExistingFlow(d, fid);
            foreach (var (_, _, mode) in ModesOf(d))
                if (Text(mode, "flow") == fid)
                {
                    mode.Remove("flow");
                    mode.Remove("step");
                }
            d.Flows.Remove(fid);
        }
        foreach (var (row, r) in Of("view", "changeView")) Entry(d.Flows[row.Flow!])["view"] = Viewed(row, r);
        foreach (var fid in Of("step").Select(x => x.Row.Flow!).Distinct().ToList())
        {
            var mine = Of("step").Where(x => x.Row.Flow == fid).ToList();
            var reroutes = mine.Where(x => x.Res.Action == "reroute").ToList();
            if (reroutes.Count > 0)
            {
                var to = reroutes.ToDictionary(x => x.Row.Step!.Value - 1, x => (x.Row.Ends!, Pointed(x.Row, x.Res)));
                var steps = StepsOf(Entry(d.Flows[fid]));
                foreach (var (i, (ends, shape)) in to)
                    foreach (var end in ends) Entry(steps[i])[end] = shape;
            }
            var removals = mine.Where(x => x.Res.Action == "removeStep").Select(x => x.Row.Step!.Value - 1).OrderByDescending(i => i).ToList();
            if (removals.Count > 0 && removals.Count == StepsOf(Entry(d.Flows[fid])).Count)
                throw new OpError($"Removing those steps would leave flow {fid} with no steps. Delete the flow instead.");
            foreach (var index in removals)
            {
                var flow = Entry(d.Flows[fid]);
                var steps = StepsOf(flow);
                var groups = LeaveGroup(flow, steps, index);
                steps.RemoveAt(index);
                d.Flows[fid] = WithGroups(flow, groups);
                RenumberModes(d, fid, index + 1);
            }
        }
        StripStates(d, gone);

        var removed = Of("mode", "removeMode").Select(x => (x.Row.Analysis!, x.Row.Mode!)).ToHashSet();
        var repoints = new Dictionary<(string, string), List<(string Part, string To)>>();
        foreach (var (row, r) in Of("mode", "repoint"))
        {
            var k = (row.Analysis!, row.Mode!);
            if (!repoints.TryGetValue(k, out var list)) repoints[k] = list = [];
            list.Add((row.Part!, Pointed(row, r)));
        }
        foreach (var (aid, mid, mode) in ModesOf(d))
        {
            if (removed.Contains((aid, mid)))
            {
                Entry(Get(Entry(d.Failures[aid]), "modes")).Remove(mid);
                continue;
            }
            foreach (var (part, to) in repoints.GetValueOrDefault((aid, mid)) ?? []) mode[part] = to;
            if (Get(mode, "affects") is List<object?> affects && affects.Any(a => a is string s && gone.Contains(s)))
            {
                var kept = affects.Where(a => !(a is string s && gone.Contains(s))).ToList();
                if (kept.Count == 0) mode.Remove("affects");
                else mode["affects"] = kept;
            }
        }
        foreach (var (row, r) in Of("scope", "changeScope"))
        {
            var analysis = Entry(d.Failures[row.Analysis!]);
            var to = Viewed(row, r);
            if (to == Names.Root) analysis.Remove("scope");
            else analysis["scope"] = to;
        }

        foreach (var (row, r) in Of("child", "moveOut"))
        {
            var child = Entry(d.Objects[row.Child!]);
            var home = r.To ?? Views.ParentOf(model, row.Of);
            if (r.To is null)
                while (gone.Contains(home)) home = Views.ParentOf(model, home);
            if (home != Names.Root && (model.GetObject(home) is null || gone.Contains(home)))
                throw new OpError($"moveOut for {Dependents.Describe(row)} needs \"to\": \"root\" or a shape that stays");
            if (home == Names.Root) child.Remove("in");
            else child["in"] = home;
        }
        foreach (var id in gone) d.Objects.Remove(id);
        var cut = targets.Where(t => t.Line is not null).SelectMany(t => Dependents.LineIndices(model, t.Line!)).ToHashSet();
        var kept2 = d.Connections.Where((c, i) => !cut.Contains(i) && !gone.Contains(Text(Entry(c), "from") ?? "") && !gone.Contains(Text(Entry(c), "to") ?? "")).ToList();
        d.Connections.Clear();
        d.Connections.AddRange(kept2);
        return d;
    }

    /// <summary>Takes the entries of every flow's and step's <c>states</c> that name a shape in <paramref name="gone"/> out, and a <c>states</c> left empty with them. Edits in place.</summary>
    private static void StripStates(EditDoc doc, IReadOnlySet<string> gone)
    {
        static void Strip(OrderedDictionary<string, object?> holder, IReadOnlySet<string> gone)
        {
            if (Get(holder, "states") is not OrderedDictionary<string, object?> states || !states.Keys.Any(gone.Contains)) return;
            var kept = new OrderedDictionary<string, object?>();
            foreach (var (key, value) in states)
                if (!gone.Contains(key)) kept[key] = value;
            if (kept.Count == 0) holder.Remove("states");
            else holder["states"] = kept;
        }
        foreach (var (_, raw) in doc.Flows)
        {
            var flow = Entry(raw);
            Strip(flow, gone);
            foreach (var step in StepsOf(flow)) Strip(Entry(step), gone);
        }
    }
}
