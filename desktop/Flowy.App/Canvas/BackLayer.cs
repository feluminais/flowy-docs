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
    private sealed record Drawn(SceneEdge Edge, LinePath Path, Geometry Geometry);

    private List<Drawn> _lines = [];
    private List<CoreRect> _labels = [];
    private IReadOnlyDictionary<string, double>? _widths; // how thick each line is drawn while a load shows (by line id), where it differs from the usual
    private Scene? _scene;
    private Viewport _viewport = new(0, 0, 1);

    public BackLayer()
    {
        IsHitTestVisible = false;
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    public Viewport Viewport
    {
        get => _viewport;
        set
        {
            _viewport = value;
            InvalidateVisual();
        }
    }

    /// <summary>Draws the scene's lines in <paramref name="style"/>: "straight", "curved" or "angled".</summary>
    public void SetScene(Scene scene, string style)
    {
        _scene = scene;
        var rects = scene.Boxes.ToDictionary(b => b.Id, b => b.Rect);
        var outlines = scene.Boxes.ToDictionary(b => b.Id, b => Look.DefOf(b.Object).Edge); // where a line meets each shape
        _lines = scene.Edges
            .Where(e => rects.ContainsKey(e.From) && rects.ContainsKey(e.To))
            .Select(e =>
            {
                var path = LinePaths.Build(style, rects[e.From], rects[e.To], outlines[e.From], outlines[e.To]);
                return new Drawn(e, path, Geometry.Parse(path.Data));
            }).ToList();
        _labels = _lines.Where(l => l.Edge.Label is { Length: > 0 }).Select(l => LabelBox(l.Path, Format(l.Edge, l.Edge.Label!, Brushes.Black))).ToList();
        InvalidateVisual();
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
        InvalidateVisual();
    }

    /// <summary>Where the labels showing now are, with their padding: what traffic runs under, as it runs under a shape.</summary>
    internal IReadOnlyList<CoreRect> LabelRects => _labels;

    /// <summary>Draws the lines at these thicknesses (a load's traffic makes busy lines thicker), or as usual for null.</summary>
    public void SetWidths(IReadOnlyDictionary<string, double>? widths)
    {
        _widths = widths;
        InvalidateVisual();
    }

    /// <summary>How thick a line is drawn while a load shows, or null when it is drawn as usual (for tests).</summary>
    internal double? WidthOf(string edgeId) => _widths is not null && _widths.TryGetValue(edgeId, out var w) ? w : null;

    /// <summary>How thick a line is drawn: what a load's traffic gives it, which outranks being picked, hovered or lit as the browser's inline width does; else lit 3, picked or hovered 2, any other 1.5.</summary>
    internal static double ThicknessOf(bool lit, bool picked, double? traffic) => traffic ?? (lit ? 2.5 : picked ? 2 : 1.5);

    /// <summary>The line under a point of this control, if any (within a few pixels of it), for pointing at and clicking lines.</summary>
    public string? EdgeAt(Point screen)
    {
        var world = _viewport.ToWorld(new CorePt(screen.X, screen.Y));
        var pen = new Pen(Brushes.Black, 14 / _viewport.Zoom);
        for (var i = _lines.Count - 1; i >= 0; i--)
            if (!SceneBuilder.IsStepLine(_lines[i].Edge.Id) && _lines[i].Geometry.StrokeContains(pen, new Point(world.X, world.Y))) return _lines[i].Edge.Id;
        return null;
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
        var title = FrameTitle(_scene.FrameName, Brushes.Black);
        return new Avalonia.Rect(frame.X + 14, frame.Y - title.Height / 2, title.Width + 12, title.Height).Contains(at);
    }

    private IBrush Brush(string key) =>
        this.TryFindResource(key, ActualThemeVariant, out var found) && found is IBrush brush ? brush : Brushes.Gray;

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
        e.Flags.HasFlag(EdgeFlags.Dim) ? 0.15 : e.Flags.HasFlag(EdgeFlags.Lane) ? 0.55 : e.Flags.HasFlag(EdgeFlags.Faint) ? 0.25 : e.Flags.HasFlag(EdgeFlags.Active) || e.Flags.HasFlag(EdgeFlags.Step) ? _litFade : 1;

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        if (_scene is null) return;
        var matrix = Matrix.CreateScale(_viewport.Zoom, _viewport.Zoom) * Matrix.CreateTranslation(_viewport.X, _viewport.Y);
        using var _ = context.PushTransform(matrix);
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
    }

    private void DrawLine(DrawingContext context, Drawn line, IBrush accent)
    {
        var e = line.Edge;
        var lit = e.Flags.HasFlag(EdgeFlags.Active) || e.Flags.HasFlag(EdgeFlags.Step);
        var emphasised = lit || e.Selected || e.Flags.HasFlag(EdgeFlags.Hover);
        var brush = e.Flags.HasFlag(EdgeFlags.Problem) && !lit ? Brush("WarnBrush") : emphasised ? accent : Brush("EdgeBrush");
        var thickness = ThicknessOf(lit, e.Selected || e.Flags.HasFlag(EdgeFlags.Hover), WidthOf(e.Id));
        var dash = e.Flags.HasFlag(EdgeFlags.Step) ? new DashStyle([8 / thickness, 5 / thickness], 0) : e.Flags.HasFlag(EdgeFlags.Lane) ? new DashStyle([4 / thickness, 5 / thickness], 0) : null;
        using var opacity = context.PushOpacity(Fade(e));
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
        var formatted = Format(line.Edge, text, Brush("FgBrush"));
        var box = LabelBox(line.Path, formatted);
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
