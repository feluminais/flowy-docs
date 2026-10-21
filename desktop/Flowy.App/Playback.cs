using Flowy.Core;

namespace Flowy.App;

/// <summary>The flow playing, the stop it is at (see <see cref="Structure.Stops"/>), and the places it was opened from.</summary>
internal sealed record Playhead(string Flow, int Step, IReadOnlyList<FlowPlace> Trail);

/// <summary>
/// What a <see cref="Playback"/> asks of the screen: where the flow on show stands (its stop and how many it has; null when none plays), whether the step's
/// motion is still going, drawing again, and a wait on animation frames (disposing what it returns cancels it).
/// </summary>
internal sealed record PlaybackHooks(
    Func<(int Index, int Count)?> Where,
    Func<bool> StepMoving,
    Action Redraw,
    Func<double, Action, IDisposable> Wait);

/// <summary>
/// The playhead and Autoplay: the flow and stop playing, the step (and replay) whose motion has started, the step whose motion has finished, and the wait that
/// takes Autoplay on to the next stop. It holds no controls; the reader draws, and tells it when a step's motion ends.
/// </summary>
internal sealed class Playback
{
    private readonly PlaybackHooks _hooks;
    private string _stepKey = ""; // the step (and replay) now showing; empty when no flow plays
    private string _settledKey = ""; // the step whose motion has finished
    private int _replays;
    private IDisposable? _wait; // what Autoplay is waiting for, run on animation frames like everything that moves here

    public Playback(PlaybackHooks hooks) => _hooks = hooks;

    /// <summary>The flow playing and its stop, or null.</summary>
    public Playhead? Head { get; set; }

    public bool Auto { get; private set; }

    /// <summary>Taking a step yourself, leaving the flow or changing view ends Autoplay. The caller draws.</summary>
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
        key = flowId is null ? "" : $"{flowId}:{index}:{_replays}";
        if (key == _stepKey) return false;
        _stepKey = key;
        return true;
    }

    /// <summary>The motion of a step has finished (or there was none to wait for): Autoplay may go on. A step that has since been left is ignored.</summary>
    public void Settled(string key)
    {
        if (key != _stepKey) return;
        _settledKey = key;
        ArmAuto();
    }

    /// <summary>
    /// Autoplay: once the step now showing has finished moving (or has had a moment, if it doesn't move), rest a moment and go on to the
    /// next, or stop after the last. Called whenever something it depends on changes.
    /// </summary>
    public void ArmAuto()
    {
        _wait?.Dispose();
        _wait = null;
        if (!Auto || _hooks.Where() is null) return;
        var key = _stepKey;
        if (_settledKey == key)
        {
            After(MotionMath.Gap, () =>
            {
                // The flow may have been reloaded while this waited: ask which one is playing now, not the one it was armed on.
                if (key != _stepKey || !Auto || _hooks.Where() is not { } now) return;
                if (now.Index < now.Count - 1) Head = Head! with { Step = now.Index + 1 };
                else Auto = false;
                _hooks.Redraw();
            });
        }
        else if (!_hooks.StepMoving())
        {
            After(MotionMath.Dwell, () =>
            {
                if (key != _stepKey || !Auto) return;
                _settledKey = key;
                ArmAuto();
            });
        }
        // Otherwise the motion's end settles it (see Settled).
    }

    public void ToggleAuto()
    {
        if (_hooks.Where() is not { } at) return;
        if (Auto)
        {
            StopAuto();
            _hooks.Redraw();
            return;
        }
        Auto = true;
        if (at.Index == at.Count - 1) Head = Head! with { Step = 0 }; // from the start
        _hooks.Redraw();
        ArmAuto();
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
