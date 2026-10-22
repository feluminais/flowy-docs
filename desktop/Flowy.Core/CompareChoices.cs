namespace Flowy.Core;

/// <summary>One thing the Compare picker offers: the flow or run, which side of a tagged pair it stands on (null for a flow nothing links), and whether a tag points at something that is not there.</summary>
public sealed record CompareChoice(string Id, string Name, string? Side, bool Missing);

/// <summary>
/// What a flow (or run) can be compared with, and in which order a pair reads: a port of <c>choicesFor</c> and <c>orderPair</c> in ui/src/compare.ts, so the picker lists the
/// same things in the same order in both readers. Nothing here draws.
/// </summary>
public static class CompareChoices
{
    /// <summary>
    /// What <paramref name="id"/> can be compared with: <c>Linked</c> are the ones it tags (the older) and then the ones that tag it (the newer), the order <see cref="Compares.Partners"/> gives; a tag to something that
    /// is not there stays, marked <see cref="CompareChoice.Missing"/> and named by its id. <c>Others</c> is every other flow (or run), by name without regard to case, then by id. <paramref name="id"/> is never listed.
    /// <paramref name="kind"/> is <c>flow</c> or <c>run</c>.
    /// </summary>
    public static (IReadOnlyList<CompareChoice> Linked, IReadOnlyList<CompareChoice> Others) For(Model model, IReadOnlyDictionary<string, LoadRun> runs, string kind, string id)
    {
        var tags = TagsOf(model, runs, kind);
        string NameOf(string key) =>
            kind == "flow" ? (model.Flows.TryGetValue(key, out var flow) && !string.IsNullOrEmpty(flow.Name) ? flow.Name : key)
            : runs.TryGetValue(key, out var run) && !string.IsNullOrEmpty(run.Name) ? run.Name : key;
        var linked = Compares.Partners(tags, id)
            .Select(p => tags.ContainsKey(p.Id) ? new CompareChoice(p.Id, NameOf(p.Id), p.Side, false) : new CompareChoice(p.Id, p.Id, p.Side, true))
            .ToList();
        var taken = new HashSet<string>(linked.Select(c => c.Id)) { id };
        var others = tags.Keys.Where(key => !taken.Contains(key)).Select(key => new CompareChoice(key, NameOf(key), null, false)).ToList();
        others.Sort(ByName);
        return (linked, others);
    }

    /// <summary>
    /// The pair in the order it reads: the one that holds the tag (the newer) second. With no tag between them, the order given. <paramref name="tags"/> holds each item's raw <c>compare</c> value
    /// (see <see cref="TagsOf"/>). <paramref name="kind"/> is only kept so a flow and a run read the same way at the call.
    /// </summary>
    public static (string Older, string Newer) Order(string kind, IReadOnlyDictionary<string, object?> tags, string a, string b)
    {
        _ = kind;
        return a != b && tags.TryGetValue(a, out var raw) && Compares.Of(raw)?.With == b ? (b, a) : (a, b);
    }

    /// <summary>A flow the player can play: it has steps and its view opens. Opening a comparison needs both flows to be one.</summary>
    public static bool Playable(Model model, string id) => model.Flows.TryGetValue(id, out var flow) && flow.Steps.Count > 0 && Views.IsView(model, flow.View);

    /// <summary>Why Compare is blocked, or null when it is not: the reason goes in the button's tooltip.</summary>
    public static string? Off(Model model, bool editing) => editing ? "Not while editing" : model.Flows.Count < 2 ? "No other flow" : null;

    /// <summary>The first flow <paramref name="id"/> is linked to that is there, or null: what C opens beside the flow playing.</summary>
    public static string? FirstLinked(Model model, string id) => For(model, new Dictionary<string, LoadRun>(), "flow", id).Linked.FirstOrDefault(c => !c.Missing)?.Id;

