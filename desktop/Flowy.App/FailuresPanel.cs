using System.Globalization;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.VisualTree;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// What the Failures panel is told: the folder, the analysis on show and the mode picked in it, what the list is narrowed to, and the shape or line picked on
/// the canvas. <see cref="AnalysisId"/> is the analysis that shows (see <see cref="FailuresView.ActiveAnalysis"/>), null when there is none.
/// </summary>
internal sealed record FailuresShown(
    Model Model, string View, string? AnalysisId, string? ModeId, RiskBand? Band, bool Left, FailurePart? Part,
    IdMap<LoadRun> Runs, IReadOnlyList<Problem> Problems, IReadOnlyList<Problem> FailureProblems);

/// <summary>
/// The Failures panel: which analysis, how it adds up, what to look at first, and everything about the mode picked. Read only. A port of Failures.tsx, with the
/// same words: the list's marks are the ones the canvas wears, and the key draws them. It takes Details' place on the right while it is open.
/// </summary>
internal sealed class FailuresPanel : StackPanel
{
    private static readonly RiskBand[] Bands = [RiskBand.High, RiskBand.Medium, RiskBand.Low, RiskBand.Unrated];
    private static readonly (string Key, string Label)[] Ratings = [("severity", "Severity"), ("occurrence", "Likelihood"), ("detection", "Hard to spot")];

    /// <summary>The reader picked another analysis.</summary>
    public event Action<string>? AnalysisPicked;

    /// <summary>The reader picked a mode in the list, or the one picked again (null).</summary>
    public event Action<string?>? ModePicked;

    /// <summary>The reader pressed a band to narrow the list to it, or pressed the one narrowing it (null).</summary>
    public event Action<RiskBand?>? BandPicked;

    /// <summary>The reader pressed "Not analysed" to list the shapes no mode names yet, or pressed it again.</summary>
    public event Action? LeftToggled;

    /// <summary>The reader cleared the shape or line that narrows the list.</summary>
    public event Action? PartCleared;

    /// <summary>The reader picked a shape in the list of those no mode names yet.</summary>
    public event Action<string>? ShapePicked;

    /// <summary>The reader pressed Show it: the flow's id, and the step it names (counted from 1) if it names one.</summary>
    public event Action<string, int?>? FlowShown;

    /// <summary>The reader pressed Seen in a run, on a mode.</summary>
    public event Action<string>? SeenInRun;

    /// <summary>The reader asked for the analysis as a table: "markdown" or "csv".</summary>
    public event Action<string>? Copied;

    /// <summary>The reader used a control that took the keyboard focus, so the reader gives it back and the keys work again.</summary>
    public event Action? Used;

    public FailuresPanel() => Spacing = 12;

    // What a test can look at.
    internal IEnumerable<Button> Buttons => this.GetVisualDescendants().OfType<Button>();

    internal ComboBox? Picker => this.GetVisualDescendants().OfType<ComboBox>().FirstOrDefault();

    internal IReadOnlyList<(string Name, bool Current)> Rows =>
        Buttons.Where(b => b.Classes.Contains("failrow")).Select(b => (AutomationProperties.GetName(b) ?? "", b.Classes.Contains("current"))).ToList();

