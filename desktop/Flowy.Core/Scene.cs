namespace Flowy.Core;

/// <summary>
/// A flow on the canvas: where each step lands in the view (null if it can't be shown), and the step to light up. Without a step or steps nothing is
/// lit or dimmed. <c>Steps</c> lights several at once (a parallel stop); <c>Faint</c> draws steps as dashed, faint lanes (the lanes of a branch this stop
/// is not in) without lighting their boxes. <c>Strands</c>, where a project draws a line for each connection, is the line each step rides (the id of its strand,
/// see <see cref="Strands.StrandOf"/>; null for a step that rides none); without it a step rides the first line that runs its way.
/// </summary>
public sealed record Playing(IReadOnlyList<(string From, string To)?> Ends, int? Step = null, IReadOnlyList<int>? Steps = null, IReadOnlyList<int>? Faint = null, IReadOnlyList<string>? Also = null, IReadOnlyList<string?>? Strands = null);

/// <summary>
/// What the reader is pointing at: the selected box, the selected line (the id of a line, or of a pair: all its lines are selected), the line the pointer is on (on the canvas, or in a box's
/// panel; the id of a line or of a pair), and the line keyboard focus is on, so its pair spreads.
/// </summary>
public sealed record Focus(string? Box = null, string? Line = null, string? Hover = null, string? Focused = null);

public enum BoxMode { Normal, Lit, Dim }

public sealed record SceneBox(string Id, FlowyObject Object, Rect Rect, int Inside, bool Outsider, BoxMode Mode, bool Problem)
{
    /// <summary>The path data of the icon the box shows (the model's own icons are part of the model, so the box can't look them up alone).</summary>
    public string Icon { get; init; } = "";
}

[Flags]
public enum EdgeFlags
{
    None = 0,
    Active = 1, // the line of the step playing
    Dim = 2, // a line of a flow that isn't the step playing
    Step = 4, // a step with no line of its own gets a dashed one
    Problem = 8,
    Faint = 16, // another box is selected and this line doesn't touch it
    Hover = 32,
    Lane = 64, // a lane of a branch this stop is not in: dashed and faint, not lit
}

/// <summary>
/// <c>Label</c> is null unless the line should show it now. <c>Both</c>: connections run both ways, so it has an arrowhead at each end. <c>Look</c> is how the line is
/// drawn when it is not the plain line (the pattern and the marks of the kind its connections share, see <see cref="Kinds.MergedLook"/>), else null; a step's line has none.
/// Where a project draws a line for each connection, <c>Id</c> is the line's own (what hit tests and animation read) and <c>Pair</c> the id of the pair's one merged line, which everything
/// about a pair (traffic, failure marks, a compared flow) keeps using; <c>Slot</c> is the line's place among its pair's lanes and <c>Lanes</c> how many there are; <c>Spread</c> is set while
/// the pair is spread so every label fits. All four are null (<c>Lanes</c> 1, <c>Spread</c> false) for a line that stands for its whole pair.
/// </summary>
public sealed record SceneEdge(string Id, string From, string To, string? Label, EdgeFlags Flags, bool Selected, bool Both = false, LineLook? Look = null)
{
    public string? Pair { get; init; }

    public LaneSlot? Slot { get; init; }

    public int Lanes { get; init; } = 1;

    public bool Spread { get; init; }

    /// <summary>The id of the pair's one merged line: the line's own id except where the project draws a line for each connection.</summary>
    public string PairId => Pair ?? Id;
}

/// <summary>Everything the canvas draws for one view: boxes with places, lines, and the frame around the members when you are inside a box.</summary>
public sealed record Scene(string View, string FrameName, IReadOnlyList<SceneBox> Boxes, IReadOnlyList<SceneEdge> Edges, Rect? Frame, IReadOnlyList<string> Members);

