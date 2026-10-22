using Avalonia.Automation;
using Avalonia.Controls;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// Swap: one canvas at full width for the two flows of a comparison, flipping between them. Both flows are alive (each keeps its step and its Autoplay across swaps, and across
/// Swap sides) but only the one on show draws, and its card and title are the ones shown. A swap runs between the two diagrams, as the browser's SwapCanvas does: the lines fade out,
/// the boxes both flows draw glide to their new place while the others fade in or out and the camera fits the incoming flow, and then the lines fade back in. A swap during a swap
/// goes on from where everything is now, so nothing is left half faded. Under reduced motion it cuts. A flow with a great many shapes cuts too, rather than move them all.
/// </summary>
internal sealed class SwapStage : Border, IFlowKeys
{
    /// <summary>More boxes than this (both flows' together) and the swap cuts: every frame would move them all.</summary>
    internal const int AnimateUpTo = 1500;

    /// <summary>One box while a swap moves it: what it is, where it is now, and where and how much it shows when the glide ends.</summary>
    private sealed class Live(SceneBox box, double x, double y, double presence, double toX, double toY, double toPresence)
    {
        public SceneBox Box { get; } = box;
        public double X { get; set; } = x;
        public double Y { get; set; } = y;
        public double Presence { get; set; } = presence;
        public double FromX { get; } = x;
        public double FromY { get; } = y;
        public double FromPresence { get; } = presence;
        public double ToX { get; } = toX;
        public double ToY { get; } = toY;
        public double ToPresence { get; } = toPresence;
    }

    private readonly CanvasView _canvas = new();
    private readonly TextBlock _title;
    private readonly string[] _keys;
    private readonly PaneFlow[] _flows;
    private int _on;
    private bool _fitted;
    private bool _swapping;
    private IDisposable? _run;
    private List<Live>? _live; // the boxes on the canvas while it holds a swap's bridge between the two diagrams

    /// <summary>A box or a line (with the view the flow on show draws it in) was clicked.</summary>
    public event Action<ReaderView.Side>? Picked;

    /// <summary>The empty area of the canvas was clicked: the Details panel closes, as on the single canvas.</summary>
    public event Action? EmptyClicked;

    /// <param name="flowIds">The two flows, in an order that does not change when the sides swap.</param>
    /// <param name="keys">A name for each (the pane keys of the comparison: a flow compared with itself has a suffix on the second), told apart.</param>
    public SwapStage(IReadOnlyList<string> flowIds, IReadOnlyList<string> keys)
    {
        _keys = [.. keys];
        Classes.Add("pane");
        Classes.Add("swapstage");
        Focusable = false;

        _flows = [.. flowIds.Select(id => new PaneFlow(this, id, _canvas, new PlayerCard(inPane: true)) { AutoFit = false })];
        for (var i = 0; i < _flows.Length; i++)
        {
            var flow = _flows[i];
            flow.Drawing = i == _on;
            flow.Drew += () =>
            {
                if (ReferenceEquals(flow, Current)) ShowName();
            };
        }
        var (head, title) = PaneChrome.Head();
        _title = title;
        Grid.SetRow(head, 0);

        var zoom = PaneChrome.ZoomButtons(_canvas, Fit);
        var stage = new Grid { ClipToBounds = true, Children = { _canvas, zoom } };
        foreach (var flow in _flows) stage.Children.Add(flow.Card);
        // A card leaves most of a short canvas to the diagram, and a fit keeps that much of the bottom clear for it.
        stage.SizeChanged += (_, e) =>
        {
            foreach (var flow in _flows) flow.Card.MaxHeight = Math.Max(150, e.NewSize.Height * 0.5);
        };
        _canvas.PlayerRoom = () => Math.Min(200, Math.Max(80, _canvas.Bounds.Height * 0.4));
        Grid.SetRow(stage, 1);
        Child = new Grid { RowDefinitions = [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Star)], Children = { head, stage } };

        // A swap takes under a second, and shows boxes and lines that are not all there: nothing is picked from it.
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

    /// <summary>The flow on show.</summary>
    public PaneFlow Current => _flows[_on];

    /// <summary>The key of the flow on show.</summary>
    public string OnKey => _keys[_on];

    public IReadOnlyList<string> Keys => _keys;

    /// <summary>The flow with this key.</summary>
    public PaneFlow Flow(string key) => _flows[Math.Max(0, Array.IndexOf(_keys, key))];

    /// <summary>The card of the flow on show, or none while a swap is under way.</summary>
    public PlayerCard? CardShown => _flows[_on].Card is { IsVisible: true } card ? card : null;

    /// <summary>The title over the canvas: the name of the flow on show.</summary>
    public string TitleText => _title.Text ?? "";

    /// <summary>Whether a swap is under way.</summary>
    public bool Swapping => _swapping;

    /// <summary>How much of the lines show now, for the tests.</summary>
    internal double LinesNow => _canvas.LinesOpacity;

    // ---- showing ------------------------------------------------------------------------------------------------