    internal IReadOnlyList<string> Texts => this.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text ?? "").Where(t => t != "").ToList();

    internal IReadOnlyList<(string Name, bool Pressed)> BandButtons =>
        Buttons.Where(b => b.Classes.Contains("failband")).Select(b => (AutomationProperties.GetName(b) ?? "", b.Classes.Contains("pressed"))).ToList();

    /// <summary>The marks in the key, by the class that draws each (high, medium, low, unrated, fails, affects).</summary>
    internal IReadOnlyList<string> KeyMarks =>
        this.GetVisualDescendants().OfType<Border>().Where(b => b.Classes.Contains("keymark")).Select(b => string.Join(' ', b.Classes.Where(c => c is not ("sw" or "keymark")))).ToList();

    public void Show(FailuresShown s)
    {
        Children.Clear();
        var model = s.Model;
        var problems = s.FailureProblems.Concat(s.Problems.Where(p => s.AnalysisId is not null && p.File == $"failures/{s.AnalysisId}.yaml")).ToList();
        if (s.AnalysisId is null || !model.Failures.TryGetValue(s.AnalysisId, out var analysis))
        {
            if (problems.Count == 0) Children.Add(Muted("No failure analyses."));
            Children.Add(ProblemList(problems));
            return;
        }

        var counts = FailuresView.BandCounts(analysis);
        var (analysed, left) = Failures.Coverage(model, analysis);
        var (here, elsewhere) = FailuresView.RowsFor(model, analysis, s.View, s.Band, s.Part);
        var mode = FailuresView.ModeIn(model, s.AnalysisId, s.ModeId);

        Children.Add(Heading(s, analysis));
        if (Failures.Has(analysis.About)) Children.Add(About(analysis.About!));
        var copy = new WrapPanel { Orientation = Orientation.Horizontal };
        copy.Children.Add(CopyButton("Copy as table", "markdown"));
        copy.Children.Add(CopyButton("Copy as CSV", "csv"));
        Children.Add(copy);

        var summary = new WrapPanel { Orientation = Orientation.Horizontal };
        foreach (var band in Bands) summary.Children.Add(BandButton(band, counts[band], s.Band == band));
        Children.Add(summary);
        Children.Add(Coverage(analysed.Count, analysed.Count + left.Count, left.Count, s.Left));
        if (s.Part is { } part) Children.Add(PartChip(FailuresView.PartText(model, part)));

        if (s.Left) Children.Add(NotAnalysed(model, left));
        else
        {
            if (here.Count > 0) Children.Add(List("This view", model, here, s.ModeId));
            if (elsewhere.Count > 0) Children.Add(List("Other views", model, elsewhere, s.ModeId));
            if (here.Count + elsewhere.Count == 0) Children.Add(Muted(analysis.Modes.Count == 0 ? "No failure modes yet." : "None here."));
        }

        if (mode is not null) Children.Add(Detail(s, analysis, mode));

        Children.Add(KeyHint.Of(("← →", "Step"), ("Esc", "Close")));
        var lit = mode is null ? null : Failures.LightFor(model, s.View, mode);
        Children.Add(Chrome.Section(Icons.Info, "Key"));
        var key = new List<(Control, string)?>();
        foreach (var band in Bands.Where(b => counts[b] > 0)) key.Add((KeyMark(Failures.BandKey(band)), Failures.BandName(band)));
        if (lit is not null) key.Add((KeyMark("fails"), "Fails"));
        if (lit is { Affects.Count: > 0 }) key.Add((KeyMark("affects"), "Affects"));
        Children.Add(KeyRow.Of(key.ToArray()));
        Children.Add(ProblemList(problems));
    }

    /// <summary>A mark of the key: the same Border the list and the canvas draw it with, so it follows the theme.</summary>
    private static Control KeyMark(string kind)
    {
        var mark = KeyRow.Mark(kind);
        mark.Classes.Add("keymark");
        return mark;
    }

    // Words take their colour from a style, which follows the theme and the control's place in the tree; a brush looked up when the panel is built would not.
    private static TextBlock Muted(string text) => new() { Text = text, Classes = { "muted" }, TextWrapping = TextWrapping.Wrap };

    private Control Heading(FailuresShown s, FailureAnalysis analysis)
    {
        var ids = s.Model.Failures.Keys.ToList();
        if (ids.Count < 2)
            return new TextBlock { Text = Structure.JsTrim(analysis.Name) == "" ? s.AnalysisId : analysis.Name, FontSize = 18, FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 32, 0) };
        var picker = new ComboBox
        {
            HorizontalAlignment = HorizontalAlignment.Stretch, Margin = new Thickness(0, 0, 32, 0), Focusable = false,
            ItemsSource = ids.Select(id => Structure.JsTrim(s.Model.Failures[id].Name) == "" ? id : s.Model.Failures[id].Name).ToList(), SelectedIndex = ids.IndexOf(s.AnalysisId!),
        };
        AutomationProperties.SetName(picker, "Analysis");
        picker.SelectionChanged += (_, _) =>
        {
            if (picker.SelectedIndex < 0 || ids[picker.SelectedIndex] == s.AnalysisId) return;
            AnalysisPicked?.Invoke(ids[picker.SelectedIndex]);
            Used?.Invoke();
        };
        return picker;
    }

    private bool _aboutOpen; // kept here, not in the control: the panel is built again on every pick, and About stays as the reader left it

    private Control About(string text)
    {
        var note = Muted(text);
        note.IsVisible = _aboutOpen;
        var header = new Button { Content = _aboutOpen ? "▾ About" : "▸ About" };
        header.Classes.Add("disclosure");
        header.Click += (_, _) =>
        {
            _aboutOpen = !_aboutOpen;
            note.IsVisible = _aboutOpen;
            header.Content = _aboutOpen ? "▾ About" : "▸ About";
            Used?.Invoke();
        };
        return new StackPanel { Children = { header, note } };
    }

    private Button CopyButton(string text, string format)
    {
        var button = new Button();
        button.Classes.Add("tool");
        Chrome.Fill(button, Icons.Copy, text);
        button.Click += (_, _) =>
        {
            Copied?.Invoke(format);
            Used?.Invoke();
        };
        return button;
    }

    /// <summary>A band as a button that narrows the list to it: its mark, its name and how many modes it holds. Pressed while it narrows the list.</summary>
    private Button BandButton(RiskBand band, int count, bool pressed)
    {
        var swatch = KeyRow.Mark(Failures.BandKey(band));
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal, Spacing = 6,
            Children = { swatch, new TextBlock { Text = Failures.BandName(band), Classes = { "btntext" }, VerticalAlignment = VerticalAlignment.Center }, new TextBlock { Text = count.ToString(CultureInfo.InvariantCulture), Classes = { "muted" }, FontSize = 12, VerticalAlignment = VerticalAlignment.Center } },
        };
        var button = new Button { Content = content };
        button.Classes.Add("tool");
        button.Classes.Add("failband");
        button.Classes.Set("pressed", pressed);
        AutomationProperties.SetName(button, $"{Failures.BandName(band)}, {count}");
        button.Click += (_, _) =>
        {
            BandPicked?.Invoke(pressed ? null : band);
            Used?.Invoke();
        };
        return button;
    }

    private Control Coverage(int analysed, int total, int left, bool narrowed)
    {
        var row = new WrapPanel { Orientation = Orientation.Horizontal };
        row.Children.Add(new TextBlock { Text = $"Analysed {analysed} of {total}", Classes = { "muted" }, FontSize = 12.5, Margin = new Thickness(0, 0, 12, 0), VerticalAlignment = VerticalAlignment.Center });
        if (left > 0)
        {
            var link = new Button { Content = new TextBlock { Text = $"Not analysed ({left})", TextDecorations = narrowed ? TextDecorations.Underline : null } };
            link.Classes.Add("link");
            link.Classes.Set("pressed", narrowed);
            AutomationProperties.SetName(link, $"Not analysed ({left})");
            link.Click += (_, _) =>
            {
                LeftToggled?.Invoke();
                Used?.Invoke();
            };
            row.Children.Add(link);
        }
        return row;
    }

    private Control PartChip(string name)
    {
        var clear = new Button { Content = Icons.Make(Icons.Close, "closeicon", 12) };
        clear.Classes.Add("close");
        AutomationProperties.SetName(clear, "Clear");
        clear.Click += (_, _) =>
        {
            PartCleared?.Invoke();
            Used?.Invoke();
        };
        return new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, HorizontalAlignment = HorizontalAlignment.Left, Children = { Chrome.Chip(name), clear } };
    }

    private Control NotAnalysed(Model model, IReadOnlyList<string> left)
    {
        var rows = new StackPanel { Spacing = 2 };
        foreach (var id in left)
        {
            var row = new Button { Content = new TextBlock { Text = Failures.ShapeName(model, id), TextTrimming = TextTrimming.CharacterEllipsis } };
            row.Classes.Add("failrow");
            AutomationProperties.SetName(row, Failures.ShapeName(model, id));
            var shape = id;
            row.Click += (_, _) =>
            {
                ShapePicked?.Invoke(shape);
                Used?.Invoke();
            };
            rows.Children.Add(row);
        }
        return new StackPanel { Children = { Chrome.Section(Icons.Info, "Not analysed", left.Count), rows } };
    }

    private Control List(string title, Model model, IReadOnlyList<RankedMode> group, string? current)
    {
        var rows = new StackPanel { Spacing = 2 };
        foreach (var r in group)
        {
            var part = Failures.PartName(model, r.Mode);
            var risk = r.Risk is { } n ? n.ToString(CultureInfo.InvariantCulture) : "";
            var what = new StackPanel
            {
                VerticalAlignment = VerticalAlignment.Center,
                Children = { new TextBlock { Text = part, Classes = { "part" }, TextTrimming = TextTrimming.CharacterEllipsis }, new TextBlock { Text = r.Mode.Mode, TextTrimming = TextTrimming.CharacterEllipsis } },
            };
            var swatch = KeyRow.Mark(Failures.BandKey(r.Band));
            var riskText = new TextBlock { Text = risk, Classes = { "risk" }, MinWidth = 30, TextAlignment = TextAlignment.Right, VerticalAlignment = VerticalAlignment.Center };
            var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 10, Children = { swatch, what, riskText } };
            Grid.SetColumn(what, 1);
            Grid.SetColumn(riskText, 2);
            var row = new Button { Content = grid };
            row.Classes.Add("failrow");
            row.Classes.Set("current", r.Id == current);
            AutomationProperties.SetName(row, $"{Failures.BandName(r.Band)}. {part}, {r.Mode.Mode}{(risk == "" ? "" : $", risk {risk}")}");
            var id = r.Id;
            row.Click += (_, _) =>
            {
                ModePicked?.Invoke(id == current ? null : id);
                Used?.Invoke();
            };
            rows.Children.Add(row);
        }
        return new StackPanel { Children = { Chrome.Section(Icons.Info, title, group.Count), rows } };
    }

    /// <summary>Everything about the mode picked: what it is, what it does, the three ratings, the risk, what is done about it, and where to see it.</summary>
    private Control Detail(FailuresShown s, FailureAnalysis analysis, FailureMode mode)
    {
        var model = s.Model;
        var box = new StackPanel { Spacing = 8 };
        box.Children.Add(Chrome.Section(Icons.Alert, Failures.PartName(model, mode)));
        box.Children.Add(new TextBlock { Text = mode.Mode, FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap });
        var facts = new StackPanel { Spacing = 4 };
        AddFact(facts, "Effect", mode.Effect);
        AddFact(facts, "Cause", mode.Cause);
        if (facts.Children.Count > 0) box.Children.Add(facts);

        var rated = Failures.RatingsOf(mode);
        foreach (var (key, label) in Ratings)
        {
            var value = key switch { "severity" => rated.Severity, "occurrence" => rated.Occurrence, _ => rated.Detection };
            box.Children.Add(Rating(label, value, analysis.Scale is { } scale && scale.TryGetValue(key, out var ends) ? ends : null));
        }

        var band = Failures.BandOf(mode);
        var risk = new WrapPanel { Orientation = Orientation.Horizontal };
        risk.Children.Add(new TextBlock { Text = "Risk", Classes = { "muted" }, Margin = new Thickness(0, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center });
        risk.Children.Add(new TextBlock { Text = Failures.RiskOf(mode) is { } n ? n.ToString(CultureInfo.InvariantCulture) : "None", FontWeight = FontWeight.SemiBold, Margin = new Thickness(0, 0, 8, 0), VerticalAlignment = VerticalAlignment.Center });
        risk.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { KeyRow.Mark(Failures.BandKey(band)), new TextBlock { Text = Failures.BandName(band), VerticalAlignment = VerticalAlignment.Center } } });
        if (FailuresView.AfterText(mode) is { } after) risk.Children.Add(new TextBlock { Text = $" · After: {after}", Classes = { "muted" }, VerticalAlignment = VerticalAlignment.Center });
        box.Children.Add(risk);

        var more = new StackPanel { Spacing = 4 };
        AddFact(more, "Controls", mode.Controls);
        var status = mode.Status is null ? "Open" : FailuresView.StatusNames.GetValueOrDefault(mode.Status, mode.Status);
        if (Failures.Has(mode.Action) || Failures.Has(mode.Owner) || Failures.Has(mode.Status))
            AddFact(more, "Next action", string.Join(" · ", new[] { mode.Action, mode.Owner, status }.Where(Failures.Has)));
        if (mode.Affects is { Count: > 0 } affects) AddFact(more, "Affects", string.Join(", ", affects.Select(id => Views.NameOf(model, id))));
        if (more.Children.Count > 0) box.Children.Add(more);
        if (Failures.Has(mode.Description)) box.Children.Add(new MarkdownView(mode.Description!, 13));

        var buttons = new WrapPanel { Orientation = Orientation.Horizontal };
        if (mode.Flow is { } flow && model.Flows.Contains(flow))
        {
            var show = new Button();
            show.Classes.Add("tool");
            Chrome.Fill(show, Icons.Route, "Show it");
            var step = FailuresView.StepOf(mode.Step);
            show.Click += (_, _) =>
            {
                FlowShown?.Invoke(flow, step);
                Used?.Invoke();
            };
            buttons.Children.Add(show);
        }
        if (mode.Run is { } runId && s.Runs.TryGetValue(runId, out var run) && FailuresView.FirstErrorAt(model, run, mode) is not null)
        {
            var seen = new Button();
            seen.Classes.Add("tool");
            Chrome.Fill(seen, Icons.Activity, "Seen in a run");
            var id = s.ModeId!;
            seen.Click += (_, _) =>
            {
                SeenInRun?.Invoke(id);
                Used?.Invoke();
            };
            buttons.Children.Add(seen);
        }
        if (buttons.Children.Count > 0) box.Children.Add(buttons);
        return box;
    }

    private static void AddFact(Panel into, string label, string? text)
    {
        if (!Failures.Has(text)) return;
        var row = new Grid { ColumnDefinitions = [new ColumnDefinition(new GridLength(96)), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 10 };
        var name = new TextBlock { Text = label, Classes = { "muted" } };
        var value = new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap };
        row.Children.Add(name);
        row.Children.Add(value);
        Grid.SetColumn(value, 1);
        into.Children.Add(row);
    }

    /// <summary>A rating as ten cells with the first of them filled, and its number; the ends of the scale the analysis names sit under it.</summary>
    private static Control Rating(string label, int? value, RatingEnds? ends)
    {
        var cells = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        foreach (var on in FailuresView.RatingCells(value))
        {
            var cell = new Border();
            cell.Classes.Add("cell");
            cell.Classes.Set("on", on);
            cells.Children.Add(cell);
        }
        var number = new TextBlock { Text = value is { } v ? v.ToString(CultureInfo.InvariantCulture) : "Not rated", VerticalAlignment = VerticalAlignment.Center };
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Children = { new TextBlock { Text = label, Classes = { "muted" }, Width = 86, VerticalAlignment = VerticalAlignment.Center }, cells, number } };
        var item = new StackPanel { Spacing = 2, Children = { row } };
        if (ends is not null && (Failures.Has(ends.Low) || Failures.Has(ends.High)))
        {
            var scale = new StackPanel { Margin = new Thickness(96, 0, 0, 0) };
            scale.Children.Add(new TextBlock { Text = $"1: {ends.Low}", Classes = { "muted" }, FontSize = 12, TextWrapping = TextWrapping.Wrap });
            scale.Children.Add(new TextBlock { Text = $"10: {ends.High}", Classes = { "muted" }, FontSize = 12, TextWrapping = TextWrapping.Wrap });
            item.Children.Add(scale);
        }
        AutomationProperties.SetName(item, $"{label}: {(value is { } n ? n.ToString(CultureInfo.InvariantCulture) : "Not rated")}");
        return item;
    }

    private static Control ProblemList(IReadOnlyList<Problem> problems)
    {
        if (problems.Count == 0) return new Panel();
        var list = new StackPanel { Spacing = 3 };
        foreach (var p in problems) list.Children.Add(new TextBlock { Text = $"{p.File} {p.Message}", Classes = { "warntext" }, TextWrapping = TextWrapping.Wrap });
        return new StackPanel { Spacing = 8, Children = { Chrome.Section(Icons.Alert, "Problems", problems.Count), list } };
    }
}
