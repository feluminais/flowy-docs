using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;
using Avalonia.VisualTree;
using Flowy.Core;
using CorePt = Flowy.Core.Pt;

namespace Flowy.App.Canvas;

/// <summary>
/// The diagram of one view: boxes as controls on a stage that moves with the camera, the frame and lines drawn behind them in the same
/// camera. Wheel zooms about the pointer, dragging empty space pans, and the camera can fit the whole view or reveal one box.
/// </summary>
internal sealed class CanvasView : Border
{
    private const double DragSlop = 3;

    private readonly BackLayer _back = new();
    private readonly Avalonia.Controls.Canvas _stage = new() { RenderTransformOrigin = RelativePoint.TopLeft };
    private readonly Dictionary<string, BoxControl> _boxes = [];
    private Scene? _scene;
    private Viewport _viewport = new(0, 0, 1);
    private IDisposable? _animation;
    private Padding _fitPadding = Camera.FitPadding(false, false);
    private bool _fitOnResize = true;
    private Point? _pressedAt;
    private Viewport _pressedViewport;
    private bool _dragged;
    private string? _hoveredEdge;

    public event Action<string>? BoxClicked;
    public event Action<string>? BoxDoubleClicked;
    public event Action<string>? EdgeClicked;
    public event Action<string?>? EdgeHovered;
    public event Action? PaneClicked;

    public CanvasView()
    {
        ClipToBounds = true;
        Background = Brushes.Transparent;
        Child = new Grid { Children = { _back, _stage } };
    }

    public Scene? Scene => _scene;

    public Viewport Viewport => _viewport;

    public string LineStyle { get; private set; } = "straight";

    public Flowy.Core.Rect? RectOf(string id) => _scene?.Boxes.FirstOrDefault(b => b.Id == id) is { } b ? b.Rect : null;

    /// <summary>The box control with this id, for keyboard focus and tests.</summary>
    public Control? BoxControlFor(string id) => _boxes.GetValueOrDefault(id);

    /// <summary>
    /// Shows a scene. The boxes already on the stage are updated in place, so a click or a flow step doesn't rebuild what didn't change;
    /// a different set of boxes replaces them.
    /// </summary>
    public void SetScene(Scene scene, string lineStyle, string? selected)
    {
        LineStyle = lineStyle;
        var sameBoxes = _scene is not null && _scene.Boxes.Select(b => b.Id).SequenceEqual(scene.Boxes.Select(b => b.Id));
        _scene = scene;
        if (!sameBoxes)
        {
            _stage.Children.Clear();
            _boxes.Clear();
            foreach (var box in scene.Boxes)
            {
                var control = new BoxControl(box);
                control.PointerReleased += (_, e) => OnBoxReleased(box.Id, e);
                control.DoubleTapped += (_, e) =>
                {
                    BoxDoubleClicked?.Invoke(box.Id);
                    e.Handled = true;
                };
                _boxes[box.Id] = control;
                _stage.Children.Add(control);
            }
        }
        else
        {
            foreach (var box in scene.Boxes) _boxes[box.Id].Update(box);
        }
        foreach (var (id, control) in _boxes) control.SetSelected(id == selected);
        _back.SetScene(scene, lineStyle);
    }

    private void OnBoxReleased(string id, PointerReleasedEventArgs e)
    {
        if (e.InitialPressMouseButton != MouseButton.Left || _dragged) return;
        BoxClicked?.Invoke(id);
        e.Handled = true;
    }

    private void SetViewport(Viewport viewport)
    {
        _viewport = viewport;
        _stage.RenderTransform = new MatrixTransform(Matrix.CreateScale(viewport.Zoom, viewport.Zoom) * Matrix.CreateTranslation(viewport.X, viewport.Y));
        _back.Viewport = viewport;
    }

    /// <summary>Moves the camera to <paramref name="target"/>, over <paramref name="milliseconds"/> (0: at once).</summary>
    public void MoveTo(Viewport target, double milliseconds = 0)
    {
        _animation?.Dispose();
        if (milliseconds <= 0 || MotionSettings.Reduced)
        {
            SetViewport(target);
            return;
        }
        var from = _viewport;
        _animation = Anim.Run(this, milliseconds, Anim.EaseInOut, t => SetViewport(new Viewport(
            from.X + (target.X - from.X) * t, from.Y + (target.Y - from.Y) * t, from.Zoom + (target.Zoom - from.Zoom) * t)));
    }

