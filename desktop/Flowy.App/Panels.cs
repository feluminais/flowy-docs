using Avalonia;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>The panel opened on the right besides what a pick opens: Details from its rail (the level you are in).</summary>
internal enum RightPanel { Closed, Details }

/// <summary>
/// The navigator on the left (its rail, the Flows list, the Explorer tree, the Failures list and the Performance panel) and the Details panel on the right with its rail: which tab is
/// open, which shapes are open in the tree, how wide the two panels are dragged, and what a click on a rail or a sash does.
/// </summary>
internal sealed class Panels
{
    private readonly NavigatorPanel _nav;
    private readonly NavRail _rail;
    private readonly NavRail _detailsRail;
    private readonly Sash _navSash;
    private readonly Sash _detailsSash;
    private readonly SidePanel _details;
    private readonly CanvasView _canvas;
    private readonly PerfSession _perf;
    private readonly IReader _reader;

    private PanelTab? _tab; // the navigator's tab (Flows or Explorer), chosen on its rail or its strip; null: the navigator is closed
    private double _navWidth = Camera.Nav; // dragged by the sashes on the panels' edges
    private double _detailsWidth = Camera.Panel;
    private readonly HashSet<string> _expanded = [Names.Root]; // the shapes whose children show in the Explorer; the project's own row starts open
    private string? _revealedView; // the level and the shape the tree last followed, so it follows a change and not every redraw
    private string? _revealedBox;

    public Panels(NavigatorPanel nav, NavRail rail, NavRail detailsRail, Sash navSash, Sash detailsSash, SidePanel details, CanvasView canvas, PerfSession perf, IReader reader)
    {
        _nav = nav;
        _rail = rail;
        _detailsRail = detailsRail;
        _navSash = navSash;
        _detailsSash = detailsSash;
        _details = details;
        _canvas = canvas;
        _perf = perf;
        _reader = reader;
        _details.Closed += CloseDetails;
        _nav.Tabs.Picked += SetTab;
        _nav.Closed += CloseNav;
        _nav.Explorer.Toggled += ToggleOpen;
        _rail.Picked += ToggleTab;
        _detailsRail.Picked += ToggleTab;
        _navSash.Current = () => _navWidth;
        _navSash.Resized += w => ResizeNav(w);
        _navSash.Reset += () => ResizeNav(Camera.Nav);
        _navSash.Settled += Remember;
        _detailsSash.Current = () => _detailsWidth;
        _detailsSash.Resized += w => ResizeDetails(w);
        _detailsSash.Reset += () => ResizeDetails(Camera.Panel);
        _detailsSash.Settled += Remember;
    }

    /// <summary>What the navigator remembers for this project changed: the tab, which shapes are open in the tree, or how wide a panel is.</summary>
    public event Action<NavigatorState>? Changed;

    /// <summary>A sash was dragged: the panels are at their new widths, and what sits beside them has to follow.</summary>
    public event Action? Resized;

    /// <summary>The navigator's tab as chosen, whether or not it can show now.</summary>
    internal PanelTab? Tab => _tab;

    /// <summary>The navigator is where the reader last clicked or opened something: Escape closes it then, and leaves it alone once they work in the diagram.</summary>
    internal bool NavUsed { get; set; }

    /// <summary>Details is also open while something is picked.</summary>
    internal RightPanel Right { get; set; }

    internal double NavWidth => _navWidth;

    internal double DetailsWidth => _detailsWidth;

    /// <summary>The navigator's tab showing (Explorer, Flows, Failures or Performance): the one chosen on its rail or its strip, else none. Flows, Failures and Performance are there only with a folder.</summary>
    internal PanelTab? ShownTab => _tab is PanelTab.Flows or PanelTab.Failures or PanelTab.Performance && _reader.Folder is null ? null : _tab;

    /// <summary>Whether the Details panel on the right is open: from its rail, or because something is picked.</summary>
    internal bool DetailsOpen => Right == RightPanel.Details || _reader.Pick is not (null or ReaderView.Side.Boxes);

    /// <summary>How much of the canvas the navigator covers.</summary>
    internal double NavInset => ShownTab is not null ? _navWidth : 0;

    /// <summary>How much of the canvas Details covers.</summary>
    internal double DetailsInset => DetailsOpen ? _detailsWidth : 0;

    internal IReadOnlySet<string> Expanded => _expanded;

    internal void SetTab(PanelTab tab)
    {
        if (tab is PanelTab.Failures or PanelTab.Performance && _reader.Folder is null) return;
        if (tab == PanelTab.Performance && !_reader.Editing) _perf.Open();
        if (tab != PanelTab.Performance) _perf.StopRamp(); // a ramp ends with its tab
        _tab = tab; // one tab at a time, so the load's traffic and the failure marks never draw over each other
        NavUsed = true; // opened or switched on purpose: Escape takes it back until the reader clicks in the diagram
        _reader.Refresh();
        Remember();
    }

