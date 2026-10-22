using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Flowy.App.Canvas;

namespace Flowy.App;

/// <summary>
/// What sits under a run's name in a comparison: the model canvas with its zoom buttons, and the run's own Performance panel in a scroll view. The panel goes beside the canvas when there is
/// room for both (wide and not tall: one pane of Swap, or a stacked pane), and under it when there is not (two panes side by side, each narrow). It is decided before the body is measured, so
/// the canvas never has a size in the wrong arrangement first (it fits its view once, when it first has a size, and would keep that zoom).
/// </summary>
internal sealed class RunBody : Grid
{
    /// <summary>The body is at least this wide, and wider than it is tall by a fifth: the panel goes beside the canvas.</summary>
    internal const double BesideFrom = 640;

    /// <summary>How wide the panel is when it sits beside the canvas.</summary>
    internal const double PanelWidth = 340;

    private readonly Border _holder = new() { Padding = new Thickness(16, 6, 16, 16) };
    private readonly Border _panelHost;
    private readonly Grid _view;
    private bool _beside;

    public RunBody(CanvasView canvas, Action fit)
    {
        var zoom = PaneChrome.ZoomButtons(canvas, fit);
        _view = new Grid { ClipToBounds = true, Children = { canvas, zoom } };
        _panelHost = new Border { Child = new ScrollViewer { HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Content = _holder }, Classes = { "runpanel" } };
        Children.Add(_view);
        Children.Add(_panelHost);
        Place(false);
    }

    /// <summary>Whether the panel sits beside the canvas (otherwise under it).</summary>
    public bool Beside => _beside;

    /// <summary>The panel on show: a run's own. It leaves the holder it was in before (Swap and Side by side share the panels of the runs).</summary>
    public void ShowPanel(PerfPanel panel)
    {
        if (ReferenceEquals(_holder.Child, panel)) return;
        if (panel.Parent is Border old) old.Child = null;
        _holder.Child = panel;
    }

    /// <summary>The panel in the holder, for the tests.</summary>
    internal PerfPanel? PanelShown => _holder.Child as PerfPanel;

    private void Place(bool beside)
    {
        _beside = beside;
        if (beside)
        {
            ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(new GridLength(PanelWidth))];
            RowDefinitions = [new RowDefinition(GridLength.Star)];
            SetColumn(_view, 0);
            SetColumn(_panelHost, 1);
            SetRow(_view, 0);
            SetRow(_panelHost, 0);
            _panelHost.BorderThickness = new Thickness(1, 0, 0, 0);
        }
        else
        {
            ColumnDefinitions = [new ColumnDefinition(GridLength.Star)];
            RowDefinitions = [new RowDefinition(new GridLength(3, GridUnitType.Star)) { MinHeight = 120 }, new RowDefinition(new GridLength(2, GridUnitType.Star))];
            SetColumn(_view, 0);
            SetColumn(_panelHost, 0);
            SetRow(_view, 0);
            SetRow(_panelHost, 1);
            _panelHost.BorderThickness = new Thickness(0, 1, 0, 0);
        }
    }

    protected override Size MeasureOverride(Size availableSize)
    {
        if (!double.IsInfinity(availableSize.Width) && !double.IsInfinity(availableSize.Height))
        {
            var beside = availableSize.Width >= BesideFrom && availableSize.Width >= availableSize.Height * 1.2;
            if (beside != _beside) Place(beside);
        }
        return base.MeasureOverride(availableSize);
    }
}
