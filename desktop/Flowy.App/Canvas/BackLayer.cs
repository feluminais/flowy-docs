using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Flowy.Core;
using CorePt = Flowy.Core.Pt;
using CoreRect = Flowy.Core.Rect;

namespace Flowy.App.Canvas;

/// <summary>
/// What sits behind the boxes: the frame around the view's own boxes, and the lines with their arrowheads and labels. Drawn in one
/// pass with the same camera as the boxes, so a line stays on its boxes while the view moves and zooms.
/// </summary>
internal sealed class BackLayer : Control
{
    /// <summary>
    /// A line as drawn. `Made` is what its path was made from: the two boxes and their outlines, so a line whose boxes stayed where they were keeps its path, its geometry and its label.
    /// `Label` is the label's box at the middle of the line, as measured; where it is drawn is in `_labelAt`.
    /// </summary>
    private sealed record Drawn(SceneEdge Edge, LinePath Path, Geometry Geometry, (CoreRect From, CoreRect To, double[]? OutlineFrom, double[]? OutlineTo, string Style) Made, CoreRect? Label, Avalonia.Rect Bounds);

    private string _style = "";

    private List<Drawn> _lines = [];
    private List<CoreRect> _labels = [];
    private Dictionary<string, CoreRect> _labelAt = []; // where each label is drawn, by line id, kept clear of the boxes and of each other (LineLabels)
    private IReadOnlyDictionary<string, double>? _widths; // how thick each line is drawn while a load shows (by line id), where it differs from the usual
    private FailureOverlay? _failures; // the Failures tab's badges and the line a picked mode fails, while the tab is open
    private IReadOnlyDictionary<string, Change>? _changes; // a comparison's change marks on the lines, by line id, while Show changes is on
    private Scene? _scene;
    private Viewport _viewport = new(0, 0, 1);