/// <summary>What toGraph and focusEdges in ui/src/graph.ts make for the canvas. Places come from <see cref="Layout"/> instead of dagre.</summary>
public static class SceneBuilder
{
    /// <summary>Whether a line is one a flow step added (it has no connection of its own: "step", "step-N", "lane-N"), so a click on it opens no panel. The same test as isStepLine in ui/src/graph.ts.</summary>
    public static bool IsStepLine(string id)
    {
        var dash = id.IndexOf('-');
        var head = dash < 0 ? id : id[..dash];
        return head is "step" or "lane" && (dash < 0 || (dash + 1 < id.Length && id[(dash + 1)..].All(c => c is >= '0' and <= '9')));
    }

    private const double Gap = 30;

    /// <summary>A line before the focus has been put on it: what the model and the flow make of it.</summary>
    private sealed record Drawn(string Id, string From, string To, string? Label, EdgeFlags Flags, bool Both, LineLook? Look, string? Pair = null, LaneSlot? Slot = null, int Lanes = 1)
    {
        public string PairId => Pair ?? Id;
    }

    /// <summary>
    /// The pair a line belongs to: the id of the pair's one merged line, which is the line's own id except where a project draws a line for each connection (<see cref="SceneEdge.Pair"/>).
    /// Everything about a pair (the widths of traffic, the failure marks, the halo of a compared flow) is kept by it. A port of pairOf in ui/src/graph.ts.
    /// </summary>
    public static string PairOf(SceneEdge e) => e.PairId;

    /// <summary>
    /// What a screen reader says for a line of a pair that has several ("2 of 5, from Management to UI, Scan results, Request and reply"): its place among them, the way it runs, its label and its kind.
    /// A line alone between its two shapes is named as <see cref="LineName"/> names it. A port of strandName in ui/src/graph.ts.
    /// </summary>
    public static string StrandName(Model model, Strand s)
    {
        if (s.Lanes < 2) return LineName(model, s.From, s.To, s.Label, false, s.Kind);
        return $"{s.Lane + 1} of {s.Lanes}, from {Views.NameOf(model, s.From)} to {Views.NameOf(model, s.To)}{(s.Label != "" ? $", {s.Label}" : "")}{(s.Kind is null ? "" : $", {Kinds.NameOf(s.Kind)}")}";
    }

    /// <summary>What a screen reader says for a line: "A to B" ("A and B" when it runs both ways), then its label and its kind when it has them. A port of lineName in ui/src/graph.ts.</summary>
    public static string LineName(Model model, string from, string to, string? label = null, bool both = false, string? kind = null) =>
        $"{Views.NameOf(model, from)} {(both ? "and" : "to")} {Views.NameOf(model, to)}{(string.IsNullOrEmpty(label) ? "" : $", {label}")}{(kind is null ? "" : $", {Kinds.NameOf(kind)}")}";

    public static string LineId(string from, string to) => Views.LineKey(from, to);

    private static bool Overlaps(Pt a, Pt b) => Math.Abs(a.X - b.X) < BoxGeometry.BoxWidth && Math.Abs(a.Y - b.Y) < BoxGeometry.BoxHeight;

    // toGraph runs again on every flow step and selection change, so placements are kept by what they're made from.
    private static readonly BoundedCache<string, OrderedDictionary<string, Pt>> Placements = new(50);

    public static OrderedDictionary<string, Pt> PlaceCached(List<string> members, List<string> around, IReadOnlyList<Edge> edges, IReadOnlyDictionary<string, Region>? fixedSides = null)
    {
        fixedSides ??= new Dictionary<string, Region>();
        var key = $"{string.Join('\u0001', members)}\u0002{string.Join('\u0001', around)}\u0002{string.Join('\u0001', edges.Select(e => e.From + "\u0003" + e.To))}\u0002{string.Join('\u0001', fixedSides.Select(f => f.Key + "\u0003" + f.Value))}";
        return Placements.GetOrAdd(key, _ => Layout.Place(members, around, edges, fixedSides));
    }

