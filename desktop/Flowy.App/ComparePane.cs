using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// One flow of a comparison, drawn on its own view with a canvas, a playhead and a player card of its own: its own zoom and pan, and its own place in the flow, so acting in one
/// pane never moves another. It is the reader's single canvas cut down to what a flow needs: nothing is dragged or edited, a double-click goes nowhere, and the card's Stop and
/// Open flow are greyed out, since a pane never leaves its flow. Its title is the flow's own name.
/// </summary>
internal sealed class ComparePane : Border
{
    private readonly CanvasView _canvas = new();
    private readonly PlayerCard _player = new(inPane: true);
    private readonly Playback _playback;
    private readonly Border _outline = new() { IsHitTestVisible = false, IsVisible = false };
    private readonly TextBlock _title = new();
    private readonly string _flowId;
    private Folder? _folder;
    private string _lineStyle = "straight";
    private ReaderView.Side? _selection;
    private string? _hover;
    private bool _fitted;
    private (Flow Flow, IReadOnlyList<Stop> Stops)? _stops;

    /// <summary>A box or a line (with the view this pane draws it in) was clicked.</summary>
    public event Action<ReaderView.Side>? Picked;

    /// <summary>The pane was pressed anywhere, or took a key: it is the one the flow keys act on.</summary>
    public event Action? FocusRequested;

    /// <summary>The pane's empty area was clicked: the Details panel closes, as on the single canvas.</summary>
    public event Action? EmptyClicked;

    /// <param name="flowId">The flow this pane draws, on that flow's own view. It must be one that plays.</param>
    /// <param name="copy">0, or 1 for the second pane of a flow compared with itself, so the two can be told apart.</param>
    public ComparePane(string flowId, int copy = 0)
    {
        _flowId = flowId;
        Key = copy == 0 ? flowId : $"{flowId}#{copy}";
        _playback = new Playback(new PlaybackHooks(PlayWhere, () => _canvas.StepMoving, Draw, (ms, then) => Anim.Run(this, ms, t => t, _ => InvalidateVisual(), then)));
        Classes.Add("pane");
        Focusable = false;

        _title.Classes.Add("panetitle");
        _title.TextTrimming = TextTrimming.CharacterEllipsis;
        var head = new Border { Child = _title, Classes = { "panehead" } };
        Grid.SetRow(head, 0);

        var zoom = ZoomButtons();
        var stage = new Grid { ClipToBounds = true, Children = { _canvas, zoom, _player } };
        // The card leaves most of a short pane to the diagram, and a fit keeps that much of the bottom clear for it.
        stage.SizeChanged += (_, e) => _player.MaxHeight = Math.Max(150, e.NewSize.Height * 0.5);
        _canvas.PlayerRoom = () => Math.Min(200, Math.Max(80, _canvas.Bounds.Height * 0.4));
        Grid.SetRow(stage, 1);
        var content = new Grid { RowDefinitions = [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Star)], Children = { head, stage } };
        // The outline is drawn over the content, not as the pane's own border: a thicker border would move what is inside it.
        Child = new Grid { Children = { content, _outline } };

