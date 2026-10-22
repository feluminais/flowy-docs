namespace Flowy.Core;

/// <summary>One thing the Compare picker offers: the flow or run, which side of a tagged pair it stands on (null for a flow nothing links), and whether a tag points at something that is not there.</summary>
public sealed record Choice(string Id, string Name, string? Side, bool Missing);

/// <summary>
/// What a flow (or run) can be compared with, and in which order a pair reads: a port of <c>choicesFor</c> and <c>orderPair</c> in ui/src/compare.ts, so the picker lists the
/// same things in the same order in both readers. Nothing here draws.
/// </summary>
public static class CompareChoices
{
    /// <summary>
    /// What <paramref name="id"/> can be compared with: <c>Linked</c> are the ones it tags (the older) and then the ones that tag it (the newer), the order <see cref="Compares.Partners"/> gives; a tag to something that
    /// is not there stays, marked <see cref="Choice.Missing"/> and named by its id. <c>Others</c> is every other flow (or run), by name without regard to case, then by id. <paramref name="id"/> is never listed.
    /// <paramref name="kind"/> is <c>flow</c> or <c>run</c>.
    /// </summary>
    public static (IReadOnlyList<Choice> Linked, IReadOnlyList<Choice> Others) For(Model model, IReadOnlyDictionary<string, LoadRun> runs, string kind, string id)
    {
        var tags = TagsOf(model, runs, kind);
        string NameOf(string key) =>
            kind == "flow" ? (model.Flows.TryGetValue(key, out var flow) && !string.IsNullOrEmpty(flow.Name) ? flow.Name : key)
            : runs.TryGetValue(key, out var run) && !string.IsNullOrEmpty(run.Name) ? run.Name : key;
        var linked = Compares.Partners(tags, id)
            .Select(p => tags.ContainsKey(p.Id) ? new Choice(p.Id, NameOf(p.Id), p.Side, false) : new Choice(p.Id, p.Id, p.Side, true))
            .ToList();
        var taken = new HashSet<string>(linked.Select(c => c.Id)) { id };
        var others = tags.Keys.Where(key => !taken.Contains(key)).Select(key => new Choice(key, NameOf(key), null, false)).ToList();
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
        var tags = new OrderedDictionary<string, object?>();
        if (kind == "flow")
            foreach (var (id, flow) in model.Flows) tags.Add(id, flow.CompareRaw);
        else
            foreach (var (id, run) in runs) tags.Add(id, run.Compare is { Note: { } note } tag ? (object?)new Dictionary<string, object?> { ["with"] = tag.With, ["note"] = note } : run.Compare?.With);
        return tags;
    }

    // Name, lower-cased, then id: the ordinal compare of lower-case text matches localeCompare for the ids and names a project holds.
    private static int ByName(Choice x, Choice y)
    {
        var byName = string.CompareOrdinal(x.Name.ToLowerInvariant(), y.Name.ToLowerInvariant());
        return byName != 0 ? byName : string.CompareOrdinal(x.Id, y.Id);
    }
}
