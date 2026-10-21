using System.Diagnostics;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// What a <see cref="PerfSession"/> asks of the screen it moves: the runs of the folder on show, drawing the load at the place it has moved to, putting a
/// slider's thumb back to its stop, the next animation frame, whether motion is reduced, and (for a test) a clock in milliseconds.
/// </summary>
internal sealed record PerfHooks(
    Func<IdMap<LoadRun>?> Runs,
    Action<bool> Draw,
    Action SnapSlider,
    Action<IReadOnlyList<double>, int> RestoreDials,
    Action<Action> NextFrame,
    Func<bool> Still,
    Func<double>? Now = null);

/// <summary>
/// Where along a load-test run the Performance panel stands, and the ramp that moves it by itself: which run, one place along its tested levels (or one for
/// each dial of a run with several sources), which dial the keys act on, and the rules for stepping, sliding, jumping and ramping. It holds no controls: what
/// it moves is drawn by whoever gave it its <see cref="PerfHooks"/>.
/// </summary>
internal sealed class PerfSession
{
    private static readonly long Origin = Stopwatch.GetTimestamp();

    private readonly PerfHooks _hooks;
    private readonly Func<double> _now;
    private double _posNow; // where the ramp has got to, which can be ahead of what the screen shows
    private List<double> _places = []; // for a run with several sources: where each of its dials stands, one place along each dial's tested loads
    private List<double> _placesNow = []; // and where the ramp has got to
    private double _rampStart;
    private double _rampLast;
    private double _rampShown;

    public PerfSession(PerfHooks hooks)
    {
        _hooks = hooks;
        _now = hooks.Now ?? (() => Stopwatch.GetElapsedTime(Origin).TotalMilliseconds);
    }

    public string RunId { get; private set; } = "";

    /// <summary>Where along the run's tested levels the screen is: a whole number is a tested level (a run over time can stand between them: on an event).</summary>
    public double Pos { get; private set; }

    public bool Ramping { get; private set; }

    /// <summary>The dial the keys and Ramp act on, and the chart and curves follow: the one that was moved last.</summary>
    public int Active { get; private set; }

    /// <summary>Where each dial of a run with several sources stands (empty for any other run).</summary>
    public IReadOnlyList<double> Places => _places;

    private IdMap<LoadRun>? Runs => _hooks.Runs();

    /// <summary>The run on show, or null when there is none.</summary>
    public LoadRun? Run => Runs is { } runs && PerfView.ActiveRun(runs, RunId) is { Length: > 0 } id ? runs[id] : null;

    /// <summary>What the run on show is turned up on, when it has several sources (added from separate runs, or tested together); null for a run of one.</summary>
    public Dials? Several => Run is not null && Runs is { } runs && Perf.DialsOf(runs, PerfView.ActiveRun(runs, RunId)) is { Mode: not Perf.ModeSingle } found ? found : null;

    /// <summary>Where the dial the keys act on stands: along its own loads for a run with several sources, along the levels for any other.</summary>
    public double ActivePos => Several is not null && Active < _places.Count ? _places[Active] : Pos;

    /// <summary>The top of the dial the keys act on.</summary>
    public double ActiveTop(LoadRun run) => Several is { } found && Active < found.Items.Count ? PerfView.DialTop(found.Items[Active]) : PerfView.Top(run);

    /// <summary>The panel opens on the load where things first struggle, or on the highest if nothing does.</summary>
    private static double StartPos(LoadRun run) => PerfView.ClampPos(run, Perf.FindKnee(run)?.Index ?? PerfView.Top(run));