    /// <summary>The bounding box of everything drawn: the boxes, and the frame around them.</summary>
    private Flowy.Core.Rect? Content()
    {
        if (_scene is null || _scene.Boxes.Count == 0) return null;
        var rects = _scene.Boxes.Select(b => b.Rect).ToList();
        if (_scene.Frame is { } frame) rects.Add(frame);
        var x = rects.Min(r => r.X);
        var y = rects.Min(r => r.Y);
        return new Flowy.Core.Rect(x, y, rects.Max(r => r.Right) - x, rects.Max(r => r.Bottom) - y);
    }

    /// <summary>The whole view, centred, with room for the side panel and the flow player when they're there. Fits again when the window is resized.</summary>
    public void Fit(bool panel, bool player, double milliseconds = 0)
    {
        _fitPadding = Camera.FitPadding(panel, player);
        _fitOnResize = true;
        if (Content() is { } bounds && base.Bounds.Width > 0 && base.Bounds.Height > 0)
            MoveTo(Camera.Fit(bounds, base.Bounds.Width, base.Bounds.Height, _fitPadding), milliseconds);
    }

    /// <summary>Pans just far enough that this box isn't hidden under the side panel.</summary>
    public void Reveal(string id, double milliseconds = 200)
    {
        if (RectOf(id) is not { } r) return;
        if (Camera.PanIntoView(r, _viewport, base.Bounds.Width, base.Bounds.Height) is { } to) MoveTo(to, milliseconds);
    }

    public void ZoomBy(double factor)
    {
        _fitOnResize = false;
        var centre = new CorePt(base.Bounds.Width / 2, base.Bounds.Height / 2);
        MoveTo(Camera.ZoomAt(_viewport, centre, factor), 120);
    }

    protected override void OnSizeChanged(SizeChangedEventArgs e)
    {
        base.OnSizeChanged(e);
        if (_fitOnResize && Content() is { } bounds && e.NewSize.Width > 0 && e.NewSize.Height > 0)
            SetViewport(Camera.Fit(bounds, e.NewSize.Width, e.NewSize.Height, _fitPadding));
    }

    private static bool OverBox(PointerEventArgs e) => e.Source is Visual v && (v is BoxControl || v.FindAncestorOfType<BoxControl>() is not null);

    protected override void OnPointerWheelChanged(PointerWheelEventArgs e)
    {
        base.OnPointerWheelChanged(e);
        _animation?.Dispose();
        _fitOnResize = false;
        var p = e.GetPosition(this);
        SetViewport(Camera.ZoomAt(_viewport, new CorePt(p.X, p.Y), Math.Pow(1.1, e.Delta.Y)));
        e.Handled = true;
    }

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        _dragged = false;
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed || OverBox(e)) return;
        _animation?.Dispose();
        _pressedAt = e.GetPosition(this);
        _pressedViewport = _viewport;
        e.Pointer.Capture(this);
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);
        var p = e.GetPosition(this);
        if (_pressedAt is { } start)
        {
            var (dx, dy) = (p.X - start.X, p.Y - start.Y);
            if (!_dragged && Math.Abs(dx) + Math.Abs(dy) < DragSlop) return;
            _dragged = true;
            _fitOnResize = false;
            SetViewport(_pressedViewport with { X = _pressedViewport.X + dx, Y = _pressedViewport.Y + dy });
            return;
        }
        var edge = OverBox(e) ? null : _back.EdgeAt(p);
        if (edge == _hoveredEdge) return;
        _hoveredEdge = edge;
        EdgeHovered?.Invoke(edge);
    }

    protected override void OnPointerExited(PointerEventArgs e)
    {
        base.OnPointerExited(e);
        if (_hoveredEdge is null) return;
        _hoveredEdge = null;
        EdgeHovered?.Invoke(null);
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        if (_pressedAt is null) return;
        _pressedAt = null;
        e.Pointer.Capture(null);
        if (_dragged) return;
        var edge = _back.EdgeAt(e.GetPosition(this));
        if (edge is not null) EdgeClicked?.Invoke(edge);
        else PaneClicked?.Invoke();
    }
}
