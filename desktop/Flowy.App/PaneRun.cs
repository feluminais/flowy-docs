using Avalonia.Controls;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>What the Performance keys reach in a comparison of runs: the pane that has the focus, or in Swap the run on show. The same steps the Performance panel's slider and buttons take.</summary>
internal interface IRunKeys
{
    /// <summary>One tested level on (1) or back (-1) along the dial the keys act on.</summary>
    void Step(int by);

    /// <summary>The first or the last tested level (<c>first</c> or <c>last</c>).</summary>
    void End(string which);

    /// <summary>Ramps the load or plays the time, or pauses.</summary>
    void Ramp();

    /// <summary>Fits the whole view in the canvas, as F does.</summary>
    void Fit();
}

/// <summary>
/// One run of a comparison: its own place along it (a <see cref="PerfSession"/>: the position of each dial, the dial the keys act on, the ramp), its own Performance panel, and what it
/// draws on the canvas it is given. A pane of Side by side owns one with a canvas of its own; Swap gives both runs the one canvas, and only the run on show draws on it
/// (<see cref="Drawing"/>), so each keeps its place and its ramp while the other is on show. It is the part of the reader's single canvas that a run needs: nothing is dragged or edited.
/// </summary>
internal sealed class PaneRun
{
    private CanvasView? _canvas;
    private Folder? _folder;
    private string _lineStyle = "straight";
    private string _view = Names.Root;
    private ReaderView.Side? _selection;
    private string? _hover;
    private bool _opened;
    private bool _fitted;

    /// <param name="host">The control the ramp's frames wait on (its window's animation frames).</param>
    /// <param name="runId">The run, by its file name.</param>
    public PaneRun(Control host, string runId)
    {
        RunId = runId;
        Session = new PerfSession(new PerfHooks(() => _folder?.Runs, snap => Apply(snap), () => Panel.SnapSlider(), (places, active) => Panel.SetPlaces(places, active, false),
            frame => TopLevel.GetTopLevel(host)?.RequestAnimationFrame(_ => frame()), () => MotionSettings.Reduced));
        Panel.LevelPicked += Session.StepLevel;
        Panel.Slid += Session.Slide;
        Panel.EventPicked += Session.JumpTo;
        Panel.RampClicked += Session.ToggleRamp;
        Panel.DialSlid += Session.SlideDial;
        Panel.DialRamped += Session.ToggleDialRamp;
        Panel.PlacePicked += Session.PlaceAll;
        Panel.DialActivated += Session.Activate;
        Panel.Used += () => Used?.Invoke();
    }

    /// <summary>A control of the run's panel took the keyboard: the reader gives it back, so the keys work.</summary>
    public event Action? Used;

    public string RunId { get; }

    /// <summary>
    /// Gives the run the canvas it draws on: a pane's own, or the one canvas Swap shares between two runs. The run keeps its place along itself and its ramp when it moves from one to the other;
    /// the next canvas is fitted once, when it is first drawn.
    /// </summary>
    public void Bind(CanvasView canvas)
    {
        if (ReferenceEquals(_canvas, canvas)) return;
        _canvas = canvas;
        _fitted = false;
    }

    public PerfSession Session { get; }

    public PerfPanel Panel { get; } = new();

    /// <summary>
    /// Whether the run draws on its canvas at all. Off, every redraw does nothing, so a run that is off show (Swap) leaves the canvas to the one that is on. A pane fits its view once,
    /// when it is first drawn; the stage of a swap fits the camera itself.
    /// </summary>
    public bool Drawing { get; set; } = true;

    /// <summary>Whether the run fits its level on the canvas itself, once when it is first drawn. The canvas of Swap is shared, so the stage fits it, and a swap keeps the reader's zoom.</summary>
    public bool AutoFit { get; set; } = true;

    /// <summary>The run's own name, or its id when it has none.</summary>
    public string Name => _folder?.Runs is { } runs && runs.TryGetValue(RunId, out var run) && !string.IsNullOrEmpty(run.Name) ? run.Name : RunId;

