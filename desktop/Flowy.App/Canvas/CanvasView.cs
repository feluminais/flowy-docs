using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Controls.Shapes;
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
    private readonly MotionLayer _motion = new();
    private IDisposable? _step;
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

    // Edit mode: a box dragged to a new place, or a line drawn from the handle under one box to another.
    private enum Gesture { None, Drag, Connect }

    private const double HandleZoneHeight = 18;
    private const double HandleZoneHalfWidth = 24;
    private Scene? _baseScene; // the scene as made, before any box was dragged
    private readonly Dictionary<string, CorePt> _moved = [];
    private Gesture _gesture;
    private string? _gestureBox;
    private Point _gestureStart;
    private CorePt _gestureBoxStart;
    private bool _gestureActive;
    private Line? _rubber;
    private IPointer? _pointer;
    private bool _editable;

    public event Action<string>? BoxClicked;
    /// <summary>A box was dragged and dropped: where every box of the view now is (top-left corners). The reader saves them.</summary>
    public event Action<IReadOnlyList<(string Id, double X, double Y)>>? BoxesMoved;
    /// <summary>A line was drawn from one box's handle to another box.</summary>
    public event Action<string, string>? ConnectRequested;
    public event Action<string>? BoxDoubleClicked;
    public event Action<string>? EdgeClicked;
    public event Action<string?>? EdgeHovered;
    public event Action? PaneClicked;

    public CanvasView()
    {
        ClipToBounds = true;
        Background = Brushes.Transparent;
        Child = new Grid { Children = { _back, _stage, _motion } };
    }

    public Scene? Scene => _scene;

    /// <summary>Edit mode: boxes can be dragged and each has a handle to draw a connection from.</summary>
    public bool Editable
    {
        get => _editable;
        set
        {
            _editable = value;
            foreach (var box in _boxes.Values) box.SetEditable(value);
        }
    }

    /// <summary>The places boxes were dragged to are kept until the reader has saved them, so a box doesn't jump back while the files are written.</summary>
    public void ClearMoved()
    {
        if (_moved.Count == 0) return;
        _moved.Clear();
        if (_baseScene is not null) SetScene(_baseScene, LineStyle, _selected);
    }

    private List<string> _selected = [];

    public Viewport Viewport => _viewport;

    public string LineStyle { get; private set; } = "straight";

    public Flowy.Core.Rect? RectOf(string id) => _scene?.Boxes.FirstOrDefault(b => b.Id == id) is { } b ? b.Rect : null;

    /// <summary>The box control with this id, for keyboard focus and tests.</summary>
    public Control? BoxControlFor(string id) => _boxes.GetValueOrDefault(id);

    /// <summary>Whether a step's animation is running.</summary>
    public bool StepMoving { get; private set; }

    /// <summary>
    /// Plays a step's animation over the canvas: a pipe along the line from one box to the other, something running through it, and the
    /// boxes reacting. <paramref name="done"/> is called once when it has finished, and not if <see cref="StopStep"/> or another call cuts
    /// it off. Returns false, and draws nothing, when motion is reduced or an end isn't on screen.
    /// </summary>
    public bool PlayStep(StepAnimation animation, string from, string to, bool afterLanding, Action? done)
    {
        StopStep();
        if (MotionSettings.Reduced || RectOf(from) is not { } a || RectOf(to) is not { } b) return false;
        var outline = (string id) => _scene!.Boxes.First(x => x.Id == id) is { } box ? Look.DefOf(box.Object).Edge : null; // the pipe meets each shape on its outline, as the line does
        var (beats, total) = _motion.Start(animation, afterLanding, LineStyle, a, b, outline(from), outline(to));
        StepMoving = true;
        _step = Anim.Run(this, total, t => t, t =>
        {
            var now = t * total;
            _motion.Show(now);
            var (squashFrom, squashTo) = MotionMath.Squash(beats, now);
            Squash(from, squashFrom);
            Squash(to, squashTo);
        }, () =>
        {
            StopStep();
            done?.Invoke();
        });
        return true;
    }

    /// <summary>Stops the step's animation where it is and puts the boxes back.</summary>
    public void StopStep()
    {
        _step?.Dispose();
        _step = null;
        StepMoving = false;
        _motion.Clear();
        foreach (var box in _boxes.Values) box.SetSquash(0);
    }

    private void Squash(string id, double amount)
    {
        if (_boxes.TryGetValue(id, out var box)) box.SetSquash(amount);
    }

    /// <summary>
    /// Shows a scene. The boxes already on the stage are updated in place, so a click or a flow step doesn't rebuild what didn't change;
    /// a different set of boxes replaces them.
    /// </summary>
    public void SetScene(Scene scene, string lineStyle, IEnumerable<string> selected)
    {
        LineStyle = lineStyle;
        _selected = selected.ToList();
        _baseScene = scene;
        scene = WithMoved(scene);
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
                control.SetEditable(_editable);
                _boxes[box.Id] = control;
                _stage.Children.Add(control);
            }
        }
        else
        {
            foreach (var box in scene.Boxes) _boxes[box.Id].Update(box);
        }
        foreach (var (id, control) in _boxes) control.SetSelected(_selected.Contains(id));
        _back.SetScene(scene, lineStyle);
    }

    /// <summary>The scene with the boxes that are being (or were just) dragged where they are now, and the frame around the members following them.</summary>
    private Scene WithMoved(Scene scene)
    {
        if (_moved.Count == 0) return scene;
        var boxes = scene.Boxes.Select(b => _moved.TryGetValue(b.Id, out var at) ? b with { Rect = b.Rect with { X = at.X, Y = at.Y } } : b).ToList();
        Flowy.Core.Rect? frame = scene.Frame is null ? null : BoxGeometry.FrameAround(boxes.Where(b => scene.Members.Contains(b.Id)).Select(b => b.Rect));
        return scene with { Boxes = boxes, Frame = frame };
    }

    private CorePt ToScene(Point screen) => new((screen.X - _viewport.X) / _viewport.Zoom, (screen.Y - _viewport.Y) / _viewport.Zoom);

    private BoxControl? BoxUnder(PointerEventArgs e) =>
        e.Source is Visual v ? (v as BoxControl ?? v.FindAncestorOfType<BoxControl>()) : null;

    private void ShowMoved()
    {
        if (_baseScene is null) return;
        _scene = WithMoved(_baseScene);
        foreach (var box in _scene.Boxes) _boxes[box.Id].Update(box);
        _back.SetScene(_scene, LineStyle);
    }

    private void EndGesture(PointerEventArgs e)
    {
        if (_rubber is not null) _stage.Children.Remove(_rubber);
        _rubber = null;
        _gesture = Gesture.None;
        _gestureBox = null;
        _gestureActive = false;
        _pointer = null;
        e.Pointer.Capture(null);
    }

    /// <summary>Esc while a box is being dragged, or a line drawn from a handle: forget it, and put the box back. True if there was one.</summary>
    public bool CancelGesture()
    {
        if (_gesture == Gesture.None || !_gestureActive) return false;
        var wasDrag = _gesture == Gesture.Drag;
        if (_rubber is not null) _stage.Children.Remove(_rubber);
        _rubber = null;
        _gesture = Gesture.None;
        _gestureBox = null;
        _gestureActive = false;
        _pointer?.Capture(null);
        _pointer = null;
        if (wasDrag) ClearMoved();
        return true;
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
        _motion.Viewport = viewport;
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
        if (_editable && e.GetCurrentPoint(this).Properties.IsLeftButtonPressed && BoxUnder(e) is { } box && RectOf(box.Id) is { } rect)
        {
            // Not captured yet: a plain click on the box is still a click. Past a few pixels it becomes a drag, or a line from the handle.
            var inside = e.GetPosition(box);
            var onHandle = inside.Y >= box.Bounds.Height - HandleZoneHeight && Math.Abs(inside.X - box.Bounds.Width / 2) <= HandleZoneHalfWidth;
            _gesture = onHandle ? Gesture.Connect : Gesture.Drag;
            _gestureBox = box.Id;
            _gestureStart = e.GetPosition(this);
            _gestureBoxStart = new CorePt(rect.X, rect.Y);
            _gestureActive = false;
            return;
        }
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
        if (_gesture != Gesture.None && _gestureBox is { } gestureBox)
        {
            if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
            {
                EndGesture(e);
                return;
            }
            if (!_gestureActive)
            {
                if (Math.Abs(p.X - _gestureStart.X) + Math.Abs(p.Y - _gestureStart.Y) < DragSlop) return;
                _gestureActive = true;
                _pointer = e.Pointer;
                e.Pointer.Capture(this);
                if (_gesture == Gesture.Connect)
                {
                    _rubber = new Line { Stroke = Brushes.DodgerBlue, StrokeThickness = 2 / _viewport.Zoom, StrokeDashArray = [4, 3], IsHitTestVisible = false };
                    _stage.Children.Add(_rubber);
                }
            }
            if (_gesture == Gesture.Drag)
            {
                _moved[gestureBox] = new CorePt(_gestureBoxStart.X + (p.X - _gestureStart.X) / _viewport.Zoom, _gestureBoxStart.Y + (p.Y - _gestureStart.Y) / _viewport.Zoom);
                ShowMoved();
            }
            else if (_rubber is not null && RectOf(gestureBox) is { } from)
            {
                var to = ToScene(p);
                _rubber.StartPoint = new Point(from.X + from.Width / 2, from.Bottom);
                _rubber.EndPoint = new Point(to.X, to.Y);
            }
            return;
        }
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
        if (_gesture != Gesture.None)
        {
            var wasActive = _gestureActive;
            var kind = _gesture;
            var from = _gestureBox;
            EndGesture(e);
            if (!wasActive || from is null) return;
            if (kind == Gesture.Drag)
            {
                if (_scene is { } now) BoxesMoved?.Invoke(now.Boxes.Select(b => (b.Id, b.Rect.X, b.Rect.Y)).ToList());
            }
            else
            {
                var at = ToScene(e.GetPosition(this));
                var to = _scene?.Boxes.FirstOrDefault(b => b.Id != from && at.X >= b.Rect.X && at.X <= b.Rect.Right && at.Y >= b.Rect.Y && at.Y <= b.Rect.Bottom);
                if (to is not null) ConnectRequested?.Invoke(from, to.Id);
            }
            e.Handled = true;
            return;
        }
        if (_pressedAt is null) return;
        _pressedAt = null;
        e.Pointer.Capture(null);
        if (_dragged) return;
        var edge = _back.EdgeAt(e.GetPosition(this));
        if (edge is not null) EdgeClicked?.Invoke(edge);
        else PaneClicked?.Invoke();
    }
}
