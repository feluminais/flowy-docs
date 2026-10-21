using System.Globalization;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Collections;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.VisualTree;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>What is picked on the canvas while the Performance panel is open: a shape, or the line between two.</summary>
internal sealed record PerfSelection(string? Id, string? From = null, string? To = null);

/// <summary>
/// Latency against load (or time), one point for each tested level: the expected call and the slowest 5%, a cursor where the slider is, and a dashed mark
/// where the run first struggles. Drawn in a 320 by 120 space that is scaled to the width it is given, as the browser's SVG is. The levels of a run over
/// time sit where their times are; the levels of a load run are evenly spaced.
/// </summary>
internal sealed class LatencyStrip : Control
{
    private static readonly Area Plot = new(44, 8, 266, 84);
    private readonly LoadRun _run;
    private readonly int? _kneeAt;
    private double _pos;

    public LatencyStrip(LoadRun run, int? kneeAt, double pos)
    {
        _run = run;
        _kneeAt = kneeAt;
        _pos = pos;
        IsHitTestVisible = false;
        AutomationProperties.SetName(this, $"Expected call and slowest 5% at each tested {(run.IsTime ? "time" : "load")}");
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    public void SetPos(double pos)
    {
        _pos = pos;
        InvalidateVisual();
    }

    protected override Size MeasureOverride(Size available) => new(double.IsInfinity(available.Width) ? 320 : available.Width, (double.IsInfinity(available.Width) ? 320 : available.Width) * 120 / 320);

    private IBrush Brush(string key) =>
        this.TryFindResource(key, ActualThemeVariant, out var found) && found is IBrush brush ? brush : Brushes.Gray;

    private FormattedText Text(string text, IBrush brush) =>
        new(text, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, new Typeface(FontFamily.Default), 10, brush);

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var p50 = _run.Levels.Select(l => l.Overall.P50).ToList();
        var p95 = _run.Levels.Select(l => l.Overall.P95).ToList();
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
        foreach (var (x, label) in PerfView.LevelLabels(_run, Plot))
        {
            var text = Text(label, muted);
            context.DrawText(text, new Point(x - text.Width / 2, 102));
        }
        if (_kneeAt is { } knee)
        {
            var x = PerfView.LevelX(_run, Plot, knee);
            context.DrawLine(new Pen(Brush("DangerBrush"), 1, new DashStyle([3, 3], 0)), new Point(x, Plot.Y), new Point(x, Plot.Y + Plot.Height));
        }
        Curve(context, p95, scale, Brush("WarnBrush"));
        Curve(context, p50, scale, Brush("AccentBrush"));
        var cursor = PerfView.CursorX(_run, Plot, _pos);
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

/// <summary>A gradient from green through amber to red, in the colours the canvas outlines a shape with in the theme that is showing.</summary>
internal sealed class HeatSwatch : Border
{
    public HeatSwatch()
    {
        Classes.Add("sw");
        Classes.Add("heat");
        ActualThemeVariantChanged += (_, _) => Fill();
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        Fill();
    }

    private void Fill()
    {
        var dark = ActualThemeVariant == Avalonia.Styling.ThemeVariant.Dark;
        var brush = new LinearGradientBrush { StartPoint = new RelativePoint(0, 0.5, RelativeUnit.Relative), EndPoint = new RelativePoint(1, 0.5, RelativeUnit.Relative) };
        foreach (var strain in new[] { 0.0, 0.5, 1.0 }) brush.GradientStops.Add(new GradientStop(Color.Parse(PerfColors.Hex(strain, dark)), strain));
        Background = brush;
    }
}

/// <summary>A row of marks, each drawn as it looks on the chart or the canvas with its name beside it: how the panel says what a colour or a shape means.</summary>
internal static class KeyRow
{
    public static Control Of(params (Control Swatch, string Label)?[] items)
    {
        var row = new WrapPanel();
        foreach (var item in items)
        {
            if (item is not { } entry) continue;
            var label = new TextBlock { Text = entry.Label, Classes = { "muted" }, FontSize = 12.5, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap };
            row.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(0, 0, 16, 6), Children = { entry.Swatch, label } });
        }
        return row;
    }

