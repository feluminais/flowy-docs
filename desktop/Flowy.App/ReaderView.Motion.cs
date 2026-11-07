using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>The step playing: when its animation starts, Replay, and Autoplay.</summary>
internal sealed partial class ReaderView
{
    private readonly Playback _playback;

    internal bool StepMoving => _canvas.StepMoving;

    /// <summary>Another tab takes the screen: a field being typed in saves, as a click elsewhere would, and a flow or a ramp stops running where nobody can see it. Coming back finds them paused.</summary>
    internal void LeaveTab()
    {
        if (Avalonia.Controls.TopLevel.GetTopLevel(this)?.FocusManager?.GetFocusedElement() is Avalonia.Visual typing && Avalonia.VisualTree.VisualExtensions.FindAncestorOfType<FieldBox>(typing) is { } box) _ = box.Commit();
        if (PlayingFlow() is not null && _playback.ShowsPause) _playback.TogglePlay();
        _perf.StopRamp();
    }

    /// <summary>
    /// For <c>--pause-at</c>: once the step on show moves, pauses it <paramref name="ms"/> into its motion; with <paramref name="hover"/> (<c>--hover-dot</c>) the first dot
    /// that carries a payload then shows its card, as the pointer on it would.
    /// </summary>
    internal void PauseAt(double ms, bool hover)
    {
        var tries = 0;
        void Try()
        {
            if (!_canvas.StepMoving && tries++ < 80)
            {
                Avalonia.Threading.DispatcherTimer.RunOnce(Try, TimeSpan.FromMilliseconds(25));
                return;
            }
            _canvas.Clock.Pause();
            _canvas.Clock.Seek(ms);
            _canvas.ShowMotionAt(ms);
            if (!hover) return;
            UpdateLayout(); // the player card has grown to the step's rows, so the card keeps clear of where it is now
            foreach (var dot in _canvas.DotsOnScreen)
            {
                _canvas.HoverDotAt(new Avalonia.Point(dot.X + dot.Width / 2, dot.Y + dot.Height / 2));
                if (_canvas.DotCardNow is not null) break;
            }
        }
        Try();
    }
    internal bool FlowPaused => _playback.Paused;

    internal bool Autoplaying => _playback.Auto && PlayingFlow() is not null;

    /// <summary>Where the flow on show stands, for <see cref="Playback"/>: its stop and how many it has, or null when none plays.</summary>
    private (int Index, int Count)? PlayWhere() => PlayingFlow() is { } f ? (StopIndex(), StopsOf(f.Flow).Count) : null;

    /// <summary>
    /// Starts the motion of the step now showing, once for each step and replay: Refresh runs for many other reasons (a hover, a theme, a
    /// change on disk) and must not start it again.
    /// </summary>
    private void UpdateMotion(Model model, string view, (string Id, Flow Flow)? flow, int index, Playing? shown)
    {
        // Where a project draws a line for each connection, the lines of the pair the step rides part around the lit one by the player's clock.
        var plans = flow is { } on && shown is not null ? FlowStage.PartsAt(model, view, on.Flow, StopsOf(on.Flow), index, shown, LineStyle) : FlowStage.NoPlans;
        if (!_playback.Begin(flow?.Id, index, out var key))
        {
            // A change on disk can take a recursion's tag off the step showing, or change its depth, without changing the step: the counter follows. It can change the lines the step rides too.
            _canvas.SetResting(flow is { } now && shown?.Ends[index] is { } at && Animations.Read(now.Flow.Steps[index]) is { Kind: "recurse" } a ? (at.From, a.Depth ?? Animations.DepthDefault) : null);
            _canvas.PartStop(flow?.Id, index, plans);
            return;
        }
        _canvas.StopStep();
        _canvas.RestartChannels();
        _canvas.PartStop(flow?.Id, index, plans); // the clock has begun this stop
        if (flow is { } playing && shown is not null)
        {
            var runs = FlowStage.RunsOf(model, view, playing.Flow, StopsOf(playing.Flow), index, shown, plans, LineStyle);
            if (runs.Count > 0)
                _canvas.PlaySteps(runs, () => _playback.Settled(key));
        }
        _playback.ArmAuto();
    }
}
