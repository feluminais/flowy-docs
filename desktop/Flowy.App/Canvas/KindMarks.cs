using System.Globalization;
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
/// What a trunk wears (several lines of a pair stacked as one, see <see cref="Trunks"/>): two hairlines behind its line, on its outer side, and a chip with the number of connections on its
/// middle. Twin of the trunk-hair and trunk-chip drawing in ui/src/Line.tsx and ui/src/kinds.tsx; the canvas and the key's swatch draw them through here.
/// </summary>
internal static class TrunkMarks
{
    /// <summary>How tall a chip is (and the least it is wide).</summary>
    internal const double ChipHeight = 16;

    /// <summary>How far from the middle of its line the chip of a trunk sits among the trunks of a pair: neighbouring chips alternate 9 above and 9 below, so they do not touch. A pair of one trunk keeps its chip on the middle.</summary>
    internal static double Stagger(int lane, int lanes) => lanes > 1 ? (lane % 2 == 0 ? -9 : 9) : 0;

    /// <summary>How wide a chip with this number is: 8 px and 6 for each digit, no less than it is tall.</summary>
    internal static double ChipWidth(int size) => Math.Max(ChipHeight, 8 + 6 * size.ToString(CultureInfo.InvariantCulture).Length);

    /// <summary>The two hairlines: the line's own shape moved <see cref="Lanes.HairlineGap"/> and twice that along <paramref name="step"/> (the unit step out of <see cref="Lanes.StackStep"/>), 1 px wide at 60% in the line's colour.</summary>
    internal static void Hairlines(DrawingContext context, Geometry line, IBrush ink, CorePt step)
    {
        using var faint = context.PushOpacity(0.6);
        var pen = new Pen(ink, 1, null, PenLineCap.Flat);
        foreach (var k in new[] { 1, 2 })
        {
            using var moved = context.PushTransform(Matrix.CreateTranslation(Lanes.Round3(step.X * Lanes.HairlineGap * k), Lanes.Round3(step.Y * Lanes.HairlineGap * k)));
            context.DrawGeometry(null, pen, line);
        }
    }

    /// <summary>The chip: the number of connections in a pill centred on <paramref name="at"/>, outlined in the line's colour over <paramref name="ground"/>.</summary>
    internal static void Chip(DrawingContext context, int size, CorePt at, IBrush outline, IBrush ground, IBrush text)
    {
        var number = new FormattedText(size.ToString(CultureInfo.InvariantCulture), CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, new Typeface(FontFamily.Default), 10, text);
        var width = ChipWidth(size);
        context.DrawRectangle(ground, new Pen(outline, 1), new Avalonia.Rect(at.X - width / 2, at.Y - ChipHeight / 2, width, ChipHeight), ChipHeight / 2, ChipHeight / 2);
        context.DrawText(number, new Point(at.X - number.Width / 2, at.Y - number.Height / 2));
    }
}

/// <summary>
/// A line drawn small with its pattern and both marks, as the canvas draws it: a swatch in the key at the canvas's foot, a tile of the kind picker and the mark at the head of a
/// line's panel. It draws the marks the canvas does (<see cref="KindKey.MarksOf"/>), so a line that carries connections both ways has a head at each end and no tail. It takes the line's colour and the background from the theme it sits in. Decorative: the name beside it is the meaning.
/// </summary>
internal sealed class LookSwatch : Control
{
    private readonly LineLook _look;
    private readonly bool _both;
    private readonly bool _inUse;

    /// <param name="look">The pattern and marks to draw; null for the plain line.</param>
    /// <param name="both">The line carries connections both ways: a head at each end and no tail.</param>
    /// <param name="inUse">The line is drawn as a lane a step plays on: in the accent colour, a little thicker (the key's "In use").</param>
    public LookSwatch(LineLook? look, double width = 56, double height = 18, bool both = false, bool inUse = false)
    {
        _look = look ?? Kinds.PlainLook;
        _both = both;
        _inUse = inUse;
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

    /// <summary>Whether it is drawn as a lane in use, for tests.</summary>
    internal bool InUse => _inUse;

    private const double Thickness = 1.5;
    private const double LitThickness = 2.5;
    private const double Pad = 3;

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        Sketch(context, _look, _both, AppTheme.Brush(this, _inUse ? "AccentBrush" : "EdgeBrush"), AppTheme.Brush(this, "BgBrush"), Pad, Width - Pad, Height / 2, _inUse ? LitThickness : Thickness);
    }

    /// <summary>A line drawn small from (<paramref name="x0"/>, <paramref name="y"/>) to (<paramref name="x1"/>, <paramref name="y"/>) with its pattern and marks: what a swatch is, and the sample that starts the label of a line among others on the canvas.</summary>
    internal static void Sketch(DrawingContext context, LineLook look, bool both, IBrush ink, IBrush ground, double x0, double x1, double y, double thickness = Thickness)
    {
        context.DrawLine(new Pen(ink, thickness, KindMarks.Dash(Kinds.Dashes(look.Pattern), thickness), PenLineCap.Flat), new Point(x0, y), new Point(x1, y));
        var marks = KindKey.MarksOf(look, both);
        if (marks.Tail is { } tail) KindMarks.Draw(context, tail, ink, ground, new CorePt(x0, y), new CorePt(-1, 0));
        KindMarks.Draw(context, marks.Head, ink, ground, new CorePt(x1, y), new CorePt(1, 0));
        if (marks.HeadAtStart) KindMarks.Draw(context, marks.Head, ink, ground, new CorePt(x0, y), new CorePt(-1, 0));
    }
}

/// <summary>
/// A trunk drawn small, as the canvas draws it: a line with two hairlines behind it, its filled head, and the chip with a number on its middle. The swatch of "Stacked lines" in the key. Twin of
/// StackedSwatch in ui/src/kinds.tsx. Decorative: the name beside it is the meaning.
/// </summary>
internal sealed class TrunkSwatch : Control
{
    /// <summary>The number on the chip: any, to show that it is a count.</summary>
    internal const int Sample = 3;

    public TrunkSwatch(double width = 56, double height = 22)
    {
        Width = width;
        Height = height;
        IsHitTestVisible = false;
        VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center;
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        const double pad = 3;
        const double y = 7;
        var ink = AppTheme.Brush(this, "EdgeBrush");
        var line = new StreamGeometry();
        using (var g = line.Open())
        {
            g.BeginFigure(new Point(pad, y), false);
            g.LineTo(new Point(Width - pad, y));
            g.EndFigure(false);
        }
        TrunkMarks.Hairlines(context, line, ink, new CorePt(0, 1));
        context.DrawLine(new Pen(ink, 1.5, null, PenLineCap.Flat), new Point(pad, y), new Point(Width - pad, y));
        KindMarks.Draw(context, KindKey.MarksOf(null, false).Head, ink, AppTheme.Brush(this, "BgBrush"), new CorePt(Width - pad, y), new CorePt(1, 0));
        TrunkMarks.Chip(context, Sample, new CorePt(Width / 2, y), ink, AppTheme.Brush(this, "BoxBrush"), AppTheme.Brush(this, "FgBrush"));
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
