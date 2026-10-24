using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Flowy.Core;
using CoreRect = Flowy.Core.Rect;

namespace Flowy.App.Canvas;

/// <summary>
/// The traffic on the lines: small particles running from one shape to the other, as many and as fast as the load says (see <see cref="Perf.TrafficFor"/>),
/// and the ones that fail dying away short of the end. It sits over the boxes in the same camera, takes no pointer, and runs its own clock: a frame at a
/// time on the window's animation frames, for as long as it has a line to draw. Each line's path is flattened once (<see cref="PathPoints"/>), so a
/// particle's place is a lookup. Where its line runs behind a shape that is not one of its ends, or under a label, a particle is still drawn, going faint
/// and a little smaller as it goes behind and back as it comes out, so the flow reads through what covers it. A line that ends at a shape that opens runs on a
/// way into it, and one that starts at such a shape comes out of it, but a particle is only drawn outside the shape (cut by its outline), so the flow goes in
/// and out of it and is never seen on it. A run's source sets the particles' colour and
/// size (a line's <c>Color</c> and <c>Radius</c>), and a line that says how its failing share fails draws a lost call as a ring where it pops and a rejected
/// one as a call that stops at a bar at the end of the line and comes back in the danger tone. A line that several sources share has a stream for each (a line's
/// <c>Source</c>), drawn in that source's colour and running a little to its side of the path (its <c>Offset</c>). Reduced motion draws none: the canvas leaves this empty then.
/// </summary>
internal sealed class TrafficLayer : Control
{
    /// <summary>A shape a line may run behind: where it is and its outline (null: the box itself).</summary>
    internal readonly record struct ShapeCover(string Id, CoreRect Rect, double[]? Edge);

    /// <summary>How far a particle runs on into a shape that opens, and starts out inside one, so it is wholly hidden before it is gone (in the diagram's units, whatever the zoom).</summary>
    internal const double Reach = 48;

    /// <summary>
    /// A line's way for the layer: the path that runs on into the shapes at its ends that open, the same without the run into its end (a rejected call stops at
    /// the bar there), and the shapes at its start and end (null: not known). A call is a few pixels on screen whatever the zoom, so one at either end of the line
    /// would spill onto the shape there: it is cut by the outlines of both ends, whether they open or not.
    /// </summary>
    internal readonly record struct Way(FlatLine Path, FlatLine Bounce, ShapeCover? From, ShapeCover? To);

    /// <summary>
    /// One line's traffic. `Behind` and `Labels` are the shapes and labels near enough to the line to hide a particle on it: far ones can't, so a particle is only asked about a few. What is the same
    /// every frame (the shapes at its ends, the cut that keeps stripes off the shapes, the stripes' path) is made once, the first time it is drawn.
    /// </summary>
    private sealed class Drawn(LineTraffic line, Way way, ParticleStream stream, IReadOnlyList<ShapeCover> behind, IReadOnlyList<CoreRect> labels)
    {
        public LineTraffic Line { get; } = line;
        public Way Way { get; } = way;
        public ParticleStream Stream { get; } = stream;
        public IReadOnlyList<ShapeCover> Behind { get; } = behind;
        public IReadOnlyList<CoreRect> Labels { get; } = labels;
        public List<ShapeCover>? Ends { get; set; }
        public StreamGeometry? Cut { get; set; }
        public StreamGeometry? Stripes { get; set; }
        public double StripesAside { get; set; }
    }

    /// <summary>How far from a line's path a shape or label can still hide a particle on it, in the diagram's units. A particle is a few pixels on screen, so at the smallest zoom it is some dozens of units; this is far more.</summary>
    private const double Near = 400;

    /// <summary>The box round a line's path, widened by <see cref="Near"/>: what is outside it cannot hide a particle on the line.</summary>
    private static CoreRect PathBox(FlatLine path)
    {
        double minX = double.MaxValue, minY = double.MaxValue, maxX = double.MinValue, maxY = double.MinValue;
        for (var i = 0; i < path.Xs.Length; i++)
        {
            minX = Math.Min(minX, path.Xs[i]);
            maxX = Math.Max(maxX, path.Xs[i]);
            minY = Math.Min(minY, path.Ys[i]);
            maxY = Math.Max(maxY, path.Ys[i]);
        }
        return new CoreRect(minX - Near, minY - Near, maxX - minX + 2 * Near, maxY - minY + 2 * Near);
    }

    private static bool Meets(CoreRect a, CoreRect b) => a.Right >= b.X && a.X <= b.Right && a.Bottom >= b.Y && a.Y <= b.Bottom;