    /// <summary>
    /// A run with several sources opens with every dial rising together to the first struggle, each along its own loads, or every dial at its top when nothing struggles.
    /// Anything else has no places: it has the one position, <see cref="Pos"/>.
    /// </summary>
    private void ResetPlaces()
    {
        Active = 0;
        if (Several is { } found && Runs is { } runs)
        {
            var opening = PerfView.OpeningPositions(found.Items, Perf.KneeOf(runs, PerfView.ActiveRun(runs, RunId)));
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
    public void EnsurePlaces()
    {
        if (Several is { } found && _places.Count != found.Items.Count) ResetPlaces();
    }

    /// <summary>The position held to the run's levels, for drawing.</summary>
    public void Clamp(LoadRun run) => Pos = PerfView.ClampPos(run, Pos);

    /// <summary>The panel opens: on the run that was on show (or the first), at the load where things first struggle.</summary>
    public void Open()
    {
        if (Runs is not { } runs) return;
        RunId = PerfView.ActiveRun(runs, RunId);
        if (Run is { } run)
        {
            if (Several is null) Pos = _posNow = StartPos(run);
            ResetPlaces();
        }
        Ramping = false;
    }

    /// <summary>Stops a ramp, wherever it has got to.</summary>
    public void StopRamp() => Ramping = false;

    /// <summary>Makes a run the one on show without moving anything: <see cref="Open"/> then starts on it.</summary>
    public void SetRun(string id) => RunId = id;

    /// <summary>Shows another run, at its first struggle. False when there is no such run.</summary>
    public bool PickRun(string id)
    {
        if (Runs is not { } runs || !runs.Contains(id)) return false;
        Ramping = false;
        RunId = id;
        if (Several is null) Pos = _posNow = StartPos(runs[id]);
        ResetPlaces();
        return true;
    }

    /// <summary>A dial's slider was pressed: it becomes the dial the keys act on.</summary>
    public void Activate(int dial)
    {
        if (Several is null || dial == Active) return;
        Active = dial;
        _hooks.Draw(false);
    }

    /// <summary>Moves along the tested levels: a level the arrow keys, Home, End or the slider picked. It stops a ramp.</summary>
    public void StepLevel(double to)
    {
        if (Run is not { } run) return;
        if (Several is not null)
        {
            StepDial(Active, to);
            return;
        }
        var level = PerfView.Snap(run, to);
        if (!Ramping && level == Pos && level == _posNow)
        {
            _hooks.SnapSlider(); // a drag that has not reached another level: nothing to draw again, but the thumb goes back to its stop
            return;
        }
        Ramping = false;
        Pos = _posNow = level;
        _hooks.Draw(false);
    }

    /// <summary>Moves a dial of a run with several sources to a tested load (the one the keys act on, or the one whose slider was moved), and makes it the active dial. It stops a ramp.</summary>
    public void StepDial(int dial, double to)
    {
        if (Several is not { } found || dial < 0 || dial >= found.Items.Count) return;
        EnsurePlaces();
        var places = PerfView.PlaceActive(found.Items, _places, dial, Perf.JsRound(PerfView.ClampDial(found.Items[dial], to)));
        if (!Ramping && dial == Active && places.SequenceEqual(_places) && places.SequenceEqual(_placesNow))
        {
            _hooks.RestoreDials(_places, Active); // a drag that has not reached another load: nothing to draw again, but the thumb goes back to its stop
            return;
        }
        Ramping = false;
        Active = dial;
        _places = [.. places];
        _placesNow = [.. places];
        _hooks.Draw(false);
    }

    /// <summary>Goes to a place with every dial at its position (Go there). It stops a ramp.</summary>
    public void PlaceAll(IReadOnlyList<double> places)
    {
        if (Several is not { } found) return;
        Ramping = false;
        _places = [.. found.Items.Select((d, i) => PerfView.ClampDial(d, i < places.Count ? places[i] : 0))];
        _placesNow = [.. _places];
        _hooks.Draw(false);
    }

    /// <summary>Puts each dial at a load, in dial order; a dial it names no load for stays.</summary>
    public void GoToLoads(IReadOnlyList<double> loads)
    {
        if (Several is not { } found) return;
        EnsurePlaces();
        Ramping = false;
        _places = [.. found.Items.Select((d, i) => i < loads.Count ? PerfView.PositionOf(d, loads[i]) : _places[i])];
        _placesNow = [.. _places];
        _hooks.Draw(false);
    }

    /// <summary>
    /// The slider moved. A load run's goes level to level. A run over time goes where it is put, so an event can be stood on, and the states of shapes follow at
    /// once instead of easing (a drag is many moves). It stops a ramp.
    /// </summary>
    public void Slide(double pos)
    {
        if (Run is not { } run) return;
        if (!run.IsTime)
        {
            StepLevel(pos);
            return;
        }
        Ramping = false;
        Pos = _posNow = PerfView.ClampPos(run, pos);
        _hooks.Draw(true);
    }

    /// <summary>Goes to a place along the run, not only a level: a click on an event. The states ease to it, as they do for a step.</summary>
    public void JumpTo(double pos)
    {
        if (Run is not { } run) return;
        Ramping = false;
        Pos = _posNow = PerfView.ClampPos(run, pos);
        _hooks.Draw(false);
    }

    /// <summary>Ramps the run, or stops the ramp that is running. Ramping is of the active dial for a run with several sources.</summary>
    public void ToggleRamp()
    {
        if (Run is not { } run || _hooks.Still()) return;
        if (Several is not null)
        {
            ToggleDialRamp(Active);
            return;
        }
        if (Ramping)
        {
            Pos = _posNow; // where it has got to, not where the screen last was
            Ramping = false;
            _hooks.Draw(false);
            return;
        }
        _posNow = PerfView.RampFrom(run, _posNow); // at the top, a ramp starts again from the bottom
        Pos = _posNow;
        StartRamp();
    }

    /// <summary>Ramps a dial of a run with several sources, or stops the ramp that is running on it. Pressing another dial's button moves the ramp there.</summary>
    public void ToggleDialRamp(int dial)
    {
        if (Several is not { } found || _hooks.Still() || dial < 0 || dial >= found.Items.Count) return;
        EnsurePlaces();
        if (Ramping && dial == Active)
        {
            _places = [.. _placesNow]; // where it has got to, not where the screen last was
            Ramping = false;
            _hooks.Draw(false);
            return;
        }
        Active = dial; // a ramp is of the dial it was started on
        _placesNow = PerfView.RampFromActive(found.Items, _placesNow, dial); // at the top, a ramp starts again from the bottom
        _places = [.. _placesNow];
        StartRamp();
    }

    private void StartRamp()
    {
        Ramping = true;
        _rampStart = _now();
        _rampLast = _rampShown = 0;
        _hooks.Draw(false);
        _hooks.NextFrame(Frame);
    }

    /// <summary>
    /// A frame of the ramp. The position moves on every frame, but the screen is given it only every <see cref="PerfView.RampStepMs"/>: a view of a
    /// hundred shapes is slow to draw again, and the particles move on their own frames meanwhile.
    /// </summary>
    public void Frame()
    {
        if (!Ramping || Run is not { } run) return;
        var now = _now() - _rampStart;
        var step = Math.Min(100, now - _rampLast); // a window that was asleep doesn't jump
        _rampLast = now;
        if (Several is { } found)
        {
            _placesNow = PerfView.RampActive(found.Items, _placesNow, Active, step);
            var finished = _placesNow[Active] >= PerfView.DialTop(found.Items[Active]);
            if (finished || now - _rampShown >= PerfView.RampStepMs)
            {
                _rampShown = now;
                _places = [.. _placesNow];
                if (finished) Ramping = false;
                _hooks.Draw(false);
            }
            if (!finished) _hooks.NextFrame(Frame);
            return;
        }
        _posNow = PerfView.RampPos(run, _posNow, step);
        var done = _posNow >= PerfView.Top(run);
        if (done || now - _rampShown >= PerfView.RampStepMs)
        {
            _rampShown = now;
            Pos = _posNow;
            if (done) Ramping = false;
            _hooks.Draw(false);
        }
        if (!done) _hooks.NextFrame(Frame);
    }
}
