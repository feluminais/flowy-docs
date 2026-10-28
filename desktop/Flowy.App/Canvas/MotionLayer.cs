using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Flowy.Core;
using CoreRect = Flowy.Core.Rect;

namespace Flowy.App.Canvas;

/// <summary>
/// A tagged step playing: a blob running along the line between its two boxes (the lit line the canvas already draws), and rings,
/// flashes and waiting dots on the boxes. The ways a request can end add a puff and a cross where one is lost, a bar at the door of a
/// rejected one, a dashed clock while one waits, the reason as a note beside the line and a dashed marker for whoever takes one.
/// It sits over the boxes in the same camera, takes no pointer, and draws one step's beats at the time it is given (see
/// <see cref="MotionMath"/>). The squash of a box is the canvas's job.
/// </summary>
internal sealed class MotionLayer : Control
{
    /// <summary>Whoever takes an intercepted request: the box that stands for it on the canvas (with its outline), or a name for a party that is not on it.</summary>
    public sealed record Taker(CoreRect? Box = null, string? Shape = null, string? Name = null);

    /// <summary><c>Depth</c> is how tall a recursion's stack gets, which its counter says; <c>Total</c> is how long the run lasts.</summary>
    private sealed record Run(IReadOnlyList<Beat> Beats, Geometry Line, double Length, CoreRect From, CoreRect To, Geometry? ShapeFrom, Geometry? ShapeTo, CoreRect? TakerBox, Geometry? TakerShape, string? TakerName, string? Effect = null,
        int Depth = Animations.DepthDefault, int Total = 0);

    /// <summary>How strongly a shape lights up when it flashes, at the start.</summary>
    private const double Flash = 0.55;

    /// <summary>The ticks of a puff where a request is lost, and how far the dashed outline around a box that takes a request stands off it.</summary>
    private const int Ticks = 6;
    private const double Halo = 6;

    private static readonly Dictionary<string, Geometry> Glyphs = [];

    private IReadOnlyList<Run> _runs = [];
    private double _t;
    private bool _still;
    private (CoreRect Rect, int Depth)? _rest; // a recursion's counter at rest: where its box is and how deep it went

