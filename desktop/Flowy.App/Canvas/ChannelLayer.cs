using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Flowy.Core;
using CoreRect = Flowy.Core.Rect;

namespace Flowy.App.Canvas;

/// <summary>
/// The drawings of an open channel and the numbers that move them, the same as the browser's (ui/src/Channels.tsx and the <c>.channels</c> block of ui/src/style.css):
/// dots that run along a stream's line, a disc on the top edge of a shape with a bell or a turning arc in it, and rings that go out from a listener's bell.
/// The layer and the key under the player both draw through these, so a swatch is the real mark.
/// </summary>
internal static class ChannelDraw
{
    /// <summary>The radius of the disc of a listener or a job, and how far apart the discs on one shape's top edge stand.</summary>
    public const double Disc = 11;
    public const double Gap = 4;

    /// <summary>How far apart a stream's dots run along its line, and how far the dots of a tether (the dotted line from a listener to the shape it listens to) stand.</summary>
    public const double Pitch = 12;
    public const double TetherPitch = 7;

    /// <summary>How fast a stream's dots run (a pitch in 0.7 s), in the diagram's units a second.</summary>
    public const double Speed = 12.1 / 0.7;

    /// <summary>How long the mark takes to come in when its step has landed, to go when it is closed, to turn once as a job, and how long a ring takes to go out.</summary>
    public const double InMs = 500;
    public const double OutMs = 600;
    public const double TurnMs = 1400;
    public const double RippleMs = 2400;

    /// <summary>The ring that a listener sends out, and the one after it, half a ripple later.</summary>
    public const double RippleGrow = 1.3;

    private static readonly Dictionary<string, Geometry> Glyphs = [];

    private static Geometry GlyphOf(string kind)
    {
        var data = kind == "job" ? Icons.Loader : Icons.Bell;
        if (!Glyphs.TryGetValue(data, out var geometry)) Glyphs[data] = geometry = Geometry.Parse(data);
        return geometry;
    }

    /// <summary>
    /// How much of the mark shows <paramref name="since"/> ms after the stop was reached. The step that opens it lets its motion land first (<paramref name="after"/>) and then
    /// the mark comes in; the step that closes it does the same going out. With motion reduced it is there, and dimmed once it is closing.
    /// </summary>
    public static double Alpha(bool opening, bool closing, double after, double since, bool reduced)
    {
        if (reduced) return closing ? 0.4 : 1;
        if (opening) return Anim.EaseOut(Math.Clamp((since - after) / InMs, 0, 1));
        if (closing) return 1 - Anim.EaseIn(Math.Clamp((since - after) / OutMs, 0, 1));
        return 1;
    }

    /// <summary>
    /// The distances along a line of <paramref name="length"/> at which a stream's dots are <paramref name="since"/> ms in. They run the way the data goes: on towards the end of the
    /// line, or back towards its start when the channel points at <c>from</c>. <paramref name="still"/> (motion reduced) is where they stand to begin with.
    /// </summary>
    public static IEnumerable<double> DotsAt(double length, double since, bool towardsStart, bool still)
    {
        var phase = still ? 0 : since / 1000 * Speed % Pitch;
        var start = towardsStart ? Pitch - phase : phase;
        for (var d = start % Pitch; d <= length; d += Pitch) yield return d;
    }

    private static Pen Round(IBrush brush, double thickness) => new(brush, thickness, lineCap: PenLineCap.Round, lineJoin: PenLineJoin.Round);

    /// <summary>Dots at these distances along the line: a paler dot beneath each keeps it visible on the lit line.</summary>
    public static void Dots(DrawingContext context, Geometry line, IEnumerable<double> at, IBrush back, IBrush ink)
    {
        var spots = at.Select(d => line.TryGetPointAtDistance(d, out var p) ? (Point?)p : null).OfType<Point>().ToList();
        foreach (var p in spots) context.DrawEllipse(back, null, p, 4.5, 4.5);
        foreach (var p in spots) context.DrawEllipse(ink, null, p, 2.8, 2.8);
    }