    /// <summary>Starts the flow with this key at a stop (the one it was at in the other view, or where it was playing when the comparison opened).</summary>
    public void Start(string key, int stop) => Flow(key).Start(stop);

    /// <summary>Puts the flow with this key on show at once, before anything is drawn (the comparison opens on it).</summary>
    public void Open(string key)
    {
        _run?.Dispose();
        _run = null;
        _live = null;
        _swapping = false;
        _canvas.ClearSwap();
        _on = Math.Max(0, Array.IndexOf(_keys, key));
        for (var i = 0; i < _flows.Length; i++) _flows[i].Drawing = i == _on;
        _fitted = false; // the canvas may hold the other flow: it is fitted again when this one is first drawn
        ShowName();
    }

    /// <summary>
    /// Takes the folder as it is now, and draws the flow on show. While a swap is under way the flows only take it, and the canvas is drawn from it when the swap ends. The camera
    /// fits the first flow once, when the canvas first has a size; after that it keeps the reader's zoom until a swap or F fits again.
    /// </summary>
    public void Show(Folder folder, string lineStyle, ReaderView.Side? selection)
    {
        foreach (var flow in _flows) flow.Show(folder, lineStyle, selection);
        if (_fitted || _swapping || _canvas.Scene is null) return;
        _fitted = true;
        _canvas.Fit(0, true, 0, 0, refit: false);
    }

    private void ShowName()
    {
        var name = Current.Name;
        _title.Text = name;
        ToolTip.SetTip(_title, name);
        AutomationProperties.SetName(this, name);
    }

    /// <summary>Whether what the Details panel shows (a shape, or a line in a view) is on the diagram of the flow on show: it stays open across a swap if so.</summary>
    public bool Holds(ReaderView.Side side)
    {
        if (Current.Frame()?.Scene is not { } scene) return false;
        return side switch
        {
            ReaderView.Side.Box box => scene.Boxes.Any(b => b.Id == box.Id),
            ReaderView.Side.Line line => line.View == scene.View && scene.Edges.Any(e => e.Id == SceneBuilder.LineId(line.From, line.To)),
            _ => true,
        };
    }

    // ---- swapping -----------------------------------------------------------------------------------------------

    /// <summary>Puts the flow with this key on show: the other flow's diagram swaps for this one's. The flow that goes off stops where it is.</summary>
    public void SwapTo(string key)
    {
        var index = Array.IndexOf(_keys, key);
        if (index < 0 || index == _on) return;
        Current.Playback.StopAuto();
        _on = index;
        ShowName();
        Begin();
    }

    /// <summary>Swaps to the other flow.</summary>
    public void Swap() => SwapTo(_keys[1 - _on]);

    /// <summary>Ends a swap that is under way where it was going: the other flow is on show, drawn whole. It does nothing when none is.</summary>
    public void Settle()
    {
        if (_swapping) Land();
    }

    private void Begin()
    {
        _run?.Dispose();
        _run = null;
        foreach (var flow in _flows) flow.Drawing = false; // the canvas is the stage's until the swap has ended
        var target = Current;
        if (target.Frame() is not { } frame || MotionSettings.Reduced || SwapPlans.Duration(false) <= 0 || Snapshot().Count + frame.Scene.Boxes.Count > AnimateUpTo)
        {
            Land();
            return;
        }
        _swapping = true;
        foreach (var flow in _flows) flow.Card.IsVisible = false;
        _canvas.StopStep();
        _canvas.SetMarks([]);
        // Three parts on one clock: the lines fade out (a line is drawn from where its boxes are, so it can't follow a box that glides; none if a swap that was under way has taken
        // them already), the boxes glide and the camera fits the incoming flow, and the lines fade back in. One clock rather than three animations in a row, so the parts can't drift.
        var lines = _canvas.LinesOpacity > 0.01 ? _canvas.LinesOpacity : 0;
        double fadeOut = SwapPlans.FadeMs * lines, glide = SwapPlans.Duration(false), fadeIn = SwapPlans.FadeMs, total = fadeOut + glide + fadeIn;
        var phase = 0; // 0 lines going, 1 boxes gliding, 2 lines coming back
        Gliding? moving = null;
        _run = Anim.Run(this, total, t => t, progress =>
        {
            var ms = progress * total;
            if (ms < fadeOut)
            {
                _canvas.LinesOpacity = lines * (1 - ms / fadeOut);
                return;
            }
            if (phase == 0)
            {
                _canvas.LinesOpacity = 0;
                moving = StartGlide(frame);
                phase = 1;
            }
            if (ms < fadeOut + glide)
            {
                moving!.To(Anim.EaseInOut((ms - fadeOut) / glide));
                return;
            }
            if (phase == 1)
            {
                moving!.To(1);
                EndGlide();
                phase = 2;
            }
            _canvas.LinesOpacity = Math.Min(1, (ms - fadeOut - glide) / fadeIn);
        }, Landed);
    }

