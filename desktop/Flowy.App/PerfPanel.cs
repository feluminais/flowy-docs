using System.Globalization;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Collections;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.VisualTree;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>What is picked on the canvas while the Performance panel is open: a shape, or the line between two.</summary>
internal sealed record PerfSelection(string? Id, string? From = null, string? To = null);

//// <summary>
/// Latency against load (or time), one point for each tested level: the expected call and the slowest 5%, a cursor where the slider is, and a dashed mark
/// where the run first struggles. Drawn in a 320 by 120 space that is scaled to the width it is given, as the browser's SVG is. The levels of a run over
/// time sit where their times are; the levels of a load run are evenly spaced. For a run with several sources it is drawn along one dial, the others held
/// where they stand (<see cref="PerfView.ActiveSeries"/>), with no mark for the first struggle: that is a step of every dial together.
/// </summary>
internal sealed class LatencyStrip : Control
{
    private static readonly Area Plot = new(44, 8, 266, 84);
    private readonly LoadRun? _run;
    private readonly Dial? _dial;
    private readonly int? _kneeAt;
    private IReadOnlyList<double?> _p50;
    private IReadOnlyList<double?> _p95;
    private double _pos;

    public LatencyStrip(LoadRun run, int? kneeAt, double pos)
    {
        _run = run;
        _kneeAt = kneeAt;
        _pos = pos;
        _p50 = run.Levels.Select(l => l.Overall.P50).ToList();
        _p95 = run.Levels.Select(l => l.Overall.P95).ToList();
        IsHitTestVisible = false;
        AutomationProperties.SetName(this, $"Expected call and slowest 5% at each tested {(run.IsTime ? "time" : "load")}");
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    /// <summary>The strip along one dial of a run with several sources: <paramref name="levels"/> are the level at each of the dial's tested loads.</summary>
    public LatencyStrip(IReadOnlyList<Level> levels, Dial dial, double pos)
    {
        _dial = dial;
        _pos = pos;
        _p50 = levels.Select(l => l.Overall.P50).ToList();
        _p95 = levels.Select(l => l.Overall.P95).ToList();
        IsHitTestVisible = false;
        AutomationProperties.SetName(this, $"Expected call and slowest 5% at each tested load of {dial.Name}");
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    public void SetPos(double pos)
    {
        _pos = pos;
        InvalidateVisual();
    }

    /// <summary>The levels along the dial changed (another dial was moved): the curves are drawn again.</summary>
    public void SetLevels(IReadOnlyList<Level> levels)
    {
        _p50 = levels.Select(l => l.Overall.P50).ToList();
        _p95 = levels.Select(l => l.Overall.P95).ToList();
        InvalidateVisual();
    }

    protected override Size MeasureOverride(Size available) => new(double.IsInfinity(available.Width) ? 320 : available.Width, (double.IsInfinity(available.Width) ? 320 : available.Width) * 120 / 320);

    private IBrush Brush(string key) => AppTheme.Brush(this, key);

    private FormattedText Text(string text, IBrush brush) =>
        new(text, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, new Typeface(FontFamily.Default), 10, brush);

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var p50 = _p50;
        var p95 = _p95;
        if (p50.All(v => v is null) && p95.All(v => v is null)) return;
        var scale = PerfView.ScaleOf(p50.Concat(p95), log: true);
        using var _ = context.PushTransform(Matrix.CreateScale(Bounds.Width / 320, Bounds.Width / 320));
        var muted = Brush("MutedBrush");
        var grid = new Pen(Brush("LineBrush"), 1);
        foreach (var (y, label) in PerfView.GridOf(scale, Plot))
        {
            context.DrawLine(grid, new Point(Plot.X, y), new Point(Plot.X + Plot.Width, y));
            var text = Text(label, muted);
            context.DrawText(text, new Point(Plot.X - 6 - text.Width, y - text.Height / 2));
        }
        var labels = _run is { } run ? PerfView.LevelLabels(run, Plot) : PerfView.DialTicks(_dial!).Select(t => (Plot.X + Plot.Width * t.Fraction, t.Label)).ToList();
        foreach (var (x, label) in labels)
        {
            var text = Text(label, muted);
            context.DrawText(text, new Point(x - text.Width / 2, 102));
        }
        if (_run is { } timed && _kneeAt is { } knee)
        {
            var x = PerfView.LevelX(timed, Plot, knee);
            context.DrawLine(new Pen(Brush("DangerBrush"), 1, new DashStyle([3, 3], 0)), new Point(x, Plot.Y), new Point(x, Plot.Y + Plot.Height));
        }
        Curve(context, p95, scale, Brush("WarnBrush"));
        Curve(context, p50, scale, Brush("AccentBrush"));
        var cursor = _run is { } placed ? PerfView.CursorX(placed, Plot, _pos) : PerfView.XAt(Plot, _pos, p50.Count);
        using var fade = context.PushOpacity(0.6);
        context.DrawLine(new Pen(Brush("FgBrush"), 1.5), new Point(cursor, Plot.Y), new Point(cursor, Plot.Y + Plot.Height));
    }

    private void Curve(DrawingContext context, IReadOnlyList<double?> values, Scale scale, IBrush brush)
    {
        var d = PerfView.PathOf(values, scale, Plot, _run);
        if (d == "") return;
        context.DrawGeometry(null, new Pen(brush, 2, lineCap: PenLineCap.Round, lineJoin: PenLineJoin.Round), Geometry.Parse(d));
    }
}

//// <summary>
/// A small curve of one number across the tested levels, with a cursor where the slider is. Drawn in a 120 by 28 space. For a run with several sources it
/// is drawn along one dial (the others held), evenly, and its series is given again whenever another dial is moved (<see cref="SetSeries"/>).
/// </summary>
internal sealed class Sparkline : Control
{
    private static readonly Area Plot = new(3, 3, 114, 22);
    private readonly LoadRun? _run;
    private readonly MetricInfo _info;
    private IReadOnlyList<double?> _series;
    private Scale _scale;
    private double _pos;

    public Sparkline(LoadRun run, IReadOnlyList<double?> series, MetricInfo info, double pos)
        : this(series, info, pos, run)
    {
    }