    public BackLayer()
    {
        IsHitTestVisible = false;
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    /// <summary>The camera, for the places a pointer is turned into the diagram's own. The layer is drawn in the diagram's units: the canvas moves it with the boxes, so a move of the camera draws nothing again.</summary>
    public Viewport Viewport
    {
        get => _viewport;
        set => _viewport = value;
    }

    /// <summary>Draws the scene's lines in <paramref name="style"/>: "straight", "curved" or "angled".</summary>
    public void SetScene(Scene scene, string style)
    {
        _scene = scene;
        var rects = scene.Boxes.ToDictionary(b => b.Id, b => b.Rect);
        var outlines = scene.Boxes.ToDictionary(b => b.Id, b => Look.DefOf(b.Object).Edge); // where a line meets each shape
        // Dragging a box moves it and the lines at it; every other line is as it was, and is not worked out again (a path parsed, a label measured).
        var before = style == _style ? _lines.ToDictionary(l => l.Edge.Id) : [];
        _style = style;
        _lines = scene.Edges
            .Where(e => rects.ContainsKey(e.From) && rects.ContainsKey(e.To))
            .Select(e =>
            {
                var made = (rects[e.From], rects[e.To], outlines[e.From], outlines[e.To], style);
                if (before.TryGetValue(e.Id, out var was) && was.Made.From == made.Item1 && was.Made.To == made.Item2 && ReferenceEquals(was.Made.OutlineFrom, made.Item3) && ReferenceEquals(was.Made.OutlineTo, made.Item4)
                    && was.Edge.Label == e.Label && (e.Label is null || (e.Flags & EdgeFlags.Active) == (was.Edge.Flags & EdgeFlags.Active)))
                    return was with { Edge = e };
                var path = LinePaths.Build(style, made.Item1, made.Item2, made.Item3, made.Item4);
                var label = e.Label is { Length: > 0 } ? LabelBox(path, Format(e, LineLabels.Clip(e.Label), Brushes.Black)) : (CoreRect?)null;
                var geometry = Geometry.Parse(path.Data);
                return new Drawn(e, path, geometry, made, label, geometry.Bounds);
            }).ToList();
        PlaceLabels();
        InvalidateVisual();
    }

    /// <summary>
    /// Where the labels on show go, as the browser places them: each slides along its line to the first place clear of the boxes and of the labels placed
    /// before it. A lit line's label and a lifted one stay at the middle of the line, and the others are placed round them.
    /// </summary>
    private void PlaceLabels()
    {
        var items = _lines.Where(l => l.Label is not null).Select(l =>
        {
            var box = l.Label!.Value;
            var pinned = l.Edge.Flags.HasFlag(EdgeFlags.Active) || _lifted.Contains((l.Edge.From, l.Edge.To));
            return new LabelItem(l.Edge.Id, l.Path.Data, new CorePt(box.X + box.Width / 2, box.Y + box.Height / 2), box.Width, box.Height, pinned);
        }).ToList();
        var spots = LineLabels.Place(items, _scene?.Boxes.Select(b => b.Rect).ToList() ?? []);
        _labelAt = items.ToDictionary(i => i.Id, i => LineLabels.Around(spots[i.Id], i));
        _labels = [.. _labelAt.Values];
    }

    private IReadOnlySet<(string From, string To)> _lifted = new HashSet<(string, string)>();

    /// <summary>
    /// The lit lines whose labels move aside, to the upper side of the line as the browser does for a step that plays: a step that leaves marks beside its
    /// line (a cross, a bar, a clock) keeps its label clear of them. None leaves every label where it is.
    /// </summary>
    public void LiftLabels(IEnumerable<(string From, string To)> lines)
    {
        var set = lines.ToHashSet();
        if (set.SetEquals(_lifted)) return;
        _lifted = set;
        PlaceLabels();
        InvalidateVisual();
    }

    /// <summary>Where the labels showing now are, with their padding: what traffic runs under, as it runs under a shape.</summary>
    internal IReadOnlyList<CoreRect> LabelRects => _labels;

    /// <summary>The geometry of a line, for tests: a line whose boxes did not move keeps the one it had.</summary>
    internal Geometry? GeometryOf(string edgeId) => _lines.FirstOrDefault(l => l.Edge.Id == edgeId)?.Geometry;

    /// <summary>Draws the lines at these thicknesses (a load's traffic makes busy lines thicker), or as usual for null.</summary>
    public void SetWidths(IReadOnlyDictionary<string, double>? widths)
    {
        _widths = widths;
        InvalidateVisual();
    }

    /// <summary>Draws the Failures tab's marks on the lines: a badge with the count at the label, and for a picked mode its line in red and every other faded. Null takes them away.</summary>
    public void SetFailures(FailureOverlay? overlay)
    {
        _failures = overlay;
        InvalidateVisual();
    }

    /// <summary>Draws a halo behind the lines a comparison marks (by line id), in the colour and dash of their kind. Null, or no lines, takes them away.</summary>
    public void SetChanges(IReadOnlyDictionary<string, Change>? lines)
    {
        var next = lines is { Count: > 0 } ? lines : null;
        if (ReferenceEquals(next, _changes) || (next is null && _changes is null)) return;
        _changes = next;
        InvalidateVisual();
    }

    /// <summary>The kind a line is marked as, or null (for tests).</summary>
    internal Change? ChangeOf(string from, string to) => _changes is not null && _changes.TryGetValue(SceneBuilder.LineId(from, to), out var kind) ? kind : null;

    private Change? ChangeOf(SceneEdge e) => _changes is not null && _changes.TryGetValue(e.Id, out var kind) ? kind : null;

    /// <summary>The badge a line wears now, or null (for tests).</summary>
    internal FailureMark? FailureOn(string from, string to) =>
        _failures is not null && _failures.Lines.TryGetValue(Failures.LineKey(from, to), out var mark) ? mark : null;

    /// <summary>How a line is lit for the picked failure mode (for tests).</summary>
    internal FailLight FailLightOf(string from, string to) => _failures?.LightOfLine(from, to) ?? FailLight.None;

    /// <summary>How thick a line is drawn while a load shows, or null when it is drawn as usual (for tests).</summary>
    internal double? WidthOf(string edgeId) => _widths is not null && _widths.TryGetValue(edgeId, out var w) ? w : null;

    /// <summary>How thick a line is drawn: what a load's traffic gives it, which outranks being picked, hovered or lit as the browser's inline width does; else lit 3, picked or hovered 2, any other 1.5.</summary>
    internal static double ThicknessOf(bool lit, bool picked, double? traffic) => traffic ?? (lit ? 2.5 : picked ? 2 : 1.5);

    /// <summary>The line under a point of this control, if any (within a few pixels of it), for pointing at and clicking lines.</summary>
    public string? EdgeAt(Point screen)
    {
        var world = _viewport.ToWorld(new CorePt(screen.X, screen.Y));
        var at = new Point(world.X, world.Y);
        var reach = 7 / _viewport.Zoom; // half the pen below: only a line whose box holds the point within that can be under it
        Pen? pen = null;
        for (var i = _lines.Count - 1; i >= 0; i--)
        {
            var line = _lines[i];
            if (!line.Bounds.Inflate(reach).Contains(at) || SceneBuilder.IsStepLine(line.Edge.Id)) continue;
            pen ??= new Pen(Brushes.Black, 14 / _viewport.Zoom);
            if (line.Geometry.StrokeContains(pen, at)) return line.Edge.Id;
        }
        return null;
    }

    private (string Name, double Width, double Height)? _titleSize;

    /// <summary>How big the frame's title is: measured once for a name, not on every pointer move.</summary>
    private (double Width, double Height) TitleSize(string name)
    {
        if (_titleSize is not { } known || known.Name != name)
        {
            var title = FrameTitle(name, Brushes.Black);
            _titleSize = known = (name, title.Width, title.Height);
        }
        return (known.Width, known.Height);
    }

    private static FormattedText FrameTitle(string name, IBrush brush) =>
        new(name, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, new Typeface(FontFamily.Default, FontStyle.Normal, FontWeight.SemiBold), 12, brush);

    /// <summary>Whether a point of this control is on the frame's outline or its title (a few pixels either side of the line, so it is easy to hit): a click there is a click on the system the frame stands for.</summary>
    public bool OnFrame(Point screen)
    {
        if (_scene is not { Frame: { } frame } || _scene.FrameName == "") return false;
        var world = _viewport.ToWorld(new CorePt(screen.X, screen.Y));
        var at = new Point(world.X, world.Y);
        var reach = 6 / _viewport.Zoom;
        var outer = new Avalonia.Rect(frame.X - reach, frame.Y - reach, frame.Width + 2 * reach, frame.Height + 2 * reach);
        var inner = new Avalonia.Rect(frame.X + reach, frame.Y + reach, Math.Max(0, frame.Width - 2 * reach), Math.Max(0, frame.Height - 2 * reach));
        if (outer.Contains(at) && !inner.Contains(at)) return true;
        var (width, height) = TitleSize(_scene.FrameName);
        return new Avalonia.Rect(frame.X + 14, frame.Y - height / 2, width + 12, height).Contains(at);
    }

    private IBrush Brush(string key) => AppTheme.Brush(this, key);

    private double _litFade = 1;

    /// <summary>How strong the lines a step has lit are drawn: 1, or less while a step that timed out has dimmed them (see MotionMath.LitOpacity).</summary>
    public double LitFade
    {
        get => _litFade;
        set
        {
            if (_litFade == value) return;
            _litFade = value;
            InvalidateVisual();
        }
    }

    private double Fade(SceneEdge e) =>
        _failures?.LightOfLine(e.From, e.To) == FailLight.Dim ? 0.15 :
        e.Flags.HasFlag(EdgeFlags.Dim) ? (ChangeOf(e) is null ? 0.15 : 0.6) : // a mark on a line off the step on show stays readable
 e.Flags.HasFlag(EdgeFlags.Lane) ? 0.55 : e.Flags.HasFlag(EdgeFlags.Faint) ? 0.25 : e.Flags.HasFlag(EdgeFlags.Active) || e.Flags.HasFlag(EdgeFlags.Step) ? _litFade : 1;

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        if (_scene is null) return;
        var accent = Brush("AccentBrush");

        if (_scene.Frame is { } frame && _scene.FrameName != "")
        {
            var rect = new Avalonia.Rect(frame.X, frame.Y, frame.Width, frame.Height);
            context.DrawRectangle(null, new Pen(accent, 1.5), rect, 12, 12);
            var title = FrameTitle(_scene.FrameName, accent);
            var at = new Point(frame.X + 14 + 6, frame.Y - title.Height / 2);
            context.DrawRectangle(Brush("BgBrush"), null, new Avalonia.Rect(at.X - 6, at.Y, title.Width + 12, title.Height));
            context.DrawText(title, at);
        }

        // A lit line draws over the others.
        foreach (var line in _lines.OrderBy(l => l.Edge.Flags.HasFlag(EdgeFlags.Active) || l.Edge.Flags.HasFlag(EdgeFlags.Step) ? 1 : 0))
            DrawLine(context, line, accent);
        foreach (var line in _lines)
            if (line.Edge.Label is { Length: > 0 } label) DrawLabel(context, line, label);
        if (_failures is { Lines.Count: > 0 })
            foreach (var line in _lines)
                if (_failures.Lines.TryGetValue(Failures.LineKey(line.Edge.From, line.Edge.To), out var mark)) DrawFailBadge(context, line, mark);
    }

