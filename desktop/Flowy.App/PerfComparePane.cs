using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// One run of a comparison, in a pane of its own: its name over the model canvas with that run's traffic and states over time, and the run's own Performance panel (slider, readout, key)
/// under the canvas, or beside it when the pane is wide (see <see cref="RunBody"/>). Its place along the run, the dial the keys act on and its ramp are its own (a
/// <see cref="PaneRun"/>), and so are its zoom and pan, so acting in one pane never moves another. Both panes of a comparison draw the same level. It is the reader's single canvas cut down
/// to what a run needs: nothing is dragged or edited, and a double-click goes nowhere.
/// </summary>
internal sealed class PerfComparePane : Border, IRunKeys
{
    private readonly CanvasView _canvas = new();
    private readonly PaneRun _run;
    private readonly RunBody _body;
    private readonly Border _outline = new() { IsHitTestVisible = false, IsVisible = false };
    private readonly TextBlock _title;

    /// <summary>A box or a line (with the level this pane draws it in) was clicked.</summary>
    public event Action<ReaderView.Side>? Picked;

    /// <summary>The pane was pressed anywhere, or took a key: it is the one the Performance keys act on.</summary>
    public event Action? FocusRequested;

    /// <summary>The pane's empty area was clicked: the Details panel closes, as on the single canvas.</summary>
    public event Action? EmptyClicked;

    /// <summary>A control of the run's panel took the keyboard: the reader gives it back, so the keys work.</summary>
    public event Action? Used;

    /// <param name="run">The run this pane draws, bound to this pane's canvas.</param>
    /// <param name="copy">0, or 1 for the second pane of a run compared with itself, so the two can be told apart.</param>
    public PerfComparePane(PaneRun run, int copy = 0)
    {
        _run = run;
        Key = copy == 0 ? run.RunId : $"{run.RunId}#{copy}";
        run.Bind(_canvas);
        Classes.Add("pane");
        Focusable = false;

        var (head, title) = PaneChrome.Head();
        _title = title;
        Grid.SetRow(head, 0);
        _body = new RunBody(_canvas, Fit);
        Grid.SetRow(_body, 1);
        var content = new Grid { RowDefinitions = [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Star)], Children = { head, _body } };
        // The outline is drawn over the content, not as the pane's own border: a thicker border would move what is inside it.
        Child = new Grid { Children = { content, _outline } };
        ClipToBounds = true;

        _outline.Classes.Add("paneoutline");
        AutomationProperties.SetName(this, Key.Contains('#') ? $"{run.Name} (2)" : run.Name);
        _canvas.BoxClicked += id => Picked?.Invoke(new ReaderView.Side.Box(id));
        _canvas.EdgeClicked += id =>
        {
            FocusRequested?.Invoke();
            if (_run.LineSide(id) is { } side) Picked?.Invoke(side);
        };
        _canvas.EdgeHovered += _run.Hover;
        _canvas.PaneClicked += () =>
        {
            FocusRequested?.Invoke();
            EmptyClicked?.Invoke();
        };
        _canvas.FrameClicked += () => FocusRequested?.Invoke();
        run.Used += () =>
        {
            FocusRequested?.Invoke();
            Used?.Invoke();
        };
        // Every press, handled or not (the canvas and the panel handle their own): the pane is the one the keys act on from now.
        AddHandler(PointerPressedEvent, (_, _) => FocusRequested?.Invoke(), RoutingStrategies.Tunnel, handledEventsToo: true);
    }

    /// <summary>The pane's identity: its run's id, and a suffix for the second pane of a run compared with itself. It stays with the pane when the sides swap.</summary>
    public string Key { get; }

    public string RunId => _run.RunId;

    public PaneRun Run => _run;

    public CanvasView Canvas => _canvas;

    public PerfPanel Panel => _run.Panel;

    public PerfSession Session => _run.Session;

    public RunBody Body => _body;

    /// <summary>The pane's title: its run's own name.</summary>
    public string TitleText => _title.Text ?? "";

    /// <summary>Whether the pane has the focus: it is outlined, and the Performance keys act on it.</summary>
    public bool Focused
    {
        get => _outline.IsVisible;
        set
        {
            _outline.IsVisible = value;
            if (value) Classes.Add("focused");
            else Classes.Remove("focused");
        }
    }

    /// <summary>Draws the pane for the folder as it is now, on the level the comparison is on, with the shape or line the shared Details panel shows outlined.</summary>
    public void Show(Folder folder, string lineStyle, string view, ReaderView.Side? selection)
    {
        _run.Bind(_canvas); // after a trip through Swap the run draws here again
        _run.Drawing = true;
        _run.AutoFit = true;
        _run.Show(folder, lineStyle, view, selection);
        _body.ShowPanel(_run.Panel);
        _title.Text = _run.Name;
        ToolTip.SetTip(_title, _run.Name);
        AutomationProperties.SetName(this, Key.Contains('#') ? $"{_run.Name} (2)" : _run.Name);
    }

    public void Step(int by) => _run.Step(by);

    public void End(string which) => _run.End(which);

    public void Ramp() => _run.Ramp();

    /// <summary>Fits the whole level in the pane, as F does.</summary>
    public void Fit() => _canvas.Fit(0, false, 0, 220, refit: false);
}