    public Sparkline(IReadOnlyList<double?> series, MetricInfo info, double pos, LoadRun? run = null)
    {
        _run = run;
        _info = info;
        _series = series;
        _scale = ScaleOf(series);
        _pos = pos;
        Width = 120;
        Height = 28;
        IsHitTestVisible = false;
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    private Scale ScaleOf(IReadOnlyList<double?> series) => _info.Log ? PerfView.ScaleOf(series, log: true) : PerfView.ScaleOf(series, from: 0, to: _info.Max);

    public void SetPos(double pos)
    {
        _pos = pos;
        InvalidateVisual();
    }

    /// <summary>The curve along the dial changed (another dial was moved).</summary>
    public void SetSeries(IReadOnlyList<double?> series)
    {
        _series = series;
        _scale = ScaleOf(series);
        InvalidateVisual();
    }

    private IBrush Brush(string key) => AppTheme.Brush(this, key);

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var d = PerfView.PathOf(_series, _scale, Plot, _run);
        if (d != "") context.DrawGeometry(null, new Pen(Brush("AccentBrush"), 1.75, lineCap: PenLineCap.Round, lineJoin: PenLineJoin.Round), Geometry.Parse(d));
        var x = _run is { } run ? PerfView.CursorX(run, Plot, _pos) : PerfView.XAt(Plot, _pos, _series.Count);
        using var fade = context.PushOpacity(0.6);
        context.DrawLine(new Pen(Brush("FgBrush"), 1.5), new Point(x, 0), new Point(x, 28));
    }
}

// <summary>The load or time of each tested level written under the slider, where its stop is (see <see cref="PerfView.TickLabels"/>, which thins them out).</summary>
internal sealed class TickLabels : Control
{
    /// <summary>A slider's thumb is not centred on the very end of its track.</summary>
    internal const double Edge = 9;

    private readonly IReadOnlyList<(double Fraction, string Label)> _ticks;

    public TickLabels(IReadOnlyList<(double Fraction, string Label)> ticks)
    {
        _ticks = ticks;
        Height = 16;
        IsHitTestVisible = false;
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var muted = AppTheme.Brush(this, "MutedBrush");
        foreach (var (fraction, label) in _ticks)
        {
            var text = new FormattedText(label, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, new Typeface(FontFamily.Default), 11, muted);
            var x = Edge + (Bounds.Width - 2 * Edge) * fraction;
            context.DrawText(text, new Point(x - text.Width / 2, 0));
        }
    }
}

/// <summary>
/// The events of a run over time as marks above the slider, each where its time is along it, in the colour of the state it leaves (a bar, dimmer until the run
/// has got there). Each says its time and what it says when pointed at, and a click on one goes there.
/// </summary>
internal sealed class EventMarks : Panel
{
    private readonly List<(Border Hit, Border Bar, double Fraction, RunEvent Event)> _marks = [];

    /// <summary>A mark was clicked: the position of its event along the run.</summary>
    public event Action<double>? Picked;

    public EventMarks(LoadRun run, Func<string, string> nameOf)
    {
        Height = 12;
        foreach (var (fraction, e) in PerfView.EventFractions(run))
        {
            var bar = new Border { Width = 4, Height = 12, HorizontalAlignment = HorizontalAlignment.Center, Opacity = 0.45 };
            bar.Classes.Add("eventmark");
            bar.Classes.Add("state-" + e.State);
            var hit = new Border { Width = 14, Height = 12, Background = Brushes.Transparent, Cursor = new Cursor(StandardCursorType.Hand), Child = bar };
            var words = $"{PerfView.FmtLoad(e.At, run.Unit)}: {Perf.EventText(e, nameOf)}";
            ToolTip.SetTip(hit, words);
            AutomationProperties.SetName(hit, words);
            var pos = PerfView.PosAt(run, e.At);
            hit.PointerPressed += (_, args) =>
            {
                if (!args.GetCurrentPoint(hit).Properties.IsLeftButtonPressed) return;
                args.Handled = true; // the slider under it does not take the press
                Picked?.Invoke(pos);
            };
            _marks.Add((hit, bar, fraction, e));
            Children.Add(hit);
        }
    }

    /// <summary>The marks of events the run has got to are drawn in full, the rest dimmer.</summary>
    public void SetTime(double time)
    {
        foreach (var (_, bar, _, e) in _marks) bar.Opacity = e.At <= time ? 1 : 0.45;
    }

    internal int Count => _marks.Count;

    protected override Size MeasureOverride(Size available)
    {
        foreach (var (hit, _, _, _) in _marks) hit.Measure(new Size(14, 12));
        return new Size(double.IsInfinity(available.Width) ? 0 : available.Width, 12);
    }

    protected override Size ArrangeOverride(Size final)
    {
        foreach (var (hit, _, fraction, _) in _marks) hit.Arrange(new Avalonia.Rect(TickLabels.Edge + (final.Width - 2 * TickLabels.Edge) * fraction - 7, 0, 14, 12));
        return final;
    }
}

/// <summary>
/// The Performance panel, in the place of Details: which run and where along it, what it says about where things first struggle, and the numbers of what
/// is picked. It is one control that lives for as long as the reader does and is updated in place, because a ramp changes the position twenty times a
/// second and must not rebuild the panel under the slider the reader is holding.
/// </summary>
internal sealed class PerfPanel : StackPanel
{
    private sealed record Reading(string Key, Func<LoadFrame, double?> At, TextBlock Value, Sparkline Curve, MetricInfo Info, Func<IReadOnlyList<Level>, IReadOnlyList<double?>>? Along = null);

    /// <summary>One dial of a run with several sources: its block, the number and note, its slider, its own Ramp, and the dot that carries its colour.</summary>
    private sealed record DialView(Dial Dial, Border Block, Border Dot, TextBlock Number, TextBlock Note, Slider Slider, Button Ramp);

    /// <summary>The line that says which dial the chart and the curves follow, and which are held: the name in its colour, and the held ones beside it.</summary>
    private sealed record AlongRow(Border Dot, TextBlock Name, TextBlock Held);

