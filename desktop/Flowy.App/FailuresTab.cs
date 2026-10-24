using Avalonia.Input;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The Failures tab of the navigator, on the left with Explorer and Flows: the analysis on show and the mode picked in it, what the list is narrowed to, and the
/// failures drawn on the canvas (a badge on each shape and line that carries a mode, and for the mode picked its part outlined and the rest faded). Details
/// stays free on the right, so a shape picked on the canvas reads out there while it also narrows the list. A port of what App.tsx does for the Failures tab,
/// with the same rules: it is always there, and stays open while editing, where it carries the forms; a flow that was
/// playing waits behind it; the Performance tab and it never show at once, because load and risk would draw over each other.
/// </summary>
internal sealed class FailuresTab
{
    private readonly FailuresPanel _panel;
    private readonly CanvasView _canvas;
    private readonly IReader _reader;
    private string _analysisId = "";
    private string? _modeId;
    private RiskBand? _band; // the list is narrowed to this band
    private bool _left; // the list holds the shapes no mode names yet

    public FailuresTab(FailuresPanel panel, CanvasView canvas, IReader reader)
    {
        _panel = panel;
        _canvas = canvas;
        _reader = reader;
        Wire();
    }

    internal FailuresPanel Panel => _panel;

    /// <summary>The tab is always there. With no analysis its panel says so; with only a broken file of one it says what is wrong. It stays open while editing: the analyses have forms, and the marks follow the model as it changes.</summary>
    internal bool Available => _reader.Folder is not null;

    /// <summary>The navigator's tab is Failures (chosen on its rail or its strip, or by M) and the folder has an analysis to show.</summary>
    internal bool IsOpen => _reader.Tab == PanelTab.Failures && Available;

    internal string? AnalysisKey => _reader.Folder is { } f ? FailuresView.ActiveAnalysis(f.Model.Failures, _analysisId) : null;

    internal FailureAnalysis? Analysis => _reader.Folder is { } f && AnalysisKey is { } key ? f.Model.Failures[key] : null;

    internal FailureMode? PickedMode => _reader.Folder is { } f ? FailuresView.ModeIn(f.Model, AnalysisKey, _modeId) : null;

    internal (string? Analysis, string? Mode, RiskBand? Band, bool Left) State => (AnalysisKey, PickedMode is null ? null : _modeId, _band, _left);

    /// <summary>The shape or line picked on the canvas: the list shows what it carries.</summary>
    private FailurePart? PickedPart => _reader.Pick switch
    {
        ReaderView.Side.Box box => new FailurePart.Box(box.Id),
        ReaderView.Side.Line line => new FailurePart.Line(line.From, line.To),
        _ => null,
    };

    /// <summary>Another folder's analyses start from the top.</summary>
    internal void Reset()
    {
        _analysisId = "";
        _modeId = null;
        _band = null;
        _left = false;
    }

    /// <summary>Shows an analysis, and the mode in it that a problem names.</summary>
    internal void Choose(string analysis, string? mode)
    {
        _analysisId = analysis;
        _modeId = mode;
        _band = null;
        _left = false;
    }

    /// <summary>Opens the tab beside Explorer and Flows. It takes Performance's place: its traffic and the failure marks would draw over each other.</summary>
    internal void Open() => _reader.SetTab(PanelTab.Failures);

    internal void Toggle()
    {
        if (IsOpen) _reader.CloseNavigator();
        else Open();
    }

    private void Wire()
    {
        _panel.AnalysisPicked += id =>
        {
            Choose(id, null);
            _reader.Refresh();
        };
        _panel.ModePicked += SelectMode;
        // One filter, as the browser keeps it: pressing a band leaves the list of shapes, and pressing Not analysed lets go of the band.
        _panel.BandPicked += band =>
        {
            _band = band;
            _left = false;
            _reader.Refresh();
        };
        _panel.LeftToggled += () =>
        {
            _left = !_left;
            _band = null;
            _reader.Refresh();
        };
        _panel.PartCleared += () =>
        {
            _reader.Pick = null;
            _reader.Refresh();
        };
        _panel.ShapePicked += PickShape;
        _panel.FlowShown += ShowFlow;
        _panel.SeenInRun += SeenInRun;
        _panel.Copied += format => _ = CopyAnalysisAsync(format);
        _panel.CreateClicked += () => _reader.SetEditing(true);
        _panel.Used += () => _reader.TakeFocus(); // a control in the panel took the keyboard: give it back, so the keys work (and its tab stays the one Esc closes)
    }

