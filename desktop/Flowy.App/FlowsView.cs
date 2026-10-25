using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.VisualTree;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// Every flow in the documentation as the folders it is filed in (the folders under flows/ in the repo), a folder first and then its flows by file name.
/// Picking one goes to its level and plays it (or, while editing, opens it for editing). The tags in use filter the list, and so does the search. A flow in a pair has a link mark; each row has a Compare button.
/// </summary>
internal sealed class FlowsView : Grid
{
    private readonly TextBox _find = new() { PlaceholderText = "Find a flow", Classes = { "bare" } };
    /// <summary>The space a navigator tab keeps between its content and the panel's right edge, inside the scroll area so the scroll bar can sit on the edge.</summary>
    internal const double Inset = 12;

    private readonly StackPanel _list = new() { Spacing = 0, Margin = new Thickness(0, 0, Inset, 0) };
    private readonly HashSet<string> _closed = [];
    private readonly List<string> _picked = [];
    private readonly WrapPanel _tagBar = new() { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, Inset, 0) };
    /// <summary>
    /// The tags, three rows and half of a fourth high, then they scroll: many tags must not push the list of flows out of the panel, and the cut row
    /// says there are more. Its scroll bar sits on the panel's edge, as the list's does.
    /// </summary>
    private readonly ScrollViewer _tagScroll;
    /// <summary>How far each level of folders is moved in, and the room a flow keeps before its mark, which lines it up with the mark of its folder.</summary>
    private const double Indent = 16, Twist = 22;
    private Model? _model;
    private bool _editing;
    private string? _current;
    private readonly Border _foot = LinkedKey();

    public event Action<FlowRef>? Opened;

    /// <summary>The Compare button on a flow's row was pressed (never while a mode blocks it).</summary>
    public event Action<string>? CompareRequested;

    /// <summary>Why the Compare buttons are greyed out (their tooltip), or null when they are not.</summary>
    internal string? CompareOff { get; private set; }

    /// <summary>Whether the foot with the Linked key shows: a flow in a pair is on the list.</summary>
    internal bool LinkedKeyShown => _foot.IsVisible;

    /// <summary>The tags that filter the list now, as the filter keeps them (lower case).</summary>
    internal IReadOnlyList<string> PickedTags => _picked;

    /// <summary>The tag buttons on show, with their counts, in the order they are drawn. What a test can look at.</summary>
    internal IReadOnlyList<FlowTag> TagButtons { get; private set; } = [];

    /// <summary>The folder rows on the list now, in the order they are drawn.</summary>
    internal IReadOnlyList<FolderRow> Folders { get; private set; } = [];

    /// <summary>Presses a tag button as a click on it does.</summary>
    internal void ToggleTag(string tag)
    {
        var key = Names.TagKey(tag);
        if (!_picked.Remove(key)) _picked.Add(key);
        Rebuild();
    }

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
        RowDefinitions = [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Star), new RowDefinition(GridLength.Auto)];
        RowSpacing = 8;
        Margin = new Thickness(12, 12, 0, 12); // no margin on the right: the list's scroll bar sits on the panel's edge, where the sash is
        var field = Field(_find, Icons.Search);
        field.Margin = new Thickness(0, 0, Inset, 0);
        _find.TextChanged += (_, _) => Rebuild();
        _find.KeyDown += (_, e) =>
        {
            // Esc empties the filter first, as in Explorer; a second press goes on to close the layers behind it.
            if (e.Key != Key.Escape || string.IsNullOrEmpty(_find.Text)) return;
            _find.Text = "";
            e.Handled = true;
        };
        var scroll = new ScrollViewer { Content = _list, VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto };
        _tagScroll = new ScrollViewer { Content = _tagBar, MaxHeight = 102, VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto };
        SetRow(_tagScroll, 1);
        SetRow(scroll, 2);
        SetRow(_foot, 3);
        _foot.IsVisible = false;
        _tagScroll.IsVisible = false;
        Children.Add(field);
        Children.Add(_tagScroll);
        Children.Add(scroll);
        Children.Add(_foot);
    }

    /// <summary>The mark of a flow that is in a pair. Its name is what a screen reader reads on the row.</summary>
    internal static Control LinkedMark()
    {
        var mark = Icons.Make(Icons.Link, "linkmark", 13);
        mark.VerticalAlignment = VerticalAlignment.Center;
        AutomationProperties.SetName(mark, "Linked");
        ToolTip.SetTip(mark, "Linked");
        return mark;
    }

    /// <summary>The foot of a list that has a flow in a pair: the mark and its name.</summary>
    internal static Border LinkedKey()
    {
        var glyph = Icons.Make(Icons.Link, "linkmark", 13);
        glyph.VerticalAlignment = VerticalAlignment.Center;
        var item = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { glyph, Muted("Linked") } };
        var foot = new Border { Child = item, Padding = new Thickness(4, 8, 0, 0), Margin = new Thickness(0, 0, Inset, 0) };
        foot.Classes.Add("navfoot");
        return foot;
    }

    /// <summary>
    /// The Compare button of a flow's row. It is always there and can always be focused: when a mode blocks it, it is greyed out with the reason in its tooltip and a press does nothing.
    /// </summary>
    internal static Button CompareButton(string flow, string name, string? off, Action<string> pressed)
    {
        var button = new Button { Content = Icons.Make(Icons.Columns, "btnicon", 14) };
        button.Classes.Add("rowcompare");
        button.Classes.Set("off", off is not null);
        AutomationProperties.SetName(button, $"Compare {name}");
        ToolTip.SetTip(button, off ?? "Compare with another flow");
        button.Click += (_, _) =>
        {
            if (off is null) pressed(flow);
        };
        return button;
    }

    /// <summary>The Compare button of a flow's row, for the tests.</summary>
    internal Button? CompareButtonOf(string flow) =>
        this.GetVisualDescendants().OfType<Button>().FirstOrDefault(b => b.Classes.Contains("rowcompare") && AutomationProperties.GetName(b) == $"Compare {NameOf(flow)}");

    private string NameOf(string flow) => Listed.FirstOrDefault(f => f.Id == flow)?.Name ?? flow;

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
        // Every step of a flow refreshes the reader; the list only changes with the model, edit mode or the flow open, and a long list is slow to build.
        if (ReferenceEquals(model, _model) && editing == _editing && current == _current) return;
        CompareOff = CompareChoices.Off(model, editing);
        _model = model;
        _editing = editing;
        _current = current;
        Rebuild();
    }

    private static TextBlock Muted(string text, double size = 12) => new() { Text = text, FontSize = size, Classes = { "muted" }, VerticalAlignment = VerticalAlignment.Center };

    private static string Plural(int n, string word) => $"{n} {word}{(n == 1 ? "" : "s")}";

    private Control Row(FlowRef f)
    {
        var icon = Icons.Make(_editing ? Icons.Pencil : Icons.Play, "btnicon", 15);
        icon.VerticalAlignment = VerticalAlignment.Center;
        var name = new TextBlock { Text = f.Name, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
        var steps = Muted(f.Steps == 0 ? "no steps yet" : Plural(f.Steps, "step"));
        var mark = LinkedMark();
        mark.IsVisible = f.Linked;
        var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 8, Children = { icon, name, mark, steps } };
        SetColumn(name, 1);
        SetColumn(mark, 2);
        SetColumn(steps, 3);
        if (f.Tags.Count > 0)
        {
            // The tags of the flow sit under its name.
            grid.RowDefinitions = [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Auto)];
            var words = new WrapPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 4) };
            foreach (var tag in f.Tags) words.Children.Add(TagWord(tag));
            SetRow(words, 1);
            SetColumn(words, 1);
            SetColumnSpan(words, 3);
            grid.Children.Add(words);
        }
        var button = new Button { Content = grid, MinHeight = 32 };
        button.Classes.Add("flowrow");
        button.Classes.Set("current", f.Id == _current);
        ToolTip.SetTip(button, Views.NameOf(_model!, f.View ?? Names.Root));
        AutomationProperties.SetName(button, f.Name);
        button.Click += (_, _) => Opened?.Invoke(f);
        // The row opens the flow; the Compare button beside it is a control of its own, so neither takes the other's click.
        var compare = CompareButton(f.Id, f.Name, CompareOff, id => CompareRequested?.Invoke(id));
        SetColumn(compare, 1);
        return new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 2, Children = { button, compare } };
    }

    /// <summary>A tag as a small word with the mark of a tag, on a flow's row.</summary>
    private static Control TagWord(string tag)
    {
        var mark = Icons.Make(Icons.Tag, "tagmark", 11);
        mark.VerticalAlignment = VerticalAlignment.Center;
        var text = new TextBlock { Text = tag, FontSize = 11, VerticalAlignment = VerticalAlignment.Center, Classes = { "muted" } };
        return new StackPanel { Orientation = Orientation.Horizontal, Spacing = 3, Margin = new Thickness(0, 0, 10, 0), Children = { mark, text } };
    }

    /// <summary>The tags in use as buttons, each with how many flows have it. Pressing one keeps the flows that have it, or any of those pressed.</summary>
    private void ShowTags(IReadOnlyList<FlowTag> tags)
    {
        TagButtons = tags;
        _tagBar.Children.Clear();
        _tagScroll.IsVisible = tags.Count > 0;
        foreach (var t in tags)
        {
            var key = Names.TagKey(t.Tag);
            var mark = Icons.Make(Icons.Tag, "tagmark", 11);
            mark.VerticalAlignment = VerticalAlignment.Center;
            var text = new TextBlock { Text = t.Tag, FontSize = 12, VerticalAlignment = VerticalAlignment.Center };
            var number = Muted(t.Count.ToString(), 11);
            var button = new Button { Content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, Children = { mark, text, number } } };
            button.Classes.Add("tagchip");
            button.Classes.Set("on", _picked.Contains(key));
            AutomationProperties.SetName(button, t.Tag);
            button.Click += (_, _) => ToggleTag(t.Tag);
            _tagBar.Children.Add(button);
        }
    }

    // The list is Outlines.FlowList: a folder row, then the flows filed in it, indented by Depth.
    private void Rebuild()
    {
        if (_model is null) return;
        var needle = (_find.Text ?? "").Trim();
        var list = Outlines.FlowList(_model, new FlowListOptions(_editing, needle, _picked, _closed));
        // A tag that no flow has any more is no filter: its button is gone, so it could not be let go of.
        if (_picked.RemoveAll(p => !list.Tags.Any(t => Names.TagKey(t.Tag) == p)) > 0) list = Outlines.FlowList(_model, new FlowListOptions(_editing, needle, _picked, _closed));
        var filtering = needle != "" || _picked.Count > 0;
        var shown = new List<FlowRef>();
        var folders = new List<FolderRow>();

        ShowTags(list.Tags);
        _list.Children.Clear();
        if (filtering && list.Shown > 0) _list.Children.Add(Note($"{list.Shown} of {Plural(list.Total, "flow")}"));
        foreach (var row in list.Rows)
        {
            if (row is FolderRow folder)
            {
                _list.Children.Add(FolderHead(folder));
                folders.Add(folder);
                continue;
            }
            var item = (FlowItemRow)row;
            var control = Row(item.Flow);
            control.Margin = new Thickness(Indent * item.Depth + Twist, 0, 0, 0);
            _list.Children.Add(control);
            shown.Add(item.Flow);
        }
        if (filtering && list.Shown == 0 && list.Total > 0) _list.Children.Add(Note(needle != "" ? $"No flow matches “{needle}”." : "No flow has these tags."));
        if (list.Total == 0) _list.Children.Add(Note("No flows yet. New flow in the bar starts one."));
        Folders = folders;
        Listed = shown;
        _foot.IsVisible = shown.Any(f => f.Linked); // only while a flow in a pair is on the list: one in a folder that is folded away is not
    }

    private static Control Note(string text) => new TextBlock { Text = text, FontSize = 13, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(6, 8), Classes = { "muted" } };

    private Control FolderHead(FolderRow folder)
    {
        var chevron = Icons.Make(Icons.ChevronRight, "navicon", 14);
        chevron.RenderTransform = new RotateTransform(folder.Open ? 90 : 0);
        chevron.VerticalAlignment = VerticalAlignment.Center;
        var glyph = Icons.Make(Icons.Folder, "navicon", 15);
        glyph.VerticalAlignment = VerticalAlignment.Center;
        var name = new TextBlock { Text = folder.Name, FontWeight = FontWeight.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, Classes = { "muted" } };
        var number = Muted(folder.Flows.ToString(), 12);
        var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 8, Children = { chevron, glyph, name, number } };
        SetColumn(glyph, 1);
        SetColumn(name, 2);
        SetColumn(number, 3);
        var button = new Button { Content = grid, MinHeight = 32, Margin = new Thickness(Indent * folder.Depth, 0, 0, 0) };
        button.Classes.Add("flowrow");
        button.Classes.Add("folderrow"); // a folder, not a flow: it folds
        AutomationProperties.SetName(button, folder.Path);
        button.Click += (_, _) =>
        {
            if (!_closed.Remove(folder.Path)) _closed.Add(folder.Path);
            Rebuild();
        };
        return button;
    }
}
