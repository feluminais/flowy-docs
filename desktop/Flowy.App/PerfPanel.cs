using System.Globalization;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>What is picked on the canvas while the Performance panel is open: a shape, or the line between two.</summary>
internal sealed record PerfSelection(string? Id, string? From = null, string? To = null);

/// <summary>
/// Latency against load, one point for each tested level: the typical call and the slowest 1 in 20, a cursor where the slider is, and a dashed mark
/// where the run first struggles. Drawn in a 320 by 120 space that is scaled to the width it is given, as the browser's SVG is.
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
        AutomationProperties.SetName(this, "Typical and slowest latency at each tested load");
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
        var n = _run.Levels.Count;
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
            var x = PerfView.XAt(Plot, knee, n);
            context.DrawLine(new Pen(Brush("DangerBrush"), 1, new DashStyle([3, 3], 0)), new Point(x, Plot.Y), new Point(x, Plot.Y + Plot.Height));
        }
        Curve(context, p95, scale, Brush("WarnBrush"));
        Curve(context, p50, scale, Brush("AccentBrush"));
        var cursor = PerfView.XAt(Plot, _pos, n);
        using var fade = context.PushOpacity(0.6);
        context.DrawLine(new Pen(Brush("FgBrush"), 1.5), new Point(cursor, Plot.Y), new Point(cursor, Plot.Y + Plot.Height));
    }

    private static void Curve(DrawingContext context, IReadOnlyList<double?> values, Scale scale, IBrush brush)
    {
        var d = PerfView.PathOf(values, scale, Plot);
        if (d == "") return;
        context.DrawGeometry(null, new Pen(brush, 2, lineCap: PenLineCap.Round, lineJoin: PenLineJoin.Round), Geometry.Parse(d));
    }
}

/// <summary>A small curve of one number across the tested levels, with a cursor where the slider is. Drawn in a 120 by 28 space.</summary>
internal sealed class Sparkline : Control
{
    private static readonly Area Plot = new(3, 3, 114, 22);
    private readonly IReadOnlyList<double?> _series;
    private readonly Scale _scale;
    private double _pos;

    public Sparkline(IReadOnlyList<double?> series, MetricInfo info, double pos)
    {
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
        var d = PerfView.PathOf(_series, _scale, Plot);
        if (d != "") context.DrawGeometry(null, new Pen(Brush("AccentBrush"), 1.75, lineCap: PenLineCap.Round, lineJoin: PenLineJoin.Round), Geometry.Parse(d));
        var x = PerfView.XAt(Plot, _pos, _series.Count);
        using var fade = context.PushOpacity(0.6);
        context.DrawLine(new Pen(Brush("FgBrush"), 1.5), new Point(x, 0), new Point(x, 28));
    }
}

/// <summary>The load of each tested level written under the slider, where its stop is.</summary>
internal sealed class TickLabels : Control
{
    private readonly IReadOnlyList<string> _labels;

    public TickLabels(IReadOnlyList<string> labels)
    {
        _labels = labels;
        Height = 16;
        IsHitTestVisible = false;
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var muted = this.TryFindResource("MutedBrush", ActualThemeVariant, out var found) && found is IBrush b ? b : Brushes.Gray;
        var n = _labels.Count;
        var every = (int)Math.Ceiling(n / 8.0);
        const double edge = 9; // a slider's thumb is not centred on the very end of its track
        for (var i = 0; i < n; i++)
        {
            if (i % every != 0 && i != n - 1) continue;
            var text = new FormattedText(_labels[i], CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, new Typeface(FontFamily.Default), 11, muted);
            var x = edge + (Bounds.Width - 2 * edge) * (n <= 1 ? 0 : (double)i / (n - 1));
            context.DrawText(text, new Point(x - text.Width / 2, 0));
        }
    }
}

/// <summary>
/// The Performance panel, in the place of Details: which run and where along it, what it says about where things first struggle, and the numbers of what
/// is picked. It is one control that lives for as long as the reader does and is updated in place, because a ramp changes the position twenty times a
/// second and must not rebuild the panel under the slider the reader is holding.
/// </summary>
internal sealed class PerfPanel : StackPanel
{
    private sealed record Reading(string Key, Func<double, double?> At, TextBlock Value, Sparkline Curve, MetricInfo Info);

    private readonly Slider _slider = new() { Minimum = 0, TickFrequency = 1, TickPlacement = TickPlacement.BottomRight, Focusable = false };
    private readonly TextBlock _loadNumber = new() { FontSize = 26, FontWeight = FontWeight.SemiBold };
    private readonly TextBlock _loadNote = new() { TextWrapping = TextWrapping.Wrap, Classes = { "muted" }, VerticalAlignment = VerticalAlignment.Bottom };
    private readonly Button _ramp = new();
    private readonly List<Reading> _readings = [];
    private LatencyStrip? _strip;
    private ComboBox? _picker;
    private LoadRun? _run;
    private double _pos;
    private bool _ramping;
    private bool _still;
    private bool _syncing;
    private string _key = "";

    /// <summary>The reader picked another run.</summary>
    public event Action<string>? RunPicked;

    /// <summary>The reader picked a tested level: on the slider, or with Go there.</summary>
    public event Action<double>? LevelPicked;

    /// <summary>The reader pressed Ramp or Pause.</summary>
    public event Action? RampClicked;

    /// <summary>The reader used a control that took the keyboard focus, so the reader gives it back and the keys work again.</summary>
    public event Action? Used;

