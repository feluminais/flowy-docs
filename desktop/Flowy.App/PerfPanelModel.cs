using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// What the Performance panel shows: the run and where it stands, the shape or line picked, and (for a run with several sources) where each dial stands.
/// The panel is built again when <see cref="SameBuild"/> says this differs from what it shows, and moved in place when only the position differs.
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
    int Active = 0)
{
    /// <summary>
    /// Whether the panel built for <paramref name="shown"/> still fits this one, so that moving it is enough: the same model and runs, the same run, view and
    /// pick, and motion on or off alike. Where the slider stands (<see cref="Pos"/>, <see cref="Places"/>), the Ramp button and the active dial do not count.
    /// </summary>
    public bool SameBuild(PerfPanelModel shown) =>
        ReferenceEquals(Model, shown.Model) && ReferenceEquals(Runs, shown.Runs) && RunProblems.Count == shown.RunProblems.Count && RunId == shown.RunId
        && View == shown.View && Still == shown.Still && Selection == shown.Selection;
}
