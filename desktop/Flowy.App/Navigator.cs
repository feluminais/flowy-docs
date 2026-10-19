using System.Globalization;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>What a rail button opens: the Details panel on the right (or, beside it, the Performance panel that takes its place), or one tab of the navigator on the left (every flow, or the whole documentation as a tree).</summary>
internal enum PanelTab { Details, Flows, Explorer, Performance }

/// <summary>
/// A slim column of icons on an edge, always there. The left one holds Flows and Explorer, and the counts on it say how much the documentation
/// holds: the flows and the shapes in all. The right one holds Details. A click opens that panel, and a click on the open one closes it (ReaderView decides).
/// </summary>
internal sealed class NavRail : Border
{
    private sealed record Entry(Button Button, TextBlock Count, Border Badge);

    private readonly Dictionary<PanelTab, Entry> _entries = [];

    public event Action<PanelTab>? Picked;

    public NavRail(bool navigator)
    {
        Classes.Add("rail");
        if (navigator) Classes.Add("railleft");
        Width = 44;
        var column = new StackPanel { Spacing = 6, Margin = new Thickness(0, 10, 0, 0), HorizontalAlignment = HorizontalAlignment.Center };
        if (navigator)
        {
            Add(column, PanelTab.Flows, Icons.Route, "Flows", "L");
            Add(column, PanelTab.Explorer, Icons.Sitemap, "Explorer", "O");
        }
        else
        {
            Add(column, PanelTab.Details, Icons.Info, "Details", null);
            Add(column, PanelTab.Performance, Icons.Activity, "Performance", "T");
            _entries[PanelTab.Performance].Button.IsVisible = false; // there only where the folder has load-test runs
        }
        Child = column;
    }

    private void Add(StackPanel column, PanelTab tab, string icon, string name, string? key)
    {
        var count = new TextBlock { FontSize = 10, FontWeight = FontWeight.SemiBold, VerticalAlignment = VerticalAlignment.Center };
        var badge = new Border
        {
            Child = count, MinWidth = 16, Height = 16, CornerRadius = new CornerRadius(8), Padding = new Thickness(4, 0), IsVisible = false,
            HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, -3, -4, 0),
        };
        badge.Classes.Add("railcount");
        var glyph = Icons.Make(icon, "railicon", 18);
        glyph.HorizontalAlignment = HorizontalAlignment.Center;
        glyph.VerticalAlignment = VerticalAlignment.Center;
        var button = new Button { Content = new Grid { Children = { glyph, badge } }, Width = 32, Height = 32 };
        button.Classes.Add("railbutton");
        button.Click += (_, _) => Picked?.Invoke(tab);
        AutomationProperties.SetName(button, name);
        ToolTip.SetTip(button, key is null ? name : $"{name} ({key})");
        column.Children.Add(button);
        _entries[tab] = new Entry(button, count, badge);
    }

    /// <summary>Shows which tab is open and the counts. The Flows icon is there only when there is a flow to find (or while editing).</summary>
    public void Update(PanelTab? shown, int flows, int shapes, bool showFlows)
    {
        foreach (var (tab, entry) in _entries) entry.Button.Classes.Set("active", shown == tab);
        if (!_entries.ContainsKey(PanelTab.Flows)) return;
        _entries[PanelTab.Flows].Button.IsVisible = showFlows;
        SetCount(PanelTab.Flows, "Flows", flows);
        SetCount(PanelTab.Explorer, "Explorer", shapes);
    }

    /// <summary>The right rail's Performance button: there only when the folder has runs (the number on it is how many) and the reader is not editing.</summary>
    public void UpdatePerformance(bool show, int runs, bool open)
    {
        if (!_entries.TryGetValue(PanelTab.Performance, out var entry)) return;
        entry.Button.IsVisible = show;
        entry.Button.Classes.Set("active", open);
        SetCount(PanelTab.Performance, "Performance", runs);
    }

    private void SetCount(PanelTab tab, string name, int n)
    {
        var entry = _entries[tab];
        entry.Count.Text = n > 999 ? "999+" : n.ToString(CultureInfo.InvariantCulture);
        entry.Badge.IsVisible = true;
        AutomationProperties.SetName(entry.Button, $"{name}, {n}");
    }

    /// <summary>What a test can look at: the label of each icon, and the count on it.</summary>
    internal IEnumerable<(string Name, bool Visible, string? Count)> Shown =>
        _entries.Select(kv => (AutomationProperties.GetName(kv.Value.Button) ?? "", kv.Value.Button.IsVisible, kv.Value.Badge.IsVisible ? kv.Value.Count.Text : null));

    internal void Press(PanelTab tab) => Picked?.Invoke(tab);
}

/// <summary>The strip of tabs on top of the navigator: Flows and Explorer.</summary>
internal sealed class NavTabs : StackPanel
{
    private readonly Dictionary<PanelTab, Button> _buttons = [];

    public event Action<PanelTab>? Picked;

    public NavTabs()
    {
        Orientation = Orientation.Horizontal;
        Spacing = 2;
        Classes.Add("navtabs");
        foreach (var (tab, label) in new[] { (PanelTab.Flows, "Flows"), (PanelTab.Explorer, "Explorer") })
        {
            var button = new Button { Content = label };
            button.Classes.Add("navtab");
            button.Click += (_, _) => Picked?.Invoke(tab);
            AutomationProperties.SetName(button, label);
            _buttons[tab] = button;
            Children.Add(button);
        }
    }

    public void Update(PanelTab active, bool showFlows)
    {
        foreach (var (tab, button) in _buttons) button.Classes.Set("on", tab == active);
        _buttons[PanelTab.Flows].IsVisible = showFlows;
    }
}

/// <summary>The panel of the Flows and Explorer tabs, on the left. It does no scrolling of its own: each tab scrolls what it holds.</summary>
internal sealed class NavigatorPanel : Border
{
    private readonly ContentControl _body = new();

    public NavTabs Tabs { get; } = new();

    public FlowsView Flows { get; } = new();

    public ExplorerView Explorer { get; } = new();

    public event Action? Closed;

    public NavigatorPanel()
    {
        Classes.Add("panel");
        Classes.Add("navpanel");
        Width = Camera.Nav;
        HorizontalAlignment = HorizontalAlignment.Left;
        IsVisible = false;
        Focusable = false;
        Tabs.Margin = new Thickness(16, 10, 52, 0);
        var close = new Button { Content = Icons.Make(Icons.Close, "closeicon", 16), HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 14, 14, 0) };
        close.Classes.Add("close");
        close.Click += (_, _) => Closed?.Invoke();
        AutomationProperties.SetName(close, "Close");
        var column = new Grid { RowDefinitions = [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Star)], Children = { Tabs, _body } };
        Grid.SetRow(_body, 1);
        Child = new Grid { Children = { column, close } };
    }

    public void Show(PanelTab tab, bool showFlows)
    {
        Tabs.Update(tab, showFlows);
        _body.Content = tab == PanelTab.Flows ? Flows : Explorer;
        IsVisible = true;
    }

    public void Hide() => IsVisible = false;
}
