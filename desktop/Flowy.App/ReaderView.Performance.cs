using System.Diagnostics;
using Avalonia.Controls;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The Performance panel: which load-test run and where along it, the ramp (Play, for a run over time), and the load drawn on the canvas (traffic on the lines,
/// strain on the shapes, and for a run over time the states its events leave). It takes Details' place on the right while it is open. A port of what App.tsx does for the Performance tab, with the same rules: it is
/// there only where the folder has a run (or a run file to complain about) and not while editing; a flow that was playing waits behind it; a click on
/// the canvas picks what its panel reads out.
/// </summary>
internal sealed partial class ReaderView
{
    private bool _perf; // the Performance panel was opened (by its rail button or T)
    private string _runId = "";
    private double _pos; // where along the run's tested levels the screen is: a whole number is a tested level (a run over time can stand between them: on an event)
    private double _posNow; // where the ramp has got to, which can be ahead of what the screen shows
    private List<double> _places = []; // for a run with several sources: where each of its dials stands, one place along each dial's tested loads
    private List<double> _placesNow = []; // and where the ramp has got to
    private int _active; // the dial the keys and Ramp act on, and the chart and curves follow: the one that was moved last
    private bool _ramping;
    private Stopwatch? _rampClock;
    private double _rampLast;
    private double _rampShown;

    /// <summary>The tab is there whenever there is a run, or a run file to complain about.</summary>
    private bool ShowPerf => _folder is { } f && ((f.Runs?.Count ?? 0) > 0 || (f.RunProblems?.Count ?? 0) > 0);

    /// <summary>While editing the tab is greyed out: the numbers would sit on a model that is changing.</summary>
    private bool CanPerf => !Editing && ShowPerf;

    private LoadRun? LoadTest => _folder?.Runs is { } runs && PerfView.ActiveRun(runs, _runId) is { Length: > 0 } id ? runs[id] : null;

    private bool PerfOpen => _perf && CanPerf; // with only a broken run file there is no load to show, but the panel can say what is wrong

    /// <summary>A panel on the right, whichever it is.</summary>
    private bool RightOpen => DetailsOpen || PerfOpen;

    private static bool Still => MotionSettings.Reduced;

    /// <summary>What the run on show is turned up on, when it has several sources (added from separate runs, or tested together); null for a run of one.</summary>
    private Dials? Several => LoadTest is not null && _folder?.Runs is { } runs && Perf.DialsOf(runs, PerfView.ActiveRun(runs, _runId)) is { Mode: not Perf.ModeSingle } found ? found : null;

    /// <summary>Where the dial the keys act on stands: along its own loads for a run with several sources, along the levels for any other.</summary>
    private double ActivePos => Several is not null && _active < _places.Count ? _places[_active] : _pos;

    /// <summary>The top of the dial the keys act on.</summary>
    private double ActiveTop(LoadRun run) => Several is { } found && _active < found.Items.Count ? PerfView.DialTop(found.Items[_active]) : PerfView.Top(run);

    /// <summary>
    /// A run with several sources opens with every dial rising together to the first struggle, each along its own loads, or every dial at its top when nothing struggles.
    /// Anything else has no places: it has the one position, <c>_pos</c>.
    /// </summary>
    private void ResetPlaces()
    {
        _active = 0;
        if (Several is { } found && _folder?.Runs is { } runs)
        {
            var opening = PerfView.OpeningPositions(found.Items, Perf.KneeOf(runs, PerfView.ActiveRun(runs, _runId)));
            _places = [.. opening];
            _placesNow = [.. opening];
        }
        else
        {
            _places = [];
            _placesNow = [];
        }
    }

    /// <summary>A live reload can change what a run is turned up on: places that no longer fit it start again.</summary>
    private void EnsurePlaces()
    {
        if (Several is { } found && _places.Count != found.Items.Count) ResetPlaces();
    }

    /// <summary>The panel opens on the load where things first struggle, or on the highest if nothing does.</summary>
    private static double StartPos(LoadRun run) => PerfView.ClampPos(run, Perf.FindKnee(run)?.Index ?? PerfView.Top(run));

    private void WirePerformance()
    {
        _perfPanel.RunPicked += PickRun;
        _perfPanel.LevelPicked += StepLevel;
        _perfPanel.Slid += Slide;
        _perfPanel.EventPicked += JumpTo;
        _perfPanel.RampClicked += ToggleRamp;
        _perfPanel.DialSlid += StepDial;
        _perfPanel.DialRamped += ToggleDialRamp;
        _perfPanel.PlacePicked += PlaceAll;
        _perfPanel.DialActivated += dial =>
        {
            if (Several is null || dial == _active) return;
            _active = dial; // pressing a slider makes it the dial the keys act on
            ApplyLoad();
        };
        _perfPanel.Used += () => Focus(); // a control in the panel took the keyboard: give it back, so the keys work
    }

    private void OpenPerf()
    {
        if (!CanPerf || _folder?.Runs is not { } runs) return;
        _runId = PerfView.ActiveRun(runs, _runId);
        if (LoadTest is { } run)
        {
            if (Several is null) _pos = _posNow = StartPos(run);
            ResetPlaces();
        }
        _details = false; // so that closing it again doesn't leave Details open in its place
        _perf = true;
        _ramping = false;
        Refresh();
    }

    private void ClosePerf()
    {
        _perf = false;
        _ramping = false;
        _side = null; // what was picked for its readings is no reason for Details to open in its place
        Refresh();
        Focus();
    }

    private void TogglePerf()
    {
        if (PerfOpen) ClosePerf();
        else OpenPerf();
    }

    private void PickRun(string id)
    {
        if (_folder?.Runs is not { } runs || !runs.Contains(id)) return;
        _ramping = false;
        _runId = id;
        if (Several is null) _pos = _posNow = StartPos(runs[id]);
        ResetPlaces();
        Refresh();
    }

    /// <summary>Moves along the tested levels: a level the arrow keys, Home, End or the slider picked. It stops a ramp.</summary>
    private void StepLevel(double to)
    {
        if (LoadTest is not { } run) return;
        if (Several is not null)
        {
            StepDial(_active, to);
            return;
        }
        var level = PerfView.Snap(run, to);
        if (!_ramping && level == _pos && level == _posNow)
        {
            _perfPanel.SnapSlider(); // a drag that has not reached another level: nothing to draw again, but the thumb goes back to its stop
            return;
        }
        _ramping = false;
        _pos = _posNow = level;
        ApplyLoad();
    }

    /// <summary>Moves a dial of a run with several sources to a tested load (the one the keys act on, or the one whose slider was moved), and makes it the active dial. It stops a ramp.</summary>
    private void StepDial(int dial, double to)
    {
        if (Several is not { } found || dial < 0 || dial >= found.Items.Count) return;
        EnsurePlaces();
        var places = PerfView.PlaceActive(found.Items, _places, dial, Perf.JsRound(PerfView.ClampDial(found.Items[dial], to)));
        if (!_ramping && dial == _active && places.SequenceEqual(_places) && places.SequenceEqual(_placesNow))
        {
            _perfPanel.SetPlaces(_places, _active, false); // a drag that has not reached another load: nothing to draw again, but the thumb goes back to its stop
            return;
        }
        _ramping = false;
        _active = dial;
        _places = [.. places];
        _placesNow = [.. places];
        ApplyLoad();
    }

    /// <summary>Goes to a place with every dial at its position (Go there). It stops a ramp.</summary>
    private void PlaceAll(IReadOnlyList<double> places)
    {
        if (Several is not { } found) return;
        _ramping = false;
        _places = [.. found.Items.Select((d, i) => PerfView.ClampDial(d, i < places.Count ? places[i] : 0))];
        _placesNow = [.. _places];
        ApplyLoad();
    }

    /// <summary>Ramps a dial of a run with several sources, or stops the ramp that is running on it. Pressing another dial's button moves the ramp there.</summary>
    private void ToggleDialRamp(int dial)
    {
        if (Several is not { } found || Still || dial < 0 || dial >= found.Items.Count) return;
        EnsurePlaces();
        if (_ramping && dial == _active)
        {
            _places = [.. _placesNow]; // where it has got to, not where the screen last was
            _ramping = false;
            ApplyLoad();
            return;
        }
        _active = dial; // a ramp is of the dial it was started on
        _placesNow = PerfView.RampFromActive(found.Items, _placesNow, dial); // at the top, a ramp starts again from the bottom
        _places = [.. _placesNow];
        _ramping = true;
        _rampClock = Stopwatch.StartNew();
        _rampLast = _rampShown = 0;
        ApplyLoad();
        RequestRampFrame();
    }

    /// <summary>
    /// The slider moved. A load run's goes level to level. A run over time goes where it is put, so an event can be stood on, and the states of shapes follow at
    /// once instead of easing (a drag is many moves). It stops a ramp.
    /// </summary>
    private void Slide(double pos)
    {
        if (LoadTest is not { } run) return;
        if (!run.IsTime)
        {
            StepLevel(pos);
            return;
        }
        _ramping = false;
        _pos = _posNow = PerfView.ClampPos(run, pos);
        ApplyLoad(snap: true);
    }

    /// <summary>Goes to a place along the run, not only a level: a click on an event. The states ease to it, as they do for a step.</summary>
    private void JumpTo(double pos)
    {
        if (LoadTest is not { } run) return;
        _ramping = false;
        _pos = _posNow = PerfView.ClampPos(run, pos);
        ApplyLoad();
    }

    private void ToggleRamp()
    {
        if (LoadTest is not { } run || Still) return;
        if (Several is not null)
        {
            ToggleDialRamp(_active);
            return;
        }
        if (_ramping)
        {
            _pos = _posNow; // where it has got to, not where the screen last was
            _ramping = false;
            ApplyLoad();
            return;
        }
        _posNow = PerfView.RampFrom(run, _posNow); // at the top, a ramp starts again from the bottom
        _pos = _posNow;
        _ramping = true;
        _rampClock = Stopwatch.StartNew();
        _rampLast = _rampShown = 0;
        ApplyLoad();
        RequestRampFrame();
    }

    private void RequestRampFrame() => TopLevel.GetTopLevel(this)?.RequestAnimationFrame(_ => RampFrame());

    /// <summary>
    /// A frame of the ramp. The position moves on every frame, but the screen is given it only every <see cref="PerfView.RampStepMs"/>: a view of a
    /// hundred shapes is slow to draw again, and the particles move on their own frames meanwhile.
    /// </summary>
    private void RampFrame()
    {
        if (!_ramping || LoadTest is not { } run || _rampClock is null) return;
        var now = _rampClock.Elapsed.TotalMilliseconds;
        var step = Math.Min(100, now - _rampLast); // a window that was asleep doesn't jump
        _rampLast = now;
        if (Several is { } found)
        {
            _placesNow = PerfView.RampActive(found.Items, _placesNow, _active, step);
            var finished = _placesNow[_active] >= PerfView.DialTop(found.Items[_active]);
            if (finished || now - _rampShown >= PerfView.RampStepMs)
            {
                _rampShown = now;
                _places = [.. _placesNow];
                if (finished) _ramping = false;
                ApplyLoad();
            }
            if (!finished) RequestRampFrame();
            return;
        }
        _posNow = PerfView.RampPos(run, _posNow, step);
        var done = _posNow >= PerfView.Top(run);
        if (done || now - _rampShown >= PerfView.RampStepMs)
        {
            _rampShown = now;
            _pos = _posNow;
            if (done) _ramping = false;
            ApplyLoad();
        }
        if (!done) RequestRampFrame();
    }

    /// <summary>
    /// The states a run over time leaves at the position on show: the latest event at or before it, for each shape (see <see cref="Perf.RunStates"/>). Null while the
    /// panel is closed or when the run has no events, so a run that has none leaves the canvas as it was.
    /// </summary>
    private IReadOnlyDictionary<string, StateMark>? RunMarks(Model model)
    {
        if (!PerfOpen || LoadTest is not { IsTime: true, Events.Count: > 0 } run) return null;
        return States.Marks(model, Perf.RunStates(run, PerfView.LoadAt(run, PerfView.ClampPos(run, _pos))));
    }

    /// <summary>
    /// Draws the load on the canvas and moves the panel to it, without building either again: what a step of a ramp, or a key, changes. With <paramref name="snap"/>
    /// (the slider of a run is being dragged) the shapes change state at once instead of easing.
    /// </summary>
    private void ApplyLoad(bool snap = false)
    {
        if (!PerfOpen || _folder is not { } folder || LoadTest is not { } run)
        {
            _canvas.ShowLoad(null);
            return;
        }
        if (Several is { } several)
        {
            // A run with several sources: the level at where every dial stands, worked out once, for the canvas and the panel's readouts both.
            EnsurePlaces();
            var runs = folder.Runs!;
            var setting = PerfView.SettingOf(several.Items, [.. several.Items.Select((d, i) => PerfView.ClampDial(d, _places[i]))]);
            var made = Perf.FrameOf(folder.Model, runs, PerfView.ActiveRun(runs, _runId), setting, CurrentView());
            _canvas.ShowLoad(made.Traffic);
            _canvas.ShowStates(RunMarks(folder.Model), snap);
            _perfPanel.SetPlaces(_places, _active, _ramping, made, _canvas.StatesShown);
            return;
        }
        _pos = PerfView.ClampPos(run, _pos);
        var frame = Perf.FrameAt(folder.Model, run, PerfView.LoadAt(run, _pos), CurrentView()); // worked out once, for the canvas and the panel's readouts both
        _canvas.ShowLoad(frame.Traffic);
        _canvas.ShowStates(RunMarks(folder.Model), snap);
        _perfPanel.SetPos(_pos, _ramping, frame, _canvas.StatesShown); // the key lists the states that are on the canvas now
    }

    private void ShowPerfPanel(Model model, string view)
    {
        var folder = _folder!;
        PerfSelection? selection = _side switch
        {
            { Kind: SideKind.Object, Id: { } id } => new PerfSelection(id),
            { Kind: SideKind.Line, From: { } from, To: { } to } => new PerfSelection(null, from, to),
            _ => null,
        };
        EnsurePlaces();
        _perfPanel.Show(model, view, folder.Runs!, folder.RunProblems ?? [], PerfView.ActiveRun(folder.Runs!, _runId), _pos, _ramping, Still, selection, Several is null ? null : _places, _active);
        _panel.ShowControl(_perfPanel, "perf");
    }

    // What a test can look at.
    internal bool PerfOpenNow => PerfOpen;

    internal PerfPanel PerfPanelNow => _perfPanel;

    internal (string Run, double Pos, bool Ramping) PerfState => (PerfView.ActiveRun(_folder?.Runs ?? new IdMap<LoadRun>(), _runId), _pos, _ramping);

    /// <summary>Where each dial of a run with several sources stands, and which is active (empty for any other run).</summary>
    internal (IReadOnlyList<double> Places, int Active) PerfPlaces => (_places, _active);

    internal void TickRamp() => RampFrame();

    internal void PickRunById(string id) => PickRun(id);

    /// <summary>Goes to a load or a time of the run on show (for a picture taken with <c>--at</c>), as a click on an event does.</summary>
    internal void GoToTime(double x)
    {
        if (LoadTest is { } run && Several is null) JumpTo(PerfView.PosAt(run, x));
    }

    /// <summary>Puts each dial of a run with several sources at a load, in dial order (for a picture taken with <c>--at 200,100</c>); a dial it names no load for stays.</summary>
    internal void GoToLoads(IReadOnlyList<double> loads)
    {
        if (Several is not { } found) return;
        EnsurePlaces();
        _ramping = false;
        _places = [.. found.Items.Select((d, i) => i < loads.Count ? PerfView.PositionOf(d, loads[i]) : _places[i])];
        _placesNow = [.. _places];
        ApplyLoad();
    }
}