    /// <summary>
    /// Where each box of a view is drawn: where layout.yaml has it, else where <see cref="Layout.Place"/> puts it, moved down past any saved box it
    /// would cover. <paramref name="boxes"/> are the view's members and outsiders, and any box only a flow brings in.
    /// </summary>
    public static OrderedDictionary<string, Pt> SpotsOf(Model model, string view, View computed, IReadOnlyList<string> boxes)
    {
        var saved = model.Layout.TryGetValue(view, out var s2) ? s2 : new Dictionary<string, LayoutPoint>();
        var at = new OrderedDictionary<string, Pt>();
        foreach (var id in boxes)
            if (saved.TryGetValue(id, out var p)) at[id] = new Pt(p.X, p.Y);
        if (at.Count == boxes.Count) return at; // every box has its place: the layout is the slow part and would be thrown away
        var members = computed.Members.ToList();
        var isMember = members.ToHashSet();
        var placed = PlaceCached(members, boxes.Where(id => !isMember.Contains(id)).ToList(), computed.Edges);
        var taken = at.Values.ToList();
        foreach (var id in boxes)
        {
            if (at.ContainsKey(id)) continue;
            var p = placed[id];
            while (taken.Any(q => Overlaps(p, q))) p = p with { Y = p.Y + BoxGeometry.BoxHeight + Gap };
            at[id] = p;
            taken.Add(p);
        }
        return at;
    }

    /// <summary>Where the members and outsiders of a view are drawn now.</summary>
    public static OrderedDictionary<string, Pt> ViewSpots(Model model, string view)
    {
        var v = Views.Compute(model, view);
        return SpotsOf(model, view, v, [.. v.Members, .. v.Outsiders]);
    }

    /// <summary>
    /// Lays out a view ahead of time and throws the scene away. What is kept is the placement cache, so the next <see cref="Build"/> of this view
    /// (with no flow playing) doesn't wait for the layout. Safe to call from another thread.
    /// </summary>
    public static void Prewarm(Model model, string view) => Build(model, view);

