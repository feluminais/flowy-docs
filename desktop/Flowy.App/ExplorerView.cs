using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Templates;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The whole documentation as a tree: a summary line, a filter, and the rows (see <see cref="Outlines"/>), drawn a window at a time by the list
/// so a model of thousands of shapes stays smooth. It keeps the row you are on in view as you move on the canvas, but not while you are using
/// the tree. The list's own selection is the row the keyboard is on.
/// </summary>
internal sealed class ExplorerView : Grid
{
    private const double RowHeight = 30;

    private readonly TextBlock _summary = new() { FontSize = 12, Classes = { "muted" }, Margin = new Thickness(2, 0, FlowsView.Inset + 2, 0) };
    private readonly TextBox _find = new() { PlaceholderText = "Filter the tree", Classes = { "bare" } };
    private readonly ListBox _list = new() { Classes = { "treelist" }, SelectionMode = SelectionMode.Single };
    private readonly TextBlock _note = new() { Margin = new Thickness(6, 8, FlowsView.Inset + 6, 8), FontSize = 13, TextWrapping = TextWrapping.Wrap, Classes = { "muted" }, IsVisible = false };
    private IReadOnlyList<OutlineRow> _rows = [];
    private Model? _model;
    private string _current = "";
    private string? _focus;
    private bool _using; // the pointer is over the tree, or a key was just pressed in it
    private bool _settingSelection;
    private readonly Border _foot = FlowsView.LinkedKey();
    private string? _compareOff;

    /// <summary>The Compare button on a flow's row was pressed (never while a mode blocks it).</summary>
    public event Action<string>? CompareRequested;

    /// <summary>A click on a row, and Enter or a double-click on one.</summary>
    public event Action<OutlineRow>? Picked;

    public event Action<OutlineRow>? Opened;

    public event Action<string, bool>? Toggled;

    public ExplorerView()
    {
        RowDefinitions = [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Star), new RowDefinition(GridLength.Auto)];
        RowSpacing = 8;
        Margin = new Thickness(12, 12, 0, 12); // no margin on the right: the tree's scroll bar sits on the panel's edge, where the sash is
        var field = FlowsView.Field(_find, Icons.Search);
        field.Margin = new Thickness(0, 0, FlowsView.Inset, 0);
        SetRow(field, 1);
        SetRow(_note, 2);
        SetRow(_list, 3);
        SetRow(_foot, 4);
        _foot.IsVisible = false;
        Children.Add(_summary);
        Children.Add(field);
        Children.Add(_note);
        Children.Add(_list);
        Children.Add(_foot);

