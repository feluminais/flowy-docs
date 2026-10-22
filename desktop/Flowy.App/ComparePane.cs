using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Input;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>What the keys of a flow act on in a comparison: a pane of Side by side, or the canvas of Swap (the flow on show).</summary>
internal interface IFlowKeys
{
    void Step(int by);

    void First();

    void Last();

    void TogglePlay();

    void Replay();

    /// <summary>Fits the whole flow's view in the canvas, as F does.</summary>
    void Fit();
}

/// <summary>
/// One flow of a comparison, drawn on its own view with a canvas, a playhead and a player card of its own: its own zoom and pan, and its own place in the flow, so acting in one
/// pane never moves another. It is the reader's single canvas cut down to what a flow needs: nothing is dragged or edited, a double-click goes nowhere, and the card's Stop and
/// Open flow are greyed out, since a pane never leaves its flow. Its title is the flow's own name. What it plays is a <see cref="PaneFlow"/>, which Swap uses too.
/// </summary>
internal sealed class ComparePane : Border, IFlowKeys
{
    private readonly CanvasView _canvas = new();
    private readonly PlayerCard _player = new(inPane: true);
    private readonly PaneFlow _flow;
    private readonly Border _outline = new() { IsHitTestVisible = false, IsVisible = false };
    private readonly TextBlock _title;

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
        Key = copy == 0 ? flowId : $"{flowId}#{copy}";
        _flow = new PaneFlow(this, flowId, _canvas, _player);
        Classes.Add("pane");
        Focusable = false;

        var (head, title) = PaneChrome.Head();
        _title = title;
        Grid.SetRow(head, 0);

        var zoom = PaneChrome.ZoomButtons(_canvas, Fit);
        var stage = new Grid { ClipToBounds = true, Children = { _canvas, zoom, _player } };
        // The card leaves most of a short pane to the diagram, and a fit keeps that much of the bottom clear for it.
        stage.SizeChanged += (_, e) => _player.MaxHeight = Math.Max(150, e.NewSize.Height * 0.5);
        _canvas.PlayerRoom = () => Math.Min(200, Math.Max(80, _canvas.Bounds.Height * 0.4));
        Grid.SetRow(stage, 1);
        var content = new Grid { RowDefinitions = [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Star)], Children = { head, stage } };
        // The outline is drawn over the content, not as the pane's own border: a thicker border would move what is inside it.
        Child = new Grid { Children = { content, _outline } };

        _outline.Classes.Add("paneoutline");
        _flow.Drew += () =>
        {
            _title.Text = _flow.Name;
            ToolTip.SetTip(_title, _flow.Name);
            AutomationProperties.SetName(this, Key.Contains('#') ? $"{_flow.Name} (2)" : _flow.Name);
        };
        _canvas.BoxClicked += id => Picked?.Invoke(new ReaderView.Side.Box(id));
        _canvas.EdgeClicked += id =>
        {
            FocusRequested?.Invoke();
            if (_flow.LineSide(id) is { } side) Picked?.Invoke(side);
        };
        _canvas.EdgeHovered += _flow.Hover;
        _canvas.PaneClicked += () =>
        {
            FocusRequested?.Invoke();
            EmptyClicked?.Invoke();
        };
        _canvas.FrameClicked += () => FocusRequested?.Invoke();
        // Every press, handled or not (the canvas handles its own): the pane is the one the keys act on from now.
        AddHandler(PointerPressedEvent, (_, _) => FocusRequested?.Invoke(), RoutingStrategies.Tunnel, handledEventsToo: true);
    }

    /// <summary>The pane's identity: its flow's id, and a suffix for the second pane of a flow compared with itself. It stays with the pane when the sides swap.</summary>
    public string Key { get; }

    public string FlowId => _flow.FlowId;

    public CanvasView Canvas => _canvas;

    public PlayerCard Card => _player;

    public Playback Playback => _flow.Playback;

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
    public int StopNow => _flow.StopNow;

    public int StopCount => _flow.StopCount;

    /// <summary>The pane's title: its flow's own name.</summary>
    public string TitleText => _title.Text ?? "";

    /// <summary>Starts the pane at a stop of its flow (see <see cref="PaneFlow.Start"/>).</summary>
    public void Start(int stop) => _flow.Start(stop);

    /// <summary>Draws the pane for the folder as it is now, with the shape or line the shared Details panel shows outlined when it was this pane that showed it.</summary>
    public void Show(Folder folder, string lineStyle, ReaderView.Side? selection) => _flow.Show(folder, lineStyle, selection);

    /// <summary>One stop on (1) or back (-1). Taking a step yourself ends Autoplay.</summary>
    public void Step(int by) => _flow.Step(by);

    public void First() => _flow.First();

    public void Last() => _flow.Last();

    public void TogglePlay() => _flow.TogglePlay();

    public void Replay() => _flow.Replay();

    /// <summary>Fits the whole flow's view in the pane, as F does.</summary>
    public void Fit() => _canvas.Fit(0, true, 0, 220, refit: false);
}