    /// <summary>The dotted line from a listener to the shape it listens to.</summary>
    public static void Tether(DrawingContext context, Geometry line, double length, IBrush muted)
    {
        for (var d = 0.0; d <= length; d += TetherPitch)
            if (line.TryGetPointAtDistance(d, out var p)) context.DrawEllipse(muted, null, p, 1, 1);
    }

    /// <summary>The disc with a bell or an arc in it, centred on the origin; <paramref name="turn"/> is the arc's angle in degrees.</summary>
    public static void Badge(DrawingContext context, string kind, double radius, double turn, IBrush bg, IBrush accent)
    {
        context.DrawEllipse(bg, new Pen(accent, 2), new Point(0, 0), radius, radius);
        var place = Matrix.CreateScale(0.58, 0.58) * Matrix.CreateTranslation(-7, -7) * (kind == "job" ? Matrix.CreateRotation(turn * Math.PI / 180) : Matrix.Identity);
        using var _ = context.PushTransform(place);
        context.DrawGeometry(null, Round(accent, 2.2), GlyphOf(kind));
    }

    /// <summary>A ring that goes out from the disc, <paramref name="p"/> of the way through its ripple (0 to 1), and fades as it goes.</summary>
    public static void Ripple(DrawingContext context, double p, IBrush accent)
    {
        var grow = 1 + RippleGrow * p;
        using var fade = context.PushOpacity(0.55 * (1 - p));
        context.DrawEllipse(null, new Pen(accent, 1.8 * grow), new Point(0, 0), Disc * grow, Disc * grow);
    }

    /// <summary>The name of a channel, centred on <paramref name="centre"/>, in the canvas colour's outline so it reads over a line.</summary>
    public static void Label(DrawingContext context, string name, Point centre, IBrush fg, IBrush bg)
    {
        var text = new FormattedText(name, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, new Typeface(FontFamily.Default, FontStyle.Normal, FontWeight.SemiBold), 12, fg);
        var origin = new Point(centre.X - text.Width / 2, centre.Y - text.Height / 2);
        if (text.BuildGeometry(origin) is { } outline) context.DrawGeometry(null, Round(bg, 4), outline);
        context.DrawText(text, origin);
    }
}

/// <summary>
/// What a step left open, drawn over the canvas for as long as it stays open: a stream as dots running along its line, a listener as a bell that rings out from the
/// shape that listens (with a dotted line to the shape it listens to), a job as an arc turning on the shape it runs on. At the stop that opens it, the mark comes in when the
/// step's motion has landed; at the stop that closes it, it goes then. Several discs on one shape stand side by side along its top edge. It sits over the boxes in the
/// same camera, takes no pointer, and runs its own clock on the window's animation frames while it has a mark. Motion reduced: the marks stand still, a closing one dimmed.
/// </summary>
internal sealed class ChannelLayer : Control
{
    /// <summary>One channel to draw: where its two shapes are (with their outlines, which the line meets), the shape it points at, and how long the step's motion takes before it comes or goes.</summary>
    internal sealed record Spec(string Key, Channel Channel, CoreRect From, CoreRect To, double[]? OutlineFrom, double[]? OutlineTo, string AtBox, double AfterMs);

    /// <summary>A channel as the layer has it: for the tests, and for the key.</summary>
    internal sealed record Shown(string Kind, string? Name, string AtBox, int Slot, bool Opening, bool Closing, double AfterMs, double Length);

    private sealed record Item(Spec Spec, Geometry? Line, double Length, int Slot);

    private IReadOnlyList<Item> _items = [];
    private readonly Dictionary<string, double> _started = [];
    private string _style = "straight";
    private readonly WindowFrames _frames = new();
    private double _now;
    private bool _running;