    /// <summary>
    /// The boxes and lines of one view. A box keeps its layout.yaml place; the rest are placed by <see cref="Layout.Place"/>, moved down past
    /// any saved box they would cover. While a flow plays, the current step's two boxes and its line stay lit and everything else is dimmed.
    /// Boxes only the flow uses join for the whole flow, as outsiders, so nothing moves between steps. A line shows its label only when the
    /// reader points at it or selects it, on the lines of the selected box, and on the line a flow has lit.
    /// </summary>
    public static Scene Build(Model model, string view, Playing? playing = null, IReadOnlyList<Problem>? problems = null, Focus? focus = null)
    {
        problems ??= [];
        focus ??= new Focus();
        var computed = Views.Compute(model, view);
        var members = computed.Members.ToList();
        var isMember = members.ToHashSet();
        var flowBoxes = (playing?.Ends ?? []).SelectMany(e => e is { } p ? new[] { p.From, p.To } : []);
        var boxes = members.Concat(computed.Outsiders).Concat(flowBoxes).Distinct().ToList();
        IReadOnlyList<int>? stepsLit = playing?.Steps ?? (playing?.Step is { } one ? [one] : null);
        var dimming = stepsLit is not null;
        (string From, string To)? PlacedAt(int i) => playing is not null && i >= 0 && i < playing.Ends.Count ? playing.Ends[i] : null;
        var litSteps = (stepsLit ?? []).Where(i => PlacedAt(i) is not null).ToList();
        var litEnds = litSteps.Select(i => PlacedAt(i)!.Value).ToList();
        var litBoxes = litEnds.SelectMany(e => new[] { e.From, e.To }).Concat(playing?.Also ?? []).ToHashSet(); // Also: a shape that takes a request off a line is lit with the step
        var faintSteps = (playing?.Faint ?? []).Select(i => (I: i, E: PlacedAt(i))).Where(f => f.E is not null).Select(f => (f.I, E: f.E!.Value)).ToList();
        var at = SpotsOf(model, view, computed, boxes);

        var badBoxes = problems.Where(p => p.Id is not null).Select(p => p.Id!).ToHashSet();
        var badLines = problems.Select(p =>
        {
            var c = p.Connection is { } i && i < model.Connections.Count ? model.Connections[i] : null;
            return c is not null && Views.PlaceEnds(model, view, c.From, c.To) is { } ends ? LineId(ends.From, ends.To) : null;
        }).Where(id => id is not null).ToHashSet();

        var inside = Views.ChildCounts(model);
        // Where a project draws a line for each connection, a step rides one of the pair's lines: the one it names (see Strands.StrandOf), else the first that runs its way.
        var strands = computed.Strands;
        string? StrandAt(int i)
        {
            if (strands is null) return null;
            if (playing?.Strands is { } listed) return i >= 0 && i < listed.Count ? listed[i] : null;
            return PlacedAt(i) is { } e ? Strands.Candidates(computed, e).FirstOrDefault()?.Id : null;
        }
        // A step rides a line that runs its way, or one with connections both ways. Against a one-way line it gets a dashed one, so no arrow points against it.
        var runs = computed.Edges.SelectMany(e => e.Both ? new[] { (e.From, e.To), (e.To, e.From) } : new[] { (e.From, e.To) }).ToHashSet();
        bool Rides((string From, string To) e, int i) => strands is null ? runs.Contains((e.From, e.To)) : StrandAt(i) is not null;
        var litLines = litSteps.Where(i => Rides(PlacedAt(i)!.Value, i)).Select(i => LineId(PlacedAt(i)!.Value.From, PlacedAt(i)!.Value.To)).ToHashSet();
        var litStrands = litSteps.Select(StrandAt).OfType<string>().ToHashSet();
        var faintLines = faintSteps.Where(f => Rides(f.E, f.I)).Select(f => LineId(f.E.From, f.E.To)).ToHashSet();
        var faintStrands = faintSteps.Select(f => StrandAt(f.I)).OfType<string>().ToHashSet();
        var badConnections = problems.Where(p => p.Connection is not null).Select(p => p.Connection!.Value).ToHashSet();
        bool IsLit(string from, string to) => litLines.Contains(LineId(from, to));
        bool IsFaint(string from, string to) => faintLines.Contains(LineId(from, to));
        var sceneBoxes = boxes.Select(id => new SceneBox(
            id, model.Objects[id], new Rect(at[id].X, at[id].Y, BoxGeometry.BoxWidth, BoxGeometry.BoxHeight), inside.GetValueOrDefault(id),
            !isMember.Contains(id),
            !dimming ? BoxMode.Normal : litBoxes.Contains(id) ? BoxMode.Lit : BoxMode.Dim,
            badBoxes.Contains(id))
        { Icon = Look.IconData(model, model.Objects[id]) }).ToList();

        var lines = new List<Drawn>();
        if (strands is not null)
        {
            var slots = Lanes.SlotsOf(strands);
            foreach (var s in strands)
            {
                var flags = EdgeFlags.None;
                if (dimming) flags |= litStrands.Contains(s.Id) ? EdgeFlags.Active : faintStrands.Contains(s.Id) ? EdgeFlags.Lane : EdgeFlags.Dim;
                if (s.Connections.Any(badConnections.Contains)) flags |= EdgeFlags.Problem;
                lines.Add(new Drawn(s.Id, s.From, s.To, s.Label == "" ? null : s.Label, flags, false, s.Look, s.Pair, slots[s.Id], s.Lanes));
            }
        }
        else
        {
            foreach (var e in computed.Edges)
            {
                var flags = EdgeFlags.None;
                if (dimming) flags |= IsLit(e.From, e.To) ? EdgeFlags.Active : IsFaint(e.From, e.To) ? EdgeFlags.Lane : EdgeFlags.Dim;
                if (badLines.Contains(LineId(e.From, e.To))) flags |= EdgeFlags.Problem;
                lines.Add(new Drawn(LineId(e.From, e.To), e.From, e.To, e.Label == "" ? null : e.Label, flags, e.Both, e.Look));
            }
        }
        // A one-box step lights its box, no line. A step with no line it can ride gets a dashed line, and so does a faint one.
        var drawn = new HashSet<string>();
        for (var n = 0; n < litEnds.Count; n++)
        {
            var e = litEnds[n];
            if (e.From == e.To || Rides(e, litSteps[n]) || !drawn.Add(LineId(e.From, e.To))) continue;
            lines.Add(new Drawn(n == 0 ? "step" : $"step-{n}", e.From, e.To, null, EdgeFlags.Step, false, null));
        }
        foreach (var (i, e) in faintSteps)
        {
            if (e.From == e.To || Rides(e, i) || !drawn.Add(LineId(e.From, e.To))) continue;
            lines.Add(new Drawn($"lane-{i}", e.From, e.To, null, EdgeFlags.Lane, false, null));
        }

        // Where a pair has several lines side by side, the pair is spread (the lanes widen so every label fits) while it is selected, or a line of it, or a box on it, or keyboard focus is on one
        // of its lines; a step playing on the pair wins over all of those. The label of every line of a spread pair shows. A line pointed at shows its own label, and its pair does not move under the pointer.
        string? PairIn(string? id) => id is null ? null : lines.FirstOrDefault(l => l.Id == id)?.PairId ?? id;
        var (selectedPair, focusedPair) = (PairIn(focus.Line), PairIn(focus.Focused));
        var playingOn = lines.Where(l => l.Flags.HasFlag(EdgeFlags.Active)).Select(l => l.PairId).ToHashSet();
        var edges = lines.Select(e =>
        {
            var touches = e.From == focus.Box || e.To == focus.Box;
            var pair = e.PairId;
            var several = e.Lanes > 1;
            var together = touches || (e.Pair is not null && (pair == selectedPair || pair == focusedPair));
            var hovered = e.Id == focus.Hover || (e.Pair is not null && pair == focus.Hover);
            var shown = together || e.Id == focus.Line || hovered || e.Flags.HasFlag(EdgeFlags.Active);
            var flags = e.Flags;
            if (focus.Box is not null && !touches) flags |= EdgeFlags.Faint;
            if (hovered) flags |= EdgeFlags.Hover;
            return new SceneEdge(e.Id, e.From, e.To, shown ? e.Label : null, flags, e.Id == focus.Line || (e.Pair is not null && focus.Line == pair), e.Both, e.Look)
            {
                Pair = e.Pair,
                Slot = e.Slot,
                Lanes = e.Lanes,
                Spread = several && together && !playingOn.Contains(pair),
            };
        }).ToList();

        var inner = sceneBoxes.Where(b => isMember.Contains(b.Id)).Select(b => b.Rect).ToList();
        Rect? frame = view == Names.Root || inner.Count == 0 ? null : BoxGeometry.FrameAround(inner);
        return new Scene(view, Views.NameOf(model, view), sceneBoxes, edges, frame, members);
    }

    /// <summary>The class names the browser canvas gives a box, for comparing with it.</summary>
    public static IEnumerable<string> Classes(SceneBox b)
    {
        if (b.Outsider) yield return "outsider";
        if (b.Mode == BoxMode.Lit) yield return "lit";
        if (b.Mode == BoxMode.Dim) yield return "dim";
        if (b.Problem) yield return "problem";
    }

    /// <summary>The class names the browser canvas gives a line, for comparing with it.</summary>
    public static IEnumerable<string> Classes(SceneEdge e)
    {
        if (e.Flags.HasFlag(EdgeFlags.Active)) yield return "active";
        if (e.Flags.HasFlag(EdgeFlags.Dim)) yield return "dim";
        if (e.Flags.HasFlag(EdgeFlags.Step)) yield return "step";
        if (e.Flags.HasFlag(EdgeFlags.Problem)) yield return "problem";
        if (e.Flags.HasFlag(EdgeFlags.Faint)) yield return "faint";
        if (e.Flags.HasFlag(EdgeFlags.Hover)) yield return "hover";
        if (e.Flags.HasFlag(EdgeFlags.Lane)) yield return "lane";
    }
}
