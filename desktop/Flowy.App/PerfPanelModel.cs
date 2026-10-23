using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// What the run header offers for comparing: Compare, greyed out with its reason as the tooltip (never hidden). <see cref="CompareOff"/> is why Compare is blocked (editing, no other run),
/// or null. Linking a run is done while editing (see <see cref="RunLinksPanel"/>).
/// </summary>
internal sealed record RunActions(string? CompareOff);

/// <summary>
/// What the Performance panel shows: the run and where it stands, the shape or line picked, and (for a run with several sources) where each dial stands.
/// The panel is built again when <see cref="SameBuild"/> says this differs from what it shows, and moved in place when only the position differs.
/// <see cref="Pane"/> is a panel inside a pane of a comparison: the run is the pane's own, so the header has no picker and no title (the pane has it), and <see cref="Actions"/> is what the
/// header offers for comparing, none in such a pane.
/// </summary>
internal sealed record PerfPanelModel(
    Model Model,
    string View,
    IdMap<LoadRun> Runs,
    IReadOnlyList<Problem> RunProblems,
    string RunId,
    double Pos,
    bool Ramping,
    bool Still,
    PerfSelection? Selection,
    IReadOnlyList<double>? Places = null,
    int Active = 0,
    bool Pane = false,
    RunActions? Actions = null)
{
    /// <summary>
    /// Whether the panel built for <paramref name="shown"/> still fits this one, so that moving it is enough: the same model and runs, the same run, view and
    /// pick, and motion on or off alike. Where the slider stands (<see cref="Pos"/>, <see cref="Places"/>), the Ramp button and the active dial do not count.
    /// </summary>
    public bool SameBuild(PerfPanelModel shown) =>
        ReferenceEquals(Model, shown.Model) && ReferenceEquals(Runs, shown.Runs) && RunProblems.Count == shown.RunProblems.Count && RunId == shown.RunId
        && View == shown.View && Still == shown.Still && Selection == shown.Selection && Pane == shown.Pane && Actions == shown.Actions;
}
