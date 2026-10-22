namespace Flowy.Core;

/// <summary>What is chosen for one row of <see cref="Dependents"/>: the action, and where to when it points at a shape (reroute, repoint, change view, move out).</summary>
public sealed record Choice(string Action, string? To = null);

/// <summary>
/// What deleting some targets comes to, given the choices so far. <c>Targets</c> include the shapes inside them that were chosen to go too. <c>Asks</c> are the rows that
/// need a decision (leaving out those of a flow that is going), <c>Open</c> the asks with no usable choice yet, <c>Along</c> what goes along and needs no choice,
/// and <c>Flows</c> the flows that are going.
/// </summary>
public sealed record UsedByPlan(IReadOnlyList<Target> Targets, IReadOnlyList<Dependent> Rows, IReadOnlyList<Dependent> Asks, IReadOnlyList<Dependent> Open, IReadOnlyList<Dependent> Along, IReadOnlySet<string> Flows);

/// <summary>What a row says: the flow or analysis it sits in, where in it, and the shapes it names (to outline on the canvas).</summary>
public sealed record RowText(string Title, string Where, IReadOnlyList<string> Shapes);

/// <summary>
/// The Used by panel's logic, with no UI in it: what is waiting on the shapes and lines about to be deleted, what the reader has chosen for each, what is still
/// open, and how to say what was done. The twin of ui/src/usedby.ts, word for word.
/// </summary>
public static class UsedBy
{
    /// <summary>What each action is called on a row.</summary>
    public static string Label(string action) => action switch
    {
        "removeStep" => "Remove step",
        "reroute" => "Reroute to…",
        "deleteFlow" => "Delete flow",
        "changeView" => "Change view",
        "removeMode" => "Remove mode",
        "repoint" => "Repoint to…",
        "changeScope" => "Change scope",
        "moveOut" => "Move out",
        "deleteWith" => "Delete too",
        _ => action,
    };

    /// <summary>Actions that name a shape to go to, and so are not settled until one is picked.</summary>
    public static bool NeedsShape(string action) => action is "reroute" or "repoint";

    /// <summary>Actions that name a place: a view, a scope or a home. They default to the top level.</summary>
    public static bool NeedsPlace(string action) => action is "changeView" or "changeScope" or "moveOut";

    /// <summary>The action "remove everything" takes for a row: the flow itself when the row's steps are all of it.</summary>
    public static Choice DefaultChoice(Dependent row) => row.Kind switch
    {
        "step" => new Choice(row.EmptiesFlow ? "deleteFlow" : "removeStep"),
        "view" => new Choice("deleteFlow"),
        "mode" => new Choice("removeMode"),
        "scope" => new Choice("changeScope"),
        "child" => new Choice("deleteWith"),
        _ => throw new InvalidOperationException($"a {row.Kind} row goes with the shape and has no choice"),
    };

    /// <summary>Whether a choice settles a row: it is one of the row's actions, and has its shape when it needs one.</summary>
    public static bool Settles(Dependent row, Choice? choice) =>
        choice is not null && row.Actions.Contains(choice.Action) && (!NeedsShape(choice.Action) || !string.IsNullOrEmpty(choice.To));

    /// <summary>What deleting these targets comes to, given the choices so far.</summary>
    public static UsedByPlan PlanOf(Model model, IReadOnlyList<Target> targets, IReadOnlyDictionary<string, Choice> choices)
    {
        var all = targets.ToList();
        var rows = Dependents.Of(model, all);
        while (true)
        {
            var more = rows.Where(r => r.Kind == "child" && choices.TryGetValue(r.Key, out var c) && c.Action == "deleteWith").Select(r => r.Child!).ToList();
            if (more.Count == 0) break;
            all.AddRange(more.Select(o => new Target(Object: o)));
            rows = Dependents.Of(model, all);
        }
        var flows = rows.Where(r => choices.TryGetValue(r.Key, out var c) && c.Action == "deleteFlow" && r.Flow is not null && r.Actions.Contains("deleteFlow")).Select(r => r.Flow!).ToHashSet();
        var asks = rows.Where(r => r.NeedsDecision && (r.Flow is null || !flows.Contains(r.Flow))).ToList();
        var open = asks.Where(r => !Settles(r, choices.GetValueOrDefault(r.Key))).ToList();
        return new UsedByPlan(all, rows, asks, open, rows.Where(r => !r.NeedsDecision).ToList(), flows);
    }