    public MotionLayer()
    {
        IsHitTestVisible = false;
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    /// <summary>One step to draw: its animation, whether it follows a landing, the line style, the two boxes (with the outline each shape has), and who takes it when it is intercepted.</summary>
    public sealed record RunSpec(StepAnimation Animation, bool AfterLanding, string Style, CoreRect From, CoreRect To, double[]? OutlineFrom = null, double[]? OutlineTo = null, string? ShapeFrom = null, string? ShapeTo = null, Taker? By = null);

    private IReadOnlyList<(IReadOnlyList<Beat> Beats, int Total)> Prepare(IReadOnlyList<RunSpec> specs)
    {
        var runs = new List<Run>();
        var started = new List<(IReadOnlyList<Beat> Beats, int Total)>();
        foreach (var s in specs)
        {
            // A recursion's pipe is a loop out of its one box and back in; every other kind runs along the line between two boxes.
            var data = s.Animation.Kind == "recurse" ? BoxGeometry.LoopAround(s.From, s.OutlineFrom) : LinePaths.Build(s.Style, s.From, s.To, s.OutlineFrom, s.OutlineTo).Data;
            var line = Geometry.Parse(data);
            var (beats, total) = Animations.BeatsFor(s.Animation, line.ContourLength, s.AfterLanding);
            // Whoever takes the request: its box, or the dashed marker that hangs below the line where the request leaves it.
            var by = s.By ?? (s.Animation.By is { } given ? new Taker(Name: given.Name ?? given.Shape) : null);
            CoreRect? takerBox = by?.Box;
            if (takerBox is null && by?.Name is { } name)
            {
                var size = MotionMath.MarkerSize(name);
                var spot = SpotAt(line, line.ContourLength, beats.FirstOrDefault(b => b.Do == "marker")?.Along ?? 0.4);
                var offset = MotionMath.MarkerSpot(spot.Dx, spot.Dy, size);
                takerBox = new CoreRect(spot.X + offset.X - size.Width / 2, spot.Y + offset.Y - size.Height / 2, size.Width, size.Height);
            }
            runs.Add(new Run(beats, line, line.ContourLength, s.From, s.To, s.ShapeFrom is null ? null : Geometry.Parse(s.ShapeFrom), s.ShapeTo is null ? null : Geometry.Parse(s.ShapeTo),
                takerBox, by?.Shape is { } shape ? Geometry.Parse(shape) : null, by?.Box is null ? by?.Name : null, s.Animation.Effect, s.Animation.Depth ?? Animations.DepthDefault, total));
            started.Add((beats, total));
        }
        _runs = runs;
        InvalidateVisual();
        return started;
    }

    /// <summary>
    /// Gets ready to draw several steps at once, each on the line between its boxes in its style, with the beats for how long it is.
    /// Returns each step's beats and how long they last, in the order given.
    /// </summary>
    public IReadOnlyList<(IReadOnlyList<Beat> Beats, int Total)> Start(IReadOnlyList<RunSpec> specs)
    {
        _still = false;
        _t = 0;
        return Prepare(specs);
    }

    /// <summary>
    /// Draws what motion leaves where a step's outcome happened, with nothing moving: the cross where a request was lost, the bar at the door, the clock, the
    /// marker of whoever took it and the reason. A step with no outcome draws nothing.
    /// </summary>
    public void StartStill(IReadOnlyList<RunSpec> specs)
    {
        _still = true;
        _t = 0;
        Prepare(specs);
    }

    /// <summary>Draws the step as it is <paramref name="t"/> ms in.</summary>
    public void Show(double t)
    {
        _t = t;
        InvalidateVisual();
    }

    /// <summary>The motion has finished: what stays (the cross, the bar, the marker) stays, and the rest is gone.</summary>
    public void Settle() => Show(double.MaxValue / 4);

    /// <summary>Shows a recursion's counter at rest on <paramref name="rect"/> (its box), or takes it away with null. It stays while a step's motion comes and goes.</summary>
    public void SetRest(CoreRect? rect, int depth)
    {
        _rest = rect is { } r ? (r, depth) : null;
        InvalidateVisual();
    }

    public void Clear()
    {
        _runs = [];
        _still = false;
        InvalidateVisual();
    }

    private IBrush Brush(string key) => AppTheme.Brush(this, key);

    /// <summary>The colour of a slot of the tints, which follows the theme.</summary>
    private static IBrush Tint(int slot)
    {
        var (light, dark) = MotionMath.TintPair(slot);
        return ThemeBrushes.For(light, dark);
    }

    private static Pen Round(IBrush brush, double thickness) => new(brush, thickness, lineCap: PenLineCap.Round, lineJoin: PenLineJoin.Round);

    private static Geometry Glyph(string? glyph)
    {
        var data = glyph switch { "envelope" => Icons.Mail, "bolt" => Icons.Bolt, "flag" => Icons.Flag, _ => Icons.Bell };
        if (!Glyphs.TryGetValue(data, out var geometry)) Glyphs[data] = geometry = Geometry.Parse(data);
        return geometry;
    }

    /// <summary>A point of a line as a fraction of its length, and the way the line runs there.</summary>
    private static (double X, double Y, double Dx, double Dy) SpotAt(Geometry line, double length, double fraction)
    {
        if (!line.TryGetPointAndTangentAtDistance(fraction * length, out var point, out var tangent)) return (0, 0, 1, 0);
        return (point.X, point.Y, tangent.X, tangent.Y);
    }

    /// <summary>A mark that stays once its beat has started: the cross where a request was lost, the bar at the door, and the marker of who takes it. The rest show only while their beat runs.</summary>
    private static bool Stays(Beat b) => b.Do is "pop" or "bar" or "marker";

    private bool Shown(Beat b) => Stays(b) ? _t >= b.At : MotionMath.Active(b, _t);

    /// <summary>The marks of an outcome, which are the only things a still picture has.</summary>
    private static bool IsMark(Beat b) => b.Do is "pop" or "bar" or "clock" or "note" or "marker";

    /// <summary>The beats of a step that are drawn now: those running at the time shown, and the marks that stay; with motion reduced, just the marks.</summary>
    private IEnumerable<Beat> Drawn(Run run) => _still ? run.Beats.Where(IsMark) : run.Beats.Where(Shown);

    /// <summary>Every beat of the steps being played, drawn or not, for the tests.</summary>
    public IReadOnlyList<Beat> AllBeats => _runs.SelectMany(r => r.Beats).ToList();

    /// <summary>The beats drawn now, for the tests: what <see cref="Render"/> would paint at the time <see cref="Show"/> was given.</summary>
    public IReadOnlyList<Beat> DrawnBeats => _runs.SelectMany(Drawn).ToList();

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        // A recursion's counter at rest says how deep it went: once its motion is over, or when there is none (motion is reduced). A recursion that moves draws its own.
        var recursing = !_still && _runs.Any(r => r.Beats.Any(b => b.Do == "stack"));
        if (_rest is { } rest && !recursing) DrawCounter(context, rest.Rect, MotionMath.PillText(false, 0, rest.Depth));
        if (_runs.Count == 0) return;

        if (_still)
        {
            // Reduced motion: once each of the marks an outcome leaves.
            var drawn = new HashSet<string>();
            foreach (var run in _runs)
                foreach (var beat in Drawn(run))
                    if (drawn.Add($"{beat.Do} {beat.On} {beat.Along} {beat.Text}")) DrawMark(context, run, beat);
            return;
        }
        foreach (var run in _runs)
        {
            // A recursion has no line in the model to light: its loop is drawn while it runs, as a step's own line is (dashed, in the accent).
            if (_t < run.Total && run.Beats.Any(b => b.Do == "stack"))
                context.DrawGeometry(null, new Pen(Brush("AccentBrush"), 2.5, new DashStyle([8 / 2.5, 5 / 2.5], 0), PenLineCap.Flat), run.Line);
            var now = Drawn(run).ToList();
            foreach (var beat in now.Where(b => b.Do == "marker")) DrawMark(context, run, beat);
            foreach (var beat in now.Where(b => b.Do == "blob")) DrawBlob(context, run, beat);
            foreach (var beat in now.Where(b => b.Do is "ring" or "flash" or "wait" or "drop")) DrawEffect(context, run, beat);
            foreach (var beat in now.Where(b => b.Do is "pop" or "bar" or "clock" or "note")) DrawMark(context, run, beat);
            // The pile of cards is a layer of its own under the boxes (see CardsLayer), so the counter reads the same pile.
            if (run.Beats.Any(b => b.Do == "stack")) DrawCounter(context, run.From, MotionMath.PillText(_t < run.Total, MotionMath.CardsAt(run.Beats, _t), run.Depth));
        }
    }

