using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Flowy.Core;
using CoreRect = Flowy.Core.Rect;

namespace Flowy.App.Canvas;

/// <summary>
/// A tagged step playing: the line between its two boxes as a pipe, a blob running through it with the pipe swelling around it, and rings,
/// flashes and waiting dots on the boxes. It sits over the boxes in the same camera, takes no pointer, and draws one step's beats at the
/// time it is given (see <see cref="MotionMath"/>). The squash of a box is the canvas's job.
/// </summary>
internal sealed class MotionLayer : Control
{
    private const double Swell = 46; // how much of the pipe bulges around a blob

    /// <summary><c>ShapePath</c> is the first box's shape in its own 200 x 72 area and <c>Depth</c> how tall a recursion's stack gets: what its cards and counter are drawn from.</summary>
    private sealed record Run(IReadOnlyList<Beat> Beats, Geometry Line, double Length, CoreRect From, CoreRect To, string? ShapePath, int Depth);

    private static readonly Dictionary<string, Geometry> Glyphs = [];

    private Run? _run;
    private double _t;
    private Viewport _viewport = new(0, 0, 1);

    public MotionLayer()
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

    /// <summary>Gets ready to draw a step: the line between its boxes in <paramref name="style"/>, and the beats for how long it is. Returns the beats and how long they last.</summary>
    public (IReadOnlyList<Beat> Beats, int Total) Start(StepAnimation animation, bool afterLanding, string style, CoreRect from, CoreRect to, double[]? outlineFrom = null, double[]? outlineTo = null, string? shapePath = null)
    {
        // A recursion's pipe is a loop out of its one box and back in; every other kind runs along the line between two boxes.
        var data = animation.Kind == "recurse" ? BoxGeometry.LoopAround(from, outlineFrom) : LinePaths.Build(style, from, to, outlineFrom, outlineTo).Data;
        var line = Geometry.Parse(data);
        var (beats, total) = Animations.BeatsFor(animation, line.ContourLength, afterLanding);
        _run = new Run(beats, line, line.ContourLength, from, to, shapePath, animation.Depth ?? Animations.DepthDefault);
        _t = 0;
        InvalidateVisual();
        return (beats, total);
    }

    /// <summary>Draws the step as it is <paramref name="t"/> ms in.</summary>
    public void Show(double t)
    {
        _t = t;
        InvalidateVisual();
    }

    public void Clear()
    {
        _run = null;
        InvalidateVisual();
    }

    private IBrush Brush(string key) =>
        this.TryFindResource(key, ActualThemeVariant, out var found) && found is IBrush brush ? brush : Brushes.Gray;

    private static Pen Round(IBrush brush, double thickness) => new(brush, thickness, lineCap: PenLineCap.Round, lineJoin: PenLineJoin.Round);

    private static Geometry Glyph(string? glyph)
    {
        var data = glyph switch { "envelope" => Icons.Mail, "bolt" => Icons.Bolt, "flag" => Icons.Flag, _ => Icons.Bell };
        if (!Glyphs.TryGetValue(data, out var geometry)) Glyphs[data] = geometry = Geometry.Parse(data);
        return geometry;
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        if (_run is not { } run) return;
        var matrix = Matrix.CreateScale(_viewport.Zoom, _viewport.Zoom) * Matrix.CreateTranslation(_viewport.X, _viewport.Y);
        using var _ = context.PushTransform(matrix);

        foreach (var beat in run.Beats.Where(b => b.Do == "pipe"))
        {
            using var fade = context.PushOpacity(MotionMath.TubeOpacity(beat, _t));
            context.DrawGeometry(null, Round(Brush("AccentBrush"), 15), run.Line);
            context.DrawGeometry(null, Round(Brush("BgBrush"), 10), run.Line);
        }
        foreach (var beat in run.Beats.Where(b => b.Do == "blob" && MotionMath.Active(b, _t))) DrawBlob(context, run, beat);
        foreach (var beat in run.Beats.Where(b => b.Do is "ring" or "flash" or "wait" or "drop" && MotionMath.Active(b, _t))) DrawEffect(context, run, beat);
    }

