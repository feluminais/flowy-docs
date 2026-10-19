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
        if (flow is { } playing && shown is not null)
        {
            // Every step of the stop that moves plays at once; the stop has settled when the longest has finished.
            var stop = StopsOf(playing.Flow)[index];
            var runs = new List<CanvasView.StepRun>();
            foreach (var i in stop.Steps)
            {
                if (Animations.Read(playing.Flow.Steps[i]) is not { } animation || shown.Ends[i] is not { } placed) continue;
                runs.Add(new CanvasView.StepRun(animation, placed.From, placed.To, stop.Before.Any(j => Animations.Follows(shown.Ends[j], placed))));
            }
            if (runs.Count > 0)
                _canvas.PlaySteps(runs, () =>
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
                if (StopIndex() < StopsOf(f.Flow).Count - 1) _playing = _playing! with { Step = StopIndex() + 1 };
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
        if (StopIndex() == StopsOf(f.Flow).Count - 1) _playing = _playing! with { Step = 0 }; // from the start
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
