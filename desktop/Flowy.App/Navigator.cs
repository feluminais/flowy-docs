using System.Globalization;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>What a rail button opens: the Details panel on the right, or one tab of the navigator on the left (the whole documentation as a tree, every flow, how things fail, or how they hold up under load).</summary>
internal enum PanelTab { Details, Flows, Explorer, Performance, Failures }

/// <summary>
/// A slim column of icons on an edge, always there. The left one holds Explorer, Flows, Failures and Performance, and the counts on it say how much the documentation
/// holds: the flows and the shapes in all. The right one holds Details. A click opens that panel, and a click on the open one closes it (ReaderView decides).
/// </summary>
internal sealed class NavRail : Border
{
    private sealed record Entry(Control Cell, Button Button, TextBlock Count, Border Badge)
    {
        public void Show(bool on) => Cell.IsVisible = Button.IsVisible = on;

        public void Activate(bool on)
        {
            Button.Classes.Set("active", on);
            Badge.Classes.Set("active", on);
        }
    }

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
            Add(column, PanelTab.Explorer, Icons.Explorer, "Explorer", "O");
            Add(column, PanelTab.Flows, Icons.Route, "Flows", "L");
            Add(column, PanelTab.Failures, Icons.Bolt, "Failures", "M");
            _entries[PanelTab.Failures].Show(false); // there only where the folder has a failure analysis
            Add(column, PanelTab.Performance, Icons.Activity, "Performance", "T");
            _entries[PanelTab.Performance].Show(false); // there only where the folder has load-test runs
        }
        else
        {
            Add(column, PanelTab.Details, Icons.Info, "Details", null);
        }
        Child = column;
    }

    private void Add(StackPanel column, PanelTab tab, string icon, string name, string? key)
    {
        var count = new TextBlock { FontSize = 10, FontWeight = FontWeight.SemiBold, VerticalAlignment = VerticalAlignment.Center };
        var badge = new Border
        {
            Child = count, MinWidth = 16, Height = 16, CornerRadius = new CornerRadius(8), Padding = new Thickness(4, 0), IsVisible = false,
            HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, -4, -4, 0), IsHitTestVisible = false,
        };
        badge.Classes.Add("railcount");
        var glyph = Icons.Make(icon, "railicon", 18);
        glyph.HorizontalAlignment = HorizontalAlignment.Center;
        glyph.VerticalAlignment = VerticalAlignment.Center;
        var button = new Button { Content = glyph, Width = 32, Height = 32 };
        button.Classes.Add("railbutton");
        button.Click += (_, _) => Picked?.Invoke(tab);
        AutomationProperties.SetName(button, name);
        ToolTip.SetTip(button, key is null ? name : $"{name} ({key})");
        // The count hangs off the button's corner, so it sits beside the button, not in it: as its content it would be cut off at the button's edge.
        var cell = new Grid { Width = 32, Height = 32, Children = { button, badge } };
        column.Children.Add(cell);
        _entries[tab] = new Entry(cell, button, count, badge);
    }

    /// <summary>Shows which tab is open and the counts. The Flows icon is there only when there is a flow to find (or while editing).</summary>
    public void Update(PanelTab? shown, int flows, int shapes, bool showFlows)
    {
        foreach (var (tab, entry) in _entries) entry.Activate(shown == tab);
        if (!_entries.ContainsKey(PanelTab.Flows)) return;
        _entries[PanelTab.Flows].Show(showFlows);
        SetCount(PanelTab.Flows, "Flows", flows);
        SetCount(PanelTab.Explorer, "Explorer", shapes);
    }

    /// <summary>The left rail's Performance button: there only when the folder has runs (the number on it is how many), and greyed out while the reader is editing.</summary>
    public void UpdatePerformance(bool show, int runs, bool open, bool editing)
    {
        if (!_entries.TryGetValue(PanelTab.Performance, out var entry)) return;
        entry.Show(show);
        entry.Activate(open);
        entry.Button.IsEnabled = !editing;
        ToolTip.SetTip(entry.Button, editing ? "Performance (not while editing)" : "Performance (T)");
        ToolTip.SetShowOnDisabled(entry.Button, true);
        SetCount(PanelTab.Performance, "Performance", runs);
    }

    /// <summary>The left rail's Failures button: there only when the folder has an analysis (the number on it is how many failure modes), and greyed out while the reader is editing.</summary>
    public void UpdateFailures(bool show, int modes, bool open, bool editing)
    {
        if (!_entries.TryGetValue(PanelTab.Failures, out var entry)) return;
        entry.Show(show);
        entry.Activate(open);
        entry.Button.IsEnabled = !editing;
        ToolTip.SetTip(entry.Button, editing ? "Failures (not while editing)" : "Failures (M)");
        ToolTip.SetShowOnDisabled(entry.Button, true);
        SetCount(PanelTab.Failures, "Failures", modes);
    }

    private void SetCount(PanelTab tab, string name, int n)
    {
        var entry = _entries[tab];
        entry.Count.Text = n > 999 ? "999+" : n.ToString(CultureInfo.InvariantCulture);
        entry.Badge.IsVisible = true;
        AutomationProperties.SetName(entry.Button, $"{name}, {n}");
    }

    /// <summary>What a test can look at: the label of each icon, whether it can be clicked, and the count on it.</summary>
    internal IEnumerable<(string Name, bool Visible, bool Enabled, string? Count)> Shown =>
        _entries.Select(kv => (AutomationProperties.GetName(kv.Value.Button) ?? "", kv.Value.Button.IsVisible, kv.Value.Button.IsEnabled, kv.Value.Badge.IsVisible ? kv.Value.Count.Text : null));

    internal void Press(PanelTab tab) => Picked?.Invoke(tab);
}