    private void DrawBlob(DrawingContext context, Run run, Beat beat)
    {
        var p = MotionMath.Progress(beat, _t);
        var at = MotionMath.Distance(beat.Dir, p, run.Length);
        var accent = Brush("AccentBrush");
        var bg = Brush("BgBrush");
        if (run.Line.TryGetSegment(Math.Max(0, at - Swell / 2), Math.Min(run.Length, at + Swell / 2), true, out var swell) && swell is not null)
        {
            context.DrawGeometry(null, Round(accent, 23), swell);
            context.DrawGeometry(null, Round(bg, 18), swell);
        }
        if (!run.Line.TryGetPointAndTangentAtDistance(at, out var point, out var tangent)) return;
        var angle = Math.Atan2(tangent.Y, tangent.X);
        var s = MotionMath.Bump(p);
        // Stretched along the way it runs and no more rotated than that, so the glyph stays upright.
        using var _ = context.PushTransform(
            Matrix.CreateRotation(-angle) * Matrix.CreateScale(1 + 0.3 * s, 1 - 0.15 * s) * Matrix.CreateRotation(angle) * Matrix.CreateTranslation(point.X, point.Y));
        var fill = Brush(beat.Tone == "reply" ? "AppBrush" : "AccentBrush");
        var rim = new Pen(bg, 2);
        if (beat.Label is { } label)
        {
            var text = new FormattedText(label, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, new Typeface(FontFamily.Default, FontStyle.Normal, FontWeight.SemiBold), 12, bg);
            context.DrawRectangle(fill, rim, new Avalonia.Rect(-text.Width / 2 - 10, -13, text.Width + 20, 26), 13, 13);
            context.DrawText(text, new Point(-text.Width / 2, -text.Height / 2));
        }
        else
        {
            context.DrawEllipse(fill, rim, new Point(0, 0), 15, 15);
            DrawGlyph(context, beat.Glyph, bg, 18, new Point(0, 0));
        }
    }

    /// <summary>A glyph on the 24-unit grid, drawn <paramref name="size"/> wide and centred on <paramref name="centre"/>.</summary>
    private static void DrawGlyph(DrawingContext context, string? glyph, IBrush brush, double size, Point centre)
    {
        var scale = size / 24;
        using var _ = context.PushTransform(Matrix.CreateTranslation(-12, -12) * Matrix.CreateScale(scale, scale) * Matrix.CreateTranslation(centre.X, centre.Y));
        context.DrawGeometry(null, Round(brush, 2), Glyph(glyph));
    }

    private void DrawEffect(DrawingContext context, Run run, Beat beat)
    {
        var p = MotionMath.Progress(beat, _t);
        var r = beat.On == "to" ? run.To : run.From;
        var accent = Brush("AccentBrush");
        switch (beat.Do)
        {
            case "ring":
            {
                var grow = 6 + 22 * p;
                using var fade = context.PushOpacity(1 - p);
                context.DrawRectangle(null, new Pen(accent, 3), new Avalonia.Rect(r.X - grow, r.Y - grow, r.Width + 2 * grow, r.Height + 2 * grow), 14 + grow, 14 + grow);
                break;
            }
            case "flash":
            {
                var wash = accent is ISolidColorBrush solid ? new SolidColorBrush(solid.Color, 0.4 * (1 - p)) : accent;
                context.DrawRectangle(wash, null, new Avalonia.Rect(r.X, r.Y, r.Width, r.Height), 14, 14);
                break;
            }
            case "wait":
                for (var k = 0; k < 3; k++)
                {
                    using var dot = context.PushOpacity(Math.Floor(_t / 150) % 3 == k ? 1 : 0.3);
                    context.DrawEllipse(accent, null, new Point(r.X + r.Width / 2 + (k - 1) * 12, r.Y - 14), 3.5, 3.5);
                }
                break;
            case "drop":
            {
                using var fade = context.PushOpacity(1 - Math.Max(0, (p - 0.8) / 0.2));
                DrawGlyph(context, beat.Glyph, accent, 26, new Point(r.X + r.Width / 2, r.Y - 50 + 50 * MotionMath.Ease(p)));
                break;
            }
        }
    }
}