    /// <summary>Each flow's (or run's) raw <c>compare</c> value by id, in the order of the files: what <see cref="Compares.Partners"/> and <see cref="Order"/> read.</summary>
    public static IReadOnlyDictionary<string, object?> TagsOf(Model model, IReadOnlyDictionary<string, LoadRun> runs, string kind)
    {
        if (kind != "flow") return RunTags(runs);
        var tags = new OrderedDictionary<string, object?>();
        foreach (var (id, flow) in model.Flows) tags.Add(id, flow.CompareRaw);
        return tags;
    }

    /// <summary>Each run's raw <c>compare</c> value by id, in the order of the files.</summary>
    public static IReadOnlyDictionary<string, object?> RunTags(IReadOnlyDictionary<string, LoadRun> runs)
    {
        var tags = new OrderedDictionary<string, object?>();
        foreach (var (id, run) in runs) tags.Add(id, run.Compare is { Note: { } note } tag ? (object?)new Dictionary<string, object?> { ["with"] = tag.With, ["note"] = note } : run.Compare?.With);
        return tags;
    }

    // ---- runs ----------------------------------------------------------------------------------------------------

    /// <summary>Why the Performance panel's Compare is blocked, or null: it needs a second run, and not while editing. A port of <c>runCompareOff</c>.</summary>
    public static string? RunOff(IReadOnlyDictionary<string, LoadRun> runs, bool editing) => editing ? "Not while editing" : runs.Count < 2 ? "No other run" : null;

    /// <summary>The first run <paramref name="id"/> is linked to that is there, or null: what C opens beside the run the Performance panel shows. A port of <c>firstLinkedRun</c>.</summary>
    public static string? FirstLinkedRun(IReadOnlyDictionary<string, LoadRun> runs, string id) =>
        For(new Model(), runs, "run", id).Linked.FirstOrDefault(c => !c.Missing)?.Id;

    /// <summary>The runs that are linked to another run that is there, either way round: the Performance panel's run picker marks them. A port of <c>linkedRuns</c>.</summary>
    public static IReadOnlySet<string> LinkedRuns(IReadOnlyDictionary<string, LoadRun> runs) => Compares.Linked(RunTags(runs));

    /// <summary>A run the comparison can open: it is there. (A run needs no steps to be played: it is drawn at any place along it.) A port of <c>openable</c>.</summary>
    public static bool Openable(IReadOnlyDictionary<string, LoadRun> runs, string id) => runs.ContainsKey(id);

    /// <summary>The comparison of run <paramref name="id"/> with the pick <paramref name="other"/>: the one that holds the tag (the newer) second, else <paramref name="id"/> first. A port of <c>runPairOf</c>.</summary>
    public static (string A, string B) RunPairOf(IReadOnlyDictionary<string, LoadRun> runs, string id, string other)
    {
        var (older, newer) = Order("run", RunTags(runs), id, other);
        return (older, newer);
    }

    /// <summary>
    /// Why the comparison an address names (<paramref name="kind"/> <c>flow</c> or <c>run</c>, <paramref name="a"/> and <paramref name="b"/>) can't open, or null when it can: a flow that is not there or
    /// can't play, or a run that is not there. A port of <c>fromAddress</c>; a launch option that names a comparison says it the same way.
    /// </summary>
    public static string? FromAddress(Model model, IReadOnlyDictionary<string, LoadRun> runs, string kind, string a, string b) =>
        kind == "run"
            ? Openable(runs, a) && Openable(runs, b) ? null : "That run can't open."
            : Playable(model, a) && Playable(model, b) ? null : "That flow can't play yet.";

    // Name, lower-cased, then id, each ordinal: the same order as byLowerName in ui/src/compare.ts (UTF-16 code units, no locale collation).
    private static int ByName(CompareChoice x, CompareChoice y)
    {
        var byName = string.CompareOrdinal(x.Name.ToLowerInvariant(), y.Name.ToLowerInvariant());
        return byName != 0 ? byName : string.CompareOrdinal(x.Id, y.Id);
    }
}