    /// <summary>A click on a rail: open that panel, or close it when it is the one open.</summary>
    internal void ToggleTab(PanelTab tab)
    {
        if (tab == PanelTab.Details)
        {
            if (DetailsOpen) CloseDetails();
            else
            {
                Right = RightPanel.Details;
                _reader.Refresh();
            }
        }
        else if (ShownTab == tab) CloseNav();
        else SetTab(tab);
    }

    internal void CloseNav()
    {
        _tab = null;
        _perf.StopRamp();
        NavUsed = false;
        _reader.Refresh();
        _reader.TakeFocus();
        Remember();
    }

    internal void CloseDetails()
    {
        _reader.Pick = null;
        if (Right == RightPanel.Details) Right = RightPanel.Closed;
        _reader.Refresh();
        _reader.TakeFocus();
    }

    /// <summary>The navigator gives way when it is on this tab (a comparison opens over the Performance tab).</summary>
    internal void Leave(PanelTab tab)
    {
        if (_tab == tab) _tab = null;
    }

    /// <summary>Another folder was loaded: nothing is open on the right, and another folder's analyses and runs start from the top.</summary>
    internal void Reset()
    {
        NavUsed = false;
        Right = RightPanel.Closed;
        if (_tab is PanelTab.Failures or PanelTab.Performance) _tab = null;
    }

    /// <summary>What the canvas can give one panel: all of it but a strip to look at, and what the other panel takes. Unknown before the canvas is laid out.</summary>
    private double Spare(double other) => (_canvas.Bounds.Width > 0 ? _canvas.Bounds.Width : double.PositiveInfinity) - 160 - other;

    private void ResizeNav(double width)
    {
        _navWidth = NavigatorState.Clamp(width, Spare(_details.IsVisible ? _detailsWidth : 0));
        Resized?.Invoke();
    }

    private void ResizeDetails(double width)
    {
        _detailsWidth = NavigatorState.Clamp(width, Spare(ShownTab is not null ? _navWidth : 0));
        Resized?.Invoke();
    }

    /// <summary>Puts the panels and their sashes at the widths dragged.</summary>
    internal void Place()
    {
        _nav.Width = _navWidth;
        _details.Width = _detailsWidth;
        _navSash.IsVisible = ShownTab is not null;
        _navSash.Margin = new Thickness(_navWidth - 3, 0, 0, 0);
        _detailsSash.IsVisible = _details.IsVisible;
        _detailsSash.Margin = new Thickness(0, 0, _detailsWidth - 3, 0);
    }

    internal void ToggleOpen(string id, bool expand)
    {
        if (expand) _expanded.Add(id);
        else _expanded.Remove(id);
        _reader.Refresh();
        Remember();
    }

    /// <summary>The tree follows the canvas: going into a level opens it, and a selected shape's ancestors open. It only ever opens rows.</summary>
    internal void FollowCanvas(Model model, string view)
    {
        var selected = _reader.Pick is ReaderView.Side.Box box ? box.Id : null;
        var grew = false;
        if (view != _revealedView)
        {
            _revealedView = view;
            foreach (var id in Outlines.ExpandTo(model, view, _expanded, true)) grew |= _expanded.Add(id);
        }
        if (selected != _revealedBox)
        {
            _revealedBox = selected;
            if (selected is { } picked)
                foreach (var id in Outlines.ExpandTo(model, picked, _expanded)) grew |= _expanded.Add(id);
        }
        if (grew) Remember();
    }

    private void Remember() => Changed?.Invoke(new NavigatorState(
        _tab switch { PanelTab.Flows => "flows", PanelTab.Explorer => "explorer", _ => null },
        _expanded.Order(StringComparer.Ordinal).Take(NavigatorState.MaxExpanded).ToList(), _navWidth, _detailsWidth));

    /// <summary>Brings back what this project's navigator remembered: the tab that was open, which shapes were open in the tree, and how wide the panels were.</summary>
    internal void Restore(NavigatorState? saved)
    {
        _expanded.Clear();
        _expanded.Add(Names.Root);
        _revealedView = null;
        _revealedBox = null;
        _tab = saved?.Tab switch { "flows" => PanelTab.Flows, "explorer" => PanelTab.Explorer, _ => null };
        NavUsed = false; // brought back, not opened: Escape leaves it until the reader uses it
        _navWidth = saved?.NavWidth ?? Camera.Nav;
        _detailsWidth = saved?.DetailsWidth ?? Camera.Panel;
        foreach (var id in saved?.Expanded ?? []) _expanded.Add(id);
    }
}