    /// <summary>Picks a mode in the list (or, picked again, none); when its part is outside this view, the canvas goes to the view that draws it.</summary>
    internal void SelectMode(string? id)
    {
        _modeId = id;
        if (PickedMode is { } mode && _reader.Folder is { } folder && !Failures.DrawnIn(folder.Model, _reader.CurrentView, mode)) _reader.GoTo(Failures.HomeView(folder.Model, mode));
        else _reader.Refresh();
        RevealPicked();
    }

    /// <summary>Pans the canvas just far enough that the picked mode's part is not hidden under the navigator, where the list is, or under Details.</summary>
    private void RevealPicked()
    {
        if (PickedMode is not { } mode || _reader.Folder is not { } folder || Failures.LightFor(folder.Model, _reader.CurrentView, mode) is not { Fails.Count: > 0 } lit) return;
        _reader.RevealAll(lit.Fails);
    }

    /// <summary>A click on a shape in the list of those no mode names yet: go to it and pick it.</summary>
    private void PickShape(string id)
    {
        if (_reader.Folder is not { } folder || folder.Model.GetObject(id) is null) return;
        var parent = Views.ParentOf(folder.Model, id);
        if (parent != _reader.CurrentView) _reader.GoTo(parent);
        _reader.OpenObject(id);
    }

    /// <summary>Show it: play the flow that tells a failure, at the step it names (counted from 1).</summary>
    private void ShowFlow(string id, int? step)
    {
        if (_reader.Folder is not { } folder) return;
        if (!folder.Model.Flows.TryGetValue(id, out var flow) || flow.Steps.Count == 0 || !Views.IsView(folder.Model, flow.View))
        {
            _reader.ShowNotice("That flow can't play yet.");
            return;
        }
        _reader.CloseNavigator();
        if (flow.View != _reader.CurrentView) _reader.GoTo(flow.View!);
        _reader.Play(id, step is { } n ? Math.Max(0, n - 1) : 0);
    }

    /// <summary>Seen in a run: open Performance on the first tested level where the mode's part has errors, on the view that draws it.</summary>
    private void SeenInRun(string id)
    {
        if (_reader.Folder is not { } folder || FailuresView.ModeIn(folder.Model, AnalysisKey, id) is not { } mode) return;
        if (mode.Run is not { } name || folder.Runs is not { } runs || !runs.TryGetValue(name, out var run)) return;
        if (FailuresView.FirstErrorAt(folder.Model, run, mode) is not { } at) return;
        _reader.Pick = null;
        _reader.GoTo(Failures.HomeView(folder.Model, mode));
        _reader.ShowRun(name, at);
    }

    /// <summary>Copies the analysis on show as a table (Markdown, to paste into a README or a PR) or as CSV (for a spreadsheet), and says so.</summary>
    private async Task CopyAnalysisAsync(string format)
    {
        if (_reader.Folder is not { } folder || AnalysisKey is null || Analysis is not { } analysis) return;
        var text = Failures.Table(folder.Model, analysis, format);
        var done = format == "csv" ? "Copied this analysis as CSV." : "Copied this analysis as a table.";
        if (await _reader.CopyAsync(text)) _reader.ShowNotice(done, 4);
        else _reader.ShowNotice("Couldn't copy: the clipboard wasn't available.", 6);
    }

    /// <summary>The marks the canvas wears for the Failures panel, or none: rolled up to the view on show, with the mode picked lit.</summary>
    internal void Apply()
    {
        if (!IsOpen || _reader.Folder is not { } folder || Analysis is not { } analysis)
        {
            _canvas.ShowFailures(null);
            return;
        }
        _canvas.ShowFailures(FailureOverlay.For(folder.Model, analysis, _reader.CurrentView, PickedMode));
    }

    internal void Show(Model model, string view)
    {
        var folder = _reader.Folder!;
        EditRun? edit = _reader.Editing ? _reader.RunAsync : null;
        _panel.Show(new FailuresShown(model, view, AnalysisKey, PickedMode is null ? null : _modeId, _band, _left, PickedPart, folder.Runs ?? new IdMap<LoadRun>(), folder.Problems, folder.FailureProblems ?? [], edit, !_reader.Editing && !_reader.ReadOnly));
    }

    /// <summary>The Left and Right keys step through the list as it is drawn: the rows of this view, then the others.</summary>
    internal bool Step(Key key)
    {
        if (!IsOpen || _reader.Editing || Analysis is not { } analysis || _reader.Folder is not { } folder) return false;
        var (here, elsewhere) = FailuresView.RowsFor(folder.Model, analysis, _reader.CurrentView, _band, PickedPart);
        var ids = here.Concat(elsewhere).Select(r => r.Id).ToList();
        SelectMode(FailuresView.Neighbour(ids, PickedMode is null ? null : _modeId, key == Key.Right ? 1 : -1));
        return true;
    }
}
