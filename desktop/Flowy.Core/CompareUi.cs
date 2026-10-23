namespace Flowy.Core;

/// <summary>
/// What the comparison view decides before it draws: which kinds the key lists, what a stop of the progress bar is marked as, where a note on a pair is saved and whether it can be.
/// A port of the pure functions in ui/src/compare.ts (keyItems, changeOfStop, noteOf, saveTarget, pairKey, unsaved, noteOff, pairOff, removeNeedsConfirm, paneLevel, paneInside and paneUp, and the flow form's flowTile,
/// partnerChoices, taggedBy and tagWith), so the app and the browser
/// say the same thing about the same pair. desktop/fixtures/compare.ts keeps the two equal. Nothing here draws.
/// </summary>
public static class CompareUi
{
    /// <summary>The level a pane draws: the one the reader zoomed it to, or its flow's own when it was not zoomed (or the level it was zoomed to has gone from the model).</summary>
    public static string PaneLevel(Model model, string flowView, string? zoomed) => zoomed is not null && Views.IsView(model, zoomed) ? zoomed : flowView;

    /// <summary>Whether a pane has a level to go up from: it is zoomed away from its flow's view and not yet at the top. At its flow's own view Esc closes the comparison instead.</summary>
    public static bool PaneInside(string level, string flowView) => level != flowView && level != Names.Root;

    /// <summary>The level one up from a pane's: the level above, which is the top at most.</summary>
    public static string PaneUp(Model model, string level) => level == Names.Root ? Names.Root : Views.ParentOf(model, level);

    /// <summary>What the key and the marks call each kind of change.</summary>
    public static string Name(Change change) => change switch { Change.New => "New", Change.Removed => "Removed", _ => "Changed" };

    /// <summary>The kinds in the order the key lists them.</summary>
    private static readonly Change[] Order = [Change.New, Change.Removed, Change.Changed];

    /// <summary>
    /// The kinds of change the key lists: those present on the sides on screen (<c>older</c> and <c>newer</c>: both side by side, the one on show in Swap), in a fixed order. Flows that share
    /// no shape have no marks and no key items, only <c>Related</c> false, for the key to say so; it is never "everything changed".
    /// </summary>
    public static (IReadOnlyList<Change> Items, bool Related) KeyItems(FlowDiff diff, IReadOnlyList<string> sides)
    {
        if (!diff.Related) return ([], false);
        var present = new HashSet<Change>();
        foreach (var side in sides.Select(which => which == "older" ? diff.Older : diff.Newer))
            foreach (var kind in side.Steps.Values.Concat(side.Shapes.Values).Concat(side.Lines.Values)) present.Add(kind);
        return (Order.Where(present.Contains).ToList(), true);
    }

    /// <summary>The mark of a stop's cell in the progress bar, from the file step numbers it plays: that of its steps when they agree, else Changed (parallel steps can hold a new one and an old one).</summary>
    public static Change? ChangeOfStop(IReadOnlyList<int> steps, IReadOnlyDictionary<int, Change> changes)
    {
        var kinds = steps.Where(changes.ContainsKey).Select(i => changes[i]).Distinct().ToList();
        return kinds.Count == 0 ? null : kinds.Count == 1 ? kinds[0] : Change.Changed;
    }

    /// <summary>
    /// The saved note of the pair <paramref name="a"/> and <paramref name="b"/>, whichever way round they are given, and which of them holds the line that has it (null when no tag joins them).
    /// When both tag each other, the line with a note is the one shown, the newer's first. A tag to some other flow is not this pair's. <paramref name="tags"/> holds each flow's raw <c>compare</c>
    /// value (see <see cref="CompareChoices.TagsOf"/>).
    /// </summary>
    public static (string Text, string? Holder) NoteOf(IReadOnlyDictionary<string, object?> tags, string a, string b)
    {
        if (a == b) return ("", null);
        var (older, newer) = CompareChoices.Order("flow", tags, a, b);
        var lines = new List<(string Id, string? Note)>();
        foreach (var (id, other) in new[] { (newer, older), (older, newer) })
            if (tags.TryGetValue(id, out var raw) && Compares.Of(raw) is { } tag && tag.With == other) lines.Add((id, tag.Note));
        if (lines.Count == 0) return ("", null);
        var line = lines.FirstOrDefault(l => l.Note is not null, lines[0]);
        return (line.Note ?? "", line.Id);
    }