        _outline.Classes.Add("paneoutline");
        _canvas.BoxClicked += id => Picked?.Invoke(new ReaderView.Side.Box(id));
        _canvas.EdgeClicked += OnEdgeClicked;
        _canvas.EdgeHovered += id =>
        {
            if (_hover == id) return;
            _hover = id;
            DrawScene();
        };
        _canvas.PaneClicked += () =>
        {
            FocusRequested?.Invoke();
            EmptyClicked?.Invoke();
        };
        _canvas.FrameClicked += () => FocusRequested?.Invoke();
        _player.Back += () => Step(-1);
        _player.Next += () => Step(1);
        _player.Auto += _playback.ToggleAuto;
        _player.Replay += _playback.Replay;
        // Every press, handled or not (the canvas handles its own): the pane is the one the keys act on from now.
        AddHandler(PointerPressedEvent, (_, _) => FocusRequested?.Invoke(), RoutingStrategies.Tunnel, handledEventsToo: true);
    }

    /// <summary>The pane's identity: its flow's id, and a suffix for the second pane of a flow compared with itself. It stays with the pane when the sides swap.</summary>
    public string Key { get; }

    public string FlowId => _flowId;

    public CanvasView Canvas => _canvas;

    public PlayerCard Card => _player;

    public Playback Playback => _playback;

    /// <summary>Whether the pane has the focus: it is outlined, and the keys of a flow act on it.</summary>
    public bool Focused
    {
        get => _outline.IsVisible;
        set
        {
            _outline.IsVisible = value;
            if (value) Classes.Add("focused");
            else Classes.Remove("focused");
        }
    }

    /// <summary>The stop the pane is at.</summary>
    public int StopNow => _folder is not null && StopsNow() is { } stops && _playback.Head is { } head ? Math.Max(0, Math.Min(head.Step, stops.Count - 1)) : 0;

    public int StopCount => StopsNow()?.Count ?? 0;

    /// <summary>The pane's title: its flow's own name.</summary>
    public string TitleText => _title.Text ?? "";

    private Border ZoomButtons()
    {
        Button Make(string icon, string name, Action click)
        {
            var b = new Button { Content = Icons.Make(icon, "zoomicon", 16) };
            b.Classes.Add("zoom");
            b.Click += (_, _) => click();
            AutomationProperties.SetName(b, name);
            ToolTip.SetTip(b, name);
            return b;
        }
        var group = new Border
        {
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(10),
            Child = new StackPanel
            {
                Children =
                {
                    Make(Icons.Plus, "Zoom in", () => _canvas.ZoomBy(1.25)),
                    Make(Icons.Minus, "Zoom out", () => _canvas.ZoomBy(0.8)),
                    Make(Icons.Fit, "Fit the view", Fit),
                },
            },
        };
        group.Classes.Add("zoomgroup");
        return group;
    }

    private (int Index, int Count)? PlayWhere() => StopsNow() is { } stops ? (StopNow, stops.Count) : null;

    private IReadOnlyList<Stop>? StopsNow()
    {
        if (_folder is null || !_folder.Model.Flows.TryGetValue(_flowId, out var flow)) return null;
        if (_stops is not { } cached || !ReferenceEquals(cached.Flow, flow)) _stops = cached = (flow, Structure.Stops(flow));
        return cached.Stops;
    }

    // ---- showing ------------------------------------------------------------------------------------------------

    /// <summary>
    /// Starts the pane at a stop of its flow (the one a playing flow was at when the comparison opened; 0 otherwise). Autoplay never carries over: a comparison opens still.
    /// </summary>
    public void Start(int stop)
    {
        _playback.StopAuto();
        _playback.Head = new Playhead(_flowId, Math.Max(0, stop), []);
    }

    /// <summary>Draws the pane for the folder as it is now, with the shape or line the shared Details panel shows outlined when it was this pane that showed it.</summary>
    public void Show(Folder folder, string lineStyle, ReaderView.Side? selection)
    {
        _folder = folder;
        _lineStyle = lineStyle;
        _selection = selection;
        Draw();
    }

    /// <summary>Everything the pane shows: its canvas, its card and the step's motion. A step, a replay and a reload all come here.</summary>
    private void Draw()
    {
        if (_folder is null || StopsNow() is not { } stops || !_folder.Model.Flows.TryGetValue(_flowId, out var flow)) return;
        var model = _folder.Model;
        var view = flow.View ?? Names.Root;
        var index = StopNow;
        var name = string.IsNullOrEmpty(flow.Name) ? _flowId : flow.Name;
        _title.Text = name;
        ToolTip.SetTip(_title, name);
        AutomationProperties.SetName(this, Key.Contains('#') ? $"{name} (2)" : name);

        var shown = DrawScene();
        if (!_fitted)
        {
            _fitted = true;
            _canvas.Fit(0, true, 0, 0, refit: false); // once, when the pane first has a size; after that the reader's zoom stays through a resize
        }
        var (card, marks) = FlowStage.CardAt(model, flow, _flowId, stops, index, shown, _playback.Auto, null, _canvas.StatesShown.Values.ToList());
        _player.Show(card);
        _canvas.SetMarks(marks);

        // The motion of the step on show starts once for each step and replay: a hover, a theme or a change on disk redraws without starting it again.
        if (!_playback.Begin(_flowId, index, out var key)) return;
        _canvas.StopStep();
        if (shown is not null)
        {
            var runs = FlowStage.RunsOf(model, view, flow, stops, index, shown);
            if (runs.Count > 0) _canvas.PlaySteps(runs, () => _playback.Settled(key));
        }
        _playback.ArmAuto();
    }

    /// <summary>The canvas alone: what pointing at a line changes.</summary>
    private Playing? DrawScene()
    {
        if (_folder is null || StopsNow() is not { } stops || !_folder.Model.Flows.TryGetValue(_flowId, out var flow)) return null;
        var model = _folder.Model;
        var view = flow.View ?? Names.Root;
        var index = StopNow;
        var shown = FlowStage.PlayingAt(model, view, flow, stops, index);
        var box = _selection is ReaderView.Side.Box b ? b.Id : null;
        // A line is the same two shapes joined in this view only: another pane on another view is not outlined for it.
        var line = _selection is ReaderView.Side.Line l && l.View == view ? SceneBuilder.LineId(l.From, l.To) : null;
        var scene = SceneBuilder.Build(model, view, shown, _folder.Problems, new Focus(box, line, _hover));
        _canvas.SetScene(scene, _lineStyle, box is null ? [] : [box]);
        _canvas.ShowStates(States.Marks(model, States.At(flow, stops, index)));
        return shown;
    }

    private void OnEdgeClicked(string id)
    {
        FocusRequested?.Invoke();
        if (_canvas.Scene?.Edges.FirstOrDefault(e => e.Id == id) is not { } edge || _folder?.Model.Flows.TryGetValue(_flowId, out var flow) != true) return;
        Picked?.Invoke(new ReaderView.Side.Line(edge.From, edge.To, flow!.View ?? Names.Root));
    }

    // ---- what the keys and the card do --------------------------------------------------------------------------

    /// <summary>One stop on (1) or back (-1). Taking a step yourself ends Autoplay.</summary>
    public void Step(int by) => GoTo(StopNow + by);

    public void First() => GoTo(0);

    public void Last() => GoTo(StopCount - 1);

    private void GoTo(int stop)
    {
        if (StopsNow() is not { } stops || _playback.Head is not { } head) return;
        _playback.StopAuto();
        _playback.Head = head with { Step = Math.Max(0, Math.Min(stop, stops.Count - 1)) };
        Draw();
    }

    public void TogglePlay() => _playback.ToggleAuto();

    public void Replay() => _playback.Replay();

    /// <summary>Fits the whole flow's view in the pane, as F does.</summary>
    public void Fit() => _canvas.Fit(0, true, 0, 220, refit: false);
}