    public ChannelLayer()
    {
        IsHitTestVisible = false;
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    /// <summary>Whether the layer runs its clock.</summary>
    internal bool Running => _running;

    /// <summary>The channels drawn now, in the order they were opened.</summary>
    internal IReadOnlyList<Shown> Marks => _items.Select(i => new Shown(i.Spec.Channel.Kind, i.Spec.Channel.Name, i.Spec.AtBox, i.Slot, i.Spec.Channel.Opening, i.Spec.Channel.Closing, i.Spec.AfterMs, i.Length)).ToList();

    private static double Now() => Anim.Now();

    /// <summary>The same shape of the same step is the same mark: it keeps its clock, so a redraw (a hover, a theme) does not bring it in again.</summary>
    internal static string KeyOf(Channel c) => $"{c.Kind}|{c.Step}|{c.Name}|{c.Opening}|{c.Closing}";

    /// <summary>
    /// Shows these channels, in the order they were opened (null or none: nothing). A mark that was not there starts its clock now. The discs on one shape stand side by side
    /// from its right corner, in that order.
    /// </summary>
    public void Set(IReadOnlyList<Spec>? specs, string lineStyle)
    {
        _style = lineStyle;
        var slots = new Dictionary<string, int>();
        var items = new List<Item>();
        foreach (var s in specs ?? [])
        {
            Geometry? line = null;
            double length = 0;
            if (s.Channel.Kind != "job" && s.From != s.To)
            {
                line = Geometry.Parse(LinePaths.Build(lineStyle, s.From, s.To, s.OutlineFrom, s.OutlineTo).Data);
                length = line.ContourLength;
            }
            var slot = 0;
            if (s.Channel.Kind != "stream")
            {
                slot = slots.GetValueOrDefault(s.AtBox);
                slots[s.AtBox] = slot + 1;
            }
            items.Add(new Item(s, line, length, slot));
        }
        _items = items;
        var keys = items.Select(i => i.Spec.Key).ToHashSet();
        foreach (var gone in _started.Keys.Where(k => !keys.Contains(k)).ToList()) _started.Remove(gone);
        foreach (var key in keys) _started.TryAdd(key, Now());
        if (items.Count == 0) Stop();
        else Start();
        InvalidateVisual();
    }

    /// <summary>The step is being played again (or has just been reached): the marks come and go from the start.</summary>
    public void Restart()
    {
        var now = Now();
        foreach (var key in _started.Keys.ToList()) _started[key] = now;
        InvalidateVisual();
    }

    /// <summary>Sets the time drawn, for the tests: a frame can't be held still while the clock runs.</summary>
    internal void ShowAt(double now)
    {
        _now = now;
        InvalidateVisual();
    }

    /// <summary>How much of a mark shows now, 0 to 1, for the tests.</summary>
    internal double AlphaOf(int index) => AlphaOf(_items[index], _now);

    private double AlphaOf(Item item, double now) =>
        ChannelDraw.Alpha(item.Spec.Channel.Opening, item.Spec.Channel.Closing, item.Spec.AfterMs, now - _started.GetValueOrDefault(item.Spec.Key, now), MotionSettings.Reduced);

    private void Start()
    {
        if (MotionSettings.Reduced)
        {
            _running = false;
            return;
        }
        if (_running || TopLevel.GetTopLevel(this) is not { } top) return;
        _frames.Watch(top, () =>
        {
            if (_items.Count > 0) Start();
        });
        if (_frames.Minimised) return; // started again when the window comes back
        _running = true;
        _frames.Drew(DateTime.UtcNow);
        top.RequestAnimationFrame(Tick);
    }

    private void Stop() => _running = false;

    private void Tick(TimeSpan _)
    {
        if (!_running) return;
        if (_frames.Minimised)
        {
            _running = false;
            return;
        }
        if (!_frames.Due(DateTime.UtcNow))
        {
            if (TopLevel.GetTopLevel(this) is { } waiting) waiting.RequestAnimationFrame(Tick);
            else _running = false;
            return;
        }
        _now = Now();
        InvalidateVisual();
        if (TopLevel.GetTopLevel(this) is { } top) top.RequestAnimationFrame(Tick);
        else _running = false;
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        if (_items.Count > 0) Start();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        Stop();
        _frames.Stop();
        base.OnDetachedFromVisualTree(e);
    }

    private IBrush Brush(string key) => AppTheme.Brush(this, key);

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        if (_items.Count == 0) return;
        var reduced = MotionSettings.Reduced;
        if (!_running) _now = Now();
        foreach (var item in _items)
        {
            var alpha = AlphaOf(item, _now);
            if (alpha <= 0) continue;
            using var fade = context.PushOpacity(alpha);
            DrawOne(context, item, _now - _started.GetValueOrDefault(item.Spec.Key, _now), reduced);
        }
    }