/// <summary>The strip of tabs on top of the navigator: Explorer, Flows, Failures and Performance.</summary>
internal sealed class NavTabs : StackPanel
{
    private readonly Dictionary<PanelTab, Button> _buttons = [];

    public event Action<PanelTab>? Picked;

    public NavTabs()
    {
        Orientation = Orientation.Horizontal;
        Spacing = 2;
        Classes.Add("navtabs");
        foreach (var (tab, label) in new[] { (PanelTab.Explorer, "Explorer"), (PanelTab.Flows, "Flows"), (PanelTab.Failures, "Failures"), (PanelTab.Performance, "Performance") })
        {
            var button = new Button { Content = label };
            button.Classes.Add("navtab");
            button.Click += (_, _) => Picked?.Invoke(tab);
            AutomationProperties.SetName(button, label);
            _buttons[tab] = button;
            Children.Add(button);
        }
    }

    public void Update(PanelTab active, bool showFlows, bool showFailures, bool showPerf)
    {
        foreach (var (tab, button) in _buttons) button.Classes.Set("on", tab == active);
        _buttons[PanelTab.Flows].IsVisible = showFlows;
        _buttons[PanelTab.Failures].IsVisible = showFailures;
        _buttons[PanelTab.Performance].IsVisible = showPerf;
    }
}

/// <summary>The panel of the Explorer, Flows, Failures and Performance tabs, on the left. It does no scrolling of its own: each tab scrolls what it holds.</summary>
internal sealed class NavigatorPanel : Border
{
    private readonly ContentControl _body = new();
    private readonly ContentControl _pickerHost = new();

    /// <summary>The flyout of a Compare button on a flow's row: the flows to compare it with, under the tabs. Null when there is none.</summary>
    public Control? Picker
    {
        get => _pickerHost.Content as Control;
        set
        {
            _pickerHost.Content = value;
            _pickerHost.Margin = value is null ? default : new Thickness(12, 8, 12, 0);
        }
    }

    public NavTabs Tabs { get; } = new();

    public FlowsView Flows { get; } = new();

    public ExplorerView Explorer { get; } = new();

    /// <summary>The Failures tab's list and detail, in a scroll view of its own (the other tabs scroll themselves).</summary>
    public FailuresPanel Failures { get; } = new();

    private readonly ScrollViewer _failuresScroll;

    /// <summary>The Performance tab's panel, in a scroll view of its own. It lives as long as the reader.</summary>
    public PerfPanel Perf { get; } = new();

    private readonly ScrollViewer _perfScroll;

    public event Action? Closed;

    public NavigatorPanel()
    {
        Classes.Add("panel");
        Classes.Add("navpanel");
        _failuresScroll = new ScrollViewer { HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled, Content = new Border { Padding = new Thickness(16, 6, 16, 16), Child = Failures } };
        _perfScroll = new ScrollViewer { HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled, Content = new Border { Padding = new Thickness(16, 6, 16, 16), Child = Perf } };
        Width = Camera.Nav;
        HorizontalAlignment = HorizontalAlignment.Left;
        IsVisible = false;
        Focusable = false;
        Tabs.Margin = new Thickness(16, 10, 52, 0);
        var close = new Button { Content = Icons.Make(Icons.Close, "closeicon", 16), HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 6, 14, 0) }; // level with the tabs' words, not with the strip that holds their underline
        close.Classes.Add("close");
        close.Click += (_, _) => Closed?.Invoke();
        AutomationProperties.SetName(close, "Close");
        var column = new Grid { RowDefinitions = [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Star)], Children = { Tabs, _pickerHost, _body } };
        Grid.SetRow(_pickerHost, 1);
        Grid.SetRow(_body, 2);
        Child = new Grid { Children = { column, close } };
    }

    public void Show(PanelTab tab, bool showFlows, bool showFailures, bool showPerf)
    {
        Tabs.Update(tab, showFlows, showFailures, showPerf);
        _body.Content = tab == PanelTab.Flows ? Flows : tab == PanelTab.Failures ? _failuresScroll : tab == PanelTab.Performance ? _perfScroll : Explorer;
        IsVisible = true;
    }

    public void Hide() => IsVisible = false;
}
