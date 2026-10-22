using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// What a run puts on a canvas from where it is along, and on its panel's readouts: the traffic on each line and what each shape measured, and for a run over time the states its
/// events have left the shapes in so far. The single canvas of the reader (while the Performance panel is open) and each canvas of a comparison of runs both draw a run from here,
/// so a run looks the same in all of them.
/// </summary>
internal static class RunDrawing
{
    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<IdMap<LoadRun>, IReadOnlyDictionary<string, LoadRun>> Maps = new();
    private static readonly IReadOnlyDictionary<string, LoadRun> NoRuns = new Dictionary<string, LoadRun>();

    /// <summary>The runs of a folder as the rules of the comparison read them (in the order the map lists them), made once for as long as the folder holds the same runs.</summary>
    public static IReadOnlyDictionary<string, LoadRun> MapOf(IdMap<LoadRun>? runs) =>
        runs is null ? NoRuns : Maps.GetValue(runs, r => r.ToDictionary(kv => kv.Key, kv => kv.Value));

    /// <summary>
    /// The states a run over time leaves at the position on show: the latest event at or before it, for each shape (see <see cref="Perf.RunStates"/>). Null when the run has no events
    /// (or is not over time), so a run that has none leaves the canvas as it was.
    /// </summary>
    public static IReadOnlyDictionary<string, StateMark>? Marks(Model model, LoadRun? run, double pos) =>
        run is { IsTime: true, Events.Count: > 0 } ? States.Marks(model, Perf.RunStates(run, PerfView.LoadAt(run, PerfView.ClampPos(run, pos)))) : null;

    /// <summary>
    /// Draws the run at the session's place on the canvas and moves the panel to it, without building either again: what a step of a ramp, or a key, changes. With
    /// <paramref name="snap"/> (the slider of a run is being dragged) the shapes change state at once instead of easing. The session must have a run.
    /// </summary>
    public static void Apply(CanvasView canvas, PerfPanel panel, PerfSession session, Folder folder, string view, bool snap)
    {
        var run = session.Run!;
        if (session.Several is { } several)
        {
            // A run with several sources: the level at where every dial stands, worked out once, for the canvas and the panel's readouts both.
            session.EnsurePlaces();
            var runs = folder.Runs!;
            var setting = PerfView.SettingOf(several.Items, [.. several.Items.Select((d, i) => PerfView.ClampDial(d, session.Places[i]))]);
            var made = Perf.FrameOf(folder.Model, runs, PerfView.ActiveRun(runs, session.RunId), setting, view);
            canvas.ShowLoad(made.Traffic);
            canvas.ShowStates(Marks(folder.Model, run, session.Pos), snap);
            panel.SetPlaces(session.Places, session.Active, session.Ramping, made, canvas.StatesShown);
            return;
        }
        session.Clamp(run);
        var frame = Perf.FrameAt(folder.Model, run, PerfView.LoadAt(run, session.Pos), view); // worked out once, for the canvas and the panel's readouts both
        canvas.ShowLoad(frame.Traffic);
        canvas.ShowStates(Marks(folder.Model, run, session.Pos), snap);
        panel.SetPos(session.Pos, session.Ramping, frame, canvas.StatesShown); // the key lists the states that are on the canvas now
    }
}