    /// <summary>
    /// The count of failure modes a line carries, in the colour of the worst, as a shape wears it. On the left end of the line's label when it has one,
    /// else centred on the line's label point.
    /// </summary>
    private void DrawFailBadge(DrawingContext context, Drawn line, FailureMark mark)
    {
        using var opacity = context.PushOpacity(Fade(line.Edge));
        var unrated = mark.Band == RiskBand.Unrated;
        var text = new FormattedText(mark.Count.ToString(CultureInfo.InvariantCulture), CultureInfo.CurrentUICulture, FlowDirection.LeftToRight,
            new Typeface(FontFamily.Default, FontStyle.Normal, FontWeight.Bold), 11, Brush(unrated ? "FgBrush" : "BgBrush"));
        var width = Math.Max(20, text.Width + 12);
        var (x, y) = _labelAt.TryGetValue(line.Edge.Id, out var label) ? (label.X - width + 6, label.Y + label.Height / 2) : (line.Path.Label.X - width / 2, line.Path.Label.Y);
        var rect = new Avalonia.Rect(x, y - 10, width, 20);
        var fill = Brush(mark.Band switch { RiskBand.High => "DangerBrush", RiskBand.Medium => "WarnBrush", RiskBand.Low => "MutedBrush", _ => "BgBrush" });
        context.DrawRectangle(fill, unrated ? new Pen(Brush("LineBrush"), 1) : null, rect, 10, 10);
        context.DrawText(text, new Point(rect.X + (width - text.Width) / 2, rect.Y + (20 - text.Height) / 2));
    }

