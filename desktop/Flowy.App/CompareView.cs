using Avalonia;
using Avalonia.Controls;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// Two flows, under the bar of the comparison: side by side, each in a pane of its own, or in Swap, on one canvas that flips between them (see <see cref="SwapStage"/>). Every pane works
/// alone (zoom, pan and play); they share the one Details panel, which shows the last thing clicked in either. One pane has the focus (it is outlined): the first to start with, then the
/// one last clicked. The keys of a flow act on it, or in Swap on the flow on show. Changing the way to view carries each flow's step over.
/// Two runs are compared the same way, each in a <see cref="PerfComparePane"/> with its own Performance panel, or in Swap on one canvas (<see cref="PerfSwapStage"/>); the keys of the
/// Performance panel act on the focused pane's run, and each run keeps its own place along itself through every change of view.
/// </summary>
internal sealed class CompareView : Grid
{
    /// <summary>The container is narrower than this: the panes stack, one above the other.</summary>
    internal const double StackBelow = 900;

    /// <summary>What a click in Swap is picked as: the canvas is one, so a second click on what the panel shows closes it whichever flow is on show.</summary>
    internal const string SwapPick = "swap";

    private const double Gap = 12;

    private readonly Grid _panes = new() { Margin = new Thickness(Gap) };
    private readonly Border _swapHost = new() { Margin = new Thickness(Gap), IsVisible = false };
    private readonly Dictionary<string, ComparePane> _byKey = [];
    private readonly Dictionary<string, PaneRun> _runs = []; // for two runs: each run of the comparison by key, kept across Side by side, Swap and Swap sides (it holds the place along the run)
    private readonly Dictionary<string, PerfComparePane> _runPanes = [];
    private PerfSwapStage? _runStage;
    private IReadOnlyList<string> _keys = [];
    private string? _focusKey; // the first pane has the focus until one is clicked
    private bool _stacked;
    private SwapStage? _stage;
    private string? _shownMode;
    private string? _shownKind;
    private (Flow Older, Flow Newer, FlowDiff Diff)? _diff; // the last diff, for as long as both flows are the ones in the model: it costs a pass over both flows' steps
    private string? _older; // the flow that reads as older, and the one that holds the tag (else the second): the marks of each pane are its side's
    private string? _newer;

    /// <summary>A box or a line was clicked in the pane with this key (in Swap, <see cref="SwapPick"/>).</summary>
    public event Action<string, ReaderView.Side>? Picked;

    /// <summary>The empty area of a pane was clicked.</summary>
    public event Action? EmptyClicked;

    /// <summary>A control of a run's panel took the keyboard: the reader gives it back, so the keys work.</summary>
    public event Action? ControlUsed;