    private List<Drawn> _lines = [];
    private IReadOnlyList<CoreRect> _labels = [];
    private readonly Dictionary<(string, string, string?), ParticleStream> _streams = [];
    private readonly Dictionary<(string, string, string?), double> _stripeAt = []; // how far each line's stripes have moved, as a share of one dash and its gap, so a change of spacing while the load is dragged moves them on smoothly
    private Viewport _viewport = new(0, 0, 1);
    private bool _running;
    private DateTime _last;
    private readonly WindowFrames _frames = new();

    /// <summary>0 to 1: what decides whether a particle fails. A test sets it to be sure of what is drawn.</summary>
    internal Func<double> Rand { get; set; } = Random.Shared.NextDouble;

    public TrafficLayer()
    {
        IsHitTestVisible = false;
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    /// <summary>The camera. The layer is drawn in the diagram's units and moves with the boxes, so only a change of zoom (a particle is a few pixels on screen, whatever the zoom) draws it again.</summary>
    public Viewport Viewport
    {
        get => _viewport;
        set
        {
            var zoomed = value.Zoom != _viewport.Zoom;
            _viewport = value;
            if (zoomed) InvalidateVisual();
        }
    }

    /// <summary>How many particles are on the lines now.</summary>
    internal int ParticleCount => _lines.Sum(l => l.Stream.Motes.Count);

    /// <summary>Whether the layer is running its clock.</summary>
    internal bool Running => _running;

    /// <summary>
    /// The lines to draw traffic on, and where each is (null: its path isn't known, so nothing is drawn on it). What is already on a line keeps going
    /// when the load changes; a line that is new starts with its particles already spread along it, as they would be had the load always been this.
    /// </summary>
    internal void Set(IReadOnlyList<LineTraffic> lines, Func<LineTraffic, Way?> pathOf, IReadOnlyList<ShapeCover> shapes, IReadOnlyList<CoreRect> labels)
    {
        _labels = labels;
        var drawn = new List<Drawn>();
        // The sources that share a line are entries of one path: it is worked out once, however many there are.
        var paths = new Dictionary<(string, string), Way?>();
        foreach (var line in lines)
        {
            if (!paths.TryGetValue((line.From, line.To), out var found)) paths[(line.From, line.To)] = found = pathOf(line);
            if (found is not { } way) continue;
            var key = (line.From, line.To, line.Source);
            if (!_streams.TryGetValue(key, out var stream))
            {
                _streams[key] = stream = new ParticleStream();
                for (double t = 0; t < line.TravelMs; t += 32) Flowy.Core.Particles.Advance(stream, line, 32, Rand);
            }
            var reach = PathBox(way.Path);
            drawn.Add(new Drawn(line, way, stream, shapes.Where(s => s.Id != line.From && s.Id != line.To && Meets(s.Rect, reach)).ToList(), labels.Where(l => Meets(l, reach)).ToList()));
        }
        _lines = drawn;
        foreach (var key in _streams.Keys.Where(k => !drawn.Any(d => (d.Line.From, d.Line.To, d.Line.Source) == k)).ToList())
        {
            _streams.Remove(key);
            _stripeAt.Remove(key);
        }
        if (drawn.Count == 0) Stop();
        else Start();
        InvalidateVisual();
    }

    /// <summary>Takes the particles away and stops the clock.</summary>
    public void Clear()
    {
        _lines = [];
        _streams.Clear();
        _stripeAt.Clear();
        Stop();
        InvalidateVisual();
    }

    private void Start()
    {
        if (_running || TopLevel.GetTopLevel(this) is not { } top) return;
        _frames.Watch(top, () =>
        {
            if (_lines.Count > 0) Start();
        });
        if (_frames.Minimised) return; // started again when the window comes back
        _running = true;
        _last = DateTime.UtcNow;
        _frames.Drew(_last);
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
        var now = DateTime.UtcNow;
        if (!_frames.Due(now))
        {
            if (TopLevel.GetTopLevel(this) is { } waiting) waiting.RequestAnimationFrame(Tick);
            else _running = false;
            return;
        }
        var ms = Math.Min(100, (now - _last).TotalMilliseconds); // a window that was asleep doesn't pour out everything it missed
        _last = now;
        foreach (var d in _lines)
        {
            Flowy.Core.Particles.Advance(d.Stream, d.Line, ms, Rand);
            if (d.Line.Stripes is { } busy and > 0)
            {
                var key = (d.Line.From, d.Line.To, d.Line.Source);
                var pace = StripePace(busy);
                _stripeAt[key] = ((_stripeAt.TryGetValue(key, out var at) ? at : 0) + pace.Speed * ms / 1000 / (pace.Dash + pace.Gap)) % 1;
            }
        }
        InvalidateVisual();
        if (TopLevel.GetTopLevel(this) is { } top) top.RequestAnimationFrame(Tick);
        else _running = false;
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        if (_lines.Count > 0) Start();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        Stop();
        _frames.Stop();
        base.OnDetachedFromVisualTree(e);
    }

    /// <summary>
    /// How far behind something the particle at (x, y) is, 0 to 1: the most of any shape its line runs behind, or label, which sits on its line with the
    /// canvas's own background. 0 when it is clear of them all, so most particles cost a bounds check or two.
    /// </summary>
    internal static double BehindOf(IReadOnlyList<ShapeCover> shapes, IReadOnlyList<CoreRect> labels, double x, double y, double ramp)
    {
        static bool Near(CoreRect r, double x, double y, double ramp) => x > r.X - ramp && x < r.Right + ramp && y > r.Y - ramp && y < r.Bottom + ramp;
        var most = 0.0;
        foreach (var s in shapes)
            if (Near(s.Rect, x, y, ramp)) most = Math.Max(most, Flowy.Core.Particles.HowBehind(BoxGeometry.DepthIn(s.Rect, s.Edge, x, y), ramp));
        foreach (var l in labels)
            if (Near(l, x, y, ramp)) most = Math.Max(most, Flowy.Core.Particles.HowBehind(BoxGeometry.DepthIn(l, null, x, y), ramp));
        return most;
    }

    /// <summary>Everything but the inside of a shape: the drawing is cut to it where a particle crosses the outline of a shape at an end of its line.</summary>
    private static StreamGeometry Outside(ShapeCover s)
    {
        var geometry = new StreamGeometry();
        using (var g = geometry.Open())
        {
            g.SetFillRule(FillRule.EvenOdd);
            g.BeginFigure(new Point(-1e6, -1e6), true);
            g.LineTo(new Point(1e6, -1e6));
            g.LineTo(new Point(1e6, 1e6));
            g.LineTo(new Point(-1e6, 1e6));
            g.EndFigure(true);
            if (s.Edge is not { Length: > 0 } edge)
            {
                g.BeginFigure(new Point(s.Rect.X, s.Rect.Y), true);
                g.LineTo(new Point(s.Rect.Right, s.Rect.Y));
                g.LineTo(new Point(s.Rect.Right, s.Rect.Bottom));
                g.LineTo(new Point(s.Rect.X, s.Rect.Bottom));
            }
            else
            {
                g.BeginFigure(new Point(s.Rect.X + edge[0], s.Rect.Y + edge[1]), true);
                for (var i = 1; i < edge.Length / 2; i++) g.LineTo(new Point(s.Rect.X + edge[2 * i], s.Rect.Y + edge[2 * i + 1]));
            }
            g.EndFigure(true);
        }
        return geometry;
    }

    /// <summary>
    /// The dashes of stripes at a level of busyness (0 to 1): how long, how far apart, and how fast they move along the line, in the diagram's units (and a second), so they grow and shrink with the line and its
    /// arrowhead as the diagram is zoomed. Busier is closer together and a good deal quicker: a quiet line crawls and the busiest runs.
    /// </summary>
    internal static (double Dash, double Gap, double Speed) StripePace(double busy) => (8, 26 - 18 * busy, 14 + 110 * busy);

    /// <summary>How big a call's mark is on screen, in pixels, before a run's size makes it bigger or smaller: the same on every line, so only the size of a call changes it.</summary>
    internal const double MarkSize = 3.6;

    /// <summary>Everything but the inside of all these shapes and labels: a line's stripes are cut to it, so they are not seen over a shape it runs behind or into, or over a label on it.</summary>
    private static StreamGeometry OutsideAll(IEnumerable<ShapeCover> shapes, IReadOnlyList<CoreRect> labels)
    {
        var geometry = new StreamGeometry();
        using (var g = geometry.Open())
        {
            g.SetFillRule(FillRule.EvenOdd);
            g.BeginFigure(new Point(-1e6, -1e6), true);
            g.LineTo(new Point(1e6, -1e6));
            g.LineTo(new Point(1e6, 1e6));
            g.LineTo(new Point(-1e6, 1e6));
            g.EndFigure(true);
            void Box(CoreRect r)
            {
                g.BeginFigure(new Point(r.X, r.Y), true);
                g.LineTo(new Point(r.Right, r.Y));
                g.LineTo(new Point(r.Right, r.Bottom));
                g.LineTo(new Point(r.X, r.Bottom));
                g.EndFigure(true);
            }
            foreach (var s in shapes)
            {
                if (s.Edge is not { Length: > 0 } edge) Box(s.Rect);
                else
                {
                    g.BeginFigure(new Point(s.Rect.X + edge[0], s.Rect.Y + edge[1]), true);
                    for (var i = 1; i < edge.Length / 2; i++) g.LineTo(new Point(s.Rect.X + edge[2 * i], s.Rect.Y + edge[2 * i + 1]));
                    g.EndFigure(true);
                }
            }
            foreach (var l in labels) Box(l);
        }
        return geometry;
    }

    /// <summary>The line as one open figure, to stroke the stripes along, a little to one side of the path by <paramref name="aside"/> where sources share it.</summary>
    private static StreamGeometry Along(FlatLine path, double aside)
    {
        var geometry = new StreamGeometry();
        using var g = geometry.Open();
        for (var k = 0; k < path.Xs.Length; k++)
        {
            double nx = 0, ny = 0;
            if (aside != 0)
            {
                var bx = path.Xs[Math.Min(k + 1, path.Xs.Length - 1)] - path.Xs[Math.Max(k - 1, 0)];
                var by = path.Ys[Math.Min(k + 1, path.Ys.Length - 1)] - path.Ys[Math.Max(k - 1, 0)];
                var length = Math.Sqrt(bx * bx + by * by);
                if (length == 0) length = 1;
                (nx, ny) = (-by / length * aside, bx / length * aside);
            }
            var p = new Point(path.Xs[k] + nx, path.Ys[k] + ny);
            if (k == 0) g.BeginFigure(p, false);
            else g.LineTo(p);
        }
        g.EndFigure(false);
        return geometry;
    }

    /// <summary>Which way a line runs at <paramref name="s"/> (0 to 1 of the way along it), as a unit step: a call is drawn lying along it. A line with no length has none, so it runs to the right.</summary>
    private static (double X, double Y) DirAt(FlatLine path, double s)
    {
        var (ax, ay) = PathPoints.PointAt(path, Math.Max(0, s - 0.015));
        var (bx, by) = PathPoints.PointAt(path, Math.Min(1, s + 0.015));
        var length = Math.Sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
        return length == 0 ? (1, 0) : ((bx - ax) / length, (by - ay) / length);
    }

    /// <summary>A call as a small stripe: a short bar lying along its line, centred on (x, y), that sticks out to either side of the line.</summary>
    private static void Mark(DrawingContext context, IBrush brush, double x, double y, (double X, double Y) dir, double r) =>
        context.DrawLine(new Pen(brush, r * 1.15, lineCap: PenLineCap.Round), new Point(x - dir.X * r * 0.9, y - dir.Y * r * 0.9), new Point(x + dir.X * r * 0.9, y + dir.Y * r * 0.9));

    private IBrush Brush(string key) => AppTheme.Brush(this, key);

    private readonly Dictionary<(string, bool), IBrush> _tints = [];

    /// <summary>The brush of a line's particles: its source's colour for the theme that is showing (a named colour for the theme, a hex as it is), else <paramref name="fallback"/>.</summary>
    private IBrush Tint(string? color, IBrush fallback)
    {
        if (color is null) return fallback;
        var dark = AppTheme.IsDark(this);
        if (_tints.TryGetValue((color, dark), out var kept)) return kept;
        if (PerfView.SourceHex(color, dark) is not { } hex) return fallback;
        return _tints[(color, dark)] = new SolidColorBrush(Color.Parse(hex)).ToImmutable();
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        if (_lines.Count == 0) return;
        var ok = Brush("AccentBrush");
        var bad = Brush("DangerBrush");
        foreach (var d in _lines)
        {
            var radius = MarkSize * (d.Line.Radius ?? 1) / _viewport.Zoom; // a few pixels on screen, whatever the zoom and however many calls, and bigger or smaller only where the size of a call says
            var ramp = radius * 2; // how far either side of an outline a particle takes to go from clear to well behind
            var tone = Tint(d.Line.Color, ok);
            // Sources that share a line run a little apart, to either side of it, by steps of a usual dot and its room: so two on one path don't hide each other.
            var aside = (d.Line.Offset ?? 0) * MarkSize / _viewport.Zoom * 2.4;
            var bar = 0.0; // how strongly the bar at the end of a rejected line shows: the strongest of its particles
            // A rejected call stops at the bar at the end of the line, so it doesn't run on into the shape there.
            var rejected = d.Line.Failure == "rejected";
            var path = rejected ? d.Way.Bounce : d.Way.Path;
            var ends = d.Ends ??= new[] { d.Way.From, d.Way.To }.OfType<ShapeCover>().ToList();
            if (d.Line.Stripes is { } busy and > 0 && path.Xs.Length > 1)
            {
                // A line the run gives no numbers: plain stripes moving along the line itself, closer and quicker the more the run is loaded.
                var pace = StripePace(busy);
                const double px = 1; // the diagram's own units: the stripes scale with the line and its arrowhead
                var moved = (_stripeAt.TryGetValue((d.Line.From, d.Line.To, d.Line.Source), out var at) ? at : 0) * (pace.Dash + pace.Gap);
                var thick = Math.Max(2.4, d.Line.Width + 0.9) * px; // a little thicker than the line it runs on, so the two read as one arrow at any zoom
                using var cut = context.PushGeometryClip(d.Cut ??= OutsideAll(ends.Concat(d.Behind), d.Labels));
                using var dim = context.PushOpacity(0.9);
                var offset = (d.Line.Offset ?? 0) * 3 * px;
                if (d.Stripes is null || d.StripesAside != offset) (d.Stripes, d.StripesAside) = (Along(path, offset), offset);
                var way = d.Stripes;
                // Avalonia counts a dash in widths of the pen, so the dashes and the offset are divided by the thickness.
                context.DrawGeometry(null, new Pen(tone, thick, new DashStyle([pace.Dash * px / thick, pace.Gap * px / thick], -moved * px / thick), PenLineCap.Round), way);
            }
            foreach (var m in d.Stream.Motes)
            {
                var look = Flowy.Core.Particles.Look(m, d.Line.Failure);
                var (x, y) = PathPoints.PointAt(path, look.At);
                var dir = DirAt(path, look.At);
                if (aside != 0)
                {
                    // To the side of the path, by its direction a little either way along it.
                    var (ax, ay) = PathPoints.PointAt(path, look.At - 0.02);
                    var (bx, by) = PathPoints.PointAt(path, look.At + 0.02);
                    var span = Math.Sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
                    if (span == 0) span = 1;
                    x += -(by - ay) / span * aside;
                    y += (bx - ax) / span * aside;
                }
                if (look.Bar is { } strength && strength > bar) bar = strength;
                // Against the shapes at its ends: wholly inside one (not drawn), or cut by the outline of one.
                ShapeCover? cut = null;
                var gone = false;
                foreach (var s in ends)
                {
                    var how = Flowy.Core.Particles.CutBy(BoxGeometry.DepthIn(s.Rect, s.Edge, x, y), radius);
                    if (how == Flowy.Core.Particles.Cut.Gone) gone = true;
                    else if (how == Flowy.Core.Particles.Cut.Cut) cut = s;
                }
                if (gone) continue;
                var (ghostAlpha, scale) = Flowy.Core.Particles.Ghost(BehindOf(d.Behind, d.Labels, x, y, ramp));
                var r = radius * scale;
                using var clip = cut is { } shape ? (IDisposable)context.PushGeometryClip(Outside(shape)) : null;
                if (look.Pop is { } pop)
                {
                    // A lost call: a ring where it died, growing and fading.
                    using var ring = context.PushOpacity((1 - pop) * ghostAlpha);
                    context.DrawEllipse(null, new Pen(bad, 1.6 / _viewport.Zoom), new Point(x, y), r * (0.9 + 1.8 * pop), r * (0.9 + 1.8 * pop));
                    continue;
                }
                var brush = look.Bad ? bad : tone;
                var alpha = look.Alpha * ghostAlpha;
                if (alpha >= 1)
                {
                    Mark(context, brush, x, y, dir, r);
                    continue;
                }
                using var dim = context.PushOpacity(alpha);
                Mark(context, brush, x, y, dir, r);
            }
            if (bar > 0)
            {
                // A rejected call meets a bar across the end of the line, strongest while one is at it.
                var (ex, ey) = PathPoints.PointAt(path, 1);
                var (px, py) = PathPoints.PointAt(path, 0.96);
                var length = Math.Sqrt((ex - px) * (ex - px) + (ey - py) * (ey - py));
                if (length == 0) length = 1;
                var (nx, ny) = (-(ey - py) / length, (ex - px) / length);
                using var faint = context.PushOpacity(bar);
                context.DrawLine(new Pen(bad, 2.4 / _viewport.Zoom, lineCap: PenLineCap.Round), new Point(ex + nx * radius * 2.4, ey + ny * radius * 2.4), new Point(ex - nx * radius * 2.4, ey - ny * radius * 2.4));
            }
        }
    }
}
