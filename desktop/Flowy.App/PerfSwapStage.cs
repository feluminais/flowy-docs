using Avalonia.Automation;
using Avalonia.Controls;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// Swap for runs: one canvas at full width for the two runs of a comparison, flipping between them, with the Performance panel of the run on show beside or under it. Both runs are alive
/// (each keeps its place along itself, its dial and its ramp across swaps, and across Swap sides) but only the one on show draws. Both draw the same level, so the shapes stay where they are:
/// a swap changes what the run measured (the shapes' outlines and the lines' thickness) and the traffic fades from one run's to the other's. The traffic fades out, the other run's takes the
/// canvas, and its traffic fades in, on one clock (<see cref="SwapPlans.CrossfadeDuration"/>). Under reduced motion it cuts. The run that goes off stops ramping.
/// </summary>
internal sealed class PerfSwapStage : Border, IRunKeys
{
    private readonly CanvasView _canvas = new();
    private readonly TextBlock _title;
    private readonly string[] _keys;
    private readonly PaneRun[] _runs;
    private readonly RunBody _body;
    private int _on;
    private bool _fitted;
    private string? _fittedView;
    private bool _swapping;
    private IDisposable? _clock;

    /// <summary>A box or a line (with the level the run on show draws it in) was clicked.</summary>
    public event Action<ReaderView.Side>? Picked;

    /// <summary>The empty area of the canvas was clicked: the Details panel closes, as on the single canvas.</summary>
    public event Action? EmptyClicked;

    /// <summary>A control of the panel took the keyboard: the reader gives it back, so the keys work.</summary>
    public event Action? Used;

    /// <param name="runs">The two runs, in an order that does not change when the sides swap.</param>
    /// <param name="keys">A name for each (the pane keys of the comparison: a run compared with itself has a suffix on the second), told apart.</param>
    public PerfSwapStage(IReadOnlyList<PaneRun> runs, IReadOnlyList<string> keys)
    {
        _keys = [.. keys];
        _runs = [.. runs];
        Classes.Add("pane");
        Classes.Add("swapstage");
        Focusable = false;
        ClipToBounds = true;

        var (head, title) = PaneChrome.Head();
        _title = title;
        Grid.SetRow(head, 0);
        _body = new RunBody(_canvas, Fit);
        Grid.SetRow(_body, 1);
        Child = new Grid { RowDefinitions = [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Star)], Children = { head, _body } };
        foreach (var run in _runs)
        {
            run.Bind(_canvas);
            run.AutoFit = false;
            run.Used += () =>
            {
                if (ReferenceEquals(run, Current)) Used?.Invoke();
            };
        }
        for (var i = 0; i < _runs.Length; i++) _runs[i].Drawing = i == _on;

