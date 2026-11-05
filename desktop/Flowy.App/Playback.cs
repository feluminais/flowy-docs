using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>The flow playing, the stop it is at (see <see cref="Structure.Stops"/>), and the places it was opened from.</summary>
internal sealed record Playhead(string Flow, int Step, IReadOnlyList<FlowPlace> Trail);

/// <summary>
/// What a <see cref="Playback"/> asks of the screen: where the flow on show stands (its stop and how many it has; null when none plays), whether the step's
/// motion is still going, drawing again, a wait in player time (disposing what it returns cancels it), and the player's clock, which Pause stops.
/// </summary>
internal sealed record PlaybackHooks(
    Func<(int Index, int Count)?> Where,
    Func<bool> StepMoving,
    Action Redraw,
    Func<double, Action, IDisposable> Wait,
    PlayerClock Clock);

/// <summary>
/// The playhead, Play and Pause, and Autoplay: the flow and stop playing, the step (and replay) whose motion has started, the step whose motion has finished, and the wait that
/// takes Autoplay on to the next stop. Play and Pause are the player's clock and nothing else: Pause stops it where it is, so a step's motion and the waits stand still, and it
/// stays paused through Back and Next. Autoplay only takes away the stop between steps. It holds no controls; the reader draws, and tells it when a step's motion ends.
/// </summary>
internal sealed class Playback
{
    private readonly PlaybackHooks _hooks;
    private string _stepKey = ""; // the step (and replay) now showing; empty when no flow plays
    private string _settledKey = ""; // the step that is over: its motion has finished, or Autoplay has given a step that doesn't move its moment
    private string _playedKey = ""; // the step whose motion has finished
    private int _replays;
    private string? _flow; // the flow the clock last began a step of

    /// <summary>How far a nudge moves a paused step, in ms of player time.</summary>
    private const double NudgeMs = 100;
    private IDisposable? _wait; // what Autoplay is waiting for, run on animation frames like everything that moves here
    private IDisposable? _redraw; // the end of the motion a step was dragged back into

    public Playback(PlaybackHooks hooks) => _hooks = hooks;

    /// <summary>The flow playing and its stop, or null.</summary>
    public Playhead? Head { get; set; }

    /// <summary>Autoplay is on: while the clock runs, each finished step is followed by the next. It stays on through Back, Next, Pause and another flow.</summary>
    public bool Auto { get; private set; }

    public bool Paused => _hooks.Clock.Paused;

    private bool OnLast => _hooks.Where() is { } at && at.Index == at.Count - 1;

    /// <summary>Nothing is left to run: a step that has played out and rests on its end, or with Autoplay the last step.</summary>
    private bool AtEnd => _settledKey == _stepKey && _hooks.Clock.Elapsed >= _hooks.Clock.Length && (Auto ? OnLast : _playedKey == _stepKey);

    /// <summary>Whether the button says Pause: the clock runs and there is something for it to run.</summary>
    public bool ShowsPause => !Paused && !AtEnd;

    /// <summary>Autoplay on or off. Turned on while the clock runs, a step that is over goes on to the next; paused, nothing moves until Play.</summary>
    public void ToggleAuto()
    {
        Auto = !Auto;
        _hooks.Redraw();
        ArmAuto();
    }

    /// <summary>Autoplay off, for a flow of a comparison that goes out of sight. The caller draws.</summary>
    public void StopAuto()
    {
        Auto = false;
        _wait?.Dispose();
        _wait = null;
    }

    /// <summary>
    /// A redraw shows this flow at this stop (or none): true when that is a step (or replay) not started yet, so its motion starts once for each, and a hover, a
    /// theme or a change on disk that redraws does not start it again. Returns the step's key, which <see cref="Settled"/> takes.
    /// </summary>
    public bool Begin(string? flowId, int index, out string key)
    {
        key = flowId is null ? "" : KeyOf(flowId, index);
        if (key == _stepKey) return false;
        _stepKey = key;
        // Another flow, or none: the player runs again, so a flow is never opened frozen.
        if (flowId != _flow) _hooks.Clock.Play();
        _flow = flowId;
        _hooks.Clock.Begin(key);
        return true;
    }

    /// <summary>The motion of a step has finished (or there was none to wait for): Autoplay may go on. A step that has since been left is ignored.</summary>
    public void Settled(string key)
    {
        if (key != _stepKey) return;
        _settledKey = key;
        _playedKey = key;
        if (!Auto || OnLast) _hooks.Redraw(); // nothing comes after it: the button says Play now
        ArmAuto();
    }