    /// <summary>The choices with every open row settled the way removing it does, over and over, as shapes chosen to go too bring rows of their own.</summary>
    public static Dictionary<string, Choice> RemoveAll(Model model, IReadOnlyList<Target> targets, IReadOnlyDictionary<string, Choice> choices)
    {
        var next = new Dictionary<string, Choice>(choices);
        while (true)
        {
            var open = PlanOf(model, targets, next).Open;
            if (open.Count == 0) return next;
            foreach (var row in open) next[row.Key] = DefaultChoice(row);
        }
    }

    /// <summary>The choices with every step and every mode part that can move to <paramref name="to"/> doing so. Rows that can't (a view, a shape inside, a line) are left as they were.</summary>
    public static Dictionary<string, Choice> RerouteAll(Model model, IReadOnlyList<Target> targets, IReadOnlyDictionary<string, Choice> choices, string to)
    {
        var next = new Dictionary<string, Choice>(choices);
        foreach (var row in PlanOf(model, targets, next).Asks)
        {
            if (row.Kind == "step") next[row.Key] = new Choice("reroute", to);
            else if (row.Kind == "mode" && row.Part != "line") next[row.Key] = new Choice("repoint", to);
        }
        return next;
    }

    /// <summary>What DeleteWith is told: a resolution for each row that is asking, one for each flow that is going, and one for the shapes chosen to go too.</summary>
    public static List<Resolution> ResolutionsOf(UsedByPlan plan, IReadOnlyDictionary<string, Choice> choices)
    {
        var going = plan.Targets.Where(t => t.Object is not null).Select(t => t.Object!).ToList();
        // A flow that is going is told by one of its rows; its other rows say nothing.
        var flowRows = plan.Flows.SelectMany(f => plan.Rows.Where(r => r.Flow == f && choices.TryGetValue(r.Key, out var c) && c.Action == "deleteFlow").Take(1).Select(r => r.Key));
        var keys = plan.Asks.Select(r => r.Key).Concat(flowRows).Concat(going.Select(id => $"child:{id}")).ToHashSet();
        return choices.Where(kv => keys.Contains(kv.Key) && (!kv.Key.StartsWith("child:", StringComparison.Ordinal) || kv.Value.Action == "deleteWith"))
            .Select(kv => new Resolution(kv.Key, kv.Value.Action, kv.Value.To)).ToList();
    }

    /// <summary>The shapes a row can be sent to: any that is not going, in the model's order.</summary>
    public static List<string> ShapesLeft(Model model, UsedByPlan plan)
    {
        var going = plan.Targets.Where(t => t.Object is not null).Select(t => t.Object!).ToHashSet();
        return model.Objects.Keys.Where(id => !going.Contains(id) && model.GetObject(id) is not null).ToList();
    }

    private static string NameOf(Model model, string id) => model.GetObject(id) is { Name: { Length: > 0 } name } ? name : id;

