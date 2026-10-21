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

    private static readonly Cursor HandCursor = new(StandardCursorType.Hand);

    private readonly BackLayer _back = new();
    private readonly MotionLayer _motion = new();
    private readonly MarksLayer _marks = new();
    private readonly TrafficLayer _traffic = new();
    private Traffic? _load; // the load being shown, if the Performance panel is open
    private IReadOnlyDictionary<string, StateMark> _states = new Dictionary<string, StateMark>(); // the states at the stop on show, by shape
    private IDisposable? _step;
    private readonly Avalonia.Controls.Canvas _stage = new() { RenderTransformOrigin = RelativePoint.TopLeft };
    private readonly Dictionary<string, BoxControl> _boxes = [];
    private Scene? _scene;
    private Viewport _viewport = new(0, 0, 1);
    private IDisposable? _animation;
    private Padding _fitPadding = Camera.FitPadding(0, false);
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
    private Dictionary<string, CorePt> _gestureStarts = []; // every box the drag carries (one, or all the boxes picked), where each was
    private bool _gestureActive;
    private Line? _rubber;
    private IPointer? _pointer;
    private bool _editable;

    // Shift and drag on empty space draws a box round boxes to pick them, instead of panning.
    private bool _marqueeMode;
    private bool _marqueeActive;
    private List<string> _marqueeIds = [];
    private IPointer? _panPointer;
    private readonly Border _marquee = new()
    {
        Background = new SolidColorBrush(Color.FromArgb(36, 30, 144, 255)), BorderBrush = Brushes.DodgerBlue, BorderThickness = new Thickness(1),
        HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Left, VerticalAlignment = Avalonia.Layout.VerticalAlignment.Top, IsHitTestVisible = false, IsVisible = false,
    };

    public event Action<string>? BoxClicked;
    /// <summary>A box was clicked with Ctrl, Cmd or Shift held in edit mode: it joins the boxes picked, or leaves them.</summary>
    public event Action<string>? BoxToggled;
    /// <summary>A box was drawn round boxes with Shift held and the pointer was let go: these are the boxes it took in (none: it took in nothing).</summary>
    public event Action<IReadOnlyList<string>>? BoxesPicked;
    /// <summary>A box was dragged and dropped: where every box of the view now is (top-left corners). The reader saves them.</summary>
    public event Action<IReadOnlyList<(string Id, double X, double Y)>>? BoxesMoved;
    /// <summary>A line was drawn from one box's handle to another box.</summary>
    public event Action<string, string>? ConnectRequested;
    public event Action<string>? BoxDoubleClicked;
    public event Action<string>? EdgeClicked;
    public event Action<string?>? EdgeHovered;
    public event Action? PaneClicked;

    /// <summary>A click on the outline round the level you are inside (or its name): a click on that system itself.</summary>
    public event Action? FrameClicked;

    public CanvasView()
    {
        ClipToBounds = true;
        Background = Brushes.Transparent;
        Child = new Grid { Children = { _back, _stage, _traffic, _motion, _marks, _marquee } };
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

    /// <summary>Every beat of the steps now playing, for the tests.</summary>
    internal IReadOnlyList<Beat> PlayingBeats => _motion.AllBeats;

    /// <summary>The beats of the playing steps that are drawn at the moment shown, for the tests.</summary>
    internal IReadOnlyList<Beat> DrawnBeats => _motion.DrawnBeats;

    /// <summary>Draws the playing steps as they are <paramref name="t"/> ms in, for the tests: a step plays on frames, which a test can't hold still.</summary>
    internal void ShowMotionAt(double t) => _motion.Show(t);

    /// <summary>
    /// Plays a step's animation over the canvas: a pipe along the line from one box to the other, something running through it, and the
    /// boxes reacting. <paramref name="done"/> is called once when it has finished, and not if <see cref="StopStep"/> or another call cuts
    /// it off. Returns false, and draws nothing, when motion is reduced or an end isn't on screen.
    /// </summary>
    public bool PlayStep(StepAnimation animation, string from, string to, bool afterLanding, Action? done) =>
        PlaySteps([new StepRun(animation, from, to, afterLanding)], done);

    /// <summary>
    /// Who takes an intercepted request, as this view can draw it: the id of the box that stands for the shape on the canvas, or a name for a party that is not on it
    /// (drawn as a dashed marker).
    /// </summary>
    public sealed record TakenBy(string? Node = null, string? Name = null);

    /// <summary>One step of a stop to play: its animation, its two boxes, whether the stop before it ended at its source, and who takes it if it is intercepted.</summary>
    public sealed record StepRun(StepAnimation Animation, string From, string To, bool AfterLanding, TakenBy? By = null);

    /// <summary>
    /// Plays the steps of a stop together on one clock, each as a pipe between its boxes with something running through it and the boxes
    /// reacting. A box several steps squash takes the largest squash. <paramref name="done"/> is called once when the longest has finished,
    /// and not if <see cref="StopStep"/> or another call cuts it off. Returns false, and moves nothing, when motion is reduced or no step has
    /// both its ends on screen; a step with an end off screen is left out. When motion is reduced the marks an outcome leaves (a cross, a bar,
    /// a clock, a marker, the reason) are still drawn, and when a step has finished they stay until it is left.
    /// </summary>
    public bool PlaySteps(IReadOnlyList<StepRun> runs, Action? done)
    {
        StopStep();
        var outline = (string id) => _scene!.Boxes.First(x => x.Id == id) is { } box ? Look.DefOf(box.Object).Edge : null; // the pipe meets each shape on its outline, as the line does
        var shape = (string id) => _scene!.Boxes.First(x => x.Id == id) is { } box ? Look.DefOf(box.Object).Path : null; // and a ring or a flash follows it
        var playing = runs.Where(r => RectOf(r.From) is not null && RectOf(r.To) is not null).ToList();
        if (playing.Count == 0) return false;
        MotionLayer.Taker? Taker(TakenBy? by) =>
            by is null ? null
            : by.Node is { } id && _scene!.Boxes.FirstOrDefault(x => x.Id == id) is { } box ? new MotionLayer.Taker(box.Rect, Look.DefOf(box.Object).Path)
            : by.Name is { } name ? new MotionLayer.Taker(Name: name) : null;
        _back.LiftLabels(playing.Where(r => Animations.LeavesMarks(r.Animation)).Select(r => (r.From, r.To)));
        var specs = playing.Select(r => new MotionLayer.RunSpec(r.Animation, r.AfterLanding, LineStyle, RectOf(r.From)!.Value, RectOf(r.To)!.Value, outline(r.From), outline(r.To), shape(r.From), shape(r.To), Taker(r.By))).ToList();
        if (MotionSettings.Reduced)
        {
            _motion.StartStill(specs);
            return false;
        }
        var started = _motion.Start(specs);
        var total = started.Max(s => s.Total);
        StepMoving = true;
        _step = Anim.Run(this, total, t => t, t =>
        {
            var now = t * total;
            _motion.Show(now);
            var asked = new Dictionary<string, List<double>>();
            for (var i = 0; i < playing.Count; i++)
            {
                var (squashFrom, squashTo) = MotionMath.Squash(started[i].Beats, now);
                foreach (var (id, amount) in new[] { (playing[i].From, squashFrom), (playing[i].To, squashTo) })
                {
                    if (!asked.TryGetValue(id, out var list)) asked[id] = list = [];
                    list.Add(amount);
                }
            }
            foreach (var (id, amounts) in asked) Squash(id, MotionMath.Largest(amounts));
            _back.LitFade = started.Min(s => MotionMath.LitOpacity(s.Beats, now));
        }, () =>
        {
            EndStep(keepFade: true); // a line that timed out stays dim until the step is left
            done?.Invoke();
        });
        return true;
    }

    /// <summary>What a group says about a lit step, to draw on its line (above the box's corner for a step on one box).</summary>
    public sealed record Mark(string From, string To, string Text, string Kind);

    /// <summary>Shows these marks over the canvas, or none.</summary>
    public void SetMarks(IReadOnlyList<Mark> marks)
    {
        var outline = (string id) => _scene is { } s && s.Boxes.FirstOrDefault(x => x.Id == id) is { } box ? Look.DefOf(box.Object).Edge : null;
        var at = new List<MarkSpec>();
        foreach (var m in marks)
        {
            if (RectOf(m.From) is not { } a || RectOf(m.To) is not { } b) continue;
            var (x, y) = m.From == m.To ? (a.X + a.Width - 24, a.Y) : (LinePaths.Build(LineStyle, a, b, outline(m.From), outline(m.To)).Label.X, LinePaths.Build(LineStyle, a, b, outline(m.From), outline(m.To)).Label.Y);
            at.Add(new MarkSpec(m.Text, m.Kind, x, y));
        }
        _marks.Set(at);
    }

    /// <summary>Stops the step's animation where it is and puts the boxes back.</summary>
    public void StopStep() => EndStep(keepFade: false);

    /// <summary>How strong the lines a step has lit are drawn: 1, or less once a step that timed out has dimmed them.</summary>
    public double LitFade => _back.LitFade;

    private void EndStep(bool keepFade)
    {
        _step?.Dispose();
        _step = null;
        StepMoving = false;
        // A step that has finished leaves its marks (the cross, the bar, the marker) until it is left; leaving it, or another step, clears them.
        if (keepFade) _motion.Settle();
        else _motion.Clear();
        foreach (var box in _boxes.Values) box.SetSquash(0);
        if (!keepFade)
        {
            _back.LitFade = 1;
            _back.LiftLabels([]);
        }
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
                    if (_editable && AddsToPick(e.KeyModifiers)) return; // two Ctrl+clicks pick and unpick, they don't open the box
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
        if (_load is not null) ApplyLoad();
        ApplyStates();
    }

    /// <summary>Where the labels showing now are, for tests.</summary>
    internal IReadOnlyList<Flowy.Core.Rect> LabelRects => _back.LabelRects;

    /// <summary>The traffic layer, for tests: how many particles run and whether it runs at all.</summary>
    internal (int Particles, bool Running) TrafficNow => (_traffic.ParticleCount, _traffic.Running);

    /// <summary>
    /// Shows where shapes stand at the stop on show (see <see cref="States.Marks"/>): each shape named here dims and carries its state, and the rest are as
    /// they were. Null or nothing takes every state away. A shape's own state beats the strain colour of a load. With <c>snap</c> (a slider is being dragged)
    /// the shapes change at once instead of easing.
    /// </summary>
    public void ShowStates(IReadOnlyDictionary<string, StateMark>? states, bool snap = false)
    {
        _states = states ?? new Dictionary<string, StateMark>();
        ApplyStates(snap);
    }

    /// <summary>Puts each shape in the state it is told, at once when <paramref name="snap"/> (see <see cref="BoxControl.SetState"/>).</summary>
    private void ApplyStates(bool snap = false)
    {
        foreach (var (id, box) in _boxes) box.SetState(_states.TryGetValue(id, out var mark) ? mark : null, snap);
    }

    /// <summary>The shapes on the canvas that are in a state now, by id: what the key under the player lists, and what a test reads.</summary>
    internal IReadOnlyDictionary<string, StateMark> StatesShown => _boxes.Where(b => b.Value.State is not null).ToDictionary(b => b.Key, b => b.Value.State!);

    /// <summary>The load that is showing, or null.</summary>
    internal Traffic? Load => _load;

    /// <summary>How thick the line from one box to another is drawn under the load (null: as usual), for tests.</summary>
    internal double? LineWidth(string from, string to) => _back.WidthOf(SceneBuilder.LineId(from, to));

    /// <summary>
    /// Shows a load: strain outlines and queue numbers on the shapes, thicker lines where there is more traffic and, unless motion is reduced, particles running
    /// along them. Null takes it all away.
    /// </summary>
    public void ShowLoad(Traffic? load)
    {
        _load = load;
        ApplyLoad();
    }

    private void ApplyLoad()
    {
        foreach (var (id, box) in _boxes) box.SetPerf(_load is not null && _load.Boxes.TryGetValue(id, out var perf) ? perf : null);
        _back.SetWidths(_load?.Lines.GroupBy(l => SceneBuilder.LineId(l.From, l.To)).ToDictionary(g => g.Key, g => g.First().Width)); // sources that share a line are as thick as the whole line, each
        if (_load is null || MotionSettings.Reduced) _traffic.Clear();
        else _traffic.Set(_load.Lines, PathOf, _scene?.Boxes.Select(b => new TrafficLayer.ShapeCover(b.Id, b.Rect, Look.DefOf(b.Object).Edge)).ToList() ?? [], _back.LabelRects);
    }

    /// <summary>A traffic line's path, flattened, in the style the lines are drawn in: the same one the line itself takes, so the particles run on it.</summary>
    private FlatLine? PathOf(LineTraffic line)
    {
        if (_scene is null || RectOf(line.From) is not { } a || RectOf(line.To) is not { } b) return null;
        double[]? Outline(string id) => Look.DefOf(_scene.Boxes.First(x => x.Id == id).Object).Edge;
        return PathPoints.Flatten(LinePaths.Build(LineStyle, a, b, Outline(line.From), Outline(line.To)).Data);
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
        if (_load is not null) ApplyLoad();
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
        if (_marqueeActive)
        {
            _pressedAt = null;
            _panPointer?.Capture(null);
            EndMarquee();
            return true;
        }
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

    /// <summary>Whether a click with these keys held adds to the boxes picked instead of replacing them.</summary>
    private static bool AddsToPick(KeyModifiers keys) => (keys & (KeyModifiers.Control | KeyModifiers.Meta | KeyModifiers.Shift)) != 0;

    private void OnBoxReleased(string id, PointerReleasedEventArgs e)
    {
        if (e.InitialPressMouseButton != MouseButton.Left || _dragged) return;
        if (_editable && AddsToPick(e.KeyModifiers)) BoxToggled?.Invoke(id);
        else BoxClicked?.Invoke(id);
        e.Handled = true;
    }

    /// <summary>Draws the box being pulled out over empty space, and lights the boxes (this view's own) that are wholly inside it.</summary>
    private void DrawMarquee(Point from, Point to)
    {
        var (x, y) = (Math.Min(from.X, to.X), Math.Min(from.Y, to.Y));
        var (width, height) = (Math.Abs(to.X - from.X), Math.Abs(to.Y - from.Y));
        _marquee.Margin = new Thickness(x, y, 0, 0);
        _marquee.Width = width;
        _marquee.Height = height;
        _marquee.IsVisible = true;
        _marqueeActive = true;
        var (topLeft, bottomRight) = (ToScene(new Point(x, y)), ToScene(new Point(x + width, y + height)));
        _marqueeIds = _scene is null ? [] : _scene.Boxes
            .Where(b => _scene.Members.Contains(b.Id) && b.Rect.X >= topLeft.X && b.Rect.Y >= topLeft.Y && b.Rect.Right <= bottomRight.X && b.Rect.Bottom <= bottomRight.Y)
            .Select(b => b.Id).ToList();
        foreach (var (id, control) in _boxes) control.SetSelected(_marqueeIds.Contains(id));
    }

    /// <summary>Takes the marquee away; the boxes show as picked again as they were before it, unless the reader is about to say otherwise.</summary>
    private void EndMarquee()
    {
        _marquee.IsVisible = false;
        _marqueeActive = false;
        _marqueeMode = false;
        _marqueeIds = [];
        foreach (var (id, control) in _boxes) control.SetSelected(_selected.Contains(id));
    }

    private void SetViewport(Viewport viewport)
    {
        _viewport = viewport;
        _stage.RenderTransform = new MatrixTransform(Matrix.CreateScale(viewport.Zoom, viewport.Zoom) * Matrix.CreateTranslation(viewport.X, viewport.Y));
        _back.Viewport = viewport;
        _motion.Viewport = viewport;
        _marks.Viewport = viewport;
        _traffic.Viewport = viewport;
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

    /// <summary>The whole view, centred, with room for the details panel (`panel` wide, 0 when closed), the navigator (`nav` wide) and the flow player when they're there. Fits again when the window is resized.</summary>
    public void Fit(double panel, bool player, double nav = 0, double milliseconds = 0)
    {
        _fitPadding = Camera.FitPadding(panel, player, nav);
        _fitOnResize = true;
        if (Content() is { } bounds && base.Bounds.Width > 0 && base.Bounds.Height > 0)
            MoveTo(Camera.Fit(bounds, base.Bounds.Width, base.Bounds.Height, _fitPadding), milliseconds);
    }

    /// <summary>Pans just far enough that this box isn't hidden under the details panel (`panel` wide: it opens for the box) or the navigator (`nav` wide, 0 when closed).</summary>
    public void Reveal(string id, double panel = Camera.Panel, double nav = 0, double milliseconds = 200)
    {
        if (RectOf(id) is not { } r) return;
        if (Camera.PanIntoView(r, _viewport, base.Bounds.Width, base.Bounds.Height, panel, 24, Math.Min(nav, base.Bounds.Width)) is { } to) MoveTo(to, milliseconds);
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
            // Dragging one of several boxes picked takes them all along; any other box goes alone.
            var group = _selected.Count > 1 && _selected.Contains(box.Id) ? _selected : [box.Id];
            _gestureStarts = group.Distinct().Where(id => RectOf(id) is not null).ToDictionary(id => id, id => new CorePt(RectOf(id)!.Value.X, RectOf(id)!.Value.Y));
            _gestureActive = false;
            return;
        }
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed || OverBox(e)) return;
        _animation?.Dispose();
        _pressedAt = e.GetPosition(this);
        _pressedViewport = _viewport;
        _marqueeMode = _editable && (e.KeyModifiers & KeyModifiers.Shift) != 0;
        _panPointer = e.Pointer;
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
                foreach (var (id, origin) in _gestureStarts)
                    _moved[id] = new CorePt(origin.X + (p.X - _gestureStart.X) / _viewport.Zoom, origin.Y + (p.Y - _gestureStart.Y) / _viewport.Zoom);
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
            if (_marqueeMode)
            {
                DrawMarquee(start, p);
                return;
            }
            _fitOnResize = false;
            SetViewport(_pressedViewport with { X = _pressedViewport.X + dx, Y = _pressedViewport.Y + dy });
            return;
        }
        var overBox = OverBox(e);
        var edge = overBox ? null : _back.EdgeAt(p);
        Cursor = !overBox && edge is null && _back.OnFrame(p) ? HandCursor : null;
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
        if (_marqueeActive)
        {
            var picked = _marqueeIds;
            EndMarquee();
            BoxesPicked?.Invoke(picked);
            e.Handled = true;
            return;
        }
        _marqueeMode = false;
        if (_dragged) return;
        var pressed = e.GetPosition(this);
        if (_back.EdgeAt(pressed) is { } edge) EdgeClicked?.Invoke(edge);
        else if (_back.OnFrame(pressed)) FrameClicked?.Invoke();
        else PaneClicked?.Invoke();
    }
}