    /// <summary>A mark the styles draw: a line (<c>p50</c>, <c>p95</c>, <c>busy</c>), a dot (<c>call</c>, and <c>bad</c> as well for one that fails) or an outline (<c>none</c>).</summary>
    public static Control Mark(params string[] classes)
    {
        var mark = new Border();
        mark.Classes.Add("sw");
        foreach (var c in classes) mark.Classes.Add(c);
        return mark;
    }

    /// <summary>The red dashes that mark where a run first struggles.</summary>
    public static Control Dashes()
    {
        var dashes = new Avalonia.Controls.Shapes.Line { StartPoint = new Point(0, 0), EndPoint = new Point(0, 14), StrokeThickness = 2, StrokeDashArray = [1.5, 1.5], VerticalAlignment = VerticalAlignment.Center };
        dashes.Classes.Add("knee");
        return dashes;
    }

    /// <summary>A dot in a source's colour (the real dot, for the theme that is showing); without a colour, the accent the styles give a dot.</summary>
    public static Control Dot(string? color, bool dark, double size = 8, double opacity = 1)
    {
        var dot = new Border { Width = size, Height = size, CornerRadius = new CornerRadius(size / 2), Opacity = opacity };
        dot.Classes.Add("sw");
        if (PerfView.SourceHex(color, dark) is { } hex) dot.Background = new SolidColorBrush(Color.Parse(hex));
        else dot.Classes.Add("accent");
        return dot;
    }

    /// <summary>A small dot beside a big one: the dots of calls of different sizes.</summary>
    public static Control Bigger(string? color, bool dark) =>
        new StackPanel { Orientation = Orientation.Horizontal, Spacing = 3, VerticalAlignment = VerticalAlignment.Center, Children = { Dot(color, dark, 5), Dot(color, dark, 11) } };

    /// <summary>Dots that thin out: a line that is scaled down to fit the screen.</summary>
    public static Control Scaled(string? color, bool dark) =>
        new StackPanel { Orientation = Orientation.Horizontal, Spacing = 3, VerticalAlignment = VerticalAlignment.Center, Children = { Dot(color, dark, 6), Dot(color, dark, 6, 0.55), Dot(color, dark, 6, 0.25) } };

    /// <summary>A call that is turned away: a dot, and the bar it stops at.</summary>
    public static Control Rejected()
    {
        var bar = new Border();
        bar.Classes.Add("sw");
        bar.Classes.Add("bar");
        return new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, VerticalAlignment = VerticalAlignment.Center, Children = { Mark("call", "bad"), bar } };
    }

    /// <summary>The badge that says how many are waiting.</summary>
    public static Control Count(string number)
    {
        var badge = new Border { Child = new TextBlock { Text = number } };
        badge.Classes.Add("sw");
        badge.Classes.Add("queue");
        return badge;
    }
}

/// <summary>Keys and what they do, a cap or two and a word each: the hint under the slider.</summary>
internal static class KeyHint
{
    public static Control Of(params (string Keys, string What)[] hints)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        foreach (var (keys, what) in hints)
        {
            var hint = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
            // Keys that do the same thing are written with a space between: each is its own cap.
            foreach (var key in keys.Split(' '))
            {
                var cap = new Border { Child = new TextBlock { Text = key, FontSize = 12, FontFamily = new FontFamily("Cascadia Mono, Consolas, Menlo, monospace") } };
                cap.Classes.Add("kbd");
                hint.Children.Add(cap);
            }
            hint.Children.Add(new TextBlock { Text = what, Classes = { "muted" }, VerticalAlignment = VerticalAlignment.Center });
            row.Children.Add(hint);
        }
        return row;
    }
}

/// <summary>A small curve of one number across the tested levels, with a cursor where the slider is. Drawn in a 120 by 28 space.</summary>
internal sealed class Sparkline : Control
{
    private static readonly Area Plot = new(3, 3, 114, 22);
    private readonly LoadRun _run;
    private readonly IReadOnlyList<double?> _series;
    private readonly Scale _scale;
    private double _pos;