        _list.ItemTemplate = new FuncDataTemplate<OutlineRow>((row, _) => row is null ? null : BuildRow(row));
        _list.SelectionChanged += (_, _) =>
        {
            if (_settingSelection) return;
            _focus = (_list.SelectedItem as OutlineRow)?.Key;
        };
        _list.ContainerPrepared += (_, e) => e.Container.Classes.Set("canvas", _rows[e.Index].Key == _current); // the keyboard ring skips the row the canvas shows
        _list.AddHandler(KeyDownEvent, OnListKey, RoutingStrategies.Tunnel);
        _list.PointerEntered += (_, _) => _using = true;
        _list.PointerExited += (_, _) => _using = false;
        _list.LostFocus += (_, _) => _using = false;
        _find.TextChanged += (_, _) => Refill();
        _find.KeyDown += (_, e) =>
        {
            if (e.Key == Key.Escape && !string.IsNullOrEmpty(_find.Text))
            {
                _find.Text = "";
                e.Handled = true;
            }
            else if (e.Key == Key.Down && _rows.Count > 0)
            {
                _list.SelectedIndex = 0;
                _list.Focus();
                e.Handled = true;
            }
        };
        AutomationProperties.SetName(_list, "Documentation");
    }

    // What a test can look at.
    internal IReadOnlyList<OutlineRow> Rows => _rows;

    internal string? FocusKey => _focus;

    /// <summary>The rows the keyboard ring leaves alone because the canvas already shows them.</summary>
    internal IEnumerable<string> CanvasKeys => _list.GetRealizedContainers().Where(c => c.Classes.Contains("canvas")).Select(c => ((OutlineRow)c.DataContext!).Key);

    internal string SummaryText => _summary.Text ?? "";

    /// <summary>Why the Compare buttons on the flow rows are greyed out (their tooltip), or null when they are not.</summary>
    internal string? CompareOff => _compareOff;

    /// <summary>Whether the foot with the Compare pair key shows: a flow in a pair is among the rows.</summary>
    internal bool LinkedKeyShown => _foot.IsVisible;

    /// <summary>The Compare button of a flow's row, if the row is on screen (the list draws a window of the rows).</summary>
    internal Button? CompareButtonOf(string flow) =>
        _list.GetRealizedContainers().SelectMany(c => c.GetVisualDescendants().OfType<Button>())
            .FirstOrDefault(b => b.Classes.Contains("rowcompare") && AutomationProperties.GetName(b) == $"Compare {_rows.FirstOrDefault(r => r.Key == $"flow:{flow}")?.Name}");

    internal string Filter
    {
        get => _find.Text ?? "";
        set
        {
            _find.Text = value;
            Refill();
        }
    }

    internal void Pick(string key) => Picked?.Invoke(_rows.First(r => r.Key == key));

    internal void Open(string key) => Opened?.Invoke(_rows.First(r => r.Key == key));

    /// <summary>Presses a key in the tree, named as in the browser: ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End or Enter.</summary>
    internal void Press(string key)
    {
        _using = true;
        var result = Outlines.Key(_rows, _focus, key);
        if (result.Focus is { } focus) SetFocus(focus);
        if (result.Toggle is { } toggle) Toggled?.Invoke(toggle.Id, toggle.Expand);
        if (result.Open is { } open) Opened?.Invoke(open);
    }

    /// <summary>Redraws the tree for the model as it is now. <paramref name="here"/> is the level the canvas shows, <paramref name="selected"/> the shape selected on it, <paramref name="playing"/> the flow playing.</summary>
    public void Update(Model model, IReadOnlyList<Problem> problems, bool editing, IReadOnlySet<string> expanded, string here, string? selected, string? playing)
    {
        _model = model;
        var current = playing is not null ? $"flow:{playing}" : $"shape:{selected ?? here}";
        var outline = Outlines.Build(model, problems, expanded, _find.Text, editing);
        _summary.Text = $"{Plural(outline.Totals.Shapes, "shape")} · {Plural(outline.Totals.Flows, "flow")}{(outline.Totals.Problems > 0 ? $" · {Plural(outline.Totals.Problems, "problem")}" : "")}";
        var off = CompareChoices.Off(model, editing); // the buttons of the rows are drawn with it, so a row that did not change is drawn again when it does
        var changed = current != _current || off != _compareOff || !outline.Rows.SequenceEqual(_rows);
        _compareOff = off;
        _current = current;
        _rows = outline.Rows;
        _filterNote = (_find.Text ?? "").Trim();
        _problems = problems;
        _editing = editing;
        _expanded = expanded;
        if (changed) Fill();
        if (!_using && string.IsNullOrWhiteSpace(_find.Text)) ScrollTo(current);
    }

    private IReadOnlyList<Problem> _problems = [];
    private bool _editing;
    private IReadOnlySet<string> _expanded = new HashSet<string>();
    private string _filterNote = "";

    /// <summary>The filter changed: the rows are asked for again with the same state as the last update.</summary>
    private void Refill()
    {
        if (_model is null) return;
        var outline = Outlines.Build(_model, _problems, _expanded, _find.Text, _editing);
        _rows = outline.Rows;
        _filterNote = (_find.Text ?? "").Trim();
        Fill();
    }

    private static string Plural(int n, string word) => $"{n} {word}{(n == 1 ? "" : "s")}";

    /// <summary>Puts the rows in the list, keeping where it was scrolled to and which row the keyboard is on.</summary>
    private void Fill()
    {
        var scroll = _list.FindDescendantOfType<ScrollViewer>();
        var offset = scroll?.Offset ?? default;
        _settingSelection = true;
        _list.ItemsSource = _rows;
        _list.UpdateLayout();
        if (scroll is not null) scroll.Offset = offset;
        _list.SelectedIndex = _focus is null ? -1 : IndexOf(_focus);
        _settingSelection = false;
        _foot.IsVisible = _rows.Any(r => r.Linked == true); // only while a flow in a pair is among the rows
        _note.IsVisible = _rows.Count == 0;
        _note.Text = _filterNote == "" ? "Nothing here yet." : $"Nothing matches “{_filterNote}”.";
    }

    private int IndexOf(string key)
    {
        for (var i = 0; i < _rows.Count; i++)
            if (_rows[i].Key == key) return i;
        return -1;
    }

    private void ScrollTo(string key)
    {
        if (IndexOf(key) is var at and >= 0) _list.ScrollIntoView(at);
    }

    private void SetFocus(string key)
    {
        _focus = key;
        _settingSelection = true;
        _list.SelectedIndex = IndexOf(key);
        _settingSelection = false;
        ScrollTo(key);
    }

    private static readonly Dictionary<Key, string> Keys = new()
    {
        [Key.Up] = "ArrowUp", [Key.Down] = "ArrowDown", [Key.Left] = "ArrowLeft", [Key.Right] = "ArrowRight", [Key.Home] = "Home", [Key.End] = "End", [Key.Enter] = "Enter",
    };

    private void OnListKey(object? sender, KeyEventArgs e)
    {
        if (e.KeyModifiers is not (KeyModifiers.None or KeyModifiers.Shift)) return;
        if (e.Key == Key.Enter && e.Source is Button) return; // a Compare button on a row takes its own Enter
        if (Keys.TryGetValue(e.Key, out var key))
        {
            Press(key);
            e.Handled = true; // the canvas's own keys (E, the arrows of a flow) are not meant for the tree
        }
        else if (!string.IsNullOrEmpty(e.KeySymbol) && e.KeySymbol != " ")
        {
            _find.Focus(); // the letter then lands in the filter
        }
    }

    /// <summary>Whether a control is in the tree, so ReaderView leaves its keys to it.</summary>
    internal bool Holds(object? source) => source is Visual v && (ReferenceEquals(v, _list) || v.GetVisualAncestors().Contains(_list));

    private Control BuildRow(OutlineRow row)
    {
        var model = _model!;
        var chevron = Icons.Make(Icons.ChevronRight, "twisticon", 14);
        chevron.RenderTransform = new RotateTransform(row.Expanded ? 90 : 0);
        chevron.HorizontalAlignment = HorizontalAlignment.Center;
        chevron.VerticalAlignment = VerticalAlignment.Center;
        var twist = new Border { Width = 20, Height = 20, Child = row.Expandable ? chevron : null, VerticalAlignment = VerticalAlignment.Center };
        twist.Classes.Add("twist");
        twist.PointerPressed += (_, e) =>
        {
            if (!row.Expandable) return;
            Toggled?.Invoke(row.Id, !row.Expanded);
            e.Handled = true;
        };
        Control icon;
        if (row.Kind == "flow") icon = Icons.Make(Icons.Route, "navicon", 16);
        else if (row.Id == Names.Root) icon = Icons.Make(Icons.Home, "navicon", 16);
        else icon = Chrome.ObjectTile(model, model.GetObject(row.Id), 18);
        icon.VerticalAlignment = VerticalAlignment.Center;
        var name = new TextBlock { Text = row.Name, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
        name.Classes.Add("treename");
        name.Classes.Set("sel", row.Key == _current);
        name.Classes.Set("dim", !row.Match);
        var dot = new Border { Width = 7, Height = 7, CornerRadius = new CornerRadius(4), IsVisible = row.Problem, VerticalAlignment = VerticalAlignment.Center };
        dot.Classes.Add("treedot");
        ToolTip.SetTip(dot, "A problem in here");
        var counts = row.Kind == "flow"
            ? Plural(row.Steps ?? 0, "step")
            : Outlines.RowCount(row);
        var count = new TextBlock { Text = counts, FontSize = 12, VerticalAlignment = VerticalAlignment.Center, Classes = { "treecount" } };
        if (Outlines.RowCountWords(row) is { Length: > 0 } countWords) ToolTip.SetTip(count, countWords); // "7 inside, 13 in all, 12 flows"
        var mark = FlowsView.LinkedMark(row.Partners ?? []);
        mark.IsVisible = row.Linked == true;
        var grid = new Grid
        {
            ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Auto)],
            ColumnSpacing = 6, Height = RowHeight, Children = { twist, icon, name, mark, dot, count },
        };
        SetColumn(icon, 1);
        SetColumn(name, 2);
        SetColumn(mark, 3);
        SetColumn(dot, 4);
        SetColumn(count, 5);
        if (row.Kind == "flow")
        {
            // A button of its own beside the count: the row's click still plays the flow, and a press here never reaches it.
            var compare = FlowsView.CompareButton(row.Id, row.Name, _compareOff, id => CompareRequested?.Invoke(id));
            grid.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Auto));
            SetColumn(compare, 6);
            grid.Children.Add(compare);
        }
        var border = new Border { Child = grid, Padding = new Thickness(6 + row.Depth * 16, 0, 8, 0), CornerRadius = new CornerRadius(6) };
        border.Classes.Add("treerow");
        border.Classes.Set("sel", row.Key == _current);
        AutomationProperties.SetName(border, Outlines.RowCountWords(row) is { Length: > 0 } words ? $"{row.Name}, {words}" : row.Name);
        border.PointerPressed += (_, e) =>
        {
            if (!e.GetCurrentPoint(border).Properties.IsLeftButtonPressed) return;
            _focus = row.Key;
            Picked?.Invoke(row);
        };
        border.DoubleTapped += (_, _) => Opened?.Invoke(row);
        return border;
    }
}
