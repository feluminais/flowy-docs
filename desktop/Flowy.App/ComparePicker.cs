using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The flyout over the player's Compare button: the flows the playing one is linked to first (a link icon and the word Linked; one a tag names that is not there is greyed out as
/// Missing), then a field to find any other. A flow that can't play is greyed out too. Picking one calls <c>pick</c>; ↑ and ↓ move, Enter picks, Esc closes.
/// The Performance panel's Compare and Link with use it too, over the runs (<c>kind</c> run): a run only needs to be there.
/// </summary>
internal sealed class ComparePicker : Border
{
    private readonly Model _model;
    private readonly string _kind;
    private readonly IReadOnlyDictionary<string, LoadRun> _runs;
    private readonly Action<string> _pick;
    private readonly Action _close;
    private readonly IReadOnlyList<CompareChoice> _linked;
    private readonly IReadOnlyList<CompareChoice> _others;
    private readonly TextBox _input;
    private readonly StackPanel _linkedRows = new();
    private readonly StackPanel _otherRows = new();
    private readonly TextBlock _nothing = new() { Text = "Nothing called that", Classes = { "muted" }, Margin = new Thickness(8, 4), IsVisible = false };
    private List<CompareChoice> _rows = []; // the choices on show, linked first
    private int _at = -1; // the one the arrow keys are on, or -1

    /// <param name="kind"><c>flow</c> (the player's Compare) or <c>run</c> (the Performance panel's Compare and Link with; <paramref name="runs"/> are the runs to pick from).</param>
    /// <param name="label">What the flyout is called, for a screen reader: <c>Compare with</c> or <c>Link with</c>.</param>
    public ComparePicker(Model model, string id, Action<string> pick, Action close, string kind = "flow", IReadOnlyDictionary<string, LoadRun>? runs = null, string label = "Compare with")
    {
        (_model, _kind, _runs, _pick, _close) = (model, kind, runs ?? new Dictionary<string, LoadRun>(), pick, close);
        (_linked, _others) = CompareChoices.For(model, _runs, kind, id);
        _input = new TextBox { PlaceholderText = $"Find a {kind}", Classes = { "bare" } };
        Classes.Add("card");
        Classes.Add("comparepicker");
        Padding = new Thickness(6);
        HorizontalAlignment = HorizontalAlignment.Stretch;
        AutomationProperties.SetName(this, label);

        var glass = Icons.Make(Icons.Search, "rowicon", 16);
        glass.VerticalAlignment = VerticalAlignment.Center;
        glass.Margin = new Thickness(8, 0, 4, 0);
        var field = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], Children = { glass, _input } };
        Grid.SetColumn(_input, 1);
        AutomationProperties.SetName(_input, $"Find a {kind}");
        var column = new StackPanel { Children = { _linkedRows } };
        if (_linked.Count > 0) column.Children.Add(new Border { Height = 1, Margin = new Thickness(0, 4), Classes = { "hairline" } });
        column.Children.Add(field);
        column.Children.Add(new ScrollViewer { Content = new StackPanel { Children = { _otherRows, _nothing } }, MaxHeight = 220, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled });
        Child = column;

        _input.TextChanged += (_, _) => Rebuild(true);
        _input.KeyDown += OnKey;
        Rebuild(false);
        // Once it is on screen: a control can't take the focus before it has been laid out.
        AttachedToVisualTree += (_, _) => Dispatcher.UIThread.Post(() => _input.Focus(), DispatcherPriority.Loaded);
    }

    /// <summary>The choices on show, linked first: for the tests.</summary>
    internal IReadOnlyList<CompareChoice> Rows => _rows;

    internal TextBox Field => _input;

    private bool Can(CompareChoice c) => !c.Missing && (_kind == "run" ? CompareChoices.Openable(_runs, c.Id) : CompareChoices.Playable(_model, c.Id));

    private void Rebuild(bool typed)
    {
        var query = (_input.Text ?? "").Trim().ToLowerInvariant();
        var found = query == "" ? _others : _others.Where(c => c.Name.ToLowerInvariant().Contains(query) || c.Id.Contains(query, StringComparison.Ordinal)).ToList();
        _rows = [.. _linked, .. found];
        _at = typed || _at >= _rows.Count ? _rows.FindIndex(Can) : _at;
        _linkedRows.Children.Clear();
        _otherRows.Children.Clear();
        for (var i = 0; i < _rows.Count; i++)
            (i < _linked.Count ? _linkedRows : _otherRows).Children.Add(Row(_rows[i], i, i < _linked.Count));
        _nothing.IsVisible = query != "" && found.Count == 0;
    }

    private Button Row(CompareChoice c, int index, bool linked)
    {
        var off = c.Missing ? "Missing" : !Can(c) ? "Can't play yet" : null;
        var end = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, VerticalAlignment = VerticalAlignment.Center };
        if (c.Missing) end.Children.Add(new TextBlock { Text = "Missing", FontSize = 12, Classes = { "muted" } });
        else if (_kind == "flow" && _model.Flows.TryGetValue(c.Id, out var flow) && Views.IsView(_model, flow.View))
            end.Children.Add(new TextBlock { Text = Views.NameOf(_model, flow.View!), FontSize = 12, Classes = { "muted" } });
        if (linked) end.Children.Add(Chrome.Chip("Compare pair", Icons.Link, "accent"));
        var name = new TextBlock { Text = c.Name, FontWeight = FontWeight.SemiBold, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
        var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 12, Children = { name, end } };
        Grid.SetColumn(end, 1);
        // Not focusable, so a click doesn't take the focus from the field.
        var button = new Button { Content = grid, Focusable = false, IsEnabled = off is null };
        button.Classes.Add("result");
        if (index == _at) button.Classes.Add("at");
        AutomationProperties.SetName(button, c.Name);
        if (off is not null && !c.Missing)
        {
            ToolTip.SetTip(button, off);
            ToolTip.SetShowOnDisabled(button, true);
        }
        button.Click += (_, _) => _pick(c.Id);
        return button;
    }

    private void OnKey(object? sender, KeyEventArgs e)
    {
        switch (e.Key)
        {
            case Key.Down:
            case Key.Up:
                Move(e.Key == Key.Down ? 1 : -1);
                break;
            case Key.Enter when _at >= 0 && _at < _rows.Count && Can(_rows[_at]):
                _pick(_rows[_at].Id);
                break;
            case Key.Escape:
                _close();
                break;
            default:
                return;
        }
        e.Handled = true;
    }

    /// <summary>The arrow keys step over the rows that are greyed out.</summary>
    private void Move(int by)
    {
        for (var next = _at + by; next >= 0 && next < _rows.Count; next += by)
        {
            if (!Can(_rows[next])) continue;
            _at = next;
            Rebuild(false);
            break;
        }
    }
}