    public CompareView()
    {
        RowDefinitions = [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Star), new RowDefinition(GridLength.Auto)];
        Bar = new CompareBar();
        Note = new CompareNote();
        SetRow(Bar, 0);
        SetRow(_panes, 1);
        SetRow(_swapHost, 1);
        SetRow(Note, 2);
        Children.Add(Bar);
        Children.Add(_panes);
        Children.Add(_swapHost);
        Children.Add(Note);
        Classes.Add("compare");
    }

    public CompareBar Bar { get; }

    /// <summary>The note on the pair, under the panes (and under the canvas of Swap).</summary>
    public CompareNote Note { get; }

    /// <summary>What Show changes found, while it is on and the comparison is shown; null otherwise (for tests).</summary>
    internal FlowDiff? Diff { get; private set; }

    /// <summary>The flow whose marks are the older side's, and the one whose marks are the newer's (the holder of the tag, else the second of the pair).</summary>
    internal (string Older, string Newer)? Sides => _older is null || _newer is null ? null : (_older, _newer);

    /// <summary>The pane the Details panel was opened from, so a second click on what it shows closes the panel, and the pane draws the outline of what is shown.</summary>
    public string? Last { get; set; }

    /// <summary>The two panes in the order they read: the older flow first.</summary>
    public IReadOnlyList<ComparePane> Panes => [.. _keys.Select(k => _byKey[k])];

    /// <summary>The pane the keys of a flow act on.</summary>
    public ComparePane FocusedPane => _byKey[_keys[Math.Max(0, _keys.ToList().IndexOf(_focusKey ?? _keys[0]))]];

    /// <summary>The canvas of Swap, while the comparison is viewed that way; else null.</summary>
    public SwapStage? Stage => _shownMode == "swap" ? _stage : null;

    /// <summary>What the keys of a flow act on: the pane that has the focus, or in Swap the flow on show.</summary>
    public IFlowKeys Target => Stage is { } stage ? stage : FocusedPane;

    /// <summary>The two panes of a comparison of runs in the order they read: the older run first.</summary>
    public IReadOnlyList<PerfComparePane> RunPanes => [.. _keys.Where(_runPanes.ContainsKey).Select(k => _runPanes[k])];

    /// <summary>The pane of a comparison of runs that the keys of the Performance panel act on.</summary>
    public PerfComparePane FocusedRunPane => _runPanes[_keys[Math.Max(0, _keys.ToList().IndexOf(_focusKey ?? _keys[0]))]];

    /// <summary>The canvas of Swap for two runs, while they are viewed that way; else null.</summary>
    public PerfSwapStage? RunStage => _shownMode == "swap" ? _runStage : null;

    /// <summary>What the keys of the Performance panel act on in a comparison of runs: the pane that has the focus, or in Swap the run on show.</summary>
    public IRunKeys RunTarget => RunStage is { } stage ? stage : FocusedRunPane;

    /// <summary>Fits the view of whatever the keys act on (F): the focused pane, or the canvas of Swap.</summary>
    public void FitFocused()
    {
        if (_shownKind == "run") RunTarget.Fit();
        else Target.Fit();
    }

    /// <summary>The run with this key, for a comparison of runs.</summary>
    public PaneRun? RunOf(string key) => _runs.GetValueOrDefault(key);

    /// <summary>Stops every run's ramp, where it is: the comparison is closed, or another tab is in front of it, and nothing should keep drawing behind.</summary>
    public void StopRamps()
    {
        foreach (var run in _runs.Values) run.Session.StopRamp();
    }

    public bool Stacked => _stacked;

    /// <summary>The key of each pane. A flow compared with itself has two panes, told apart by the second's suffix.</summary>
    internal static IReadOnlyList<string> KeysOf(CompareState state) => [state.A, state.A == state.B ? $"{state.B}#1" : state.B];

    /// <summary>
    /// Shows the comparison. A pane is kept for as long as its flow is in the comparison, so swapping the sides moves the panes instead of making them again: each keeps its place in
    /// its flow and its zoom. <paramref name="start"/> is the stop the first pane starts at (the flow was playing there when the comparison opened).
    /// </summary>
    public void Show(CompareState state, Folder folder, string lineStyle, ReaderView.Side? selection, (string Flow, int Step)? start, bool changes = false, string view = Names.Root)
    {
        var keys = KeysOf(state);
        if (state.Kind == "run")
        {
            ShowRuns(state, keys, folder, lineStyle, selection, view);
            return;
        }
        _shownKind = "flow";
        Bar.Kind = "flow";
        FindChanges(state, folder, changes);
        if (state.Mode == "swap") ShowSwap(state, keys, folder, lineStyle, selection, start);
        else ShowSide(state, keys, folder, lineStyle, selection, start);
        _shownMode = state.Mode;
        Bar.Mode = state.Mode;
        // The key lists only what is drawn: both flows side by side, the one on show in Swap.
        IReadOnlyList<string> sides = Stage is { } stage ? [SideOf(stage.Current.FlowId)] : [SideOf(state.A), SideOf(state.B)];
        Bar.ShowChanges(Diff is not null, null, Diff is null ? null : new CompareKey(Diff, sides));
    }

    /// <summary>
    /// Finds what differs between the two flows, when Show changes is on. The flow that holds the tag (the newer; else the second of the pair) is compared with the other, whichever side the
    /// panes show them on, and each pane draws its own side's marks, so Swap sides keeps them right.
    /// </summary>
    private void FindChanges(CompareState state, Folder folder, bool on)
    {
        var tags = CompareChoices.TagsOf(folder.Model, new Dictionary<string, LoadRun>(), "flow");
        (_older, _newer) = CompareChoices.Order("flow", tags, state.A, state.B);
        if (!on || !folder.Model.Flows.TryGetValue(_older, out var older) || !folder.Model.Flows.TryGetValue(_newer, out var newer))
        {
            Diff = null;
            return;
        }
        if (_diff is not { } kept || !ReferenceEquals(kept.Older, older) || !ReferenceEquals(kept.Newer, newer)) _diff = kept = (older, newer, FlowDiffs.Diff(older, newer));
        Diff = kept.Diff;
    }

    private string SideOf(string flowId) => flowId == _newer ? "newer" : "older";

    /// <summary>The marks the pane (or the flow on show) of this flow draws, or null with Show changes off.</summary>
    internal SideMarks? MarksOf(string flowId) => Diff is null ? null : SideOf(flowId) == "newer" ? Diff.Newer : Diff.Older;

    private void ShowSide(CompareState state, IReadOnlyList<string> keys, Folder folder, string lineStyle, ReaderView.Side? selection, (string Flow, int Step)? start)
    {
        var fromSwap = _shownMode == "swap" && _stage is not null;
        foreach (var stale in _byKey.Keys.Where(k => !keys.Contains(k)).ToList())
        {
            _panes.Children.Remove(_byKey[stale]);
            _byKey.Remove(stale);
        }
        for (var slot = 0; slot < 2; slot++)
        {
            var key = keys[slot];
            if (!_byKey.ContainsKey(key))
            {
                var pane = new ComparePane(slot == 0 ? state.A : state.B, key.Contains('#') ? 1 : 0);
                pane.Start(start is { } from && from.Flow == pane.FlowId && !key.Contains('#') ? from.Step : 0);
                pane.FocusRequested += () => FocusPane(key);
                pane.Picked += side => Picked?.Invoke(key, side);
                pane.EmptyClicked += () => EmptyClicked?.Invoke();
                _byKey[key] = pane;
                _panes.Children.Add(pane);
            }
            // Coming back from Swap, each flow is where it was left there.
            if (fromSwap && _stage!.Keys.Contains(key)) _byKey[key].Start(_stage.Flow(key).StopNow);
        }
        if (fromSwap) _focusKey = _stage!.OnKey; // Side by side opens with the focus on the flow that was on show
        _keys = keys;
        _panes.IsVisible = true;
        _swapHost.IsVisible = false;
        PlacePanes(_stacked);
        for (var slot = 0; slot < 2; slot++)
        {
            var pane = _byKey[keys[slot]];
            pane.Focused = ReferenceEquals(pane, FocusedPane);
            pane.Changes = MarksOf(pane.FlowId);
            pane.Show(folder, lineStyle, Last == keys[slot] ? selection : null);
        }
    }

    private void ShowSwap(CompareState state, IReadOnlyList<string> keys, Folder folder, string lineStyle, ReaderView.Side? selection, (string Flow, int Step)? start)
    {
        // The stage keeps its flows through Swap sides (the same two keys), so each keeps its step; a different pair of flows is a new stage.
        var fresh = _stage is null || !_stage.Keys.Order().SequenceEqual(keys.Order());
        if (fresh)
        {
            _stage = new SwapStage([state.A, state.B], keys);
            _stage.Picked += side => Picked?.Invoke(SwapPick, side);
            _stage.EmptyClicked += () => EmptyClicked?.Invoke();
            _swapHost.Child = _stage;
            for (var slot = 0; slot < 2; slot++)
                _stage.Start(keys[slot], start is { } from && from.Flow == (slot == 0 ? state.A : state.B) && !keys[slot].Contains('#') ? from.Step : 0);
        }
        if (_shownMode != "swap")
        {
            // Opened from Side by side: Swap starts on the flow whose pane has the focus, and each flow keeps the step its pane was at.
            var stage = _stage!;
            var onKey = _byKey.Count > 0 && _keys.Count == 2 ? FocusedPane.Key : keys[0];
            foreach (var key in keys)
                if (_byKey.TryGetValue(key, out var pane) && stage.Keys.Contains(key))
                {
                    pane.Playback.StopAuto();
                    stage.Start(key, pane.StopNow);
                }
            stage.Open(stage.Keys.Contains(onKey) ? onKey : keys[0]);
        }
        _panes.IsVisible = false;
        _swapHost.IsVisible = true;
        foreach (var key in keys) _stage!.Flow(key).Changes = MarksOf(_stage.Flow(key).FlowId); // the marks follow the flow on show
        _stage!.Show(folder, lineStyle, selection);
        var names = keys.Select(k => _stage.Flow(k).Name).ToList();
        if (names[0] == names[1] && keys[1].Contains('#')) names[1] += " (2)"; // a flow against itself: told apart as its panes are
        Bar.ShowFlows(names, Math.Max(0, keys.ToList().IndexOf(_stage.OnKey)));
    }

    // ---- two runs ------------------------------------------------------------------------------------------------

    /// <summary>
    /// Shows a comparison of two runs, in the level the reader is on. A run is kept for as long as it is in the comparison, so swapping the sides, or the way to view, moves the panes
    /// instead of making them again: each run keeps its place along itself, its dial and its zoom. The change marks are for flows only.
    /// </summary>
    private void ShowRuns(CompareState state, IReadOnlyList<string> keys, Folder folder, string lineStyle, ReaderView.Side? selection, string view)
    {
        _shownKind = "run";
        Bar.Kind = "run";
        Diff = null;
        foreach (var stale in _runs.Keys.Where(k => !keys.Contains(k)).ToList())
        {
            _runs.Remove(stale);
            if (_runPanes.Remove(stale, out var gone)) _panes.Children.Remove(gone);
        }
        for (var slot = 0; slot < 2; slot++)
            if (!_runs.ContainsKey(keys[slot])) _runs[keys[slot]] = new PaneRun(this, slot == 0 ? state.A : state.B);
        if (state.Mode == "swap") ShowRunSwap(keys, folder, lineStyle, selection, view);
        else ShowRunSide(keys, folder, lineStyle, selection, view);
        _shownMode = state.Mode;
        Bar.Mode = state.Mode;
        Bar.ShowChanges(false, "Not for runs", null); // two runs are compared by eye: there are no marks to show
    }

    private void ShowRunSide(IReadOnlyList<string> keys, Folder folder, string lineStyle, ReaderView.Side? selection, string view)
    {
        var fromSwap = _shownMode == "swap" && _runStage is not null;
        for (var slot = 0; slot < 2; slot++)
        {
            var key = keys[slot];
            if (_runPanes.ContainsKey(key)) continue;
            var pane = new PerfComparePane(_runs[key], key.Contains('#') ? 1 : 0);
            pane.FocusRequested += () => FocusPane(key);
            pane.Picked += side => Picked?.Invoke(key, side);
            pane.EmptyClicked += () => EmptyClicked?.Invoke();
            pane.Used += () => ControlUsed?.Invoke();
            _runPanes[key] = pane;
            _panes.Children.Add(pane);
        }
        if (fromSwap)
        {
            _runStage!.Settle();
            _focusKey = _runStage.OnKey; // Side by side opens with the focus on the run that was on show
        }
        _keys = keys;
        _panes.IsVisible = true;
        _swapHost.IsVisible = false;
        PlacePanes(_stacked);
        // Both panes draw the shape or line the Details panel shows: it is the same shape in both, and each panel reads it out for its own run.
        for (var slot = 0; slot < 2; slot++)
        {
            var pane = _runPanes[keys[slot]];
            pane.Focused = ReferenceEquals(pane, FocusedRunPane);
            pane.Show(folder, lineStyle, view, selection);
        }
    }

    private void ShowRunSwap(IReadOnlyList<string> keys, Folder folder, string lineStyle, ReaderView.Side? selection, string view)
    {
        // The stage keeps its runs through Swap sides (the same two keys), so each keeps its place along itself; a different pair of runs is a new stage.
        if (_runStage is null || !_runStage.Keys.Order().SequenceEqual(keys.Order()))
        {
            _runStage = new PerfSwapStage([.. keys.Select(k => _runs[k])], keys);
            _runStage.Picked += side => Picked?.Invoke(SwapPick, side);
            _runStage.EmptyClicked += () => EmptyClicked?.Invoke();
            _runStage.Used += () => ControlUsed?.Invoke();
            _swapHost.Child = _runStage;
        }
        var stage = _runStage;
        if (_shownMode != "swap")
        {
            // Opened from Side by side: Swap starts on the run whose pane has the focus.
            var onKey = _runPanes.Count > 0 && _keys.Count == 2 ? FocusedRunPane.Key : keys[0];
            stage.Open(stage.Keys.Contains(onKey) ? onKey : keys[0]);
            foreach (var key in keys)
                if (key != stage.OnKey) stage.Run(key).Session.StopRamp(); // the run that is not on show stops where it is
        }
        _keys = keys;
        _panes.IsVisible = false;
        _swapHost.IsVisible = true;
        stage.Show(folder, lineStyle, view, selection);
        var names = keys.Select(k => stage.Run(k).Name).ToList();
        if (names[0] == names[1] && keys[1].Contains('#')) names[1] += " (2)"; // a run against itself: told apart as its panes are
        Bar.ShowFlows(names, Math.Max(0, keys.ToList().IndexOf(stage.OnKey)));
    }

    // ---- focus and layout ---------------------------------------------------------------------------------------

    /// <summary>The control of the pane with this key, flow or run.</summary>
    private Control? PaneOf(string key) => _shownKind == "run" ? _runPanes.GetValueOrDefault(key) : _byKey.GetValueOrDefault(key);

    /// <summary>Gives a pane the focus: it is outlined and the keys of a flow (or, for runs, of the Performance panel) act on it.</summary>
    public void FocusPane(string key)
    {
        if (_shownKind == "run")
        {
            if (!_runPanes.ContainsKey(key)) return;
            _focusKey = key;
            foreach (var (k, pane) in _runPanes) pane.Focused = k == FocusedRunPane.Key;
            return;
        }
        if (!_byKey.ContainsKey(key)) return;
        _focusKey = key;
        foreach (var (k, pane) in _byKey) pane.Focused = k == FocusedPane.Key;
    }

    /// <summary>Puts the panes side by side, or one above the other when the container is narrow.</summary>
    private void PlacePanes(bool stacked)
    {
        _stacked = stacked;
        _panes.RowSpacing = _panes.ColumnSpacing = Gap;
        if (_stacked)
        {
            _panes.ColumnDefinitions = [new ColumnDefinition(GridLength.Star)];
            _panes.RowDefinitions = [new RowDefinition(GridLength.Star), new RowDefinition(GridLength.Star)];
        }
        else
        {
            _panes.ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Star)];
            _panes.RowDefinitions = [new RowDefinition(GridLength.Star)];
        }
        for (var slot = 0; slot < _keys.Count; slot++)
        {
            if (PaneOf(_keys[slot]) is not { } pane) continue;
            SetColumn(pane, _stacked ? 0 : slot);
            SetRow(pane, _stacked ? slot : 0);
        }
    }

    /// <summary>
    /// The panes stack when the room they are offered is narrow. It is decided before they are measured, so a pane never has a size in the wrong arrangement first (it fits its flow once,
    /// when it first has a size, and would keep that zoom).
    /// </summary>
    protected override Size MeasureOverride(Size availableSize)
    {
        if (_keys.Count == 2 && !double.IsInfinity(availableSize.Width) && (availableSize.Width < StackBelow) != _stacked) PlacePanes(availableSize.Width < StackBelow);
        return base.MeasureOverride(availableSize);
    }
}
