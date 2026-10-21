namespace Flowy.Core;

/// <summary>
/// A flow on the canvas: where each step lands in the view (null if it can't be shown), and the step to light up. Without a step or steps nothing is
/// lit or dimmed. <c>Steps</c> lights several at once (a parallel stop); <c>Faint</c> draws steps as dashed, faint lanes (the lanes of a branch this stop
/// is not in) without lighting their boxes.
/// </summary>
public sealed record Playing(IReadOnlyList<(string From, string To)?> Ends, int? Step = null, IReadOnlyList<int>? Steps = null, IReadOnlyList<int>? Faint = null, IReadOnlyList<string>? Also = null);

/// <summary>What the reader is pointing at: the selected box, the selected line, and the line the pointer is on (on the canvas, or in a box's panel).</summary>
public sealed record Focus(string? Box = null, string? Line = null, string? Hover = null);

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

/// <summary><c>Label</c> is null unless the line should show it now.</summary>
public sealed record SceneEdge(string Id, string From, string To, string? Label, EdgeFlags Flags, bool Selected);

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

    public static string LineId(string from, string to) => $"{from} {to}";

    private static bool Overlaps(Pt a, Pt b) => Math.Abs(a.X - b.X) < Layout.BoxWidth && Math.Abs(a.Y - b.Y) < Layout.BoxHeight;

    // toGraph runs again on every flow step and selection change, so placements are kept by what they're made from.
    private static readonly Dictionary<string, OrderedDictionary<string, Pt>> Placements = [];
    private static readonly object PlacementsLock = new();

    private static OrderedDictionary<string, Pt> PlaceCached(List<string> members, List<string> around, IReadOnlyList<Edge> edges)
    {
        var key = $"{string.Join('\u0001', members)}\u0002{string.Join('\u0001', around)}\u0002{string.Join('\u0001', edges.Select(e => e.From + "\u0003" + e.To))}";
        lock (PlacementsLock)
        {
            if (Placements.TryGetValue(key, out var cached)) return cached;
        }
        var placed = Layout.Place(members, around, edges);
        lock (PlacementsLock)
        {
            if (Placements.Count >= 50) Placements.Remove(Placements.Keys.First());
            Placements[key] = placed;
        }
        return placed;
    }

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
        var litEnds = (stepsLit ?? []).Select(PlacedAt).Where(e => e is not null).Select(e => e!.Value).ToList();
        var litBoxes = litEnds.SelectMany(e => new[] { e.From, e.To }).Concat(playing?.Also ?? []).ToHashSet(); // Also: a shape that takes a request off a line is lit with the step
        var faintSteps = (playing?.Faint ?? []).Select(i => (I: i, E: PlacedAt(i))).Where(f => f.E is not null).Select(f => (f.I, E: f.E!.Value)).ToList();
        var around = boxes.Where(id => !isMember.Contains(id)).ToList();
        var placed = PlaceCached(members, around, computed.Edges);

        var saved = model.Layout.TryGetValue(view, out var s2) ? s2 : new Dictionary<string, LayoutPoint>();
        var at = new OrderedDictionary<string, Pt>();
        foreach (var id in boxes)
            if (saved.TryGetValue(id, out var p)) at[id] = new Pt(p.X, p.Y);
        foreach (var id in boxes)
        {
            if (at.ContainsKey(id)) continue;
            var p = placed[id];
            while (at.Values.Any(q => Overlaps(p, q))) p = p with { Y = p.Y + Layout.BoxHeight + Gap };
            at[id] = p;
        }

        var badBoxes = problems.Where(p => p.Id is not null).Select(p => p.Id!).ToHashSet();
        var badLines = problems.Select(p =>
        {
            var c = p.Connection is { } i && i < model.Connections.Count ? model.Connections[i] : null;
            return c is not null && Views.PlaceEnds(model, view, c.From, c.To) is { } ends ? LineId(ends.From, ends.To) : null;
        }).Where(id => id is not null).ToHashSet();

        var inside = Views.ChildCounts(model);
        bool IsLit(string from, string to) => litEnds.Any(e => e.From == from && e.To == to);
        bool IsFaint(string from, string to) => faintSteps.Any(f => f.E.From == from && f.E.To == to);
        var sceneBoxes = boxes.Select(id => new SceneBox(
            id, model.Objects[id], new Rect(at[id].X, at[id].Y, Layout.BoxWidth, Layout.BoxHeight), inside.GetValueOrDefault(id),
            !isMember.Contains(id),
            !dimming ? BoxMode.Normal : litBoxes.Contains(id) ? BoxMode.Lit : BoxMode.Dim,
            badBoxes.Contains(id)) { Icon = Look.IconData(model, model.Objects[id]) }).ToList();

        var lines = new List<(string Id, string From, string To, string? Label, EdgeFlags Flags)>();
        foreach (var e in computed.Edges)
        {
            var flags = EdgeFlags.None;
            if (dimming) flags |= IsLit(e.From, e.To) ? EdgeFlags.Active : IsFaint(e.From, e.To) ? EdgeFlags.Lane : EdgeFlags.Dim;
            if (badLines.Contains(LineId(e.From, e.To))) flags |= EdgeFlags.Problem;
            lines.Add((LineId(e.From, e.To), e.From, e.To, e.Label == "" ? null : e.Label, flags));
        }
        // A one-box step lights its box, no line. A step with no connection of its own gets a dashed line, and so does a faint one.
        var drawn = new HashSet<string>();
        for (var n = 0; n < litEnds.Count; n++)
        {
            var e = litEnds[n];
            if (e.From == e.To || computed.Edges.Any(c => c.From == e.From && c.To == e.To) || !drawn.Add(LineId(e.From, e.To))) continue;
            lines.Add((n == 0 ? "step" : $"step-{n}", e.From, e.To, null, EdgeFlags.Step));
        }
        foreach (var (i, e) in faintSteps)
        {
            if (e.From == e.To || computed.Edges.Any(c => c.From == e.From && c.To == e.To) || !drawn.Add(LineId(e.From, e.To))) continue;
            lines.Add(($"lane-{i}", e.From, e.To, null, EdgeFlags.Lane));
        }

        var edges = lines.Select(e =>
        {
            var touches = e.From == focus.Box || e.To == focus.Box;
            var shown = touches || e.Id == focus.Line || e.Id == focus.Hover || e.Flags.HasFlag(EdgeFlags.Active);
            var flags = e.Flags;
            if (focus.Box is not null && !touches) flags |= EdgeFlags.Faint;
            if (e.Id == focus.Hover) flags |= EdgeFlags.Hover;
            return new SceneEdge(e.Id, e.From, e.To, shown ? e.Label : null, flags, e.Id == focus.Line);
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
