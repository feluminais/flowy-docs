using Avalonia.Controls;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The Performance panel: which load-test run and where along it, the ramp (Play, for a run over time), and the load drawn on the canvas (traffic on the lines,
/// strain on the shapes, and for a run over time the states its events leave). It is a tab of the navigator on the left, with Explorer, Flows and Failures, and Details stays free on the right. A port of what App.tsx does for the Performance tab, with the same rules: it is
/// there only where the folder has a run (or a run file to complain about) and not while editing; a flow that was playing waits behind it; a click on
/// the canvas picks what its panel reads out.
/// </summary>
internal sealed partial class ReaderView
{
    private readonly PerfSession _perf;

    /// <summary>The tab is always there. With no run its panel says so and offers a starter; with only a broken run file it says what is wrong.</summary>
    private bool ShowPerf => _folder is not null;

    /// <summary>While editing the tab shows no numbers: they would sit on a model that is changing.</summary>
    private bool CanPerf => !Editing && ShowPerf;

    /// <summary>While editing the tab lists the runs to link, and draws none.</summary>
    private bool CanRuns => Editing && ShowPerf;

    private bool RunsOpen => _panels.Tab == PanelTab.Performance && CanRuns;

    private LoadRun? LoadTest => _perf.Run;

    private IReadOnlyDictionary<string, LoadRun> RunMap => RunDrawing.MapOf(_folder?.Runs);

    private bool PerfOpen => _panels.Tab == PanelTab.Performance && CanPerf; // with only a broken run file there is no load to show, but the panel can say what is wrong

    /// <summary>The panel on the right, which is Details.</summary>
    private bool RightOpen => DetailsOpen;

    private static bool Still => MotionSettings.Reduced;

    /// <summary>What the run on show is turned up on, when it has several sources; null for a run of one.</summary>
    private Dials? Several => _perf.Several;

    private void WirePerformance()
    {
        _perfPanel.RunPicked += id =>
        {
            if (_perf.PickRun(id)) Refresh();
        };
        _perfPanel.LevelPicked += _perf.StepLevel;
        _perfPanel.Slid += _perf.Slide;
        _perfPanel.EventPicked += _perf.JumpTo;
        _perfPanel.RampClicked += _perf.ToggleRamp;
        _perfPanel.MeasureChosen += _perf.ChooseMeasure;
        _perfPanel.DialSlid += _perf.SlideDial;
        _perfPanel.DialRamped += _perf.ToggleDialRamp;
        _perfPanel.PlacePicked += _perf.PlaceAll;
        _perfPanel.DialActivated += _perf.Activate; // pressing a slider makes it the dial the keys act on
        _perfPanel.Used += () => Focus(); // a control in the panel took the keyboard: give it back, so the keys work
        _nav.RunLinks.Used += () => Focus();
        _perfPanel.CreateClicked += () => _ = CopyStarterRunAsync();
    }

    /// <summary>Copies a starter run for the view on show, to fill in and save in flowy/perf/, and says so.</summary>
    private async Task CopyStarterRunAsync()
    {
        if (_folder is not { } folder) return;
        var text = PerfView.StarterRun(folder.Model, CurrentView());
        if (await CopyAsync(text)) ShowNotice("Copied a starter run for this view. Fill in your numbers and save it as flowy/perf/<name>.yaml.", 6);
        else ShowNotice("Couldn't copy: the clipboard wasn't available.", 6);
    }

    private void OpenPerf() => _panels.SetTab(PanelTab.Performance);

    /// <summary>The Performance tab gives way (a comparison opens): a ramp stops with it.</summary>
    private void LeavePerformance()
    {
        _panels.Leave(PanelTab.Performance);
        _perf.StopRamp();
    }

    private void ClosePerf() => _panels.CloseNav();

    private void TogglePerf()
    {
        if (PerfOpen) ClosePerf();
        else OpenPerf();
    }

    /// <summary>
    /// The states a run over time leaves at the position on show: the latest event at or before it, for each shape (see <see cref="Perf.RunStates"/>). Null while the
    /// panel is closed or when the run has no events, so a run that has none leaves the canvas as it was.
    /// </summary>
    private IReadOnlyDictionary<string, StateMark>? RunMarks(Model model) => PerfOpen ? RunDrawing.Marks(model, LoadTest, _perf.Pos) : null;

    /// <summary>
    /// Draws the load on the canvas and moves the panel to it, without building either again: what a step of a ramp, or a key, changes. With <paramref name="snap"/>
    /// (the slider of a run is being dragged) the shapes change state at once instead of easing.
    /// </summary>
    private void ApplyLoad(bool snap = false)
    {
        if (!PerfOpen || _folder is not { } folder || LoadTest is null)
        {
            _canvas.ShowLoad(null);
            return;
        }
        RunDrawing.Apply(_canvas, _perfPanel, _perf, folder, CurrentView(), snap);
    }

    private void ShowPerfPanel(Model model, string view)
    {
        var folder = _folder!;
        PerfSelection? selection = _side switch
        {
            Side.Box box => new PerfSelection(box.Id),
            Side.Line line => new PerfSelection(null, line.From, line.To),
            _ => null,
        };
        _perf.EnsurePlaces();
        // Compare is greyed out with its reason, never hidden: no second run, or editing. Linking a run is done while editing.
        var actions = new RunActions(CompareChoices.RunOff(RunMap, Editing));
        var runs = folder.Runs ?? new IdMap<LoadRun>();
        _perfPanel.Show(new PerfPanelModel(model, view, runs, folder.RunProblems ?? [], PerfView.ActiveRun(runs, _perf.RunId), _perf.Pos, _perf.Ramping, Still, selection, Several is null ? null : _perf.Places, _perf.Active,
            Actions: actions));
    }

    // What a test can look at.
    internal bool PerfOpenNow => PerfOpen;

    internal bool RunsOpenNow => RunsOpen;

    internal PerfPanel PerfPanelNow => _perfPanel;

    internal RunLinksPanel RunLinksNow => _nav.RunLinks;

    internal (string Run, double Pos, bool Ramping) PerfState => (PerfView.ActiveRun(_folder?.Runs ?? new IdMap<LoadRun>(), _perf.RunId), _perf.Pos, _perf.Ramping);

    /// <summary>Where each dial of a run with several sources stands, and which is active (empty for any other run).</summary>
    internal (IReadOnlyList<double> Places, int Active) PerfPlaces => (_perf.Places, _perf.Active);

    internal void TickRamp() => _perf.Frame();

    internal void FlushSlide() => _perf.FlushSlide();

    internal void PickRunById(string id)
    {
        if (_perf.PickRun(id)) Refresh();
    }

    /// <summary>Goes to a load or a time of the run on show (for a picture taken with <c>--at</c>), as a click on an event does.</summary>
    internal void GoToTime(double x)
    {
        if (LoadTest is { } run && Several is null) _perf.JumpTo(PerfView.PosAt(run, x));
    }

    /// <summary>Puts each dial of a run with several sources at a load, in dial order (for a picture taken with <c>--at 200,100</c>); a dial it names no load for stays.</summary>
    internal void GoToLoads(IReadOnlyList<double> loads)
    {
        _perf.GoToLoads(loads);
    }
}
