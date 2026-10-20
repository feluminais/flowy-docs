using Avalonia;
using Flowy.Core;

namespace Flowy.App;

/// <summary>The navigator on the left (its rail, the Flows list and the Explorer tree), the Details panel on the right and its rail, how wide the two panels are dragged, and what a click in them does.</summary>
internal sealed partial class ReaderView
{
    private string? _revealedView; // the level and the shape the tree last followed, so it follows a change and not every redraw
    private string? _revealedBox;

    /// <summary>What the navigator remembers for this project changed: the tab, which shapes are open in the tree, or how wide a panel is.</summary>
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

    /// <summary>The navigator's tab showing (Flows or Explorer): the one chosen on its rail or its strip, else none.</summary>
    private PanelTab? ShownTab => _tab == PanelTab.Flows && !ShowFlows ? null : _tab;

    /// <summary>Whether the Details panel on the right is open: from its rail, or because something is picked.</summary>
    private bool DetailsOpen => (_details || _side is { Kind: not SideKind.Objects }) && !PerfOpen; // the Performance panel is in its place while it is open

    private void SetTab(PanelTab tab)
    {
        _tab = tab;
        _navUsed = true; // opened or switched on purpose: Escape takes it back until the reader clicks in the diagram
        Refresh();
        Remember();
    }

    /// <summary>A click on a rail: open that panel, or close it when it is the one open.</summary>
    private void ToggleTab(PanelTab tab)
    {
        if (tab == PanelTab.Performance) TogglePerf();
        else if (tab == PanelTab.Details)
        {
            if (DetailsOpen) CloseDetails();
            else
            {
                _perf = false; // Details takes the place of Performance
                _ramping = false;
                _details = true;
                Refresh();
            }
        }
        else if (ShownTab == tab) CloseNav();
        else SetTab(tab);
    }

    private void CloseNav()
    {
        _tab = null;
        _navUsed = false;
        Refresh();
        Focus();
        Remember();
    }

    private void CloseDetails()
    {
        _side = null;
        _details = false;
        Refresh();
        Focus();
    }

    /// <summary>What the canvas can give one panel: all of it but a strip to look at, and what the other panel takes. Unknown before the canvas is laid out.</summary>
    private double Spare(double other) => (_canvas.Bounds.Width > 0 ? _canvas.Bounds.Width : double.PositiveInfinity) - 160 - other;

    private void ResizeNav(double width)
    {
        _navWidth = NavigatorState.Clamp(width, Spare(_panel.IsVisible ? _detailsWidth : 0));
        ApplyWidths();
    }

    private void ResizeDetails(double width)
    {
        _detailsWidth = NavigatorState.Clamp(width, Spare(ShownTab is not null ? _navWidth : 0));
        ApplyWidths();
    }

    private Thickness NoticeMargin => new(16 + (ShownTab is not null ? _navWidth : 0), 12, 16, 12);

    /// <summary>Puts the panels and their sashes at the widths dragged, and keeps what sits beside the navigator (the zoom buttons, a notice) clear of it.</summary>
    private void ApplyWidths()
    {
        var nav = ShownTab is not null;
        _nav.Width = _navWidth;
        _panel.Width = _detailsWidth;
        _navSash.IsVisible = nav;
        _navSash.Margin = new Thickness(_navWidth - 3, 0, 0, 0);
        _detailsSash.IsVisible = _panel.IsVisible;
        _detailsSash.Margin = new Thickness(0, 0, _detailsWidth - 3, 0);
        if (_zoomButtons is not null) _zoomButtons.Margin = new Thickness(16 + (nav ? _navWidth : 0), 16, 16, 16);
        if (_notice is not null) _notice.Margin = NoticeMargin;
    }

    /// <summary>Plays a flow where it plays (going to its level first), or while editing opens it to edit.</summary>
    private void OpenFlow(string id)
    {
        if (_folder is null || !_folder.Model.Flows.TryGetValue(id, out var flow) || flow.View is not { } view) return;
        if (view != CurrentView()) GoTo(view);
        if (Editing) EditFlow(id);
        else Play(id);
    }

    /// <summary>A click in the Explorer: show the shape where it is drawn and select it (its Details open on the right), or play the flow.</summary>
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
        OpenObject(row.Id);
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
        _detailsRail.Update(DetailsOpen ? PanelTab.Details : PerfOpen ? PanelTab.Performance : null, 0, 0, false);
        _detailsRail.UpdatePerformance(ShowPerf, _folder?.Runs?.Count ?? 0, PerfOpen, Editing);
        if (tab is { } open) _nav.Show(open, showFlows);
        else _nav.Hide();
        ApplyWidths();
        if (tab == PanelTab.Flows) _nav.Flows.Update(model, view, Editing, Recording?.Id ?? flow?.Id);
        else if (tab == PanelTab.Explorer) _nav.Explorer.Update(model, _folder!.Problems, Editing, _expanded, view, SelectedBox, flow?.Id);
    }

    private void Remember() => NavigatorChanged?.Invoke(new NavigatorState(
        _tab switch { PanelTab.Flows => "flows", PanelTab.Explorer => "explorer", _ => null },
        _expanded.Order(StringComparer.Ordinal).Take(NavigatorState.MaxExpanded).ToList(), _navWidth, _detailsWidth));

    /// <summary>Brings back what this project's navigator remembered: the tab that was open, which shapes were open in the tree, and how wide the panels were.</summary>
    public void RestoreNavigator(NavigatorState? saved)
    {
        _expanded.Clear();
        _expanded.Add(Names.Root);
        _revealedView = null;
        _revealedBox = null;
        _tab = saved?.Tab switch { "flows" => PanelTab.Flows, "explorer" => PanelTab.Explorer, _ => null };
        _navUsed = false; // brought back, not opened: Escape leaves it until the reader uses it
        _navWidth = saved?.NavWidth ?? Camera.Nav;
        _detailsWidth = saved?.DetailsWidth ?? Camera.Panel;
        foreach (var id in saved?.Expanded ?? []) _expanded.Add(id);
        Refresh();
    }

    // What a test can look at.
    internal PanelTab? ShownTabNow => ShownTab;

    internal bool DetailsOpenNow => DetailsOpen;

    internal NavRail Rail => _rail;

    internal NavRail DetailsRail => _detailsRail;

    internal NavigatorPanel Navigator => _nav;

    internal (double Nav, double Details) Widths => (_navWidth, _detailsWidth);

    internal (Sash Nav, Sash Details) Sashes => (_navSash, _detailsSash);

    internal (double Nav, double Details) PanelWidthsOnScreen => (_nav.Width, _panel.Width);

    internal void ClickRail(PanelTab tab) => (tab is PanelTab.Details or PanelTab.Performance ? _detailsRail : _rail).Press(tab);

    /// <summary>Opens a panel by name ("details", "flows" or "explorer"), for a picture (--tab). Anything else is ignored.</summary>
    public void OpenTab(string name)
    {
        if (!Enum.TryParse<PanelTab>(name, true, out var tab)) return;
        if (tab == PanelTab.Performance) OpenPerf();
        else if (tab != PanelTab.Details) SetTab(tab);
        else if (!DetailsOpen) ToggleTab(tab);
    }

    internal void OpenFlowById(string id) => OpenFlow(id);

    internal void ToggleRow(string id, bool expand) => ToggleOpen(id, expand);
}