    public Sparkline(LoadRun run, IReadOnlyList<double?> series, MetricInfo info, double pos)
    {
        _run = run;
        _series = series;
        _scale = info.Log ? PerfView.ScaleOf(series, log: true) : PerfView.ScaleOf(series, from: 0, to: info.Max);
        _pos = pos;
        Width = 120;
        Height = 28;
        IsHitTestVisible = false;
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    public void SetPos(double pos)
    {
        _pos = pos;
        InvalidateVisual();
    }

    private IBrush Brush(string key) =>
        this.TryFindResource(key, ActualThemeVariant, out var found) && found is IBrush brush ? brush : Brushes.Gray;

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var d = PerfView.PathOf(_series, _scale, Plot, _run);
        if (d != "") context.DrawGeometry(null, new Pen(Brush("AccentBrush"), 1.75, lineCap: PenLineCap.Round, lineJoin: PenLineJoin.Round), Geometry.Parse(d));
        var x = PerfView.CursorX(_run, Plot, _pos);
        using var fade = context.PushOpacity(0.6);
        context.DrawLine(new Pen(Brush("FgBrush"), 1.5), new Point(x, 0), new Point(x, 28));
    }
}

/// <summary>The load or time of each tested level written under the slider, where its stop is (see <see cref="PerfView.TickLabels"/>, which thins them out).</summary>
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
        var muted = this.TryFindResource("MutedBrush", ActualThemeVariant, out var found) && found is IBrush b ? b : Brushes.Gray;
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
    private sealed record Reading(string Key, Func<LoadFrame, double?> At, TextBlock Value, Sparkline Curve, MetricInfo Info);

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
    private Model? _model;
    private string _view = "";
    private double _pos;
    private bool _ramping;
    private bool _still;
    private bool _syncing;
    private string _key = "";

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
            SetPos(_pos, _ramping);
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
        foreach (var key in new[] { "SliderThumbBackground", "SliderThumbBackgroundPointerOver", "SliderThumbBackgroundPressed", "SliderTrackValueFill", "SliderTrackValueFillPointerOver", "SliderTrackValueFillPressed" })
            _slider.Resources[key] = Resource("AccentBrush");
        _slider.Resources["SliderTrackFill"] = Resource("LineBrush");
        _slider.Resources["SliderTrackFillPointerOver"] = Resource("LineBrush");
    }

    private IBrush Resource(string key) =>
        this.TryFindResource(key, ActualThemeVariant, out var found) && found is IBrush b ? b : Brushes.Gray;

    private static string NameOf(Model model, string id) => Views.NameOf(model, id);

    /// <summary>
    /// Shows the run at a position. When only the position or the ramp changed it is updated in place; anything else (another run, another level of the
    /// diagram, another pick) builds the panel again.
    /// </summary>
    public void Show(Model model, string view, IdMap<LoadRun> runs, IReadOnlyList<Problem> runProblems, string runId, double pos, bool ramping, bool still, PerfSelection? selection)
    {
        var key = $"{Identity(model)}|{Identity(runs)}|{runProblems.Count}|{runId}|{view}|{still}|{selection}";
        if (key == _key && _run is not null)
        {
            SetPos(pos, ramping);
            return;
        }
        _key = key;
        Build(model, view, runs, runProblems, runId, pos, ramping, still, selection);
    }

    private static int Identity(object o) => System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(o);

    private void Build(Model model, string view, IdMap<LoadRun> runs, IReadOnlyList<Problem> runProblems, string runId, double pos, bool ramping, bool still, PerfSelection? selection)
    {
        Children.Clear();
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
        _model = model;
        _view = view;
        _pos = pos;
        _ramping = ramping;
        var knee = Perf.FindKnee(run);

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
            note.IsVisible = false;
            var header = new Button { Content = "▸ About this run" };
            header.Classes.Add("disclosure");
            header.Click += (_, _) =>
            {
                note.IsVisible = !note.IsVisible;
                header.Content = note.IsVisible ? "▾ About this run" : "▸ About this run";
                Used?.Invoke();
            };
            Children.Add(new StackPanel { Children = { header, note } });
        }

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

    private void BuildSelection(Model model, string view, LoadRun run, PerfSelection? selection)
    {
        Func<string, IReadOnlyList<double?>>? series = null;
        Func<LoadFrame, string, double?>? at = null;
        string[]? keys = null;
        var title = "Selected";
        if (selection is { Id: { } id })
        {
            title = NameOf(model, id);
            keys = PerfView.BoxKeys;
            series = key => PerfView.BoxSeries(model, run, view, id, key);
            at = (frame, key) => frame.Box(id)?[key];
        }
        else if (selection is { From: { } from, To: { } to })
        {
            title = $"{NameOf(model, from)} → {NameOf(model, to)}";
            keys = PerfView.LineKeys;
            series = key => PerfView.LineSeries(model, run, view, from, to, key);
            at = (frame, key) => frame.Line(from, to)?[key];
        }
        Children.Add(Chrome.Section(Icons.Info, title));
        if (keys is null)
        {
            Children.Add(Muted("Click a shape or a line."));
            return;
        }
        var any = false;
        foreach (var key in keys)
        {
            var values = series!(key);
            if (values.All(v => v is null)) continue;
            any = true;
            var info = PerfView.Metrics[key];
            var label = new TextBlock { Text = info.Label, Classes = { "muted" }, VerticalAlignment = VerticalAlignment.Center };
            var value = new TextBlock { FontWeight = FontWeight.SemiBold, VerticalAlignment = VerticalAlignment.Center };
            var curve = new Sparkline(run, values, info, _pos);
            var row = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 10, Children = { label, value, curve } };
            Grid.SetColumn(value, 1);
            Grid.SetColumn(curve, 2);
            Children.Add(row);
            _readings.Add(new Reading(key, frame => at!(frame, key), value, curve, info));
        }
        if (!any) Children.Add(Muted(selection is { Id: not null } ? "Nothing measured here or inside it." : "Nothing measured here."));
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
            var dark = ActualThemeVariant == Avalonia.Styling.ThemeVariant.Dark;
            _scaledLine = (scaledFrom, scaledTo);
            _scaledRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, IsVisible = false, Children = { KeyRow.Scaled(run.Source?.Color, dark), new TextBlock { Text = "Scaled down", Classes = { "muted" }, VerticalAlignment = VerticalAlignment.Center } } };
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
        var dark = ActualThemeVariant == Avalonia.Styling.ThemeVariant.Dark;
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
        if (_run is not { } run) return;
        _syncing = true;
        _slider.Value = PerfView.SliderValue(run, _pos);
        _syncing = false;
    }

    /// <summary>Moves the panel to a position, working out for itself what the readings say there.</summary>
    public void SetPos(double pos, bool ramping)
    {
        if (_run is not { } run || _model is not { } model) return;
        SetPos(pos, ramping, Perf.FrameAt(model, run, PerfView.LoadAt(run, pos), _view));
    }

    /// <summary>
    /// Moves the panel to a position without building it again: the number, the slider, the cursors, the readings and the Ramp button. The readings are
    /// those of <paramref name="frame"/>, which the caller worked out for this position and also drew the canvas from.
    /// </summary>
    public void SetPos(double pos, bool ramping, LoadFrame frame, IReadOnlyDictionary<string, StateMark>? states = null)
    {
        if (_run is not { } run) return;
        _pos = pos;
        _ramping = ramping;
        if (states is not null) _states = states;
        var load = PerfView.LoadAt(run, pos);
        _loadNumber.Text = PerfView.FmtLoad(load, run.Unit);
        if (PerfView.IsTested(pos)) _loadNote.Text = "Tested";
        else
        {
            var lower = run.Levels[Math.Min(PerfView.Top(run) - 1, (int)Math.Floor(pos))];
            var upper = run.Levels[Math.Min(PerfView.Top(run), (int)Math.Floor(pos) + 1)];
            _loadNote.Text = $"Between {lower.Load.ToString("R", CultureInfo.InvariantCulture)} and {upper.Load.ToString("R", CultureInfo.InvariantCulture)}, estimated";
        }
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