        // A swap takes a third of a second and shows a canvas half way between two runs: nothing is picked from it.
        _canvas.BoxClicked += id =>
        {
            if (!_swapping) Picked?.Invoke(new ReaderView.Side.Box(id));
        };
        _canvas.EdgeClicked += id =>
        {
            if (!_swapping && Current.LineSide(id) is { } side) Picked?.Invoke(side);
        };
        _canvas.EdgeHovered += id =>
        {
            if (!_swapping) Current.Hover(id);
        };
        _canvas.PaneClicked += () => EmptyClicked?.Invoke();
        ShowName();
    }

    public CanvasView Canvas => _canvas;

    public RunBody Body => _body;

    /// <summary>The run on show.</summary>
    public PaneRun Current => _runs[_on];

    /// <summary>The key of the run on show.</summary>
    public string OnKey => _keys[_on];

    public IReadOnlyList<string> Keys => _keys;

    /// <summary>The run with this key.</summary>
    public PaneRun Run(string key) => _runs[Math.Max(0, Array.IndexOf(_keys, key))];

    /// <summary>The title over the canvas: the name of the run on show.</summary>
    public string TitleText => _title.Text ?? "";

    /// <summary>Whether a swap is under way.</summary>
    public bool Swapping => _swapping;

    // ---- showing ------------------------------------------------------------------------------------------------

    /// <summary>Puts the run with this key on show at once, before anything is drawn (the comparison opens on it).</summary>
    public void Open(string key)
    {
        _clock?.Dispose();
        _clock = null;
        _swapping = false;
        _canvas.TrafficOpacity = 1;
        _on = Math.Max(0, Array.IndexOf(_keys, key));
        for (var i = 0; i < _runs.Length; i++) _runs[i].Drawing = i == _on;
        ShowName();
    }

    /// <summary>
    /// Takes the folder as it is now, and draws the run on show. While a swap is under way the runs only take it, and the canvas is drawn from it when the swap switches runs.
    /// </summary>
    public void Show(Folder folder, string lineStyle, string view, ReaderView.Side? selection)
    {
        foreach (var run in _runs) run.Bind(_canvas);
        if (_fittedView != view) _fitted = false; // another level: fitted afresh
        _fittedView = view;
        foreach (var run in _runs) run.Show(folder, lineStyle, view, selection);
        // The camera fits the level once, when the canvas first has a size; after that it keeps the reader's zoom through a swap, since both runs draw the same level.
        if (!_fitted && _canvas.Scene is not null)
        {
            _fitted = true;
            _canvas.Fit(0, false, 0, 0, refit: false);
        }
        _body.ShowPanel(Current.Panel);
        ShowName();
    }

    private void ShowName()
    {
        var name = Current.Name;
        _title.Text = name;
        ToolTip.SetTip(_title, name);
        AutomationProperties.SetName(this, name);
    }

    /// <summary>Whether what the Details panel shows (a shape, or a line in a level) is on the canvas of the run on show. Both draw the same level, so it always is.</summary>
    public bool Holds(ReaderView.Side side) => side switch
    {
        ReaderView.Side.Box box => _canvas.Scene?.Boxes.Any(b => b.Id == box.Id) ?? true,
        ReaderView.Side.Line line => _canvas.Scene?.Edges.Any(e => e.Id == SceneBuilder.LineId(line.From, line.To)) ?? true,
        _ => true,
    };

    // ---- swapping -----------------------------------------------------------------------------------------------

    /// <summary>Puts the run with this key on show: the traffic of the other fades to its own. The run that goes off stops ramping, where it is.</summary>
    public void SwapTo(string key)
    {
        var index = Array.IndexOf(_keys, key);
        if (index < 0 || index == _on) return;
        Settle(); // a swap that is under way lands first, so nothing is left half faded
        Current.Session.StopRamp();
        _on = index;
        ShowName();
        Begin();
    }

    /// <summary>Swaps to the other run.</summary>
    public void Swap() => SwapTo(_keys[1 - _on]);

    /// <summary>Ends a swap that is under way where it was going: the other run is on show, drawn whole. It does nothing when none is.</summary>
    public void Settle()
    {
        if (!_swapping) return;
        _clock?.Dispose();
        _clock = null;
        Switch();
        Landed();
    }

    private void Begin()
    {
        var total = SwapPlans.CrossfadeDuration(MotionSettings.Reduced);
        if (total <= 0 || _canvas.Scene is null)
        {
            Switch();
            return;
        }
        _swapping = true;
        var switched = false;
        _clock = Anim.Run(this, total, t => t, progress =>
        {
            if (progress < 0.5)
            {
                _canvas.TrafficOpacity = 1 - 2 * progress;
                return;
            }
            if (!switched)
            {
                switched = true;
                Switch();
            }
            _canvas.TrafficOpacity = 2 * progress - 1;
        }, Landed);
    }

    /// <summary>The run on show takes the canvas, with its panel and the load it measured.</summary>
    private void Switch()
    {
        for (var i = 0; i < _runs.Length; i++) _runs[i].Drawing = i == _on;
        Current.Draw();
        _body.ShowPanel(Current.Panel);
    }

    private void Landed()
    {
        _clock = null;
        _swapping = false;
        _canvas.TrafficOpacity = 1;
    }

    // ---- what the keys do ---------------------------------------------------------------------------------------

    public void Step(int by)
    {
        Settle();
        Current.Step(by);
    }

    public void End(string which)
    {
        Settle();
        Current.End(which);
    }

    public void Ramp()
    {
        Settle();
        Current.Ramp();
    }

    /// <summary>Fits the whole level in the canvas, as F does.</summary>
    public void Fit() => _canvas.Fit(0, false, 0, 220, refit: false);
}
