using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The Failures tab of the navigator, on the left with Explorer and Flows: the analysis on show and the mode picked in it, what the list is narrowed to, and the
/// failures drawn on the canvas (a badge on each shape and line that carries a mode, and for the mode picked its part outlined and the rest faded). Details
/// stays free on the right, so a shape picked on the canvas reads out there while it also narrows the list. A port of what App.tsx does for the Failures tab,
/// with the same rules: it is there only where the folder has an analysis (or a file of one to complain about) and not while editing; a flow that was
/// playing waits behind it; the Performance tab and it never show at once, because load and risk would draw over each other.
/// </summary>
internal sealed partial class ReaderView
{
    private FailuresPanel _failuresPanel => _nav.Failures;
    private string _analysisId = "";
    private string? _modeId;
    private RiskBand? _band; // the list is narrowed to this band
    private bool _left; // the list holds the shapes no mode names yet

    /// <summary>The tab is there whenever there is an analysis, or a file of one to complain about.</summary>
    private bool ShowFailures => _folder is { } f && (f.Model.Failures.Count > 0 || (f.FailureProblems?.Count ?? 0) > 0);

    /// <summary>While editing the tab is greyed out: the analyses have no forms here yet, and the marks would sit on a model that is changing.</summary>
    private bool CanFailures => !Editing && ShowFailures;

    /// <summary>The navigator's tab is Failures (chosen on its rail or its strip, or by M) and the folder has an analysis to show.</summary>
    private bool FailuresOpen => _tab == PanelTab.Failures && CanFailures;

    private string? AnalysisKey => _folder is { } f ? FailuresView.ActiveAnalysis(f.Model.Failures, _analysisId) : null;

    private FailureAnalysis? Analysis => _folder is { } f && AnalysisKey is { } key ? f.Model.Failures[key] : null;

    private FailureMode? PickedMode => _folder is { } f ? FailuresView.ModeIn(f.Model, AnalysisKey, _modeId) : null;

    /// <summary>The shape or line picked on the canvas: the list shows what it carries.</summary>
    private FailurePart? PickedPart => _side switch
    {
        Side.Box box => new FailurePart.Box(box.Id),
        Side.Line line => new FailurePart.Line(line.From, line.To),
        _ => null,
    };

    /// <summary>Opens the tab beside Explorer and Flows. It takes Performance's place: its traffic and the failure marks would draw over each other.</summary>
    private void OpenFailures() => SetTab(PanelTab.Failures);

    private void CloseFailures() => CloseNav();

    private void ToggleFailures()
    {
        if (FailuresOpen) CloseFailures();
        else OpenFailures();
    }

    private void WireFailures()
    {
        _failuresPanel.AnalysisPicked += id =>
        {
            _analysisId = id;
            _modeId = null;
            _band = null;
            _left = false;
            Refresh();
        };
        _failuresPanel.ModePicked += SelectMode;
        // One filter, as the browser keeps it: pressing a band leaves the list of shapes, and pressing Not analysed lets go of the band.
        _failuresPanel.BandPicked += band =>
        {
            _band = band;
            _left = false;
            Refresh();
        };
        _failuresPanel.LeftToggled += () =>
        {
            _left = !_left;
            _band = null;
            Refresh();
        };
        _failuresPanel.PartCleared += () =>
        {
            _side = null;
            Refresh();
        };
        _failuresPanel.ShapePicked += PickShape;
        _failuresPanel.FlowShown += ShowFlow;
        _failuresPanel.SeenInRun += SeenInRun;
        _failuresPanel.Copied += format => _ = CopyAnalysisAsync(format);
        _failuresPanel.Used += () => Focus(); // a control in the panel took the keyboard: give it back, so the keys work (and its tab stays the one Esc closes)
    }

    /// <summary>Picks a mode in the list (or, picked again, none); when its part is outside this view, the canvas goes to the view that draws it.</summary>
    private void SelectMode(string? id)
    {
        _modeId = id;
        if (PickedMode is { } mode && _folder is { } folder && !Failures.DrawnIn(folder.Model, CurrentView(), mode)) GoTo(Failures.HomeView(folder.Model, mode));
        else Refresh();
        RevealPicked();
    }

    /// <summary>Pans the canvas just far enough that the picked mode's part is not hidden under the navigator, where the list is, or under Details.</summary>
    private void RevealPicked()
    {
        if (PickedMode is not { } mode || _folder is not { } folder || Failures.LightFor(folder.Model, CurrentView(), mode) is not { Fails.Count: > 0 } lit) return;
        _canvas.RevealAll(lit.Fails, RightOpen ? _detailsWidth : 0, ShownTab is not null ? _navWidth : 0);
    }