    /// <summary>
    /// Where a note on the pair is saved and with what tag: on the line the pair has, else on the second of the pair (the newer, on the right), naming the first as the older. A pair with no line never
    /// takes a link away without saying: when the newer already links to some other flow and the older links to none, the line goes to the older instead; when both link elsewhere, the newer is the target
    /// and <c>Replaces</c> is the id its old link named, for the confirm to say. The note is trimmed; blank is no note, which writes the short form.
    /// </summary>
    public static (string Id, CompareTag Tag, string? Replaces) SaveTarget(IReadOnlyDictionary<string, object?> tags, string a, string b, string note = "")
    {
        var (older, newer) = CompareChoices.Order("flow", tags, a, b);
        var held = NoteOf(tags, a, b).Holder;
        string? Linked(string id) => tags.TryGetValue(id, out var raw) ? Compares.Of(raw)?.With : null;
        var id = held ?? (Linked(newer) is not null && Linked(older) is null ? older : newer);
        var text = JsCompat.JsTrim(note);
        var tag = new CompareTag(id == newer ? older : newer, text == "" ? null : text);
        return (id, tag, held is null ? Linked(id) : null);
    }

    /// <summary>One key for the pair whichever way round it is given: the draft note and the confirm belong to the pair, not to a side.</summary>
    public static string PairKey(string a, string b) => string.CompareOrdinal(a, b) <= 0 ? $"{a}|{b}" : $"{b}|{a}";

    /// <summary>Why a note can't be written, or null when it can: the folder has to be one that saves. The reason is the tooltip of the greyed control.</summary>
    public static string? NoteOff(bool live, bool readOnly) => live && !readOnly ? null : "This page can't save";

    /// <summary>Why a pair can't be saved as one (a pair needs two), or null. <paramref name="kind"/> is <c>flow</c> or <c>run</c>.</summary>
    public static string? PairOff(string kind, string a, string b) => a == b ? $"Needs two different {kind}s" : null;

    /// <summary>Whether the text in the note editor would be lost by leaving: it is not what the pair holds, and it is not just blank where nothing is held.</summary>
    public static bool Unsaved(string? draft, string saved) => draft is not null && JsCompat.JsTrim(draft) != JsCompat.JsTrim(saved);

    /// <summary>Whether taking a tag out loses something the reader wrote: a note belongs to its link, so removing the link asks first. With no note, removing is one click.</summary>
    public static bool RemoveNeedsConfirm(CompareTag? tag) => tag?.Note is not null;

    // ---- the flow form's Compare with --------------------------------------------------------------------------------

    /// <summary>The tile of a flow that is there.</summary>
    public static FlowTile FlowTile(Model model, string id) =>
        new(id, model.Flows[id].Name is { Length: > 0 } name ? name : id, Views.NameOf(model, model.Flows[id].View ?? Names.Root));

    // Name, lower-cased, then id, each ordinal: the same order as byLowerName in ui/src/compare.ts (UTF-16 code units, no locale collation).
    private static int ByTileName(FlowTile x, FlowTile y)
    {
        var byName = string.CompareOrdinal(x.Name.ToLowerInvariant(), y.Name.ToLowerInvariant());
        return byName != 0 ? byName : string.CompareOrdinal(x.Id, y.Id);
    }

    /// <summary>What the edit form's Compare with offers for flow <paramref name="flowId"/>: every other flow, by name. The flow itself is never offered, since a flow can't compare with itself.</summary>
    public static IReadOnlyList<FlowTile> PartnerChoices(Model model, string flowId)
    {
        var tiles = model.Flows.Keys.Where(id => id != flowId).Select(id => FlowTile(model, id)).ToList();
        tiles.Sort(ByTileName);
        return tiles;
    }

    /// <summary>The flows that tag flow <paramref name="flowId"/> (its newer partners), by name. A flow that tags it and is tagged by it back is the form's own partner, so it is not listed again.</summary>
    public static IReadOnlyList<FlowTile> TaggedBy(Model model, string flowId)
    {
        var tiles = Compares.Partners(CompareChoices.TagsOf(model, new Dictionary<string, LoadRun>(), "flow"), flowId)
            .Where(p => p.Side == "after" && model.Flows.Contains(p.Id)).Select(p => FlowTile(model, p.Id)).ToList();
        tiles.Sort(ByTileName);
        return tiles;
    }

    /// <summary>The tag flow <paramref name="flowId"/> gets when <paramref name="partner"/> is picked, keeping the note it had; no partner is no tag.</summary>
    public static CompareTag? TagWith(Model model, string flowId, string? partner) =>
        TagKeepingNote(model.Flows.TryGetValue(flowId, out var flow) ? flow.CompareRaw : null, partner);

    /// <summary>The same, from the <c>compare</c> value a flow holds now (the form's edit reads it from the document it is changing, not from the model it drew).</summary>
    public static CompareTag? TagKeepingNote(object? current, string? partner) =>
        partner is null ? null : new CompareTag(partner, Compares.Of(current)?.Note);
}

/// <summary>One flow the edit form can show as a tile: its id, its name (the id when it has none) and the name of the view it plays in.</summary>
public sealed record FlowTile(string Id, string Name, string View);
