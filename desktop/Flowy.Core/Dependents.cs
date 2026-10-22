namespace Flowy.Core;

/// <summary>A line to delete. Without <c>Label</c> it is any from → to line, and with <c>All</c> every one that matches goes, else the first.</summary>
public sealed record LineTarget(string From, string To, string? Label = null, bool All = false);

/// <summary>What is being deleted: a shape (<c>Object</c>) or a line (<c>Line</c>).</summary>
public sealed record Target(string? Object = null, LineTarget? Line = null);

/// <summary>
/// One thing that depends on a target. <c>Kind</c> is step, view, mode, scope or child (these need a decision: <c>Actions</c> are the ways to settle
/// it, the default first) or line, start, stepState or affects (these go with the target: no actions). <c>Key</c> says where the row is, so it stays
/// the same when the rows are worked out again. <c>Step</c> counts from 1. <c>EmptiesFlow</c> is true on a step row when every step of its flow is a row.
/// </summary>
public sealed record Dependent(
    string Key, string Kind, string Of, string? Flow, int? Step, IReadOnlyList<string>? Ends, string? Analysis, string? Mode, string? Part, string? Child,
    ConnectionInput? Line, IReadOnlyList<string> Actions, bool EmptiesFlow)
{
    /// <summary>Whether the row has a choice to make.</summary>
    public bool NeedsDecision => Actions.Count > 0;
}

/// <summary>
/// What depends on a shape or a line that is about to go: the flow steps and views that name a shape, the failure modes that sit on it, the shapes
/// inside it, and the leftovers that go along with it. The twin of src/core/dependents.ts, row for row.
/// </summary>
public static class Dependents
{
    private static readonly string[] StepActions = ["removeStep", "reroute", "deleteFlow"];
    private static readonly string[] ViewActions = ["changeView", "deleteFlow"];
    private static readonly string[] ModeActions = ["removeMode", "repoint"];
    private static readonly string[] ScopeActions = ["changeScope"];
    private static readonly string[] ChildActions = ["deleteWith", "moveOut"];
    private static readonly string[] EmptyingActions = ["deleteFlow", "reroute", "removeStep"];

    private static Dependent Row(string key, string kind, string of, string[] actions, string? flow = null, int? step = null, IReadOnlyList<string>? ends = null, string? analysis = null,
        string? mode = null, string? part = null, string? child = null, ConnectionInput? line = null, bool empties = false) =>
        new(key, kind, of, flow, step, ends, analysis, mode, part, child, line, actions, empties);

    /// <summary>The first shape in a <c>states</c> mapping that is in <paramref name="objects"/>, or null (a list or a text names nothing).</summary>
    private static string? Named(object? states, IReadOnlySet<string> objects) =>
        states is OrderedDictionary<string, object?> map ? JsCompat.OrderKeys(map.Keys).FirstOrDefault(objects.Contains) : null;

    /// <summary>The indices of the connections a line target takes out: the first match, or every match with <c>All</c>.</summary>
    public static List<int> LineIndices(Model model, LineTarget line)
    {
        var hits = new List<int>();
        for (var i = 0; i < model.Connections.Count; i++)
        {
            var c = model.Connections[i];
            if (c.From == line.From && c.To == line.To && (line.Label is null || (c.Label ?? "") == line.Label)) hits.Add(i);
        }
        return line.All ? hits : hits.Take(1).ToList();
    }

