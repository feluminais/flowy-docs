using Avalonia;
using Flowy.Core;

namespace Flowy.App;

/// <summary>What the navigator on the left and Details on the right show after every redraw, and what a click in their lists does. Which is open and how wide is <see cref="Panels"/>.</summary>
internal sealed partial class ReaderView
{
    /// <summary>What the navigator remembers for this project changed: the tab, which shapes are open in the tree, or how wide a panel is.</summary>
    public event Action<NavigatorState>? NavigatorChanged;

    private OutlineTotals Totals()
    {
        var model = _folder!.Model;
        if (_totals is not { } t || !ReferenceEquals(t.Model, model) || t.Editing != Editing)
            _totals = t = (model, Editing, Outlines.Build(model, [], new HashSet<string>(), null, Editing).Totals);
        return t.Totals;
    }

    /// <summary>The Flows tab is always there, and says so when there is no flow.</summary>
    private bool ShowFlows => _folder is not null;

    private void CloseDetails() => _panels.CloseDetails();

    private PanelTab? ShownTab => _panels.ShownTab;

    private bool DetailsOpen => _panels.DetailsOpen;

    private Thickness NoticeMargin => new(16 + _panels.NavInset, 12, 16, 12);

    /// <summary>Puts the panels at the widths dragged, and keeps what sits beside the navigator (the zoom buttons, a notice) clear of it.</summary>
    /// <summary>A panel opened, closed or was dragged to another width: the view fits again to the room beside them, unless the reader has moved the view since it was fitted.</summary>
    private void RefitBesidePanels()
    {
        if (Comparing || (_panels.NavInset, _panels.DetailsInset) == _fitRoom) return;
        _fitRoom = (_panels.NavInset, _panels.DetailsInset);
        _canvas.RefitIfFitted(_panels.DetailsInset, PlayingFlow() is not null, _panels.NavInset);
    }

    private void ApplyWidths()
    {
        _panels.Place();
        RefitBesidePanels();
        var nav = ShownTab is not null;
        if (_zoomButtons is not null) _zoomButtons.Margin = new Thickness(16 + (nav ? _panels.NavWidth : 0), 16, 16, 16);
        // The comparison keeps clear of both panels instead of fitting round them, so its panes (each with a zoom of its own) are never under one.
        _compareHost.Margin = new Thickness(nav ? _panels.NavWidth : 0, 0, _panel.IsVisible ? _panels.DetailsWidth : 0, 0);
        if (_notice is not null) _notice.Margin = NoticeMargin;
    }

    /// <summary>Plays a flow where it plays (going to its level first), or while editing opens it to edit.</summary>
    private void OpenFlow(string id)
    {
        if (_folder is null || !_folder.Model.Flows.TryGetValue(id, out var flow) || flow.View is not { } view) return;
        if (_compareMode.State is not null && UnlessDraft(() => OpenFlow(id))) return; // playing a flow ends the comparison: a note that isn't saved asks first
        CloseCompare(false); // playing a flow ends the comparison
        if (view != CurrentView()) GoTo(view);
        if (Editing) _gestures.EditFlow(id);
        else Play(id);
    }

    /// <summary>A click in the Explorer: show the shape where it is drawn and select it (its Details open on the right), or play the flow.</summary>
    internal void PickRow(OutlineRow row)
    {
        if (_folder is null) return;
        if (row.Kind == "flow")
        {
            OpenFlow(row.Id);
            return;
        }
        // A comparison of flows stays open: the Details show the shape, where it is drawn or not.
        if (row.Id == Names.Root)
        {
            if (!ComparingFlows && CurrentView() != Names.Root) GoTo(Names.Root);
            _side = null;
            Refresh();
            return;
        }
        var parent = Views.ParentOf(_folder.Model, row.Id);
        if (!ComparingFlows && parent != CurrentView()) GoTo(parent);
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

    private void RefreshNavigator(Model model, string view, (string Id, Flow Flow)? flow)
    {
        if (Editing && _compareMode.Picker is not null) _compareMode.DropPicker(); // Compare is blocked while editing, and so is a flyout it opened
        var totals = Totals();
        var tab = ShownTab;
        _rail.Update(tab, totals.Flows, totals.Shapes);
        _rail.UpdateFailures(FailuresView.ModeCount(model), FailuresOpen);
        _rail.UpdatePerformance(_folder?.Runs?.Count ?? 0, PerfOpen || RunsOpen, Editing);
        _detailsRail.Update(DetailsOpen ? PanelTab.Details : null, 0, 0);
        if (tab is { } open) _nav.Show(open, Editing);
        else _nav.Hide();
        ApplyWidths();
        if (tab == PanelTab.Flows) _nav.Flows.Update(model, view, Editing, Recording?.Id ?? flow?.Id);
        else if (tab == PanelTab.Explorer)
        {
            _nav.Explorer.Update(model, _folder!.Problems, Editing, _panels.Expanded, view, SelectedBox, flow?.Id);
            ShowDrafts();
        }
        else if (tab == PanelTab.Failures) _failures.Show(model, view);
        else if (tab == PanelTab.Yaml && _dir is not null) _nav.Yaml.Show(_dir, _folder!, Recording?.Id ?? flow?.Id, SelectedBox);
        else if (RunsOpen) _nav.RunLinks.Show(model, _folder!.Runs ?? new IdMap<LoadRun>(), _edit.SaveOff);
    }

    /// <summary>Brings back what this project's navigator remembered: the tab that was open, which shapes were open in the tree, and how wide the panels were.</summary>
    public void RestoreNavigator(NavigatorState? saved)
    {
        _panels.Restore(saved);
        Refresh();
    }

    // What a test can look at.
    internal PanelTab? ShownTabNow => ShownTab;

    internal bool DetailsOpenNow => DetailsOpen;

    internal NavRail Rail => _rail;

    internal NavRail DetailsRail => _detailsRail;

    internal NavigatorPanel Navigator => _nav;

    internal (double Nav, double Details) Widths => (_panels.NavWidth, _panels.DetailsWidth);

    internal (Sash Nav, Sash Details) Sashes => (_navSash, _detailsSash);

    internal (double Nav, double Details) PanelWidthsOnScreen => (_nav.Width, _panel.Width);

    internal void ClickRail(PanelTab tab) => (tab == PanelTab.Details ? _detailsRail : _rail).Press(tab);

    /// <summary>Opens a panel by name ("details", "flows", "explorer", "performance", "failures" or "yaml"), for a picture (--tab). Anything else is ignored.</summary>
    public void OpenTab(string name)
    {
        if (!Enum.TryParse<PanelTab>(name, true, out var tab)) return;
        if (tab != PanelTab.Details) _panels.SetTab(tab);
        else if (!DetailsOpen) _panels.ToggleTab(tab);
    }

    internal void OpenFlowById(string id) => OpenFlow(id);

    internal void ToggleRow(string id, bool expand) => _panels.ToggleOpen(id, expand);
}
