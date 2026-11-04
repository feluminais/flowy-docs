using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Flowy.Core;
using CorePt = Flowy.Core.Pt;

namespace Flowy.App.Canvas;

/// <summary>
/// The marks at the ends of a line, drawn from the one table the browser draws from (<see cref="Kinds.Marks"/>): a mark is a shape in a frame of its own, placed by the same
/// matrix as an arrowhead (<see cref="Heads.Matrix"/>), so it is the same size and sits the same way on the canvas, in the key and in a panel.
/// </summary>
internal static class KindMarks
{
    private static readonly Dictionary<string, Geometry> Shapes = [];

    /// <summary>A mark's shape, parsed once.</summary>
    private static Geometry ShapeOf(string shape)
    {
        lock (Shapes)
        {
            if (!Shapes.TryGetValue(shape, out var found)) Shapes[shape] = found = Geometry.Parse(Kinds.Marks[shape].Path);
            return found;
        }
    }

    /// <summary>
    /// Draws a mark with its tip at <paramref name="at"/>, pointing along <paramref name="dir"/> (a unit vector out of the line there), <paramref name="scale"/> times its size.
    /// A filled mark is filled with <paramref name="ink"/>; a stroked one is only an outline in it; a hollow one is an outline over <paramref name="ground"/>, so the line does not
    /// show through it. The stroke widths are the table's, in the mark's own frame, so they grow with the mark as an SVG stroke does.
    /// </summary>
    public static void Draw(DrawingContext context, string shape, IBrush ink, IBrush ground, CorePt at, CorePt dir, double scale = 1)
    {
        var mark = Kinds.Marks[shape];
        var m = Heads.Matrix(at, dir, scale);
        using (context.PushTransform(new Matrix(m.A, m.B, m.C, m.D, m.E, m.F)))
        {
            var pen = mark.Paint == "fill" ? null : new Pen(ink, mark.Width, null, PenLineCap.Round, PenLineJoin.Round);
            var fill = mark.Paint switch { "fill" => ink, "hollow" => ground, _ => null };
            context.DrawGeometry(fill, pen, ShapeOf(shape));
        }
    }

    /// <summary>The dashes (px, as SVG counts them) as a pen <paramref name="thickness"/> thick takes them, a dash being counted in its own widths; null for a solid line.</summary>
    public static DashStyle? Dash(IReadOnlyList<double>? dashes, double thickness) =>
        dashes is { Count: > 0 } ? new DashStyle(dashes.Select(d => d / thickness).ToList(), 0) : null;
}

/// <summary>
/// A line drawn small with its pattern and both marks, as the canvas draws it: a swatch in the key at the canvas's foot, a tile of the kind picker and the mark at the head of a
/// line's panel. It draws the marks the canvas does (<see cref="KindKey.MarksOf"/>), so a line that carries connections both ways has a head at each end and no tail. It takes the line's colour and the background from the theme it sits in. Decorative: the name beside it is the meaning.
/// </summary>
internal sealed class LookSwatch : Control
{
    private readonly LineLook _look;
    private readonly bool _both;

    /// <param name="look">The pattern and marks to draw; null for the plain line.</param>
    /// <param name="both">The line carries connections both ways: a head at each end and no tail.</param>
    public LookSwatch(LineLook? look, double width = 56, double height = 18, bool both = false)
    {
        _look = look ?? Kinds.PlainLook;
        _both = both;
        Width = width;
        Height = height;
        IsHitTestVisible = false;
        VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center;
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    /// <summary>The look drawn, for tests.</summary>
    internal LineLook Look => _look;

    /// <summary>The marks drawn, for tests.</summary>
    internal LineMarks Marks => KindKey.MarksOf(_look, _both);

    private const double Thickness = 1.5;
    private const double Pad = 3;

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var ink = AppTheme.Brush(this, "EdgeBrush");
        var ground = AppTheme.Brush(this, "BgBrush");
        var (x0, x1, y) = (Pad, Width - Pad, Height / 2);
        context.DrawLine(new Pen(ink, Thickness, KindMarks.Dash(Kinds.Dashes(_look.Pattern), Thickness), PenLineCap.Flat), new Point(x0, y), new Point(x1, y));
        var marks = Marks;
        if (marks.Tail is { } tail) KindMarks.Draw(context, tail, ink, ground, new CorePt(x0, y), new CorePt(-1, 0));
        KindMarks.Draw(context, marks.Head, ink, ground, new CorePt(x1, y), new CorePt(1, 0));
        if (marks.HeadAtStart) KindMarks.Draw(context, marks.Head, ink, ground, new CorePt(x0, y), new CorePt(-1, 0));
    }
}

/// <summary>
/// How a pair of shapes is drawn, as a tile: two boxes with one line between them (merged) or a line for each connection, side by side (separate). Twin of the sketch in PairsPicker in
/// ui/src/Pickers.tsx. It takes the outline of the boxes and the lines from the theme it sits in. Decorative: the name beside it is the meaning.
/// </summary>
internal sealed class PairsSwatch : Control
{
    private readonly string _mode;

    public PairsSwatch(string mode, double width = 44, double height = 24)
    {
        _mode = mode;
        Width = width;
        Height = height;
        IsHitTestVisible = false;
        VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center;
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    /// <summary>The mode drawn, for tests.</summary>
    internal string Mode => _mode;

    /// <summary>How many lines are drawn between the boxes, for tests.</summary>
    internal int Lines => _mode == "separate" ? 3 : 1;

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var ink = AppTheme.Brush(this, "FgBrush");
        var pen = new Pen(ink, 1.5, null, PenLineCap.Round);
        var scale = Height / 24;
        context.DrawRectangle(null, pen, new Avalonia.Rect(2 * scale, 3 * scale, 8 * scale, 18 * scale), 2 * scale, 2 * scale);
        context.DrawRectangle(null, pen, new Avalonia.Rect(Width - 10 * scale, 3 * scale, 8 * scale, 18 * scale), 2 * scale, 2 * scale);
        foreach (var y in _mode == "separate" ? new[] { 7.0, 12, 17 } : [12.0])
            context.DrawLine(pen, new Point(10 * scale, y * scale), new Point(Width - 10 * scale, y * scale));
    }
}
