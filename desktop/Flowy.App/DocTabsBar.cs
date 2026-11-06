using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Flowy.App.Canvas;

namespace Flowy.App;

/// <summary>
/// The row of tabs at the top of a window: one tab for each model and sketch open in it. A model and its sketches sit inside one outline, each sketch with the mark the Sketches list gives it,
/// so whose a sketch is can be seen at a glance. A sketch whose model is not in this window says so in its name. The row draws what it is told and says what was pressed; what a press does is the window's.
/// </summary>
internal sealed class DocTabsBar : Border
{
    private const double MaxNameWidth = 280;
    private const double WheelStep = 40;

    private readonly StackPanel _groups = new() { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
    private readonly ScrollViewer _scroll;
    private readonly Button _open = new();
    private readonly Dictionary<DocTab, Border> _shown = [];
    private string _drawn = "";

    public DocTabsBar()
    {
        AreaStyles.Add(this, "DocTabs");
        Classes.Add("doctabs");
        AutomationProperties.SetName(this, "Open tabs");
        _scroll = new ScrollViewer
        {
            Content = _groups,
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Hidden,
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
        };
        // A wheel turns the row: there is nothing to scroll up and down, and the bar under a row of tabs has no room for a scroll bar.
        _scroll.PointerWheelChanged += (_, e) =>
        {
            _scroll.Offset = _scroll.Offset.WithX(_scroll.Offset.X - e.Delta.Y * WheelStep);
            e.Handled = true;
        };
        _open.Classes.Add("tool");
        _open.Classes.Add("icononly");
        _open.Margin = new Thickness(6, 0, 0, 0);
        _open.VerticalAlignment = VerticalAlignment.Center;
        Chrome.Fill(_open, Icons.Plus, null, "Open folder");
        ToolTip.SetTip(_open, "Open folder (Ctrl+O)");
        _open.Click += (_, _) => OpenAsked?.Invoke();
        Grid.SetColumn(_open, 1);
        Child = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], Children = { _scroll, _open } };
    }

    public event Action<DocTab>? Picked;

    public event Action<DocTab>? CloseAsked;

    public event Action<DocTab>? CloseOthersAsked;

    public event Action<DocTab>? MoveAsked;

    public event Action? OpenAsked;

    /// <summary>
    /// Draws <paramref name="tabs"/>, with <paramref name="active"/> on show. The controls stay when only the tab on show changed, so a keyboard on a tab stays there.
    /// </summary>
    public void Show(IReadOnlyList<DocTab> tabs, DocTab? active)
    {
        var drawn = string.Join('\n', tabs.Select(t => $"{t.Key}\t{NameOf(t, tabs)}"));
        if (drawn != _drawn || _shown.Count != tabs.Count || !tabs.All(_shown.ContainsKey))
        {
            _drawn = drawn;
            _groups.Children.Clear();
            _shown.Clear();
            StackPanel? group = null;
            string? key = null;
            foreach (var tab in tabs)
            {
                if (group is null || tab.Place.Group != key)
                {
                    key = tab.Place.Group;
                    group = new StackPanel { Orientation = Orientation.Horizontal };
                    _groups.Children.Add(new Border { Child = group, Classes = { "docgroup" } });
                }
                var shown = Tab(tab, tabs);
                _shown[tab] = shown;
                group.Children.Add(shown);
            }
        }
        foreach (var (tab, shown) in _shown) shown.Classes.Set("active", tab == active);
        // After the layout: a tab just drawn has no place in the row yet.
        Dispatcher.UIThread.Post(() =>
        {
            if (active is not null && _shown.TryGetValue(active, out var shown)) shown.BringIntoView();
        }, DispatcherPriority.Background);
    }

    /// <summary>A sketch whose model has a tab in this window is named alone: the outline says the rest. Elsewhere it says whose it is.</summary>
    internal static string NameOf(DocTab tab, IReadOnlyList<DocTab> tabs) =>
        tab.OwnerName is { } owner && !tabs.Any(t => t.Key == tab.Place.Owner) ? $"{tab.Name} (sketch of {owner})" : tab.Name;

    private Border Tab(DocTab tab, IReadOnlyList<DocTab> tabs)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        if (tab.IsSketch) row.Children.Add(Sketched());
        var name = new TextBlock { Text = NameOf(tab, tabs), MaxWidth = MaxNameWidth, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, Classes = { "docname" } };
        row.Children.Add(name);
        var pick = new Button { Content = row, Classes = { "docpick" } };
        AutomationProperties.SetName(pick, NameOf(tab, tabs));
        ToolTip.SetTip(pick, tab.OwnerName is { } owner ? $"Sketch of {owner}" : tab.Dir);
        pick.Click += (_, _) => Picked?.Invoke(tab);

        var close = new Button { Classes = { "docclose" } };
        close.Content = Icons.Make(Icons.Close, "btnicon", 12);
        AutomationProperties.SetName(close, $"Close {tab.Name}");
        ToolTip.SetTip(close, "Close tab (Ctrl+W)");
        close.Click += (_, _) => CloseAsked?.Invoke(tab);

        var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Auto)], Children = { pick, close } };
        Grid.SetColumn(close, 1);
        var shown = new Border { Child = grid, Classes = { "doctab" } };
        if (tab.IsSketch) shown.Classes.Add("sketch");
        shown.PointerPressed += (_, e) =>
        {
            if (!e.GetCurrentPoint(shown).Properties.IsMiddleButtonPressed) return;
            e.Handled = true;
            CloseAsked?.Invoke(tab);
        };
        shown.ContextMenu = Menu(tab, tabs);
        return shown;
    }

    private static Control Sketched()
    {
        var mark = Icons.Make(Icons.Sketch, "sketchmark", 14);
        mark.VerticalAlignment = VerticalAlignment.Center;
        return mark;
    }

    private ContextMenu Menu(DocTab tab, IReadOnlyList<DocTab> tabs)
    {
        var close = new MenuItem { Header = "Close" };
        close.Click += (_, _) => CloseAsked?.Invoke(tab);
        var others = new MenuItem { Header = "Close Others", IsEnabled = tabs.Count > 1 };
        others.Click += (_, _) => CloseOthersAsked?.Invoke(tab);
        // The window keeps at least one tab: a move of everything in it would leave an empty window behind.
        var move = new MenuItem { Header = "Move to New Window", IsEnabled = tabs.Any(t => !TabGroups.TravelsWith(tab.Place, t.Place)) };
        move.Click += (_, _) => MoveAsked?.Invoke(tab);
        return new ContextMenu { Items = { close, others, move } };
    }

    // What a test can look at.
    internal IReadOnlyList<IReadOnlyList<string>> GroupsShown =>
        [.. _groups.Children.OfType<Border>().Select(g => (IReadOnlyList<string>)[.. ((StackPanel)g.Child!).Children.OfType<Border>().Select(TabName)])];

    internal string? ActiveShown => _shown.Values.FirstOrDefault(s => s.Classes.Contains("active")) is { } tab ? TabName(tab) : null;

    private static string TabName(Border tab) => AutomationProperties.GetName(((Grid)tab.Child!).Children.OfType<Button>().First()) ?? "";

    internal void Press(string name) => PressButton(name, 0);

    internal void PressClose(string name) => PressButton(name, 1);

    private void PressButton(string name, int which) =>
        ((Grid)_shown.Values.First(s => TabName(s) == name).Child!).Children.OfType<Button>().ElementAt(which).RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));

    internal ContextMenu MenuOf(string name) => _shown.Values.First(s => TabName(s) == name).ContextMenu!;
}
