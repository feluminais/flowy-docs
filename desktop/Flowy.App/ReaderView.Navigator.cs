using Flowy.Core;

namespace Flowy.App;

/// <summary>The right-hand panel's tabs: the rail, the Flows list and the Explorer tree, and what a click in them does.</summary>
internal sealed partial class ReaderView
{
    private string? _revealedView; // the level and the shape the tree last followed, so it follows a change and not every redraw
    private string? _revealedBox;

    /// <summary>What the navigator remembers for this project changed: the tab, or which shapes are open in the tree.</summary>
    public event Action<NavigatorState>? NavigatorChanged;

    private OutlineTotals Totals()
    {
        var model = _folder!.Model;
        if (_totals is not { } t || !ReferenceEquals(t.Model, model) || t.Editing != Editing)
            _totals = t = (model, Editing, Outlines.Build(model, [], new HashSet<string>(), null, Editing).Totals);
        return t.Totals;
    }

    /// <summary>The Flows tab is there whenever there is a flow to find, and always while editing.</summary>
    private bool ShowFlows => _folder is not null && (Totals().Flows > 0 || Editing);

    /// <summary>The tab showing: the one chosen on the rail or a tab strip, else Details while something is picked, else none.</summary>
    private PanelTab? ShownTab => (_tab == PanelTab.Flows && !ShowFlows ? null : _tab) ?? (_side is not null ? PanelTab.Details : null);

    private void SetTab(PanelTab tab)
    {
        _tab = tab;
        Refresh();
        Remember();
    }

    /// <summary>A click on the rail: open that tab, or close the panel when it is the one open.</summary>
    private void ToggleTab(PanelTab tab)
    {
        if (ShownTab == tab) CloseTab();
        else SetTab(tab);
    }

    private void CloseTab()
    {
        _side = null;
        _tab = null;
        Refresh();
        Focus();
        Remember();
    }

    /// <summary>Plays a flow where it plays (going to its level first), or while editing opens it to edit.</summary>
    private void OpenFlow(string id)
    {
        if (_folder is null || !_folder.Model.Flows.TryGetValue(id, out var flow) || flow.View is not { } view) return;
        if (view != CurrentView()) GoTo(view);
        if (Editing) EditFlow(id);
        else Play(id);
    }

    /// <summary>A click in the Explorer: show the shape where it is drawn and select it, or play the flow. The panel stays on the Explorer.</summary>
    private void PickRow(OutlineRow row)
    {
        if (_folder is null) return;
        if (row.Kind == "flow")
        {
            OpenFlow(row.Id);
            return;
        }
        if (row.Id == Names.Root)
        {
            if (CurrentView() != Names.Root) GoTo(Names.Root);
            _side = null;
            Refresh();
            return;
        }
        var parent = Views.ParentOf(_folder.Model, row.Id);
        if (parent != CurrentView()) GoTo(parent);
        _keepTab = true;
        try
        {
            OpenObject(row.Id);
        }
        finally
        {
            _keepTab = false;
        }
    }

    /// <summary>Enter or a double-click in the Explorer: go into a shape that opens, else the same as a click.</summary>
    private void OpenRow(OutlineRow row)
    {
        if (row.Kind == "shape" && (row.Id == Names.Root || CanOpen(row.Id)))
        {
            GoTo(row.Id);
            _side = null;
            Refresh();
            return;
        }
        PickRow(row);
    }

    private void ToggleOpen(string id, bool expand)
    {
        if (expand) _expanded.Add(id);
        else _expanded.Remove(id);
        Refresh();
        Remember();
    }

    /// <summary>The tree follows the canvas: going into a level opens it, and a selected shape's ancestors open. It only ever opens rows.</summary>
    private void FollowCanvas(Model model, string view)
    {
        var grew = false;
        if (view != _revealedView)
        {
            _revealedView = view;
            foreach (var id in Outlines.ExpandTo(model, view, _expanded, true)) grew |= _expanded.Add(id);
        }
        if (SelectedBox != _revealedBox)
        {
            _revealedBox = SelectedBox;
            if (SelectedBox is { } picked)
                foreach (var id in Outlines.ExpandTo(model, picked, _expanded)) grew |= _expanded.Add(id);
        }
        if (grew) Remember();
    }

    private void RefreshNavigator(Model model, string view, (string Id, Flow Flow)? flow)
    {
        var totals = Totals();
        var tab = ShownTab;
        var showFlows = ShowFlows;
        _rail.Update(tab, totals.Flows, totals.Shapes, showFlows);
        _panel.Tabs.Update(PanelTab.Details, showFlows);
        if (tab is PanelTab.Flows or PanelTab.Explorer) _nav.Show(tab.Value, showFlows);
        else _nav.Hide();
        if (tab == PanelTab.Flows) _nav.Flows.Update(model, view, Editing, Recording?.Id ?? flow?.Id);
        else if (tab == PanelTab.Explorer) _nav.Explorer.Update(model, _folder!.Problems, Editing, _expanded, view, SelectedBox, flow?.Id);
    }

    private void Remember() => NavigatorChanged?.Invoke(new NavigatorState(
        _tab switch { PanelTab.Flows => "flows", PanelTab.Explorer => "explorer", _ => null },
        _expanded.Order(StringComparer.Ordinal).Take(NavigatorState.MaxExpanded).ToList()));

    /// <summary>Brings back what this project's navigator remembered: the tab that was open and which shapes were open in the tree.</summary>
    public void RestoreNavigator(NavigatorState? saved)
    {
        _expanded.Clear();
        _expanded.Add(Names.Root);
        _revealedView = null;
        _revealedBox = null;
        _tab = saved?.Tab switch { "flows" => PanelTab.Flows, "explorer" => PanelTab.Explorer, _ => null };
        foreach (var id in saved?.Expanded ?? []) _expanded.Add(id);
        Refresh();
    }

    // What a test can look at.
    internal PanelTab? ShownTabNow => ShownTab;

    internal NavRail Rail => _rail;

    internal NavigatorPanel Navigator => _nav;

    internal void ClickRail(PanelTab tab) => _rail.Press(tab);

    /// <summary>Opens a tab by name ("details", "flows" or "explorer"), for a picture (--tab). Anything else is ignored.</summary>
    public void OpenTab(string name)
    {
        if (Enum.TryParse<PanelTab>(name, true, out var tab)) SetTab(tab);
    }

    internal void OpenFlowById(string id) => OpenFlow(id);

    internal void ToggleRow(string id, bool expand) => ToggleOpen(id, expand);
}