    public bool Has => _folder?.Runs?.Contains(RunId) == true;

    /// <summary>Takes the folder as it is now, the level the comparison draws, and the shape or line the shared Details panel shows, and draws.</summary>
    public void Show(Folder folder, string lineStyle, string view, ReaderView.Side? selection)
    {
        _folder = folder;
        _lineStyle = lineStyle;
        if (_view != view) _fitted = false; // another level: it is fitted afresh, as the single canvas fits a new view
        _view = view;
        _selection = selection;
        if (!_opened && folder.Runs is { } runs && runs.Contains(RunId))
        {
            // The panel opens on the run, at the load where things first struggle.
            _opened = true;
            Session.SetRun(RunId);
            Session.Open();
        }
        Draw();
    }

    /// <summary>The canvas, the panel and the load: everything the run shows. A reload, a pick and a new level come here.</summary>
    public void Draw()
    {
        if (!Drawing || _canvas is null || _folder is not { Runs: { } runs } folder || !runs.Contains(RunId) || Session.Run is null) return;
        DrawScene();
        if (AutoFit && !_fitted)
        {
            _fitted = true;
            _canvas.Fit(0, false, 0, 0, refit: false); // once, when the pane first has a size; after that the reader's zoom stays through a resize
        }
        Session.EnsurePlaces();
        PerfSelection? selection = _selection switch
        {
            ReaderView.Side.Box box => new PerfSelection(box.Id),
            ReaderView.Side.Line line => new PerfSelection(null, line.From, line.To),
            _ => null,
        };
        Panel.Show(new PerfPanelModel(folder.Model, _view, runs, folder.RunProblems ?? [], PerfView.ActiveRun(runs, Session.RunId), Session.Pos, Session.Ramping, MotionSettings.Reduced, selection,
            Session.Several is null ? null : Session.Places, Session.Active, Pane: true));
        Apply(false);
    }

    /// <summary>The shapes and lines of the level, with the shape or line the panel shows outlined, and nothing else (pointing at a line changes this alone).</summary>
    private void DrawScene()
    {
        if (_canvas is null || _folder is not { } folder) return;
        var box = _selection is ReaderView.Side.Box b ? b.Id : null;
        var line = _selection is ReaderView.Side.Line l ? SceneBuilder.LineId(l.From, l.To) : null;
        _canvas.SetScene(SceneBuilder.Build(folder.Model, _view, null, folder.Problems, new Focus(box, line, _hover)), _lineStyle, box is null ? [] : [box]);
    }

    /// <summary>The load at the run's place on the canvas, and the panel moved to it, without building either again: what a ramp's step or a key changes.</summary>
    private void Apply(bool snap)
    {
        if (!Drawing || _canvas is null || _folder is null || Session.Run is null) return;
        RunDrawing.Apply(_canvas, Panel, Session, _folder, _view, snap);
    }

    /// <summary>The line is pointed at (null: no longer).</summary>
    public void Hover(string? edge)
    {
        if (_hover == edge) return;
        _hover = edge;
        if (Drawing) DrawScene();
    }

    /// <summary>The line with this id on the canvas, as the side the Details panel shows it with: the two shapes it joins and the level the comparison draws them in.</summary>
    public ReaderView.Side? LineSide(string edgeId) =>
        _canvas?.Scene?.Edges.FirstOrDefault(e => e.Id == edgeId) is { } edge ? new ReaderView.Side.Line(edge.From, edge.To, _view) : null;

    // ---- what the keys do ---------------------------------------------------------------------------------------

    public void Step(int by) => Session.StepLevel(PerfView.StepFrom(Session.ActivePos, by));

    public void End(string which)
    {
        if (which == "first") Session.StepLevel(0);
        else if (Session.Run is { } run) Session.StepLevel(Session.ActiveTop(run));
    }

    public void Ramp() => Session.ToggleRamp();
}