    private void DrawLine(DrawingContext context, Drawn line, IBrush accent)
    {
        var e = line.Edge;
        var lit = e.Flags.HasFlag(EdgeFlags.Active) || e.Flags.HasFlag(EdgeFlags.Step);
        var emphasised = lit || e.Selected || e.Flags.HasFlag(EdgeFlags.Hover);
        var brush = e.Flags.HasFlag(EdgeFlags.Problem) && !lit ? Brush("WarnBrush") : emphasised ? accent : Brush("EdgeBrush");
        var thickness = ThicknessOf(lit, e.Selected || e.Flags.HasFlag(EdgeFlags.Hover), WidthOf(e.Id));
        if (_failures?.LightOfLine(e.From, e.To) == FailLight.Fails) // the line a picked failure mode fails, in the colour of the mode's band
        {
            brush = Brush(_failures.LitBand switch { RiskBand.High => "DangerBrush", RiskBand.Medium => "WarnBrush", _ => "MutedBrush" });
            thickness = 2.5;
        }
        var dash = e.Flags.HasFlag(EdgeFlags.Step) ? new DashStyle([8 / thickness, 5 / thickness], 0) : e.Flags.HasFlag(EdgeFlags.Lane) ? new DashStyle([4 / thickness, 5 / thickness], 0) : null;
        using var opacity = context.PushOpacity(Fade(e));
        if (ChangeOf(e) is { } change)
        {
            // The halo: 8 px wide in the kind's colour at 30%, dashed for Removed (6 and 4 px, in widths of the pen), as the browser's .change-line.
            using var faint = context.PushOpacity(0.3);
            var halo = Brush(change switch { Change.New => "AccentBrush", Change.Removed => "DangerBrush", _ => "WarnBrush" });
            context.DrawGeometry(null, new Pen(halo, 8, change == Change.Removed ? new DashStyle([6.0 / 8, 4.0 / 8], 0) : null, PenLineCap.Flat), line.Geometry);
        }
        context.DrawGeometry(null, new Pen(brush, thickness, dash, PenLineCap.Flat), line.Geometry);

        // The arrowhead: a closed triangle on the end, pointing along the line.
        var (end, dir) = (line.Path.End, line.Path.Direction);
        var tip = new Point(end.X, end.Y);
        var back = new Point(end.X - dir.X * 10, end.Y - dir.Y * 10);
        var side = new Vector(-dir.Y * 4.5, dir.X * 4.5);
        var arrow = new StreamGeometry();
        using (var g = arrow.Open())
        {
            g.BeginFigure(tip, true);
            g.LineTo(back + side);
            g.LineTo(back - side);
            g.EndFigure(true);
        }
        context.DrawGeometry(brush, null, arrow);
    }

