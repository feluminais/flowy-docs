using Avalonia;
using Avalonia.Controls;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// Two flows, under the bar of the comparison: side by side, each in a pane of its own, or in Swap, on one canvas that flips between them (see <see cref="SwapStage"/>). Every pane works
/// alone (zoom, pan and play); they share the one Details panel, which shows the last thing clicked in either. One pane has the focus (it is outlined): the first to start with, then the
/// one last clicked. The keys of a flow act on it, or in Swap on the flow on show. Changing the way to view carries each flow's step over.
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
    private IReadOnlyList<string> _keys = [];
    private string? _focusKey; // the first pane has the focus until one is clicked
    private bool _stacked;
    private SwapStage? _stage;
    private string? _shownMode;

    /// <summary>A box or a line was clicked in the pane with this key (in Swap, <see cref="SwapPick"/>).</summary>
    public event Action<string, ReaderView.Side>? Picked;

    /// <summary>The empty area of a pane was clicked.</summary>
    public event Action? EmptyClicked;

    public CompareView()
    {
        RowDefinitions = [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Star)];
        Bar = new CompareBar();
        SetRow(Bar, 0);
        SetRow(_panes, 1);
        SetRow(_swapHost, 1);
        Children.Add(Bar);
        Children.Add(_panes);
        Children.Add(_swapHost);
        Classes.Add("compare");
    }

    public CompareBar Bar { get; }

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

    public bool Stacked => _stacked;

    /// <summary>The key of each pane. A flow compared with itself has two panes, told apart by the second's suffix.</summary>
    internal static IReadOnlyList<string> KeysOf(CompareState state) => [state.A, state.A == state.B ? $"{state.B}#1" : state.B];

    /// <summary>
    /// Shows the comparison. A pane is kept for as long as its flow is in the comparison, so swapping the sides moves the panes instead of making them again: each keeps its place in
    /// its flow and its zoom. <paramref name="start"/> is the stop the first pane starts at (the flow was playing there when the comparison opened).
    /// </summary>
    public void Show(CompareState state, Folder folder, string lineStyle, ReaderView.Side? selection, (string Flow, int Step)? start)
    {
        var keys = KeysOf(state);
        if (state.Mode == "swap") ShowSwap(state, keys, folder, lineStyle, selection, start);
        else ShowSide(state, keys, folder, lineStyle, selection, start);
        _shownMode = state.Mode;
        Bar.Mode = state.Mode;
    }

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
        _stage!.Show(folder, lineStyle, selection);
        var names = keys.Select(k => _stage.Flow(k).Name).ToList();
        if (names[0] == names[1] && keys[1].Contains('#')) names[1] += " (2)"; // a flow against itself: told apart as its panes are
        Bar.ShowFlows(names, Math.Max(0, keys.ToList().IndexOf(_stage.OnKey)));
    }

    /// <summary>Gives a pane the focus: it is outlined and the keys of a flow act on it.</summary>
    public void FocusPane(string key)
    {
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
            SetColumn(_byKey[_keys[slot]], _stacked ? 0 : slot);
            SetRow(_byKey[_keys[slot]], _stacked ? slot : 0);
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