    /// <summary>The counter on a recursing box's top-right corner: a small pill in the accent's tint with the words in the accent.</summary>
    private void DrawCounter(DrawingContext context, CoreRect box, string words)
    {
        var accent = Brush("AccentBrush");
        var tint = accent is ISolidColorBrush a && Brush("BgBrush") is ISolidColorBrush b ? new SolidColorBrush(Mix(a.Color, b.Color, 0.14)) : Brush("BgBrush");
        var edge = new Pen(accent is ISolidColorBrush c ? new SolidColorBrush(c.Color, 0.55) : accent, 1);
        var text = new FormattedText(words, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, new Typeface(FontFamily.Default, FontStyle.Normal, FontWeight.Medium), 12, accent);
        var width = text.Width + 16;
        var pill = new Avalonia.Rect(box.Right - 6 - width, box.Y - 11, width, 22);
        context.DrawRectangle(tint, edge, pill, 11, 11);
        context.DrawText(text, new Point(pill.X + 8, pill.Y + (22 - text.Height) / 2));
    }

    /// <summary><paramref name="amount"/> of <paramref name="over"/> laid over <paramref name="under"/>, opaque.</summary>
    private static Color Mix(Color over, Color under, double amount) => Color.FromRgb(
        (byte)Math.Round(over.R * amount + under.R * (1 - amount)),
        (byte)Math.Round(over.G * amount + under.G * (1 - amount)),
        (byte)Math.Round(over.B * amount + under.B * (1 - amount)));