    private void DrawOne(DrawingContext context, Item item, double since, bool reduced)
    {
        var c = item.Spec.Channel;
        var bg = Brush("BgBrush");
        var accent = Brush("AccentBrush");
        var fg = Brush("FgBrush");
        if (c.Kind == "stream" && item.Line is { } flow)
        {
            ChannelDraw.Dots(context, flow, ChannelDraw.DotsAt(item.Length, since, c.End == "from", reduced), bg, accent);
            if (c.Name is { } name && flow.TryGetPointAtDistance(item.Length / 2, out var mid)) ChannelDraw.Label(context, name, new Point(mid.X, mid.Y - 16), fg, bg);
            return;
        }
        if (c.Kind == "listener" && item.Line is { } tether) ChannelDraw.Tether(context, tether, item.Length, Brush("MutedBrush"));
        var at = c.End == "to" ? item.Spec.To : item.Spec.From;
        var x = at.X + at.Width - ChannelDraw.Disc - ChannelDraw.Gap - item.Slot * (2 * ChannelDraw.Disc + ChannelDraw.Gap);
        using var place = context.PushTransform(Matrix.CreateTranslation(x, at.Y));
        if (c.Kind == "listener" && !reduced)
        {
            // A ring goes out, and half a ripple later another.
            ChannelDraw.Ripple(context, since % ChannelDraw.RippleMs / ChannelDraw.RippleMs, accent);
            if (since >= ChannelDraw.RippleMs / 2) ChannelDraw.Ripple(context, (since - ChannelDraw.RippleMs / 2) % ChannelDraw.RippleMs / ChannelDraw.RippleMs, accent);
        }
        ChannelDraw.Badge(context, c.Kind, ChannelDraw.Disc, reduced ? 0 : since / ChannelDraw.TurnMs * 360 % 360, bg, accent);
        if (c.Name is { } label) ChannelDraw.Label(context, label, new Point(0, -ChannelDraw.Disc - 10), fg, bg);
    }
}

/// <summary>A mark as the key under the player draws it: the same dots, disc and glyph as on the canvas, still, in the theme that is showing.</summary>
internal sealed class ChannelSwatch : Control
{
    private readonly string _kind;

    public ChannelSwatch(string kind)
    {
        _kind = kind;
        Width = 30;
        Height = 18;
        IsHitTestVisible = false;
        VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center;
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var bg = AppTheme.Brush(this, "BgBrush");
        var accent = AppTheme.Brush(this, "AccentBrush");
        if (_kind == "stream")
        {
            var line = Geometry.Parse("M3 9H27");
            ChannelDraw.Dots(context, line, ChannelDraw.DotsAt(24, 0, false, true), bg, accent);
            return;
        }
        using var _ = context.PushTransform(Matrix.CreateTranslation(15, 9));
        ChannelDraw.Badge(context, _kind, ChannelDraw.Disc - 1, 0, bg, accent);
    }
}