    public PerfPanel()
    {
        Spacing = 12;
        _slider.ValueChanged += (_, e) =>
        {
            if (_syncing || _run is null) return;
            LevelPicked?.Invoke(PerfView.Snap(_run, e.NewValue));
            Used?.Invoke();
        };
        ActualThemeVariantChanged += (_, _) => ThemeSlider();
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

    internal ComboBox? Picker => _picker;

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
        foreach (Control kept in new Control[] { _loadNumber, _loadNote, _slider, _ramp })
            if (kept.Parent is Panel holder) holder.Children.Remove(kept);
        _readings.Clear();
        _picker = null;
        _strip = null;
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

        Children.Add(Chrome.Section(Icons.Activity, "Load"));
        var number = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 10, Children = { _loadNumber, _loadNote } };
        Grid.SetColumn(_loadNote, 1);
        Children.Add(number);
        _syncing = true; // setting up the slider is not the reader moving it
        _slider.Maximum = PerfView.Top(run);
        _slider.Value = 0;
        _syncing = false;
        AutomationProperties.SetName(_slider, "Load");
        Children.Add(_slider);
        Children.Add(new TickLabels(run.Levels.Select(l => l.Load.ToString("R", CultureInfo.InvariantCulture)).ToList()));
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        if (!still) buttons.Children.Add(_ramp);
        buttons.Children.Add(new TextBlock { Text = still ? "← → step the levels" : "← → step the levels, P ramps up", Classes = { "muted" }, VerticalAlignment = VerticalAlignment.Center });
        Children.Add(buttons);

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
        Children.Add(new TextBlock { Text = "Blue: the typical call. Amber: the slowest 1 in 20." + (knee is null ? "" : " The red dashes: where it first struggles."), Classes = { "muted" }, FontSize = 12, TextWrapping = TextWrapping.Wrap });

        BuildSelection(model, view, run, selection);

        Children.Add(Chrome.Section(Icons.Info, "Key"));
        Children.Add(Muted("A shape's outline runs from green to red as it fills up. A number on it is how many are waiting. No outline: nothing was measured."));
        Children.Add(Muted("A dot is a call. More dots and a thicker line are more calls, slower dots are slower calls, and red dots are calls that fail."));
        Children.Add(problems);
        SetPos(pos, ramping);
    }

    private void BuildSelection(Model model, string view, LoadRun run, PerfSelection? selection)
    {
        Func<string, IReadOnlyList<double?>>? series = null;
        Func<string, double, double?>? at = null;
        string[]? keys = null;
        var title = "Selected";
        if (selection is { Id: { } id })
        {
            title = NameOf(model, id);
            keys = PerfView.BoxKeys;
            series = key => PerfView.BoxSeries(model, run, view, id, key);
            at = (key, load) => PerfView.BoxAt(model, run, view, id, load)?[key];
        }
        else if (selection is { From: { } from, To: { } to })
        {
            title = $"{NameOf(model, from)} → {NameOf(model, to)}";
            keys = PerfView.LineKeys;
            series = key => PerfView.LineSeries(model, run, view, from, to, key);
            at = (key, load) => PerfView.LineAt(model, run, view, from, to, load)?[key];
        }
        Children.Add(Chrome.Section(Icons.Info, title));
        if (keys is null)
        {
            Children.Add(Muted("Click a shape or a line to see its numbers."));
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
            var curve = new Sparkline(values, info, _pos);
            var row = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 10, Children = { label, value, curve } };
            Grid.SetColumn(value, 1);
            Grid.SetColumn(curve, 2);
            Children.Add(row);
            _readings.Add(new Reading(key, load => at!(key, load), value, curve, info));
        }
        if (!any) Children.Add(Muted(selection is { Id: not null } ? "Nothing was measured here, or inside it." : "Nothing was measured here."));
    }

    /// <summary>Moves the panel to a position without building it again: the number, the slider, the cursors, the readings and the Ramp button.</summary>
    public void SetPos(double pos, bool ramping)
    {
        if (_run is not { } run) return;
        _pos = pos;
        _ramping = ramping;
        var load = PerfView.LoadAt(run, pos);
        _loadNumber.Text = PerfView.FmtLoad(load, run.Unit);
        if (PerfView.IsTested(pos)) _loadNote.Text = "a tested level";
        else
        {
            var lower = run.Levels[Math.Min(PerfView.Top(run) - 1, (int)Math.Floor(pos))];
            var upper = run.Levels[Math.Min(PerfView.Top(run), (int)Math.Floor(pos) + 1)];
            _loadNote.Text = $"between {lower.Load.ToString("R", CultureInfo.InvariantCulture)} and {upper.Load.ToString("R", CultureInfo.InvariantCulture)}, worked out from the two";
        }
        _syncing = true;
        _slider.Value = pos;
        _syncing = false;
        AutomationProperties.SetName(_slider, "Load");
        Chrome.Fill(_ramp, ramping ? Icons.Pause : Icons.Play, ramping ? "Pause" : "Ramp");
        _ramp.Classes.Set("pressed", ramping);
        _strip?.SetPos(pos);
        foreach (var r in _readings)
        {
            r.Value.Text = r.At(load) is { } v ? r.Info.Show(v) : "–";
            r.Curve.SetPos(pos);
        }
    }

    private TextBlock Muted(string text) => new() { Text = text, Foreground = Resource("MutedBrush"), TextWrapping = TextWrapping.Wrap };

    private Control ProblemsFor(IReadOnlyList<Problem> problems)
    {
        if (problems.Count == 0) return new Panel();
        var list = new StackPanel { Spacing = 3 };
        foreach (var p in problems) list.Children.Add(new TextBlock { Text = $"{p.File} {p.Message}", Foreground = Resource("WarnFgBrush"), TextWrapping = TextWrapping.Wrap });
        return new StackPanel { Spacing = 8, Children = { Chrome.Section(Icons.Alert, "Problems", problems.Count), list } };
    }
}
