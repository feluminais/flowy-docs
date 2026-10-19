using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// Every flow in the documentation: first those that play in the level you are in, then all the others under the level they play in.
/// Picking one goes to its level and plays it (or, while editing, opens it for editing).
/// </summary>
internal sealed class FlowsView : Grid
{
    private readonly TextBox _find = new() { PlaceholderText = "Find a flow", Classes = { "bare" } };
    private readonly StackPanel _list = new() { Spacing = 0 };
    private readonly HashSet<string> _closed = [];
    private Model? _model;
    private string _view = Names.Root;
    private bool _editing;
    private string? _current;

    public event Action<FlowRef>? Opened;

    /// <summary>The flows on the list now, in the order they are drawn. What a test can look at.</summary>
    internal IReadOnlyList<FlowRef> Listed { get; private set; } = [];

    internal string Filter
    {
        get => _find.Text ?? "";
        set => _find.Text = value;
    }

    /// <summary>Picks a flow as a click on its row does.</summary>
    internal void Open(string id)
    {
        if (Listed.FirstOrDefault(f => f.Id == id) is { } flow) Opened?.Invoke(flow);
    }

    public FlowsView()
    {
        RowDefinitions = [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Star)];
        RowSpacing = 8;
        Margin = new Thickness(12);
        var field = Field(_find, Icons.Search);
        _find.TextChanged += (_, _) => Rebuild();
        var scroll = new ScrollViewer { Content = _list, VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto };
        SetRow(scroll, 1);
        Children.Add(field);
        Children.Add(scroll);
    }

    /// <summary>A bordered field with a magnifier before it, for the filter of each tab.</summary>
    internal static Border Field(TextBox box, string icon)
    {
        var glyph = Icons.Make(icon, "navicon", 15);
        glyph.VerticalAlignment = VerticalAlignment.Center;
        var row = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 6, Children = { glyph, box } };
        SetColumn(box, 1);
        AutomationProperties.SetName(box, box.PlaceholderText);
        var field = new Border { Child = row, Height = 32, Padding = new Thickness(10, 0, 4, 0) };
        field.Classes.Add("navfind");
        return field;
    }

    public void Update(Model model, string view, bool editing, string? current)
    {
        _model = model;
        _view = view;
        _editing = editing;
        _current = current;
        Rebuild();
    }

    private static TextBlock Muted(string text, double size = 12) => new() { Text = text, FontSize = size, Classes = { "muted" }, VerticalAlignment = VerticalAlignment.Center };

    private static string Plural(int n, string word) => $"{n} {word}{(n == 1 ? "" : "s")}";

    private Control Heading(string text, int count)
    {
        var title = new TextBlock { Text = text.ToUpperInvariant(), FontSize = 11, FontWeight = FontWeight.SemiBold, Classes = { "muted" } };
        var row = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], Margin = new Thickness(4, 12, 4, 4), Children = { title } };
        var number = Muted(count.ToString(), 11);
        SetColumn(number, 1);
        row.Children.Add(number);
        return row;
    }

    private Control Row(FlowRef f)
    {
        var icon = Icons.Make(_editing ? Icons.Pencil : Icons.Play, "btnicon", 15);
        icon.VerticalAlignment = VerticalAlignment.Center;
        var name = new TextBlock { Text = f.Name, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
        var steps = Muted(f.Steps == 0 ? "no steps yet" : Plural(f.Steps, "step"));
        var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 8, Children = { icon, name, steps } };
        SetColumn(name, 1);
        SetColumn(steps, 2);
        var button = new Button { Content = grid, MinHeight = 32 };
        button.Classes.Add("flowrow");
        button.Classes.Set("current", f.Id == _current);
        AutomationProperties.SetName(button, f.Name);
        button.Click += (_, _) => Opened?.Invoke(f);
        return button;
    }

    private void Rebuild()
    {
        if (_model is null) return;
        var groups = Outlines.Groups(_model, _view, _editing);
        var needle = (_find.Text ?? "").Trim().ToLowerInvariant();
        bool Keep(FlowRef f) => needle == "" || f.Name.ToLowerInvariant().Contains(needle, StringComparison.Ordinal) || f.Id.Contains(needle, StringComparison.Ordinal);
        var here = groups.Here.Where(Keep).ToList();
        var elsewhere = groups.Elsewhere.Select(g => (Group: g, Flows: g.Flows.Where(Keep).ToList())).Where(g => g.Flows.Count > 0).ToList();
        var other = groups.Total - groups.Here.Count;
        var shown = new List<FlowRef>();

        _list.Children.Clear();
        var where = Views.NameOf(_model, _view);
        _list.Children.Add(Heading($"In {where}", groups.Here.Count));
        foreach (var f in here)
        {
            _list.Children.Add(Row(f));
            shown.Add(f);
        }
        if (groups.Here.Count == 0) _list.Children.Add(Note($"No flows in {where}.{(other > 0 ? $" {other} elsewhere." : "")}"));
        else if (here.Count == 0) _list.Children.Add(Note("Nothing here matches."));
        if (groups.Elsewhere.Count > 0) _list.Children.Add(Heading("Everywhere else", other));
        foreach (var (group, flows) in elsewhere)
        {
            var open = needle != "" || !_closed.Contains(group.View);
            _list.Children.Add(GroupHead(group, flows.Count, open));
            if (!open) continue;
            foreach (var f in flows)
            {
                var row = Row(f);
                row.Margin = new Thickness(16, 0, 0, 0);
                _list.Children.Add(row);
                shown.Add(f);
            }
        }
        if (needle != "" && here.Count == 0 && elsewhere.Count == 0) _list.Children.Add(Note($"No flow matches “{needle}”."));
        if (groups.Total == 0) _list.Children.Add(Note("No flows yet. New flow in the bar starts one."));
        Listed = shown;
    }

    private static Control Note(string text) => new TextBlock { Text = text, FontSize = 13, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(6, 8), Classes = { "muted" } };

    private Control GroupHead(FlowGroup group, int count, bool open)
    {
        var chevron = Icons.Make(Icons.ChevronRight, "navicon", 14);
        chevron.RenderTransform = new RotateTransform(open ? 90 : 0);
        chevron.VerticalAlignment = VerticalAlignment.Center;
        var name = new TextBlock { Text = group.Path.Count > 0 ? string.Join(" › ", group.Path) : group.Name, FontWeight = FontWeight.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, Classes = { "muted" } };
        var number = Muted(count.ToString(), 12);
        var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 8, Children = { chevron, name, number } };
        SetColumn(name, 1);
        SetColumn(number, 2);
        var button = new Button { Content = grid, MinHeight = 32 };
        button.Classes.Add("flowrow");
        AutomationProperties.SetName(button, group.Path.Count > 0 ? string.Join(" › ", group.Path) : group.Name);
        button.Click += (_, _) =>
        {
            if (!_closed.Remove(group.View)) _closed.Add(group.View);
            Rebuild();
        };
        return button;
    }
}
