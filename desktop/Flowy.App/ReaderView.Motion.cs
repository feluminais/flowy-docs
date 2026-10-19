using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>The step playing: when its animation starts, Replay, and Autoplay.</summary>
internal sealed partial class ReaderView
{
    private string _stepKey = ""; // the step (and replay) now showing; empty when no flow plays
    private string _settledKey = ""; // the step whose motion has finished
    private int _replays;
    private bool _auto;
    private IDisposable? _wait; // what Autoplay is waiting for, run on animation frames like everything that moves here

    internal bool StepMoving => _canvas.StepMoving;
    internal bool Autoplaying => _auto && PlayingFlow() is not null;

    /// <summary>
    /// Waits on animation frames, as everything that moves here does, so a test can drive them. Each frame invalidates the reader: a headless
    /// window only ticks frames while something needs drawing, and a wait draws nothing of its own.
    /// </summary>
    private void After(double milliseconds, Action then)
    {
        _wait?.Dispose();
        _wait = Anim.Run(this, milliseconds, t => t, _ => InvalidateVisual(), then);
    }

    /// <summary>Taking a step yourself, leaving the flow or changing view ends Autoplay. The caller draws.</summary>
    private void StopAuto()
    {
        _auto = false;
        _wait?.Dispose();
        _wait = null;
    }

    /// <summary>
    /// Starts the motion of the step now showing, once for each step and replay: Refresh runs for many other reasons (a hover, a theme, a
    /// change on disk) and must not start it again.
    /// </summary>
    private void UpdateMotion((string Id, Flow Flow)? flow, int index, Playing? shown)
    {
        var key = flow is { } f ? $"{f.Id}:{index}:{_replays}" : "";
        if (key == _stepKey) return;
        _stepKey = key;
        _canvas.StopStep();
        // A recursion is not drawn here yet, so it plays like a step with no tag. The desktop phase removes the Kind condition.
        if (flow is { } playing && shown?.Ends[index] is { } placed && Animations.Read(playing.Flow.Steps[index]) is { Kind: not "recurse" } animation)
        {
            var after = index > 0 && Animations.Follows(shown.Ends[index - 1], placed);
            _canvas.PlayStep(animation, placed.From, placed.To, after, () =>
            {
                if (key != _stepKey) return;
                _settledKey = key;
                ArmAuto();
            });
        }
        ArmAuto();
    }

    /// <summary>
    /// Autoplay: once the step now showing has finished moving (or has had a moment, if it doesn't move), rest a moment and go on to the
    /// next, or stop after the last. Called whenever something it depends on changes.
    /// </summary>
    private void ArmAuto()
    {
        _wait?.Dispose();
        _wait = null;
        if (!_auto || PlayingFlow() is not { } f) return;
        var key = _stepKey;
        if (_settledKey == key)
        {
            After(MotionMath.Gap, () =>
            {
                if (key != _stepKey || !_auto) return;
                if (StepIndex() < f.Flow.Steps.Count - 1) _playing = (f.Id, StepIndex() + 1);
                else _auto = false;
                Refresh();
            });
        }
        else if (!_canvas.StepMoving)
        {
            After(MotionMath.Dwell, () =>
            {
                if (key != _stepKey || !_auto) return;
                _settledKey = key;
                ArmAuto();
            });
        }
        // Otherwise the motion's end settles it (see UpdateMotion).
    }

    private void ToggleAuto()
    {
        if (PlayingFlow() is not { } f) return;
        if (_auto)
        {
            StopAuto();
            Refresh();
            return;
        }
        _auto = true;
        if (StepIndex() == f.Flow.Steps.Count - 1) _playing = (f.Id, 0); // from the start
        Refresh();
        ArmAuto();
    }

    private void Replay()
    {
        if (PlayingFlow() is null) return;
        _replays++;
        Refresh();
    }
}