    private readonly Slider _slider = new() { Minimum = 0, TickFrequency = 1, TickPlacement = TickPlacement.BottomRight, Focusable = false };
    private readonly TextBlock _loadNumber = new() { FontSize = 26, FontWeight = FontWeight.SemiBold };
    private readonly TextBlock _loadNote = new() { TextWrapping = TextWrapping.Wrap, Classes = { "muted" }, VerticalAlignment = VerticalAlignment.Bottom };
    private readonly Button _ramp = new();
    private readonly List<Reading> _readings = [];
    private readonly StackPanel _keyRows = new();
    private string _keyShape = "";
    private StackPanel? _scaledRow;
    private (string From, string To)? _scaledLine;
    private LatencyStrip? _strip;
    private EventMarks? _marks;
    private readonly List<(Button Row, Border Dot, TextBlock[] Words, RunEvent Event, string Time, string Text)> _eventRows = [];
    private StackPanel? _stateRow; // under the readings of a picked shape: the state it is in, when it is in one
    private string? _stateOf;
    private StateMark? _stateShown;
    private IReadOnlyDictionary<string, StateMark> _states = new Dictionary<string, StateMark>(); // the shapes in a state on the canvas now
    private ComboBox? _picker;
    private LoadRun? _run;
    private IdMap<LoadRun>? _runs;
    private string _runId = "";
    private Dials? _dials; // for a run with several sources: what it is turned up on (null for a run of one)
    private List<double> _places = []; // where each dial stands
    private int _active; // the dial the keys act on, the chart and the curves follow
    private readonly List<DialView> _dialViews = [];
    private readonly List<AlongRow> _alongs = [];
    private TextBlock? _over; // under the readings of a picked shape: that runs added past its capacity
    private TextBlock? _mode; // how the sources were measured
    private Model? _model;
    private string _view = "";
    private double _pos;
    private bool _ramping;
    private bool _still;
    private bool _syncing;
    private PerfPanelModel? _shown; // what the panel was last built for

    /// <summary>The reader picked another run.</summary>
    public event Action<string>? RunPicked;

    /// <summary>The reader picked a tested level with Go there.</summary>
    public event Action<double>? LevelPicked;

    /// <summary>The reader moved the slider: where along the run it stands for (see <see cref="PerfView.SlidePos"/>).</summary>
    public event Action<double>? Slid;

    /// <summary>The reader picked an event, on the slider or in the list: where along the run it is.</summary>
    public event Action<double>? EventPicked;

    /// <summary>The reader pressed Ramp, Play or Pause.</summary>
    public event Action? RampClicked;

    /// <summary>A dial was moved or pressed: the keys act on it from now on. (Several sources.)</summary>
    public event Action<int>? DialActivated;

    /// <summary>The slider of a dial moved: which, and the tested load it stands for (a position along that dial). (Several sources.)</summary>
    public event Action<int, double>? DialSlid;

    /// <summary>The reader pressed the Ramp or Pause of a dial. (Several sources.)</summary>
    public event Action<int>? DialRamped;

    /// <summary>The reader pressed Go there: where every dial stands at the first struggle. (Several sources.)</summary>
    public event Action<IReadOnlyList<double>>? PlacePicked;

    /// <summary>The reader used a control that took the keyboard focus, so the reader gives it back and the keys work again.</summary>
    public event Action? Used;

    public PerfPanel()
    {
        Spacing = 12;
        _slider.ValueChanged += (_, e) =>
        {
            if (_syncing || _run is null) return;
            Slid?.Invoke(PerfView.SlidePos(_run, e.NewValue));
            Used?.Invoke();
        };
        ActualThemeVariantChanged += (_, _) =>
        {
            ThemeSlider();
            _keyShape = ""; // the dots of the key are in a colour for the theme, so they are drawn again
            if (_dials is { Mode: not Perf.ModeSingle }) SetPlaces(_places, _active, _ramping);
            else SetPos(_pos, _ramping);
        };
        _ramp.Classes.Add("tool");
        _ramp.Classes.Add("primary");
        _ramp.Click += (_, _) =>
        {
            RampClicked?.Invoke();
            Used?.Invoke();
        };
    }

    // What a test can look at.
    internal string LoadText => _loadNumber.Text ?? "";

    internal string LoadNote => _loadNote.Text ?? "";

    internal double SliderValue => _slider.Value;

    internal double SliderMaximum => _slider.Maximum;

    internal Button RampButton => _ramp;

    internal Slider Slider => _slider;

    /// <summary>For a run with several sources: each dial's name, number, note, slider and Ramp, and whether it is the active one.</summary>
    internal IReadOnlyList<(string Name, string Load, string Note, Slider Slider, Button Ramp, bool Active)> DialLines =>
        _dialViews.Select(v => (v.Dial.Name, v.Number.Text ?? "", v.Note.Text ?? "", v.Slider, v.Ramp, v.Block.Classes.Contains("active"))).ToList();

    /// <summary>How the sources were measured, in words (null for a run of one).</summary>
    internal string? ModeText => _mode?.Text;

    /// <summary>What the picked shape says when runs that were added made it pass its capacity, or null.</summary>
    internal string? OverShown => _over is { IsVisible: true } ? _over.Text : null;

    /// <summary>The lines that name the dial the chart and curves follow and the ones held: the dial, then the held ones.</summary>
    internal IReadOnlyList<(string Name, string Held)> AlongTexts => _alongs.Select(a => (a.Name.Text ?? "", a.Held.Text ?? "")).ToList();

    /// <summary>The words of the key, in the order it lists them.</summary>
    internal IReadOnlyList<string> KeyLabels => _keyRows.GetVisualDescendants().OfType<TextBlock>().Where(t => !t.GetVisualAncestors().OfType<Border>().Any(b => b.Classes.Contains("sw"))).Select(t => t.Text ?? "").ToList();

    /// <summary>Whether the selected line says it is scaled down.</summary>
    internal bool ScaledDownShown => _scaledRow is { IsVisible: true };

    internal ComboBox? Picker => _picker;

    /// <summary>The events as the list shows them: the time, the words, whether the run has got there and whether it is the latest it has.</summary>
    internal IReadOnlyList<(string Time, string Text, bool Passed, bool Current)> EventLines =>
        _eventRows.Select(r => (r.Time, r.Text, r.Dot.Classes.Contains("passed"), r.Row.Classes.Contains("current"))).ToList();

    /// <summary>The buttons of the event rows, to click.</summary>
    internal IReadOnlyList<Button> EventButtons => _eventRows.Select(r => r.Row).ToList();

    /// <summary>How many marks the slider carries, and the marks themselves.</summary>
    internal int EventMarkCount => _marks?.Count ?? 0;

    internal EventMarks? Marks => _marks;

    /// <summary>The state the picked shape is shown in under its readings, or null.</summary>
    internal string? SelectedState => _stateShown?.State;

    internal IReadOnlyList<(string Label, string Value)> Readings => _readings.Select(r => (r.Info.Label, r.Value.Text ?? "")).ToList();

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        ThemeSlider();
    }

