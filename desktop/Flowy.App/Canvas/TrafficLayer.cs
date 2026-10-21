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
/// and a little smaller as it goes behind and back as it comes out, so the flow reads through what covers it. Reduced motion draws none: the canvas
/// leaves this empty then.
/// </summary>
internal sealed class TrafficLayer : Control
{
    /// <summary>A shape a line may run behind: where it is and its outline (null: the box itself).</summary>
    internal readonly record struct ShapeCover(string Id, CoreRect Rect, double[]? Edge);

    private sealed record Drawn(LineTraffic Line, FlatLine Path, ParticleStream Stream, IReadOnlyList<ShapeCover> Behind);

    private List<Drawn> _lines = [];
    private IReadOnlyList<CoreRect> _labels = [];
    private readonly Dictionary<(string, string), ParticleStream> _streams = [];
    private Viewport _viewport = new(0, 0, 1);
    private bool _running;
    private DateTime _last;

    /// <summary>0 to 1: what decides whether a particle fails. A test sets it to be sure of what is drawn.</summary>
    internal Func<double> Rand { get; set; } = Random.Shared.NextDouble;

    public TrafficLayer()
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

    /// <summary>How many particles are on the lines now.</summary>
    internal int ParticleCount => _lines.Sum(l => l.Stream.Motes.Count);

    /// <summary>Whether the layer is running its clock.</summary>
    internal bool Running => _running;

    /// <summary>
    /// The lines to draw traffic on, and where each is (null: its path isn't known, so nothing is drawn on it). What is already on a line keeps going
    /// when the load changes; a line that is new starts with its particles already spread along it, as they would be had the load always been this.
    /// </summary>
    public void Set(IReadOnlyList<LineTraffic> lines, Func<LineTraffic, FlatLine?> pathOf, IReadOnlyList<ShapeCover> shapes, IReadOnlyList<CoreRect> labels)
    {
        _labels = labels;
        var drawn = new List<Drawn>();
        foreach (var line in lines)
        {
            if (pathOf(line) is not { } path) continue;
            if (!_streams.TryGetValue((line.From, line.To), out var stream))
            {
                _streams[(line.From, line.To)] = stream = new ParticleStream();
                for (double t = 0; t < line.TravelMs; t += 32) Flowy.Core.Particles.Advance(stream, line, 32, Rand);
            }
            drawn.Add(new Drawn(line, path, stream, shapes.Where(s => s.Id != line.From && s.Id != line.To).ToList()));
        }
        _lines = drawn;
        foreach (var key in _streams.Keys.Where(k => !drawn.Any(d => (d.Line.From, d.Line.To) == k)).ToList()) _streams.Remove(key);
        if (drawn.Count == 0) Stop();
        else Start();
        InvalidateVisual();
    }

    /// <summary>Takes the particles away and stops the clock.</summary>
    public void Clear()
    {
        _lines = [];
        _streams.Clear();
        Stop();
        InvalidateVisual();
    }

    private void Start()
    {
        if (_running || TopLevel.GetTopLevel(this) is not { } top) return;
        _running = true;
        _last = DateTime.UtcNow;
        top.RequestAnimationFrame(Tick);
    }

    private void Stop() => _running = false;

    private void Tick(TimeSpan _)
    {
        if (!_running) return;
        var now = DateTime.UtcNow;
        var ms = Math.Min(100, (now - _last).TotalMilliseconds); // a window that was asleep doesn't pour out everything it missed
        _last = now;
        foreach (var d in _lines) Flowy.Core.Particles.Advance(d.Stream, d.Line, ms, Rand);
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

    private IBrush Brush(string key) =>
        this.TryFindResource(key, ActualThemeVariant, out var found) && found is IBrush brush ? brush : Brushes.Gray;

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        if (_lines.Count == 0) return;
        var matrix = Matrix.CreateScale(_viewport.Zoom, _viewport.Zoom) * Matrix.CreateTranslation(_viewport.X, _viewport.Y);
        using var _ = context.PushTransform(matrix);
        var ok = Brush("AccentBrush");
        var bad = Brush("DangerBrush");
        foreach (var d in _lines)
        {
            var radius = (2.2 + d.Line.Width / 2) / _viewport.Zoom; // a few pixels on screen, whatever the zoom
            var ramp = radius * 2; // how far either side of an outline a particle takes to go from clear to well behind
            foreach (var m in d.Stream.Motes)
            {
                var (x, y) = PathPoints.PointAt(d.Path, m.S);
                var (alpha, scale) = Flowy.Core.Particles.Ghost(BehindOf(d.Behind, _labels, x, y, ramp));
                var r = radius * scale;
                if (m.Fails == 0)
                {
                    if (alpha >= 1)
                    {
                        context.DrawEllipse(ok, null, new Point(x, y), r, r);
                        continue;
                    }
                    using var dim = context.PushOpacity(alpha);
                    context.DrawEllipse(ok, null, new Point(x, y), r, r);
                    continue;
                }
                using var fade = context.PushOpacity(Flowy.Core.Particles.Visibility(m) * alpha);
                context.DrawEllipse(bad, null, new Point(x, y), r, r);
            }
        }
    }
}
