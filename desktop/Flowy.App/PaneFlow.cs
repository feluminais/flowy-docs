using Flowy.App.Canvas;
using Flowy.Core;
using Avalonia.Controls;

namespace Flowy.App;

/// <summary>What a flow's canvas shows right now: the scene, the shape outlined, and the stop's lit lines (null when the flow has no stop to show).</summary>
internal sealed record FlowFrame(Scene Scene, Playing? Shown, IReadOnlyList<string> Selected);

/// <summary>
/// One flow of a comparison: its own place in the flow (the playhead and Autoplay), its player card and what it draws on the canvas it is given. A pane of Side by side owns one
/// of these with a canvas of its own; Swap gives both flows the one canvas, and only the flow on show draws on it (<see cref="Drawing"/>), so each keeps its step and its Autoplay
/// while the other is on show. It is the part of the single reader's canvas that a flow needs: nothing is dragged or edited.
/// </summary>
internal sealed class PaneFlow
{
    private readonly CanvasView _canvas;
    private readonly PlayerCard _player;
    private readonly Playback _playback;
    private readonly string _flowId;
    private Folder? _folder;
    private string _lineStyle = "straight";
    private ReaderView.Side? _selection;
    private string? _hover;
    private bool _fitted;
    private (Flow Flow, IReadOnlyList<Stop> Stops)? _stops;

    /// <param name="host">The control the flow's animations run on (they wait on its window's frames).</param>
    /// <param name="flowId">The flow, on that flow's own view. It must be one that plays.</param>
    public PaneFlow(Control host, string flowId, CanvasView canvas, PlayerCard player)
    {
        _flowId = flowId;
        _canvas = canvas;
        _player = player;
        _playback = new Playback(new PlaybackHooks(PlayWhere, () => _canvas.StepMoving, Draw, (ms, then) => Anim.Run(host, ms, t => t, _ => host.InvalidateVisual(), then)));
        _player.Back += () => Step(-1);
        _player.Next += () => Step(1);
        _player.Auto += _playback.ToggleAuto;
        _player.Replay += _playback.Replay;
    }

    /// <summary>The flow was drawn (its name may be new): the pane's title follows.</summary>
    public event Action? Drew;

    /// <summary>
    /// Whether the flow draws on its canvas and card at all. Off, every redraw does nothing, so a flow that is off show (Swap), or whose canvas a swap is moving about, is not
    /// drawn over. A pane fits its flow once, when it is first drawn; the stage of a swap fits the camera itself.
    /// </summary>
    public bool Drawing { get; set; } = true;

    public bool AutoFit { get; init; } = true;

    /// <summary>
    /// What a comparison with Show changes on says changed in this flow: its shapes, lines and steps. The canvas marks the shapes and lines when the flow draws, and the card's progress bar
    /// marks the stops. Null (the switch is off) marks nothing.
    /// </summary>
    public SideMarks? Changes { get; set; }

    public string FlowId => _flowId;

    /// <summary>How the lines are drawn (straight, curved or angled), as the reader last said.</summary>
    public string LineStyle => _lineStyle;

    public Playback Playback => _playback;

    public PlayerCard Card => _player;

    /// <summary>The flow's own name, or its id when it has none (before it is first drawn, the id).</summary>
    public string Name => _folder is not null && _folder.Model.Flows.TryGetValue(_flowId, out var flow) && !string.IsNullOrEmpty(flow.Name) ? flow.Name : _flowId;

    /// <summary>The stop the flow is at.</summary>
    public int StopNow => _folder is not null && StopsNow() is { } stops && _playback.Head is { } head ? Math.Max(0, Math.Min(head.Step, stops.Count - 1)) : 0;

    public int StopCount => StopsNow()?.Count ?? 0;

    private (int Index, int Count)? PlayWhere() => StopsNow() is { } stops ? (StopNow, stops.Count) : null;

