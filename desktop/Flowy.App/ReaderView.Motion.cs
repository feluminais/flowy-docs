using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>The step playing: when its animation starts, Replay, and Autoplay.</summary>
internal sealed partial class ReaderView
{
    private readonly Playback _playback;

    internal bool StepMoving => _canvas.StepMoving;
    internal bool Autoplaying => _playback.Auto && PlayingFlow() is not null;

    /// <summary>Where the flow on show stands, for <see cref="Playback"/>: its stop and how many it has, or null when none plays.</summary>
    private (int Index, int Count)? PlayWhere() => PlayingFlow() is { } f ? (StopIndex(), StopsOf(f.Flow).Count) : null;

    /// <summary>
    /// Starts the motion of the step now showing, once for each step and replay: Refresh runs for many other reasons (a hover, a theme, a
    /// change on disk) and must not start it again.
    /// </summary>
    private void UpdateMotion(Model model, string view, (string Id, Flow Flow)? flow, int index, Playing? shown)
    {
        if (!_playback.Begin(flow?.Id, index, out var key)) return;
        _canvas.StopStep();
        if (flow is { } playing && shown is not null)
        {
            // Every step of the stop that moves plays at once; the stop has settled when the longest has finished.
            var stop = StopsOf(playing.Flow)[index];
            var runs = new List<CanvasView.StepRun>();
            foreach (var i in stop.Steps)
            {
                if (Animations.Read(playing.Flow.Steps[i]) is not { } animation || shown.Ends[i] is not { } placed) continue;
                runs.Add(new CanvasView.StepRun(animation, placed.From, placed.To, stop.Before.Any(j => Animations.Follows(shown.Ends[j], placed)), TakenBy(model, view, animation, placed)));
            }
            if (runs.Count > 0)
                _canvas.PlaySteps(runs, () => _playback.Settled(key));
        }
        _playback.ArmAuto();
    }

    /// <summary>
    /// Who takes an intercepted request, as the view can draw it: the box that stands for the shape in this view, unless that is an end of the step (the view folds
    /// the shape into one of them) or the view can't show it; then its name stands in, drawn as a marker. Null for a step that is not intercepted.
    /// </summary>
    private static CanvasView.TakenBy? TakenBy(Model model, string view, StepAnimation animation, (string From, string To) placed)
    {
        if (animation.By is not { } by) return null;
        if (by.Name is { } name) return new CanvasView.TakenBy(Name: name);
        var box = Views.PlaceStep(model, view, by.Shape, null)?.From;
        return box is not null && box != placed.From && box != placed.To ? new CanvasView.TakenBy(Node: box) : new CanvasView.TakenBy(Name: Views.NameOf(model, by.Shape!));
    }
}