    /// <summary>
    /// Autoplay: once the step now showing has finished moving (or has had a moment, if it doesn't move), rest a moment and go on to the
    /// next, and wait on the last. Called whenever something it depends on changes.
    /// </summary>
    public void ArmAuto()
    {
        _wait?.Dispose();
        _wait = null;
        if (!Auto || _stepKey == "" || _hooks.Where() is null) return;
        var key = _stepKey;
        if (_settledKey == key)
        {
            if (OnLast) return;
            // A stop dragged (or nudged) back into its motion first plays the rest of it.
            After(MotionMath.Gap + Math.Max(0, _hooks.Clock.Length - _hooks.Clock.Elapsed), () =>
            {
                // The flow may have been reloaded while this waited: ask which one is playing now, not the one it was armed on.
                if (key != _stepKey || !Auto || _hooks.Where() is not { } now || now.Index >= now.Count - 1) return;
                Head = Head! with { Step = now.Index + 1 };
                _hooks.Redraw();
            });
        }
        else if (!_hooks.StepMoving())
        {
            After(MotionMath.Dwell, () =>
            {
                if (key != _stepKey || !Auto) return;
                _settledKey = key;
                if (OnLast) _hooks.Redraw(); // nothing comes after it: the button says Play now
                ArmAuto();
            });
        }
        // Otherwise the motion's end settles it (see Settled).
    }

    /// <summary>Pause when the button says so, else Play: on from where it stands. Run out, Play goes round again: the step on its own, or with Autoplay the flow from its first step.</summary>
    public void TogglePlay()
    {
        if (_hooks.Where() is not { } at) return;
        if (ShowsPause)
        {
            _hooks.Clock.Pause();
            _hooks.Redraw();
            return;
        }
        var over = AtEnd;
        Resume();
        if (over)
        {
            if (Auto && at.Index > 0) Head = Head! with { Step = 0 };
            else _replays++;
        }
        _hooks.Redraw();
        ArmAuto();
    }

    /// <summary>The clock runs again. A step dragged back into its motion has the rest of it to play: the button says Play again when that is over.</summary>
    private void Resume()
    {
        _hooks.Clock.Play();
        _redraw?.Dispose();
        _redraw = null;
        var left = _hooks.Clock.Length - _hooks.Clock.Elapsed;
        if (left > 0 && _settledKey == _stepKey) _redraw = _hooks.Wait(left, _hooks.Redraw);
    }

    /// <summary>The step (and replay) as the clock knows it: a new key is a new step to play.</summary>
    private string KeyOf(string flowId, int index) => $"{flowId}:{index}:{_replays}";

    private bool _wasOn; // whether it was playing when the bar was taken hold of

    /// <summary>The bar is taken hold of: the player stands still while it is dragged.</summary>
    public void ScrubStart()
    {
        _wasOn = ShowsPause;
        _hooks.Clock.Pause();
        _hooks.Redraw();
    }

    /// <summary>The bar is dragged to <paramref name="fraction"/> of the way through stop <paramref name="stop"/>: the reader goes to the stop, and the clock to the moment once the stop's motion says how long it is.</summary>
    public void ScrubTo(int stop, double fraction)
    {
        if (Head is null || _hooks.Where() is not { } at) return;
        var to = Math.Max(0, Math.Min(stop, at.Count - 1));
        _hooks.Clock.SeekFraction(fraction, KeyOf(Head.Flow, to));
        if (to == at.Index) return;
        Head = Head with { Step = to };
        _hooks.Redraw();
    }

    /// <summary>The bar is let go of: it carries on if it was playing, else the player stays paused where it was dragged to.</summary>
    public void ScrubEnd()
    {
        if (!_wasOn) return;
        _wasOn = false;
        Resume();
        _hooks.Redraw();
        ArmAuto();
    }

    /// <summary>Plays at <paramref name="speed"/>, and keeps it for the canvases that come after while the app runs. The caller draws.</summary>
    public void SetSpeed(double speed)
    {
        _hooks.Clock.SetRate(speed);
        PlayerClock.Kept = speed;
        _hooks.Redraw();
    }

    /// <summary>The next of <see cref="PlayerClock.Speeds"/>, round to the first after the last (the S key).</summary>
    public void NextSpeed()
    {
        var speeds = PlayerClock.Speeds;
        SetSpeed(speeds[(Array.IndexOf(speeds, _hooks.Clock.Rate) + 1) % speeds.Length]);
    }

    /// <summary>A moment back or on, while paused.</summary>
    public void Nudge(int by)
    {
        if (Paused) _hooks.Clock.Seek(_hooks.Clock.Elapsed + by * NudgeMs);
    }

    public void Replay()
    {
        if (_hooks.Where() is null) return;
        _replays++;
        _hooks.Redraw();
    }

    private void After(double milliseconds, Action then)
    {
        _wait?.Dispose();
        _wait = _hooks.Wait(milliseconds, then);
    }
}