    private IReadOnlyList<Stop>? StopsNow()
    {
        if (_folder is null || !_folder.Model.Flows.TryGetValue(_flowId, out var flow)) return null;
        if (_stops is not { } cached || !ReferenceEquals(cached.Flow, flow)) _stops = cached = (flow, Structure.Stops(flow));
        return cached.Stops;
    }

    // ---- showing ------------------------------------------------------------------------------------------------

    /// <summary>
    /// Starts the flow at a stop (the one a playing flow was at when the comparison opened; 0 otherwise). Autoplay never carries over: a comparison opens still.
    /// </summary>
    public void Start(int stop)
    {
        _playback.StopAuto();
        _playback.Head = new Playhead(_flowId, Math.Max(0, stop), []);
    }

    /// <summary>Takes the folder as it is now, with the shape or line the shared Details panel shows outlined when it is this flow's, and draws.</summary>
    public void Show(Folder folder, string lineStyle, ReaderView.Side? selection)
    {
        _folder = folder;
        _lineStyle = lineStyle;
        _selection = selection;
        Draw();
    }

    /// <summary>Everything the flow shows: its canvas, its card and the step's motion. A step, a replay and a reload all come here.</summary>
    public void Draw()
    {
        if (!Drawing || _folder is null || StopsNow() is not { } stops || !_folder.Model.Flows.TryGetValue(_flowId, out var flow)) return;
        var model = _folder.Model;
        var view = flow.View ?? Names.Root;
        var index = StopNow;
        Drew?.Invoke();

        var shown = DrawScene();
        if (AutoFit && !_fitted)
        {
            _fitted = true;
            _canvas.Fit(0, true, 0, 0, refit: false); // once, when the pane first has a size; after that the reader's zoom stays through a resize
        }
        var (card, marks) = FlowStage.CardAt(model, flow, _flowId, stops, index, shown, _playback.Auto, null, _canvas.StatesShown.Values.ToList(), Changes?.Steps);
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

    /// <summary>What the canvas shows for the flow at its stop, without showing it: Swap plans its move between two of these.</summary>
    public FlowFrame? Frame()
    {
        if (_folder is null || StopsNow() is not { } stops || !_folder.Model.Flows.TryGetValue(_flowId, out var flow)) return null;
        var model = _folder.Model;
        var view = flow.View ?? Names.Root;
        var shown = FlowStage.PlayingAt(model, view, flow, stops, StopNow);
        var box = _selection is ReaderView.Side.Box b ? b.Id : null;
        // A line is the same two shapes joined in this view only: another pane on another view is not outlined for it.
        var line = _selection is ReaderView.Side.Line l && l.View == view ? SceneBuilder.LineId(l.From, l.To) : null;
        var scene = SceneBuilder.Build(model, view, shown, _folder.Problems, new Focus(box, line, _hover));
        return new FlowFrame(scene, shown, box is null ? [] : [box]);
    }

    /// <summary>The canvas alone: what pointing at a line changes.</summary>
    public Playing? DrawScene()
    {
        if (!Drawing || _folder is null || Frame() is not { } frame || !_folder.Model.Flows.TryGetValue(_flowId, out var flow)) return null;
        var stops = StopsNow()!;
        _canvas.SetScene(frame.Scene, _lineStyle, frame.Selected);
        _canvas.ShowChanges(Changes);
        _canvas.ShowStates(States.Marks(_folder.Model, States.At(flow, stops, StopNow)));
        return frame.Shown;
    }

    /// <summary>The line is pointed at (null: no longer).</summary>
    public void Hover(string? edge)
    {
        if (_hover == edge) return;
        _hover = edge;
        DrawScene();
    }

    /// <summary>The line with this id on the canvas, as the side the Details panel shows it with: the two shapes it joins and the view this flow draws them in.</summary>
    public ReaderView.Side? LineSide(string edgeId)
    {
        if (_canvas.Scene?.Edges.FirstOrDefault(e => e.Id == edgeId) is not { } edge || _folder?.Model.Flows.TryGetValue(_flowId, out var flow) != true) return null;
        return new ReaderView.Side.Line(edge.From, edge.To, flow!.View ?? Names.Root);
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
}
