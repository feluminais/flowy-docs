using Avalonia.Input;
using Flowy.Core;

namespace Flowy.App;

internal sealed partial class ReaderView
{
    private readonly FailuresTab _failures;

    private bool CanFailures => _failures.Available;

    private bool FailuresOpen => _failures.IsOpen;

    // What a test can look at.
    internal bool FailuresOpenNow => FailuresOpen;

    internal FailuresPanel FailuresPanelNow => _failures.Panel;

    internal (string? Analysis, string? Mode, RiskBand? Band, bool Left) FailuresState => _failures.State;

    internal void PickModeById(string? id) => _failures.SelectMode(id);

    internal void StepFailureList(Key key) => _failures.Step(key);

    /// <summary>What a click on a problem in the bar's list does.</summary>
    internal void JumpToProblem(Problem problem) => Jump(problem);
}