    /// <summary>The slider in the app's own colours, not the theme's accent: the filled part of its track and its thumb in the accent, the rest of the track in the line colour.</summary>
    private void ThemeSlider()
    {
        ThemeSlider(_slider);
        foreach (var view in _dialViews) ThemeSlider(view.Slider);
    }

    private void ThemeSlider(Slider slider)
    {
        foreach (var key in new[] { "SliderThumbBackground", "SliderThumbBackgroundPointerOver", "SliderThumbBackgroundPressed", "SliderTrackValueFill", "SliderTrackValueFillPointerOver", "SliderTrackValueFillPressed" })
            slider.Resources[key] = Resource("AccentBrush");
        slider.Resources["SliderTrackFill"] = Resource("LineBrush");
        slider.Resources["SliderTrackFillPointerOver"] = Resource("LineBrush");
    }

    private IBrush Resource(string key) => AppTheme.Brush(this, key);

    private static string NameOf(Model model, string id) => Views.NameOf(model, id);

    /// <summary>
    /// Shows the run at a position. When only the position or the ramp changed it is updated in place; anything else (another run, another level of the
    /// diagram, another pick) builds the panel again.
    /// </summary>
    public void Show(PerfPanelModel next)
    {
        if (_shown is { } shown && next.SameBuild(shown) && _run is not null)
        {
            if (_dials is { Mode: not Perf.ModeSingle }) SetPlaces(next.Places ?? _places, next.Active, next.Ramping);
            else SetPos(next.Pos, next.Ramping);
            return;
        }
        _shown = next;
        Build(next);
    }

    private void Build(PerfPanelModel next)
    {
        var (model, view, runs, runProblems, runId, pos, ramping, still, selection, places, active) = next;
        Children.Clear();
        _dialViews.Clear();
        _alongs.Clear();
        _over = null;
        _mode = null;
        _dials = null;
        _runs = null;
        // The number, the note, the slider and the button live as long as the panel does, so the rows that held them last time let go of them first.
        foreach (Control kept in new Control[] { _loadNumber, _loadNote, _slider, _ramp, _keyRows })
            if (kept.Parent is Panel holder) holder.Children.Remove(kept);
        _readings.Clear();
        _scaledRow = null;
        _scaledLine = null;
        _picker = null;
        _strip = null;
        _marks = null;
        _eventRows.Clear();
        _stateRow = null;
        _stateOf = null;
        _stateShown = null;
        _still = still;
        var problems = ProblemsFor(runProblems);
        if (!runs.TryGetValue(runId, out var run))
        {
            _run = null;
            Children.Add(Muted("No run could be read."));
            Children.Add(problems);
            return;
        }
        _run = run;
        _runs = runs;
        _runId = runId;
        _model = model;
        _view = view;
        _pos = pos;
        _ramping = ramping;
        AddHeader(runs, runId, run);
        _dials = Perf.DialsOf(runs, runId);
        if (_dials is { Mode: not Perf.ModeSingle } several)
        {
            BuildDials(model, view, runs, runId, several, places ?? [.. several.Items.Select(_ => 0.0)], active, ramping, still, selection, problems);
            return;
        }
        var knee = Perf.FindKnee(run);

        var timed = run.IsTime;
        Children.Add(Chrome.Section(timed ? Icons.Clock : Icons.Activity, timed ? "Time" : "Load"));
        var number = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 10, Children = { _loadNumber, _loadNote } };
        Grid.SetColumn(_loadNote, 1);
        Children.Add(number);
        _syncing = true; // setting up the slider is not the reader moving it
        var (min, max) = PerfView.SliderRange(run);
        _slider.Minimum = min;
        _slider.Maximum = max;
        _slider.Value = min;
        // A load run's slider has a stop at each level, evenly; a run over time has its stops where its levels' times are.
        if (timed) _slider.Ticks = new AvaloniaList<double>(run.Levels.Select(l => l.Load));
        else
        {
            _slider.Ticks = null;
            _slider.TickFrequency = 1;
        }
        _syncing = false;
        AutomationProperties.SetName(_slider, timed ? "Time" : "Load");
        if (run.Events.Count > 0)
        {
            _marks = new EventMarks(run, id => NameOf(model, id));
            _marks.Picked += pos =>
            {
                EventPicked?.Invoke(pos);
                Used?.Invoke();
            };
            Children.Add(new StackPanel { Children = { _marks, _slider } });
        }
        else Children.Add(_slider);
        Children.Add(new TickLabels(PerfView.TickLabels(run)));
        var play = timed ? "Play" : "Ramp";
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        if (!still) buttons.Children.Add(_ramp);
        buttons.Children.Add(KeyHint.Of(still ? [("← →", "Step")] : [("← →", "Step"), ("P", play)]));
        Children.Add(buttons);
        if (run.Events.Count > 0) Children.Add(BuildEvents(model, run));

        Children.Add(Chrome.Section(Icons.Alert, "Where it struggles"));
        if (knee is null) Children.Add(Muted("It never struggled in the tested range."));
        else
        {
            var sentence = new TextBlock { Text = Perf.KneeText(run, knee, id => NameOf(model, id)) + " ", TextWrapping = TextWrapping.Wrap };
            var go = new Button { Content = new TextBlock { Text = "Go there" } };
            go.Classes.Add("link");
            go.Click += (_, _) =>
            {
                LevelPicked?.Invoke(knee.Index);
                Used?.Invoke();
            };
            Children.Add(new WrapPanel { Children = { sentence, go } });
        }
        _strip = new LatencyStrip(run, knee?.Index, pos);
        Children.Add(_strip);
        Children.Add(KeyRow.Of(
            (KeyRow.Mark("p50"), "Expected call"),
            (KeyRow.Mark("p95"), "Slowest 5%"),
            knee is null ? null : (KeyRow.Dashes(), "First struggles")));

        BuildSelection(model, view, run, selection);

