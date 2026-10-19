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
        InvalidateVisual();
    }

    /// <summary>Draws the lines at these thicknesses (a load's traffic makes busy lines thicker), or as usual for null.</summary>
    public void SetWidths(IReadOnlyDictionary<string, double>? widths)
    {
        _widths = widths;
        InvalidateVisual();
    }

    /// <summary>How thick a line is drawn while a load shows, or null when it is drawn as usual (for tests).</summary>
    internal double? WidthOf(string edgeId) => _widths is not null && _widths.TryGetValue(edgeId, out var w) ? w : null;

    /// <summary>How thick a line is drawn: what a load's traffic gives it, which outranks being picked, hovered or lit as the browser's inline width does; else lit 3, picked or hovered 2, any other 1.5.</summary>
    internal static double ThicknessOf(bool lit, bool picked, double? traffic) => traffic ?? (lit ? 3 : picked ? 2 : 1.5);

    /// <summary>The line under a point of this control, if any (within a few pixels of it), for pointing at and clicking lines.</summary>
    public string? EdgeAt(Point screen)
    {
        var world = _viewport.ToWorld(new CorePt(screen.X, screen.Y));
        var pen = new Pen(Brushes.Black, 14 / _viewport.Zoom);
        for (var i = _lines.Count - 1; i >= 0; i--)
            if (_lines[i].Edge.Id != "step" && _lines[i].Geometry.StrokeContains(pen, new Point(world.X, world.Y))) return _lines[i].Edge.Id;
        return null;
    }

    private IBrush Brush(string key) =>
        this.TryFindResource(key, ActualThemeVariant, out var found) && found is IBrush brush ? brush : Brushes.Gray;

    private static double Fade(SceneEdge e) => e.Flags.HasFlag(EdgeFlags.Dim) ? 0.15 : e.Flags.HasFlag(EdgeFlags.Lane) ? 0.55 : e.Flags.HasFlag(EdgeFlags.Faint) ? 0.25 : 1;

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
            var title = new FormattedText(_scene.FrameName, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight,
                new Typeface(FontFamily.Default, FontStyle.Normal, FontWeight.SemiBold), 12, accent);
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
        if (lit) // a soft glow under it
        {
            var glow = accent is ISolidColorBrush solid ? new SolidColorBrush(solid.Color, 0.3) : accent;
            context.DrawGeometry(null, new Pen(glow, thickness + 5, lineCap: PenLineCap.Round), line.Geometry);
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

    private void DrawLabel(DrawingContext context, Drawn line, string text)
    {
        var e = line.Edge;
        using var opacity = context.PushOpacity(Fade(e));
        var formatted = new FormattedText(text, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight,
            new Typeface(FontFamily.Default, FontStyle.Normal, e.Flags.HasFlag(EdgeFlags.Active) ? FontWeight.SemiBold : FontWeight.Normal), 11, Brush("FgBrush"));
        var at = new Point(line.Path.Label.X - formatted.Width / 2, line.Path.Label.Y - formatted.Height / 2);
        context.DrawRectangle(Brush("BgBrush"), null, new Avalonia.Rect(at.X - 4, at.Y - 2, formatted.Width + 8, formatted.Height + 4), 2, 2);
        context.DrawText(formatted, at);
    }
}