    /// <summary>What a row says: the flow or analysis it sits in, where in it, and the shapes it names.</summary>
    public static RowText TextOf(Model model, Dependent row)
    {
        var flow = row.Flow is not null && model.Flows.TryGetValue(row.Flow, out var f) ? f : null;
        var analysis = row.Analysis is not null && model.Failures.TryGetValue(row.Analysis, out var a) ? a : null;
        switch (row.Kind)
        {
            case "step":
            {
                var step = flow is not null && row.Step is { } n && n >= 1 && n <= flow.Steps.Count ? flow.Steps[n - 1] : null;
                var ends = new[] { step?.From, step?.To }.OfType<string>().ToList();
                return new RowText(flow?.Name ?? row.Flow ?? "", $"Step {row.Step}: {string.Join(" → ", ends.Select(id => NameOf(model, id)))}", ends);
            }
            case "view": return new RowText(flow?.Name ?? row.Flow ?? "", "View", []);
            case "mode":
            {
                FailureMode? mode = null;
                if (analysis is not null && row.Mode is not null) analysis.Modes.TryGetValue(row.Mode, out mode);
                var part = row.Part switch { "line" => "Line", "on" => "On", "from" => "From", _ => "To" };
                string?[] shapes = row.Part == "line" ? [mode?.From, mode?.To] : [row.Part == "on" ? mode?.On : row.Part == "from" ? mode?.From : mode?.To];
                var said = string.IsNullOrEmpty(mode?.Mode) ? row.Mode : mode.Mode;
                return new RowText(analysis?.Name ?? row.Analysis ?? "", $"{said}: {part}", shapes.OfType<string>().ToList());
            }
            case "scope": return new RowText(analysis?.Name ?? row.Analysis ?? "", "Scope", []);
            case "child": return new RowText(NameOf(model, row.Child!), "Inside it", [row.Child!]);
            default: return new RowText(row.Of, "", []);
        }
    }

    private static string Count(int n, string one, string? many = null) => $"{n} {(n == 1 ? one : many ?? one + "s")}";

    /// <summary>What went along with the targets, in a few words: "2 lines, 1 state". Empty when nothing did.</summary>
    public static string AlongText(IReadOnlyList<Dependent> along)
    {
        int N(params string[] kinds) => along.Count(r => kinds.Contains(r.Kind));
        var parts = new List<string>();
        if (N("line") > 0) parts.Add(Count(N("line"), "line"));
        if (N("start", "stepState") > 0) parts.Add(Count(N("start", "stepState"), "state"));
        if (N("affects") > 0) parts.Add(Count(N("affects"), "affected shape"));
        return string.Join(", ", parts);
    }

    /// <summary>The notice after a delete: what went, what was done about what depended on it, and what went along.</summary>
    public static string DoneText(Model model, UsedByPlan plan, IReadOnlyDictionary<string, Choice> choices, IReadOnlyList<Target> targets)
    {
        var shapes = targets.Where(t => t.Object is not null).Select(t => t.Object!).ToList();
        var what = shapes.Count == 1 ? NameOf(model, shapes[0]) : shapes.Count > 1 ? $"{shapes.Count} shapes" : "the line";
        int By(string action) => plan.Asks.Count(r => choices.TryGetValue(r.Key, out var c) && c.Action == action);
        var parts = new List<string>();
        if (By("removeStep") > 0) parts.Add($"{Count(By("removeStep"), "step")} removed");
        if (By("reroute") > 0) parts.Add($"{Count(By("reroute"), "step")} rerouted");
        if (plan.Flows.Count > 0) parts.Add($"{Count(plan.Flows.Count, "flow")} deleted");
        if (By("removeMode") > 0) parts.Add($"{Count(By("removeMode"), "mode")} removed");
        if (By("repoint") > 0) parts.Add($"{Count(By("repoint"), "mode")} repointed");
        if (By("changeView") > 0) parts.Add($"{Count(By("changeView"), "flow")} moved");
        if (By("moveOut") > 0) parts.Add($"{Count(By("moveOut"), "shape")} moved out");
        var along = AlongText(plan.Along);
        var sentences = new List<string> { $"Deleted {what}." };
        if (parts.Count > 0)
        {
            var joined = string.Join(", ", parts) + ".";
            sentences.Add(char.ToUpperInvariant(joined[0]) + joined[1..]);
        }
        if (along != "") sentences.Add($"Went with it: {along}.");
        return string.Join(" ", sentences);
    }
}