        Children.Add(Chrome.Section(Icons.Info, "Key"));
        _keyShape = ""; // what the key holds depends on the lines on screen, so SetPos fills it
        Children.Add(_keyRows);
        Children.Add(problems);
        SetPos(pos, ramping);
    }

    /// <summary>The run's name (a picker when there is more than one run) and, when it has one, the About line that opens to its note.</summary>
    private void AddHeader(IdMap<LoadRun> runs, string runId, LoadRun run)
    {
        if (runs.Count > 1)
        {
            var picker = new ComboBox { HorizontalAlignment = HorizontalAlignment.Stretch, Margin = new Thickness(0, 0, 32, 0), ItemsSource = runs.Select(kv => kv.Value.Name).ToList(), SelectedIndex = runs.Keys.ToList().IndexOf(runId), Focusable = false };
            AutomationProperties.SetName(picker, "Run");
            picker.SelectionChanged += (_, _) =>
            {
                if (_syncing || picker.SelectedIndex < 0) return;
                RunPicked?.Invoke(runs.Keys[picker.SelectedIndex]);
                Used?.Invoke();
            };
            _picker = picker;
            Children.Add(picker);
        }
        else Children.Add(new TextBlock { Text = run.Name, FontSize = 18, FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 32, 0) });
        if (run.About is { } about)
        {
            var note = Muted(about);
            if (about.Length <= PerfView.AboutFoldsOver)
            {
                Children.Add(note);
                return;
            }
            // The twist sits where a section's icon does and the words where its title does, so the fold lines up with the headings below.
            note.IsVisible = false;
            note.Margin = new Thickness(22, 6, 0, 0);
            var chevron = Icons.Make(Icons.ChevronRight, "sectionicon", 14);
            chevron.RenderTransform = new RotateTransform(0);
            chevron.VerticalAlignment = VerticalAlignment.Center;
            var title = new TextBlock { Text = "About this run", VerticalAlignment = VerticalAlignment.Center };
            var header = new Button { Content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { chevron, title } } };
            header.Classes.Add("disclosure");
            AutomationProperties.SetName(header, "About this run");
            header.Click += (_, _) =>
            {
                note.IsVisible = !note.IsVisible;
                chevron.RenderTransform = new RotateTransform(note.IsVisible ? 90 : 0);
                Used?.Invoke();
            };
            Children.Add(new StackPanel { Children = { header, note } });
        }
    }

    /// <summary>The Events list: a row for each event, with the time, the state it leaves a shape in drawn as the canvas draws it, and its words. A click on a row goes there.</summary>
    private Control BuildEvents(Model model, LoadRun run)
    {
        var list = new StackPanel { Spacing = 2 };
        foreach (var e in run.Events)
        {
            var time = PerfView.FmtLoad(e.At, run.Unit);
            var text = Perf.EventText(e, id => NameOf(model, id));
            var dot = new Border();
            dot.Classes.Add("evdot");
            var when = new TextBlock { Text = time, FontWeight = FontWeight.SemiBold, VerticalAlignment = VerticalAlignment.Center };
            var words = new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center };
            Control swatch = e.State == "running"
                ? new PlainSwatch(false) { Margin = new Thickness(6, 0, 0, 0), VerticalAlignment = VerticalAlignment.Center }
                : new StateSwatch(new StateMark(e.State, false));
            AutomationProperties.SetName(swatch, States.Labels[e.State]);
            var stamp = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center, Children = { dot, when } };
            var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(new GridLength(84)), new ColumnDefinition(new GridLength(44)), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 4, Children = { stamp, swatch, words } };
            Grid.SetColumn(swatch, 1);
            Grid.SetColumn(words, 2);
            var row = new Button { Content = grid, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch, Focusable = false };
            row.Classes.Add("event");
            AutomationProperties.SetName(row, $"{time}, {text}, {States.Labels[e.State]}");
            var pos = PerfView.PosAt(run, e.At);
            row.Click += (_, _) =>
            {
                EventPicked?.Invoke(pos);
                Used?.Invoke();
            };
            _eventRows.Add((row, dot, [when, words], e, time, text));
            list.Children.Add(row);
        }
        return new StackPanel { Spacing = 12, Children = { Chrome.Section(Icons.Bolt, "Events"), list } };
    }

    /// <summary>
    /// What is picked, with its numbers: a curve of each across the tested levels. For a run with several sources (<paramref name="along"/> is the level at each load of the active dial, the
    /// others held) the curves are along that dial and are given again whenever another dial is moved.
    /// </summary>
    private void BuildSelection(Model model, string view, LoadRun run, PerfSelection? selection, IReadOnlyList<Level>? along = null)
    {
        Func<string, IReadOnlyList<double?>>? series = null;
        Func<LoadFrame, string, double?>? at = null;
        Func<string, Func<IReadOnlyList<Level>, IReadOnlyList<double?>>>? followed = null;
        string[]? keys = null;
        var title = "Selected";
        if (selection is { Id: { } id })
        {
            title = NameOf(model, id);
            keys = PerfView.BoxKeys;
            series = key => along is null ? PerfView.BoxSeries(model, run, view, id, key) : PerfView.BoxSeriesIn(model, along, view, id, key);
            followed = key => levels => PerfView.BoxSeriesIn(model, levels, view, id, key);
            at = (frame, key) => frame.Box(id)?[key];
        }
        else if (selection is { From: { } from, To: { } to })
        {
            title = $"{NameOf(model, from)} → {NameOf(model, to)}";
            keys = PerfView.LineKeys;
            series = key => along is null ? PerfView.LineSeries(model, run, view, from, to, key) : PerfView.LineSeriesIn(model, along, view, from, to, key);
            followed = key => levels => PerfView.LineSeriesIn(model, levels, view, from, to, key);
            at = (frame, key) => frame.Line(from, to)?[key];
        }
        Children.Add(Chrome.Section(Icons.Info, title));
        if (keys is null)
        {
            Children.Add(Muted("Click a shape or a line."));
            return;
        }
        var any = false;
        var held = false; // the line that names the dial the curves follow is put above the first curve
        foreach (var key in keys)
        {
            var values = series!(key);
            if (values.All(v => v is null)) continue;
            any = true;
            if (along is not null && !held)
            {
                held = true;
                Children.Add(AlongLine());
            }
            var info = PerfView.Metrics[key];
            var label = new TextBlock { Text = info.Label, Classes = { "muted" }, VerticalAlignment = VerticalAlignment.Center };
            var value = new TextBlock { FontWeight = FontWeight.SemiBold, VerticalAlignment = VerticalAlignment.Center };
            var curve = along is null ? new Sparkline(run, values, info, _pos) : new Sparkline(values, info, _places[_active]);
            var row = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 10, Children = { label, value, curve } };
            Grid.SetColumn(value, 1);
            Grid.SetColumn(curve, 2);
            Children.Add(row);
            _readings.Add(new Reading(key, frame => at!(frame, key), value, curve, info, along is null ? null : followed!(key)));
        }
        if (!any) Children.Add(Muted(selection is { Id: not null } ? "Nothing measured here or inside it." : "Nothing measured here."));
        if (along is not null && selection is { Id: not null })
        {
            // Hidden until runs that were added make the shape pass its capacity; SetPlaces shows it.
            _over = new TextBlock { Classes = { "dangertext" }, TextWrapping = TextWrapping.Wrap, IsVisible = false };
            Children.Add(_over);
        }
        if (selection is { Id: { } shape })
        {
            // Hidden until the shape is in a state; SetPos shows it.
            _stateOf = shape;
            _stateRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, IsVisible = false };
            Children.Add(_stateRow);
        }
        if (selection is { From: { } scaledFrom, To: { } scaledTo })
        {
            // Hidden until the line is scaled down to fit the screen; SetPos shows it.
            var dark = AppTheme.IsDark(this);
            _scaledLine = (scaledFrom, scaledTo);
            _scaledRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, IsVisible = false, Children = { KeyRow.Scaled(along is null ? run.Source?.Color : Perf.OtherColor, dark), new TextBlock { Text = "Scaled down", Classes = { "muted" }, VerticalAlignment = VerticalAlignment.Center } } };
            Children.Add(_scaledRow);
        }
    }

    /// <summary>
    /// The key: the marks of the panel that are always there, and what the lines on screen now add: the kinds of failing call, and what a run's source puts
    /// on screen (the scale in words, a bigger dot, a line scaled down). Drawn again only when what it shows changes, which a ramp does a few times.
    /// </summary>
    private void UpdateKey(LoadRun run, LoadFrame frame)
    {
        IReadOnlyList<LineTraffic> drawn = _still ? [] : frame.Traffic.Lines; // reduced motion draws no traffic, so the key says nothing of it
        var marks = PerfView.FailureMarksOf(drawn);
        var source = Perf.SourceKeyOf(run, drawn);
        var states = StateKey.Distinct(_states.Values);
        var shape = $"{marks}|{source}|{string.Join(",", states)}";
        if (shape == _keyShape) return;
        _keyShape = shape;
        var dark = AppTheme.IsDark(this);
        _keyRows.Children.Clear();
        _keyRows.Children.Add(KeyRow.Of(
            (new HeatSwatch(), "Busy"),
            (KeyRow.Count("3"), "Waiting"),
            (KeyRow.Mark("none"), "Not measured"),
            (KeyRow.Dot(source?.Color, dark), "A call (slower dots, slower calls)"),
            marks.Fade ? (KeyRow.Mark("call", "bad"), "A call that fails") : null,
            marks.Lost ? (KeyRow.Mark("lost"), "Lost call") : null,
            marks.Rejected ? (KeyRow.Rejected(), "Rejected call") : null,
            (KeyRow.Mark("busy"), "More calls"),
            source?.Scale is { } scale ? (KeyRow.Dot(source.Color, dark), scale) : null,
            source is { Bigger: true } ? (KeyRow.Bigger(source.Color, dark), "Bigger call") : null,
            source is { ScaledDown: true } ? (KeyRow.Scaled(source.Color, dark), "Scaled down") : null));
        if (StateKey.Of(_states.Values) is { } stateKey) _keyRows.Children.Add(stateKey); // the states on the canvas now: only those
    }

    /// <summary>The state of the picked shape, under its readings, when it is in one on the canvas now.</summary>
    private void ShowSelectedState()
    {
        if (_stateRow is null) return;
        var mark = _stateOf is { } id && _states.TryGetValue(id, out var found) && !found.Inside ? found : null;
        if (mark == _stateShown) return;
        _stateShown = mark;
        _stateRow.Children.Clear();
        _stateRow.IsVisible = mark is not null;
        if (mark is null) return;
        _stateRow.Children.Add(new StateGlyph(mark, 16));
        _stateRow.Children.Add(new TextBlock { Text = States.Labels[mark.State], VerticalAlignment = VerticalAlignment.Center });
    }

    /// <summary>Puts the thumb back on the level the panel is at, after a drag that took it somewhere between levels without reaching another.</summary>
    public void SnapSlider()
    {
        if (_run is not { } run || _dials is { Mode: not Perf.ModeSingle }) return;
        _syncing = true;
        _slider.Value = PerfView.SliderValue(run, _pos);
        _syncing = false;
    }

    /// <summary>Moves the panel to a position, working out for itself what the readings say there.</summary>
    public void SetPos(double pos, bool ramping)
    {
        if (_run is not { } run || _model is not { } model || _dials is { Mode: not Perf.ModeSingle }) return;
        SetPos(pos, ramping, Perf.FrameAt(model, run, PerfView.LoadAt(run, pos), _view));
    }

    /// <summary>
    /// Moves the panel to a position without building it again: the number, the slider, the cursors, the readings and the Ramp button. The readings are
    /// those of <paramref name="frame"/>, which the caller worked out for this position and also drew the canvas from.
    /// </summary>
    public void SetPos(double pos, bool ramping, LoadFrame frame, IReadOnlyDictionary<string, StateMark>? states = null)
    {
        if (_run is not { } run || _dials is { Mode: not Perf.ModeSingle }) return;
        _pos = pos;
        _ramping = ramping;
        if (states is not null) _states = states;
        var load = PerfView.LoadAt(run, pos);
        _loadNumber.Text = PerfView.FmtLoad(load, run.Unit);
        _loadNote.Text = PerfView.LoadNote(run, pos);
        _syncing = true;
        _slider.Value = PerfView.SliderValue(run, pos);
        _syncing = false;
        AutomationProperties.SetName(_slider, run.IsTime ? "Time" : "Load");
        Chrome.Fill(_ramp, ramping ? Icons.Pause : Icons.Play, ramping ? "Pause" : run.IsTime ? "Play" : "Ramp");
        _ramp.Classes.Set("pressed", ramping);
        _strip?.SetPos(pos);
        _marks?.SetTime(load);
        var rows = PerfView.EventRows(run, load);
        for (var i = 0; i < _eventRows.Count && i < rows.Count; i++)
        {
            var (row, dot, words, _, _, _) = _eventRows[i];
            row.Classes.Set("current", rows[i].Current);
            dot.Classes.Set("passed", rows[i].Passed);
            foreach (var word in words) word.Classes.Set("muted", !rows[i].Passed);
        }
        UpdateKey(run, frame);
        ShowSelectedState();
        if (_scaledRow is not null && _scaledLine is { } line) _scaledRow.IsVisible = !_still && frame.Traffic.Lines.Any(l => l.From == line.From && l.To == line.To && l.Capped);
        foreach (var r in _readings)
        {
            r.Value.Text = r.At(frame) is { } v ? r.Info.Show(v) : "–";
            r.Curve.SetPos(pos);
        }
    }

    // ---- a run with several sources -----------------------------------------------------------------------------

    /// <summary>
    /// The panel for a run that adds others or is tested together: how it was measured, a block for each dial, what it says about where everything first struggles
    /// rising together, and the chart and curves along the active dial with the others held (named). A port of what Performance.tsx shows for several sources.
    /// </summary>
    private void BuildDials(Model model, string view, IdMap<LoadRun> runs, string runId, Dials dials, IReadOnlyList<double> places, int active, bool ramping, bool still, PerfSelection? selection, Control problems)
    {
        _places = [.. places];
        _active = Math.Min(Math.Max(0, active), dials.Items.Count - 1);
        if (PerfView.ModeLabel(dials.Mode) is { } mode)
        {
            _mode = new TextBlock { Text = mode, Classes = { "muted" }, FontSize = 12.5 };
            Children.Add(new Border { Classes = { "modelabel" }, Child = _mode });
        }
        Children.Add(Chrome.Section(Icons.Activity, "Load"));
        for (var i = 0; i < dials.Items.Count; i++) Children.Add(BuildDial(i, dials.Items[i], still));
        Children.Add(KeyHint.Of(still ? [("← →", "Step")] : [("← →", "Step"), ("P", "Ramp")]));

        Children.Add(Chrome.Section(Icons.Alert, "Where it struggles"));
        var knee = Perf.KneeOf(runs, runId);
        if (knee is null) Children.Add(Muted("It never struggled in the tested range."));
        else
        {
            var sentence = new TextBlock { Text = Perf.KneeTextOf(runs, runId, knee, id => NameOf(model, id)) + " ", TextWrapping = TextWrapping.Wrap };
            var go = new Button { Content = new TextBlock { Text = "Go there" } };
            go.Classes.Add("link");
            go.Click += (_, _) =>
            {
                PlacePicked?.Invoke(PerfView.OpeningPositions(dials.Items, knee));
                Used?.Invoke();
            };
            Children.Add(new WrapPanel { Children = { sentence, go } });
        }
        Children.Add(AlongLine());
        var along = PerfView.ActiveSeries(runs, runId, dials.Items, _places, _active);
        _strip = new LatencyStrip(along, dials.Items[_active], _places[_active]);
        Children.Add(_strip);
        Children.Add(KeyRow.Of((KeyRow.Mark("p50"), "Expected call"), (KeyRow.Mark("p95"), "Slowest 5%")));

        BuildSelection(model, view, runs[runId], selection, along);

        Children.Add(Chrome.Section(Icons.Info, "Key"));
        _keyShape = ""; // what the key holds depends on the lines on screen, so SetPlaces fills it
        Children.Add(_keyRows);
        Children.Add(problems);
        SetPlaces(_places, _active, ramping);
    }

    /// <summary>One dial: its name beside a dot in its colour, the load it stands at and whether that was tested, its slider with the tested loads written under it, and its own Ramp.</summary>
    private Control BuildDial(int index, Dial dial, bool still)
    {
        var number = new TextBlock { FontSize = 22, FontWeight = FontWeight.SemiBold };
        var note = new TextBlock { TextWrapping = TextWrapping.Wrap, Classes = { "muted" }, VerticalAlignment = VerticalAlignment.Bottom };
        var slider = new Slider { Minimum = 0, Maximum = PerfView.DialTop(dial), Value = 0, TickFrequency = 1, TickPlacement = TickPlacement.BottomRight, Focusable = false };
        ThemeSlider(slider);
        AutomationProperties.SetName(slider, dial.Name);
        slider.ValueChanged += (_, e) =>
        {
            if (_syncing) return;
            DialSlid?.Invoke(index, PerfView.SlideDial(dial, e.NewValue));
            Used?.Invoke();
        };
        slider.AddHandler(InputElement.PointerPressedEvent, (_, _) => DialActivated?.Invoke(index), RoutingStrategies.Tunnel); // pressing it makes it the active dial
        var ramp = new Button { HorizontalAlignment = HorizontalAlignment.Left };
        ramp.Classes.Add("tool");
        ramp.Classes.Add("primary");
        ramp.Click += (_, _) =>
        {
            DialRamped?.Invoke(index);
            Used?.Invoke();
        };
        var dot = new Border { VerticalAlignment = VerticalAlignment.Center };
        var heading = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { dot, new TextBlock { Text = dial.Name, FontWeight = FontWeight.SemiBold } } };
        var load = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 10, Children = { number, note } };
        Grid.SetColumn(note, 1);
        var inside = new StackPanel { Spacing = 6, Children = { heading, load, slider, new TickLabels(PerfView.DialTicks(dial)) } };
        if (!still) inside.Children.Add(ramp);
        var block = new Border { Child = inside };
        block.Classes.Add("dial");
        _dialViews.Add(new DialView(dial, block, dot, number, note, slider, ramp));
        return block;
    }

    /// <summary>The line that says which dial the chart and the curves follow and which are held; SetPlaces writes it.</summary>
    private Control AlongLine()
    {
        var dot = new Border { VerticalAlignment = VerticalAlignment.Center };
        var name = new TextBlock { FontWeight = FontWeight.SemiBold, VerticalAlignment = VerticalAlignment.Center };
        var held = new TextBlock { Classes = { "muted" }, FontSize = 12.5, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center };
        _alongs.Add(new AlongRow(dot, name, held));
        return new WrapPanel { Children = { new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(0, 0, 10, 0), Children = { dot, name } }, held } };
    }

    /// <summary>Moves the panel of a run with several sources to where its dials stand, working out for itself what the readings say there.</summary>
    public void SetPlaces(IReadOnlyList<double> places, int active, bool ramping)
    {
        if (_runs is null || _dials is not { Mode: not Perf.ModeSingle } dials || _model is not { } model) return;
        SetPlaces(places, active, ramping, Perf.FrameOf(model, _runs, _runId, PerfView.SettingOf(dials.Items, places), _view));
    }

    /// <summary>
    /// Moves the panel of a run with several sources to where its dials stand without building it again: each dial's number, note, slider and Ramp (the active one marked), the chart and the
    /// curves along the active dial, the readings and the key. The readings are those of <paramref name="frame"/>, which the caller worked out for these places and also drew the canvas from.
    /// </summary>
    public void SetPlaces(IReadOnlyList<double> places, int active, bool ramping, LoadFrame frame, IReadOnlyDictionary<string, StateMark>? states = null)
    {
        if (_runs is null || _dials is not { Mode: not Perf.ModeSingle } dials) return;
        _places = [.. places];
        _active = Math.Min(Math.Max(0, active), dials.Items.Count - 1);
        _ramping = ramping;
        if (states is not null) _states = states;
        var dark = AppTheme.IsDark(this);
        _syncing = true; // putting the thumbs where the dials stand is not the reader moving them
        for (var i = 0; i < _dialViews.Count && i < _places.Count; i++)
        {
            var view = _dialViews[i];
            var here = i == _active;
            view.Number.Text = PerfView.FmtLoad(Perf.LoadOfPosition(view.Dial.Values, _places[i]), view.Dial.Unit);
            view.Note.Text = PerfView.LoadNote(view.Dial, _places[i]);
            view.Slider.Value = _places[i];
            var running = ramping && here;
            Chrome.Fill(view.Ramp, running ? Icons.Pause : Icons.Play, running ? "Pause" : "Ramp");
            view.Ramp.Classes.Set("pressed", running);
            AutomationProperties.SetName(view.Ramp, $"{(running ? "Pause" : "Ramp")} {view.Dial.Name}");
            view.Block.Classes.Set("active", here);
            view.Block.BorderBrush = here ? DialBrush(view.Dial, dark) : Brushes.Transparent;
            view.Dot.Child = KeyRow.Dot(view.Dial.Color, dark);
        }
        _syncing = false;
        var along = PerfView.ActiveSeries(_runs, _runId, dials.Items, _places, _active);
        _strip?.SetLevels(along);
        _strip?.SetPos(_places[_active]);
        var held = string.Join(", ", PerfView.HeldText(dials.Items, _places, _active));
        foreach (var row in _alongs)
        {
            row.Dot.Child = KeyRow.Dot(dials.Items[_active].Color, dark);
            row.Name.Text = dials.Items[_active].Name;
            row.Held.Text = held;
        }
        UpdateKeyMulti(frame);
        ShowSelectedState();
        if (_scaledRow is not null && _scaledLine is { } line) _scaledRow.IsVisible = !_still && frame.Traffic.Lines.Any(l => l.From == line.From && l.To == line.To && l.Capped);
        foreach (var r in _readings)
        {
            r.Value.Text = r.At(frame) is { } v ? r.Info.Show(v) : "–";
            if (r.Along is { } series) r.Curve.SetSeries(series(along));
            r.Curve.SetPos(_places[_active]);
        }
        if (_over is not null)
        {
            var text = _stateOf is { } shape ? PerfView.OverText(dials.Mode, frame.Box(shape)?.Util) : null;
            _over.Text = text ?? "";
            _over.IsVisible = text is not null;
        }
    }

    private static IBrush DialBrush(Dial dial, bool dark) => PerfView.SourceHex(dial.Color, dark) is { } hex ? new SolidColorBrush(Color.Parse(hex)) : Brushes.Transparent;

    /// <summary>
    /// The key of a run with several sources: the marks that are always there, what the lines on screen now add, and for each source that has a line its dot in its own colour, its name, its scale and
    /// its size. Drawn again only when what it shows changes.
    /// </summary>
    private void UpdateKeyMulti(LoadFrame frame)
    {
        IReadOnlyList<LineTraffic> drawn = _still ? [] : frame.Traffic.Lines; // reduced motion draws no traffic, so the key says nothing of it
        var marks = PerfView.FailureMarksOf(drawn);
        var keyed = Perf.SourceKeyAt(_runs!, _runId, drawn);
        var states = StateKey.Distinct(_states.Values);
        var shape = $"{marks}|{string.Join(";", keyed.Sources.Select(s => $"{s.Id}/{s.Color}/{s.Scale}/{s.Bigger}"))}|{keyed.ScaledDown}|{keyed.Other}|{string.Join(",", states)}";
        if (shape == _keyShape) return;
        _keyShape = shape;
        var dark = AppTheme.IsDark(this);
        var items = new List<(Control Swatch, string Label)?>
        {
            (new HeatSwatch(), "Busy"),
            (KeyRow.Count("3"), "Waiting"),
            (KeyRow.Mark("none"), "Not measured"),
            (KeyRow.Dot(Perf.OtherColor, dark), "A call (slower dots, slower calls)"),
        };
        if (marks.Fade) items.Add((KeyRow.Mark("call", "bad"), "A call that fails"));
        if (marks.Lost) items.Add((KeyRow.Mark("lost"), "Lost call"));
        if (marks.Rejected) items.Add((KeyRow.Rejected(), "Rejected call"));
        items.Add((KeyRow.Mark("busy"), "More calls"));
        foreach (var source in keyed.Sources)
        {
            items.Add((KeyRow.Dot(source.Color, dark), source.Name));
            if (source.Scale is { } scale) items.Add((KeyRow.Dot(source.Color, dark), scale));
            if (source.Bigger) items.Add((KeyRow.Bigger(source.Color, dark), "Bigger call"));
        }
        if (keyed.Other) items.Add((KeyRow.Dot(Perf.OtherColor, dark), "Other calls"));
        if (keyed.ScaledDown) items.Add((KeyRow.Scaled(Perf.OtherColor, dark), "Scaled down"));
        _keyRows.Children.Clear();
        _keyRows.Children.Add(KeyRow.Of([.. items]));
        if (StateKey.Of(_states.Values) is { } stateKey) _keyRows.Children.Add(stateKey);
    }

    // Words take their colour from a style, which follows the theme and the control's place in the tree; a brush looked up when the panel is built would not (it is built before it is shown, and lives through a theme change).
    private static TextBlock Muted(string text) => new() { Text = text, Classes = { "muted" }, TextWrapping = TextWrapping.Wrap };

    private Control ProblemsFor(IReadOnlyList<Problem> problems)
    {
        if (problems.Count == 0) return new Panel();
        var list = new StackPanel { Spacing = 3 };
        foreach (var p in problems) list.Children.Add(new TextBlock { Text = $"{p.File} {p.Message}", Classes = { "warntext" }, TextWrapping = TextWrapping.Wrap });
        return new StackPanel { Spacing = 8, Children = { Chrome.Section(Icons.Alert, "Problems", problems.Count), list } };
    }
}