    /// <summary>A click on a shape in the list of those no mode names yet: go to it and pick it.</summary>
    private void PickShape(string id)
    {
        if (_folder is not { } folder || folder.Model.GetObject(id) is null) return;
        var parent = Views.ParentOf(folder.Model, id);
        if (parent != CurrentView()) GoTo(parent);
        OpenObject(id);
    }

    /// <summary>Show it: play the flow that tells a failure, at the step it names (counted from 1).</summary>
    private void ShowFlow(string id, int? step)
    {
        if (_folder is not { } folder) return;
        if (!folder.Model.Flows.TryGetValue(id, out var flow) || flow.Steps.Count == 0 || !Views.IsView(folder.Model, flow.View))
        {
            ShowNotice("That flow can't play yet.");
            return;
        }
        CloseFailures();
        if (flow.View != CurrentView()) GoTo(flow.View!);
        Play(id, step is { } n ? Math.Max(0, n - 1) : 0);
    }

    /// <summary>Seen in a run: open Performance on the first tested level where the mode's part has errors, on the view that draws it.</summary>
    private void SeenInRun(string id)
    {
        if (_folder is not { } folder || FailuresView.ModeIn(folder.Model, AnalysisKey, id) is not { } mode) return;
        if (mode.Run is not { } name || folder.Runs is not { } runs || !runs.TryGetValue(name, out var run)) return;
        if (FailuresView.FirstErrorAt(folder.Model, run, mode) is not { } at) return;
        _side = null;
        GoTo(Failures.HomeView(folder.Model, mode));
        _perf.StopRamp();
        _perf.SetRun(name);
        OpenPerf();
        _perf.JumpTo(at);
    }

    /// <summary>Copies the analysis on show as a table (Markdown, to paste into a README or a PR) or as CSV (for a spreadsheet), and says so.</summary>
    private async Task CopyAnalysisAsync(string format)
    {
        if (_folder is not { } folder || AnalysisKey is not { } key || Analysis is not { } analysis) return;
        var text = Failures.Table(folder.Model, analysis, format);
        var done = format == "csv" ? "Copied this analysis as CSV." : "Copied this analysis as a table.";
        CopiedText = text;
        if (TopLevel.GetTopLevel(this)?.Clipboard is { } clipboard)
        {
            try
            {
                await clipboard.SetTextAsync(text);
                ShowNotice(done, 4);
                return;
            }
            catch (Exception)
            {
                // fall through to the notice below
            }
        }
        ShowNotice("Couldn't copy: the clipboard wasn't available.", 6);
    }

    /// <summary>The marks the canvas wears for the Failures panel, or none: rolled up to the view on show, with the mode picked lit.</summary>
    private void ApplyFailures()
    {
        if (!FailuresOpen || _folder is not { } folder || Analysis is not { } analysis)
        {
            _canvas.ShowFailures(null);
            return;
        }
        _canvas.ShowFailures(FailureOverlay.For(folder.Model, analysis, CurrentView(), PickedMode));
    }

    private void ShowFailuresPanel(Model model, string view)
    {
        var folder = _folder!;
        _failuresPanel.Show(new FailuresShown(model, view, AnalysisKey, PickedMode is null ? null : _modeId, _band, _left, PickedPart, folder.Runs ?? new IdMap<LoadRun>(), folder.Problems, folder.FailureProblems ?? []));
    }

    /// <summary>The Left and Right keys step through the list as it is drawn: the rows of this view, then the others.</summary>
    private bool StepFailures(Key key)
    {
        if (!FailuresOpen || Editing || Analysis is not { } analysis || _folder is not { } folder) return false;
        var (here, elsewhere) = FailuresView.RowsFor(folder.Model, analysis, CurrentView(), _band, PickedPart);
        var ids = here.Concat(elsewhere).Select(r => r.Id).ToList();
        SelectMode(FailuresView.Neighbour(ids, PickedMode is null ? null : _modeId, key == Key.Right ? 1 : -1));
        return true;
    }

    // What a test can look at.
    internal bool FailuresOpenNow => FailuresOpen;

    internal FailuresPanel FailuresPanelNow => _failuresPanel;

    internal (string? Analysis, string? Mode, RiskBand? Band, bool Left) FailuresState => (AnalysisKey, PickedMode is null ? null : _modeId, _band, _left);

    internal void PickModeById(string? id) => SelectMode(id);

    /// <summary>The text last copied from the Failures panel, for a test that has no clipboard.</summary>
    internal string? CopiedText { get; private set; }

    internal void StepFailureList(Key key) => StepFailures(key);

    /// <summary>What a click on a problem in the bar's list does.</summary>
    internal void JumpToProblem(Problem problem) => Jump(problem);
}