    /// <summary>The rows for deleting these targets, worked out together so that targets which depend on each other don't count against each other.</summary>
    public static List<Dependent> Of(Model model, IReadOnlyList<Target> targets)
    {
        var order = targets.Where(t => t.Object is not null).Select(t => t.Object!).Distinct().ToList();
        var objects = new HashSet<string>(order);
        var cut = targets.Where(t => t.Line is not null).SelectMany(t => LineIndices(model, t.Line!)).ToHashSet();
        bool Incident(int i) => (model.Connections[i].From is { } f && objects.Contains(f)) || (model.Connections[i].To is { } t && objects.Contains(t));
        bool Hit(string? id) => id is not null && objects.Contains(id);
        var rows = new List<Dependent>();

        foreach (var (fid, flow) in model.Flows)
        {
            if (Hit(flow.View)) rows.Add(Row($"view:{fid}", "view", flow.View!, [.. ViewActions], flow: fid));
            var stepRows = new List<Dependent>();
            for (var i = 0; i < flow.Steps.Count; i++)
            {
                var s = flow.Steps[i];
                var ends = new List<string>();
                if (Hit(s.From)) ends.Add("from");
                if (Hit(s.To)) ends.Add("to");
                if (ends.Count > 0) stepRows.Add(Row($"step:{fid}:{i + 1}", "step", ends[0] == "from" ? s.From! : s.To!, [.. StepActions], flow: fid, step: i + 1, ends: ends));
                else if (Named(s.States, objects) is { } named) rows.Add(Row($"stepState:{fid}:{i + 1}", "stepState", named, [], flow: fid, step: i + 1));
            }
            var empties = stepRows.Count > 0 && stepRows.Count == flow.Steps.Count;
            foreach (var r in stepRows) rows.Add(empties ? r with { Actions = [.. EmptyingActions], EmptiesFlow = true } : r);
            if (Named(flow.States, objects) is { } start) rows.Add(Row($"start:{fid}", "start", start, [], flow: fid));
        }

        // A line goes when it is cut, or when a shape it joins goes. A mode on a line is left with nothing only when no from → to line is left.
        var remaining = model.Connections.Where((_, i) => !cut.Contains(i) && !Incident(i)).ToList();
        foreach (var (aid, a) in model.Failures)
        {
            if (Hit(a.Scope)) rows.Add(Row($"scope:{aid}", "scope", a.Scope!, [.. ScopeActions], analysis: aid));
            foreach (var (mid, m) in a.Modes)
            {
                var parts = new List<(string Part, string Id)>();
                if (Hit(m.On)) parts.Add(("on", m.On!));
                if (Hit(m.From)) parts.Add(("from", m.From!));
                if (Hit(m.To)) parts.Add(("to", m.To!));
                foreach (var (part, id) in parts) rows.Add(Row($"mode:{aid}:{mid}:{part}", "mode", id, [.. ModeActions], analysis: aid, mode: mid, part: part));
                if (parts.Count > 0) continue;
                foreach (var t in targets)
                {
                    if (t.Line is not { } l || m.From != l.From || m.To != l.To) continue;
                    if (remaining.Any(c => c.From == m.From && c.To == m.To)) continue;
                    rows.Add(Row($"mode:{aid}:{mid}:line", "mode", $"{l.From}>{l.To}", ["removeMode"], analysis: aid, mode: mid, part: "line"));
                    break;
                }
            }
        }

        foreach (var id in order)
            foreach (var child in Views.MemberIds(model, id))
                if (!objects.Contains(child)) rows.Add(Row($"child:{child}", "child", id, [.. ChildActions], child: child));

        for (var i = 0; i < model.Connections.Count; i++)
        {
            if (!Incident(i) || cut.Contains(i)) continue;
            var c = model.Connections[i];
            rows.Add(Row($"line:{i}", "line", Hit(c.From) ? c.From! : c.To!, [], line: new ConnectionInput(c.From ?? "", c.To ?? "", c.Label)));
        }
        foreach (var (aid, a) in model.Failures)
            foreach (var (mid, m) in a.Modes)
                if ((m.Affects ?? []).FirstOrDefault(objects.Contains) is { } affected) rows.Add(Row($"affects:{aid}:{mid}", "affects", affected, [], analysis: aid, mode: mid));

        // What needs a decision first, then what goes along; each in the order they were found.
        return [.. rows.Where(r => r.NeedsDecision), .. rows.Where(r => !r.NeedsDecision)];
    }

    /// <summary>A row in a few words for a refusal, in the words of the flow or analysis it sits in: "flow checkout, step 3".</summary>
    public static string Describe(Dependent row) => row.Kind switch
    {
        "step" or "stepState" => $"flow {row.Flow}, step {row.Step}",
        "view" => $"the view of flow {row.Flow}",
        "start" => $"where flow {row.Flow} starts",
        "mode" or "affects" => $"mode {row.Mode} of {row.Analysis}",
        "scope" => $"the scope of {row.Analysis}",
        "child" => $"{row.Child} inside it",
        _ => $"the line {row.Line!.From} → {row.Line.To}",
    };
}
