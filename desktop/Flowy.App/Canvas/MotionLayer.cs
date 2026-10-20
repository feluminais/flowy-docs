using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Flowy.Core;
using CoreRect = Flowy.Core.Rect;

namespace Flowy.App.Canvas;

/// <summary>
/// A tagged step playing: a blob running along the line between its two boxes (the lit line the canvas already draws), and rings,
/// flashes and waiting dots on the boxes. It sits over the boxes in the same camera, takes no pointer, and draws one step's beats at the
/// time it is given (see <see cref="MotionMath"/>). The squash of a box is the canvas's job.
/// </summary>
internal sealed class MotionLayer : Control
{

    private sealed record Run(IReadOnlyList<Beat> Beats, Geometry Line, double Length, CoreRect From, CoreRect To, Geometry? ShapeFrom, Geometry? ShapeTo);

    /// <summary>How strongly a shape lights up when it flashes, at the start.</summary>
    private const double Flash = 0.55;

    private static readonly Dictionary<string, Geometry> Glyphs = [];

    private IReadOnlyList<Run> _runs = [];
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

    /// <summary>One step to draw: its animation, whether it follows a landing, the line style, and the two boxes (with the outline each shape has).</summary>
    public sealed record RunSpec(StepAnimation Animation, bool AfterLanding, string Style, CoreRect From, CoreRect To, double[]? OutlineFrom = null, double[]? OutlineTo = null, string? ShapeFrom = null, string? ShapeTo = null);

    /// <summary>
    /// Gets ready to draw several steps at once, each on the line between its boxes in its style, with the beats for how long it is.
    /// Returns each step's beats and how long they last, in the order given.
    /// </summary>
    public IReadOnlyList<(IReadOnlyList<Beat> Beats, int Total)> Start(IReadOnlyList<RunSpec> specs)
    {
        var runs = new List<Run>();
        var started = new List<(IReadOnlyList<Beat> Beats, int Total)>();
        foreach (var s in specs)
        {
            var line = Geometry.Parse(LinePaths.Build(s.Style, s.From, s.To, s.OutlineFrom, s.OutlineTo).Data);
            var (beats, total) = Animations.BeatsFor(s.Animation, line.ContourLength, s.AfterLanding);
            runs.Add(new Run(beats, line, line.ContourLength, s.From, s.To, s.ShapeFrom is null ? null : Geometry.Parse(s.ShapeFrom), s.ShapeTo is null ? null : Geometry.Parse(s.ShapeTo)));
            started.Add((beats, total));
        }
        _runs = runs;
        _t = 0;
        InvalidateVisual();
        return started;
    }

    /// <summary>Draws the step as it is <paramref name="t"/> ms in.</summary>
    public void Show(double t)
    {
        _t = t;
        InvalidateVisual();
    }

    public void Clear()
    {
        _runs = [];
        InvalidateVisual();
    }

    private IBrush Brush(string key) =>
        this.TryFindResource(key, ActualThemeVariant, out var found) && found is IBrush brush ? brush : Brushes.Gray;

    private static Pen Round(IBrush brush, double thickness) => new(brush, thickness, lineCap: PenLineCap.Round, lineJoin: PenLineJoin.Round);

    private static Geometry Glyph(string? glyph)
    {
        var data = glyph switch { "envelope" => Icons.Mail, "bolt" => Icons.Bolt, _ => Icons.Bell };
        if (!Glyphs.TryGetValue(data, out var geometry)) Glyphs[data] = geometry = Geometry.Parse(data);
        return geometry;
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        if (_runs.Count == 0) return;
        var matrix = Matrix.CreateScale(_viewport.Zoom, _viewport.Zoom) * Matrix.CreateTranslation(_viewport.X, _viewport.Y);
        using var _ = context.PushTransform(matrix);

        foreach (var run in _runs)
        {
            foreach (var beat in run.Beats.Where(b => b.Do == "blob" && MotionMath.Active(b, _t))) DrawBlob(context, run, beat);
            foreach (var beat in run.Beats.Where(b => b.Do is "ring" or "flash" or "wait" or "drop" && MotionMath.Active(b, _t))) DrawEffect(context, run, beat);
        }
    }

    private void DrawBlob(DrawingContext context, Run run, Beat beat)
    {
        var p = MotionMath.Progress(beat, _t);
        var at = MotionMath.Distance(beat.Dir, p, run.Length);
        var bg = Brush("BgBrush");
        if (!run.Line.TryGetPointAndTangentAtDistance(at, out var point, out var tangent)) return;
        var angle = Math.Atan2(tangent.Y, tangent.X);
        var s = MotionMath.Bump(p);
        // The shape is stretched along the way it runs and no more rotated than that. The glyph or the words in it are not stretched at all.
        var place = Matrix.CreateTranslation(point.X, point.Y);
        var stretch = Matrix.CreateRotation(-angle) * Matrix.CreateScale(1 + 0.3 * s, 1 - 0.15 * s) * Matrix.CreateRotation(angle) * place;
        var fill = Brush(beat.Tone == "reply" ? "AppBrush" : "AccentBrush");
        var rim = new Pen(bg, 2);
        if (beat.Label is { } label)
        {
            var text = new FormattedText(label, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, new Typeface(FontFamily.Default, FontStyle.Normal, FontWeight.SemiBold), 12, bg);
            using (context.PushTransform(stretch))
                context.DrawRectangle(fill, rim, new Avalonia.Rect(-text.Width / 2 - 10, -13, text.Width + 20, 26), 13, 13);
            using var _ = context.PushTransform(place);
            context.DrawText(text, new Point(-text.Width / 2, -text.Height / 2));
        }
        else
        {
            using (context.PushTransform(stretch))
                context.DrawEllipse(fill, rim, new Point(0, 0), 15, 15);
            using var _ = context.PushTransform(place);
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
            // The ring and the flash follow the outline of the shape they are on, drawn in the 200 by 72 area every shape has.
            case "ring":
            {
                var grow = 6 + 22 * p;
                using var fade = context.PushOpacity(1 - p);
                var outline = beat.On == "to" ? run.ShapeTo : run.ShapeFrom;
                if (outline is null) context.DrawRectangle(null, new Pen(accent, 3), new Avalonia.Rect(r.X - grow, r.Y - grow, r.Width + 2 * grow, r.Height + 2 * grow), 14 + grow, 14 + grow);
                else
                {
                    outline.Transform = new MatrixTransform(Matrix.CreateTranslation(-100, -36) * Matrix.CreateScale((r.Width + 2 * grow) / 200, (r.Height + 2 * grow) / 72) * Matrix.CreateTranslation(r.X + r.Width / 2, r.Y + r.Height / 2));
                    context.DrawGeometry(null, new Pen(accent, 3), outline);
                }
                break;
            }
            case "flash":
            {
                var wash = accent is ISolidColorBrush solid ? new SolidColorBrush(solid.Color, Flash * (1 - p)) : accent;
                var outline = beat.On == "to" ? run.ShapeTo : run.ShapeFrom;
                if (outline is null) context.DrawRectangle(wash, null, new Avalonia.Rect(r.X, r.Y, r.Width, r.Height), 14, 14);
                else
                {
                    outline.Transform = new MatrixTransform(Matrix.CreateScale(r.Width / 200, r.Height / 72) * Matrix.CreateTranslation(r.X, r.Y));
                    context.DrawGeometry(wash, null, outline);
                }
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