    private static FormattedText Format(SceneEdge e, string text, IBrush brush) =>
        new(text, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight,
            new Typeface(FontFamily.Default, FontStyle.Normal, e.Flags.HasFlag(EdgeFlags.Active) ? FontWeight.SemiBold : FontWeight.Normal), 11, brush);

    /// <summary>The box a label is drawn in: its text centred on the line's label point, with a little room round it.</summary>
    private static CoreRect LabelBox(LinePath path, FormattedText text) =>
        new(path.Label.X - text.Width / 2 - 4, path.Label.Y - text.Height / 2 - 2, text.Width + 8, text.Height + 4);

    private void DrawLabel(DrawingContext context, Drawn line, string text)
    {
        using var opacity = context.PushOpacity(Fade(line.Edge));
        text = LineLabels.Clip(text);
        var formatted = Format(line.Edge, text, Brush("FgBrush"));
        var box = _labelAt.TryGetValue(line.Edge.Id, out var placed) ? placed : LabelBox(line.Path, formatted);
        if (_lifted.Contains((line.Edge.From, line.Edge.To)) && _scene is { } s
            && s.Boxes.FirstOrDefault(b => b.Id == line.Edge.From) is { } a && s.Boxes.FirstOrDefault(b => b.Id == line.Edge.To) is { } b)
        {
            var (x, y) = MotionMath.LabelOffset(b.Rect.X + b.Rect.Width / 2 - (a.Rect.X + a.Rect.Width / 2), b.Rect.Y + b.Rect.Height / 2 - (a.Rect.Y + a.Rect.Height / 2), text.Length);
            box = box with { X = box.X + x, Y = box.Y + y };
        }
        context.DrawRectangle(Brush("BgBrush"), null, new Avalonia.Rect(box.X, box.Y, box.Width, box.Height), 2, 2);
        context.DrawText(formatted, new Point(box.X + 4, box.Y + 2));
    }
}