    /// <summary>The boxes on the canvas now, each where it is and how much of it shows: the scene's boxes at rest, the bridge's mid-swap.</summary>
    private List<Live> Snapshot() =>
        _live is not null
            ? [.. _live.Select(l => new Live(l.Box, l.X, l.Y, l.Presence, l.X, l.Y, l.Presence))]
            : [.. (_canvas.Scene?.Boxes ?? []).Select(b => new Live(b, b.Rect.X, b.Rect.Y, 1, b.Rect.X, b.Rect.Y, 1))];

    /// <summary>Boxes on the way to the other flow's places, and the camera with them.</summary>
    private sealed class Gliding(List<Live> items, Viewport from, Viewport to, CanvasView canvas)
    {
        /// <summary>Everything is <paramref name="t"/> of the way (0 to 1, already eased).</summary>
        public void To(double t)
        {
            foreach (var l in items)
            {
                l.X = l.FromX + (l.ToX - l.FromX) * t;
                l.Y = l.FromY + (l.ToY - l.FromY) * t;
                l.Presence = l.FromPresence + (l.ToPresence - l.FromPresence) * t;
                canvas.PlaceBox(l.Box.Id, l.X, l.Y);
                canvas.SetBoxPresence(l.Box.Id, l.Presence);
            }
            canvas.MoveTo(new Viewport(from.X + (to.X - from.X) * t, from.Y + (to.Y - from.Y) * t, from.Zoom + (to.Zoom - from.Zoom) * t));
        }
    }

    /// <summary>Puts both diagrams' boxes on the canvas, each where it starts, with no lines; the plan says which glide, which come and which go.</summary>
    private Gliding StartGlide(FlowFrame frame)
    {
        var now = Snapshot();
        var was = new Dictionary<string, Live>(StringComparer.Ordinal);
        foreach (var l in now) was[l.Box.Id] = l;
        var going = new Dictionary<string, SceneBox>(StringComparer.Ordinal);
        foreach (var b in frame.Scene.Boxes) going[b.Id] = b;
        var plan = SwapPlans.Plan([.. now.Select(l => (l.Box.Id, l.X, l.Y))], [.. frame.Scene.Boxes.Select(b => (b.Id, b.Rect.X, b.Rect.Y))]);

        // Boxes both flows draw glide from where they are to where the new flow has them; new ones fade in where they will be; old ones fade out where they are.
        var items = new List<Live>();
        foreach (var g in plan.Stay) items.Add(new Live(going[g.Id], g.From.X, g.From.Y, was[g.Id].Presence, g.To.X, g.To.Y, 1));
        foreach (var id in plan.Entering) items.Add(new Live(going[id], going[id].Rect.X, going[id].Rect.Y, 0, going[id].Rect.X, going[id].Rect.Y, 1));
        foreach (var id in plan.Leaving) items.Add(new Live(was[id].Box, was[id].X, was[id].Y, was[id].Presence, was[id].X, was[id].Y, 0));
        _live = items;

        // The canvas holds both diagrams' boxes and no lines, each box where it starts. Setting it does not move the camera.
        var start = new Scene(frame.Scene.View, "", [.. items.Select(l => l.Box with { Rect = l.Box.Rect with { X = l.X, Y = l.Y } })], [], null, frame.Scene.Members);
        _canvas.SetScene(start, Current.LineStyle, frame.Selected);
        foreach (var l in items) _canvas.SetBoxPresence(l.Box.Id, l.Presence);

        return new Gliding(items, _canvas.Viewport, _canvas.FitOf(frame.Scene) ?? _canvas.Viewport, _canvas);
    }

    /// <summary>The boxes have settled: the new flow's diagram takes the canvas, drawn whole (its lines come back with the rest of the clock).</summary>
    private void EndGlide()
    {
        _live = null;
        Current.Drawing = true;
        Current.DrawScene();
        _canvas.ClearSwap();
        _canvas.LinesOpacity = 0;
    }

    /// <summary>The swap is over, or was cut: the flow on show is drawn whole, with its card, its marks and its step's motion, as the camera fits it.</summary>
    private void Land()
    {
        _run?.Dispose();
        _live = null;
        var target = Current;
        target.Drawing = true;
        target.DrawScene();
        _canvas.ClearSwap();
        _canvas.Fit(0, true, 0, 0, refit: false);
        Landed();
    }

    private void Landed()
    {
        _run = null;
        _live = null;
        _swapping = false;
        _canvas.ClearSwap();
        // The step's motion plays again as the flow comes on, since what the other flow's did was cleared.
        Current.Replay();
    }

    // ---- what the keys do ---------------------------------------------------------------------------------------

    /// <summary>One stop on (1) or back (-1) in the flow on show.</summary>
    public void Step(int by)
    {
        Settle();
        Current.Step(by);
    }

    public void First()
    {
        Settle();
        Current.First();
    }

    public void Last()
    {
        Settle();
        Current.Last();
    }

    public void TogglePlay()
    {
        Settle();
        Current.TogglePlay();
    }

    public void Replay()
    {
        Settle();
        Current.Replay();
    }

    /// <summary>Fits the whole flow's view in the canvas, as F does.</summary>
    public void Fit()
    {
        Settle();
        _canvas.Fit(0, true, 0, 220, refit: false);
    }
}
