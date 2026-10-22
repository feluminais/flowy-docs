using Avalonia;
using Avalonia.Controls;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// Two flows side by side, each in a pane of its own, under the bar of the comparison. Every pane works alone (zoom, pan and play); they share the one Details panel, which shows the
/// last thing clicked in either. One pane has the focus (it is outlined): the first to start with, then the one last clicked. The keys of a flow act on it.
/// </summary>
internal sealed class CompareView : Grid
{
    /// <summary>The container is narrower than this: the panes stack, one above the other.</summary>
    internal const double StackBelow = 900;

    private const double Gap = 12;

    private readonly Grid _panes = new() { Margin = new Thickness(Gap) };
    private readonly Dictionary<string, ComparePane> _byKey = [];
    private IReadOnlyList<string> _keys = [];
    private string? _focusKey; // the first pane has the focus until one is clicked
    private bool _stacked;

    /// <summary>A box or a line was clicked in the pane with this key.</summary>
    public event Action<string, ReaderView.Side>? Picked;

    /// <summary>The empty area of a pane was clicked.</summary>
    public event Action? EmptyClicked;

    public CompareView()
    {
        RowDefinitions = [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Star)];
        Bar = new CompareBar();
        SetRow(Bar, 0);
        SetRow(_panes, 1);
        Children.Add(Bar);
        Children.Add(_panes);
        Classes.Add("compare");
    }

    public CompareBar Bar { get; }

    /// <summary>The pane the Details panel was opened from, so a second click on what it shows closes the panel, and the pane draws the outline of what is shown.</summary>
    public string? Last { get; set; }

    /// <summary>The two panes in the order they read: the older flow first.</summary>
    public IReadOnlyList<ComparePane> Panes => [.. _keys.Select(k => _byKey[k])];

    /// <summary>The pane the keys of a flow act on.</summary>
    public ComparePane FocusedPane => _byKey[_keys[Math.Max(0, _keys.ToList().IndexOf(_focusKey ?? _keys[0]))]];

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
        foreach (var stale in _byKey.Keys.Where(k => !keys.Contains(k)).ToList())
        {
            _panes.Children.Remove(_byKey[stale]);
            _byKey.Remove(stale);
        }
        for (var slot = 0; slot < 2; slot++)
        {
            var key = keys[slot];
            if (_byKey.ContainsKey(key)) continue;
            var pane = new ComparePane(slot == 0 ? state.A : state.B, key.Contains('#') ? 1 : 0);
            pane.Start(start is { } from && from.Flow == pane.FlowId && !key.Contains('#') ? from.Step : 0);
            pane.FocusRequested += () => FocusPane(key);
            pane.Picked += side => Picked?.Invoke(key, side);
            pane.EmptyClicked += () => EmptyClicked?.Invoke();
            _byKey[key] = pane;
            _panes.Children.Add(pane);
        }
        _keys = keys;
        Bar.Mode = state.Mode;
        PlacePanes(_stacked);
        for (var slot = 0; slot < 2; slot++)
        {
            var pane = _byKey[keys[slot]];
            pane.Focused = ReferenceEquals(pane, FocusedPane);
            pane.Show(folder, lineStyle, Last == keys[slot] ? selection : null);
        }
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