    private void DrawBlob(DrawingContext context, Run run, Beat beat)
    {
        var p = MotionMath.Progress(beat, _t);
        var bg = Brush("BgBrush");
        Point point;
        double angle;
        if (beat.On == "by")
        {
            // Off the line, straight to the one who takes it, and as far as its edge.
            var leave = SpotAt(run.Line, run.Length, beat.Start ?? 0);
            var land = run.TakerBox is { } box ? MotionMath.EntryPoint((leave.X, leave.Y), box) : (leave.X, leave.Y);
            var e = MotionMath.Ease(p);
            point = new Point(leave.X + (land.X - leave.X) * e, leave.Y + (land.Y - leave.Y) * e);
            angle = Math.Atan2(land.Y - leave.Y, land.X - leave.X);
        }
        else
        {
            var at = MotionMath.Distance(beat.Dir, p, run.Length, beat.Start, beat.End);
            if (!run.Line.TryGetPointAndTangentAtDistance(at, out point, out var tangent)) return;
            angle = Math.Atan2(tangent.Y, tangent.X);
        }
        // A blob keeps its shape unless the step asks for an effect (Animations.Effects), and one that waits where it is never moves for it.
        // The glyph or the words in it are never stretched, only its shape: see MotionMath.PoseOf.
        var waiting = beat.Start is not null && beat.Start == beat.End;
        var pose = run.Effect is null || waiting ? MotionMath.Still : MotionMath.PoseOf(run.Effect, beat.Label is not null, angle, p);
        var place = Matrix.CreateRotation(pose.Turn) * Matrix.CreateTranslation(point.X, point.Y + pose.Dy);
        var stretch = Matrix.CreateRotation(-pose.Rotation) * Matrix.CreateScale(pose.Sx * pose.Grow, pose.Sy * pose.Grow) * Matrix.CreateRotation(pose.Rotation) * place;
        // A refusal is the danger colour, then a colour of its own for a request in a burst, then the answer's colour.
        var tint = beat.Tint is { } slot ? Tint(slot) : null;
        var fill = Brush(beat.Tone switch { "reply" => "AppBrush", "fail" => "DangerBrush", _ => "AccentBrush" });
        if (beat.Tone != "fail" && tint is not null) fill = tint;
        var ring = beat.Ring == true ? new Pen(tint ?? Brush("AccentBrush"), 2.5) : null;
        var rim = new Pen(bg, 2);
        if (beat.Label is { } word)
        {
            var label = Animations.ShortLabel(word);
            var text = new FormattedText(label, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, new Typeface(FontFamily.Default, FontStyle.Normal, FontWeight.SemiBold), 12, bg);
            using (context.PushTransform(stretch))
            {
                context.DrawRectangle(fill, rim, new Avalonia.Rect(-text.Width / 2 - 10, -13, text.Width + 20, 26), 13, 13);
                if (ring is not null) context.DrawRectangle(null, ring, new Avalonia.Rect(-text.Width / 2 - 16, -19, text.Width + 32, 38), 19, 19);
            }
            using var _ = context.PushTransform(place);
            context.DrawText(text, new Point(-text.Width / 2, -text.Height / 2));
        }
        else
        {
            using (context.PushTransform(stretch))
            {
                context.DrawEllipse(fill, rim, new Point(0, 0), 15, 15);
                if (ring is not null) context.DrawEllipse(null, ring, new Point(0, 0), 21, 21);
            }
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
            case "flash" when beat.On == "by":
            {
                // The one who takes a request lights up: a box as its own outline, a party that is not on the canvas as its dashed pill.
                if (run.TakerBox is not { } t) break;
                var wash = new SolidColorBrush(((ISolidColorBrush)accent).Color, Flash * (1 - p));
                if (run.TakerShape is { } shape)
                {
                    shape.Transform = new MatrixTransform(Matrix.CreateScale(t.Width / 200, t.Height / 72) * Matrix.CreateTranslation(t.X, t.Y));
                    context.DrawGeometry(wash, null, shape);
                }
                else context.DrawRectangle(wash, null, new Avalonia.Rect(t.X, t.Y, t.Width, t.Height), 14, 14);
                break;
            }
            case "flash":
            {
                var tint = beat.Tone == "fail" ? Brush("DangerBrush") : accent; // a refusal flashes in the danger colour
                var wash = tint is ISolidColorBrush solid ? new SolidColorBrush(solid.Color, Flash * (1 - p)) : tint;
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

    private FormattedText Words(string text, IBrush brush) =>
        new(text, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, new Typeface(FontFamily.Default, FontStyle.Normal, FontWeight.SemiBold), 12, brush);

    /// <summary>The marks an outcome leaves, each as at <c>_t</c> (or as a still picture when motion is reduced): a puff and a cross, a bar, a clock, a note, a marker.</summary>
    private void DrawMark(DrawingContext context, Run run, Beat beat)
    {
        var p = _still ? 1 : MotionMath.Progress(beat, _t);
        var danger = Brush("DangerBrush");
        switch (beat.Do)
        {
            case "pop":
            {
                var spot = SpotAt(run.Line, run.Length, beat.Along!.Value);
                var ink = beat.Tint is { } slot ? Tint(slot) : Brush("AccentBrush");
                var centre = new Point(spot.X, spot.Y);
                if (p < 1)
                {
                    // The ring and the ticks go out and fade.
                    using var fade = context.PushOpacity(1 - p);
                    context.DrawEllipse(null, Round(ink, 3), centre, 6 + 22 * p, 6 + 22 * p);
                    for (var k = 0; k < Ticks; k++)
                    {
                        var angle = k / (double)Ticks * 2 * Math.PI + 0.3;
                        double near = 10 + 16 * p, far = 16 + 24 * p;
                        context.DrawLine(Round(ink, 3), new Point(centre.X + Math.Cos(angle) * near, centre.Y + Math.Sin(angle) * near), new Point(centre.X + Math.Cos(angle) * far, centre.Y + Math.Sin(angle) * far));
                    }
                }
                // The cross stays where the request vanished.
                var grow = 0.5 + 0.5 * Math.Min(1, p * 4);
                using (context.PushOpacity(0.9 * Math.Min(1, p * 5)))
                using (context.PushTransform(Matrix.CreateScale(grow, grow) * Matrix.CreateTranslation(centre.X, centre.Y)))
                {
                    context.DrawLine(Round(danger, 3.5), new Point(-7, -7), new Point(7, 7));
                    context.DrawLine(Round(danger, 3.5), new Point(7, -7), new Point(-7, 7));
                }
                break;
            }
            case "bar":
            {
                // The bar at the receiver's door flashes in thick, settles, and stays.
                var spot = SpotAt(run.Line, run.Length, beat.Along!.Value);
                using (context.PushOpacity(Math.Min(1, p * 8)))
                using (context.PushTransform(Matrix.CreateRotation(Math.Atan2(spot.Dy, spot.Dx)) * Matrix.CreateTranslation(spot.X, spot.Y)))
                    context.DrawLine(Round(danger, 7 + 6 * Math.Max(0, 1 - p * 4)), new Point(0, -22), new Point(0, 22));
                break;
            }
            case "clock":
            {
                // A dashed dial that turns, a dot going round it, and for a still picture the hands (a waiting request would cover them).
                var spot = SpotAt(run.Line, run.Length, beat.Along!.Value);
                var muted = Brush("MutedBrush");
                var accent = Brush("AccentBrush");
                var centre = new Point(spot.X, spot.Y);
                using var fade = context.PushOpacity(_still ? 1 : MotionMath.TubeOpacity(beat, _t));
                var turn = _still ? 0 : _t / 1000 * 18.85 / 2; // 8 s a turn, in units of the pen
                context.DrawEllipse(null, new Pen(muted, 2, new DashStyle([1.5, 2.5], turn), PenLineCap.Flat), centre, 24, 24);
                var orbit = (_still ? -60 : -60 + 360 * (_t % 1600) / 1600) * Math.PI / 180;
                context.DrawEllipse(accent, null, new Point(centre.X + Math.Cos(orbit) * 24, centre.Y + Math.Sin(orbit) * 24), 3.5, 3.5);
                if (_still)
                {
                    context.DrawLine(Round(muted, 2), centre, new Point(centre.X, centre.Y - 10));
                    context.DrawLine(Round(muted, 2), centre, new Point(centre.X + 7, centre.Y + 4));
                }
                break;
            }
            case "note":
            {
                // The reason, beside where it happened on the lower side of the line, or under the one who takes the request.
                Point at;
                if (beat.On == "by")
                {
                    if (run.TakerBox is not { } t) break;
                    at = new Point(t.X + t.Width / 2, t.Y + t.Height + Halo + 12);
                }
                else
                {
                    var spot = SpotAt(run.Line, run.Length, beat.Along!.Value);
                    var offset = MotionMath.NoteSpot(spot.Dx, spot.Dy, (beat.Text ?? "").Length);
                    at = new Point(spot.X + offset.X, spot.Y + offset.Y);
                }
                var text = Words(beat.Text ?? "", Brush("FgBrush"));
                var origin = new Point(at.X - text.Width / 2, at.Y - text.Height / 2);
                using var fade = context.PushOpacity(_still ? 1 : MotionMath.TubeOpacity(beat, _t));
                // Painted with an outline of the canvas colour, so it reads over a line.
                if (text.BuildGeometry(origin) is { } outline) context.DrawGeometry(null, Round(Brush("BgBrush"), 4), outline);
                context.DrawText(text, origin);
                break;
            }
            case "marker":
            {
                // Whoever takes a request, for the whole step: a party that is not on the canvas as a dashed pill with its name, a box as a dashed outline around it.
                if (run.TakerBox is not { } t) break;
                var dashed = new Pen(Brush("MutedBrush"), 1.5, new DashStyle([5 / 1.5, 4 / 1.5], 0));
                using var fade = context.PushOpacity(_still ? 1 : Math.Min(1, (_t - beat.At) / 150));
                if (run.TakerShape is not null) context.DrawRectangle(null, dashed, new Avalonia.Rect(t.X - Halo, t.Y - Halo, t.Width + 2 * Halo, t.Height + 2 * Halo), 16, 16);
                else if (run.TakerName is { } name)
                {
                    context.DrawRectangle(Brush("BgBrush"), dashed, new Avalonia.Rect(t.X, t.Y, t.Width, t.Height), 14, 14);
                    var text = Words(name, Brush("FgBrush"));
                    context.DrawText(text, new Point(t.X + t.Width / 2 - text.Width / 2, t.Y + t.Height / 2 - text.Height / 2));
                }
                break;
            }
        }
    }
}
