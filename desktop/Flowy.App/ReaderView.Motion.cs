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
            var runs = FlowStage.RunsOf(model, view, playing.Flow, StopsOf(playing.Flow), index, shown);
            if (runs.Count > 0)
                _canvas.PlaySteps(runs, () => _playback.Settled(key));
        }
        _playback.ArmAuto();
    }
}
