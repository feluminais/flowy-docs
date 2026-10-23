using System.Globalization;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The forms that write a failure analysis, a port of ui/src/FailuresEdit.tsx: every save is one edit, refused with the checker's words when it would add a problem, and the field
/// goes back to what it was. They are built once and updated in place, so a field being typed in keeps its focus while the model reloads round it.
/// </summary>
internal static class FailureForms
{
    public static readonly (string Id, string Name)[] RatingOptions = [("", "Not rated"), .. Enumerable.Range(1, 10).Select(n => (n.ToString(CultureInfo.InvariantCulture), n.ToString(CultureInfo.InvariantCulture)))];

    public static readonly (string Id, string Name)[] StatusOptions = [.. FailuresView.StatusNames.Select(s => (s.Key, s.Value))];

    /// <summary>Every shape, by the path a reader sees.</summary>
    public static List<(string Id, string Name)> Shapes(Model model) =>
        [.. model.Objects.Keys.Where(id => model.GetObject(id) is not null).Select(id => (id, Failures.ShapeName(model, id)))];

    /// <summary>The shapes a connection starts at: only a line that exists can carry a mode.</summary>
    public static List<(string Id, string Name)> Starts(Model model) =>
        [.. model.Connections.Select(c => c.From).OfType<string>().Distinct().Where(id => model.GetObject(id) is not null).Select(id => (id, Failures.ShapeName(model, id)))];

    /// <summary>The shapes the chosen one connects to.</summary>
    public static List<(string Id, string Name)> Ends(Model model, string? from) =>
        [.. model.Connections.Where(c => c.From == from).Select(c => c.To).OfType<string>().Distinct().Where(id => model.GetObject(id) is not null).Select(id => (id, Failures.ShapeName(model, id)))];

    /// <summary>A heading's worth of label over the cells, as the Chooser draws it; a refusal puts the ring back.</summary>
    public static TextChooser Cells(string label, int columns, Func<string, Task<bool>> picked, double? maxHeight = null) => new(label, columns, picked, maxHeight);
}

/// <summary>
/// A <see cref="Chooser"/> of words: each option is a cell holding its name. Its options can change (the shapes of the model, the flows), and are laid out again only when they do,
/// so the ring and the focus stay where they are while the model reloads.
/// </summary>
internal sealed class TextChooser
{
    private Dictionary<string, string> _names = [];
    private string _signature = "";

    public Chooser View { get; }

    public TextChooser(string label, int columns, Func<string, Task<bool>> picked, double? maxHeight = null) =>
        View = new Chooser(label, new UniformGrid { Columns = columns }, picked, id => _names.GetValueOrDefault(id, id), maxHeight);

    /// <summary>Offers <paramref name="options"/> and rings <paramref name="chosen"/> (none when it is not among them).</summary>
    public void Set(IReadOnlyList<(string Id, string Name)> options, string? chosen)
    {
        var signature = string.Join('\n', options.Select(o => $"{o.Id}\t{o.Name}"));
        if (signature != _signature)
        {
            _signature = signature;
            _names = [];
            View.Clear();
            foreach (var (id, name) in options)
            {
                if (_names.ContainsKey(id)) continue;
                _names[id] = name;
                View.Add(id, name, new TextBlock { Text = name, FontSize = 12, TextTrimming = TextTrimming.CharacterEllipsis, TextAlignment = TextAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center });
            }
        }
        View.Show(chosen is not null && _names.ContainsKey(chosen) ? chosen : null);
    }
}

/// <summary>A name and a button: the first analysis, or another one.</summary>
internal sealed class NewAnalysisForm : StackPanel
{
    private readonly TextBox _name = new();

    public NewAnalysisForm(EditRun run, Action<string> made)
    {
        Spacing = 8;
        AutomationProperties.SetName(_name, "Name");
        var caption = new TextBlock { Text = "Name", FontSize = 12 };
        caption.Classes.Add("muted");
        var make = new Button { HorizontalAlignment = HorizontalAlignment.Left };
        make.Classes.Add("tool");
        make.Classes.Add("primary");
        Chrome.Fill(make, Icons.Plus, "New analysis");
        async Task Do()
        {
            var name = (_name.Text ?? "").Trim();
            if (name == "") return;
            var id = "";
            var saved = await run(d =>
            {
                id = Navigation.NewId(name, d.Failures.Keys, "analysis"); // from the fresh files, so it never lands on an existing analysis
                return EditOps.PutAnalysis(d, id, name);
            });
            if (!saved) return;
            _name.Text = "";
            made(id);
        }
        make.Click += async (_, _) => await Do();
        _name.KeyDown += async (_, e) =>
        {
            if (e.Key != Key.Enter) return;
            e.Handled = true;
            await Do();
        };
        Children.Add(caption);
        Children.Add(_name);
        Children.Add(make);
    }

    internal TextBox Box => _name;
}

/// <summary>The analysis itself: its name, About and Scope, and deleting it with its modes.</summary>
internal sealed class AnalysisForm : StackPanel
{
    private readonly string _id;
    private readonly FieldBox _name;
    private readonly FieldBox _about;
    private readonly TextChooser _scope;
    private readonly Button _delete = new();

    public AnalysisForm(string id, EditRun run)
    {
        _id = id;
        Spacing = 12;
        _name = new FieldBox("Name", "", false, v => run(d => EditOps.UpdateAnalysis(d, id, name: v)));
        _about = new FieldBox("About", "", true, v => run(d => EditOps.UpdateAnalysis(d, id, about: v)));
        _scope = new TextChooser("Scope", 2, v => run(d => EditOps.UpdateAnalysis(d, id, scope: v)), 150);
        _delete.Classes.Add("danger");
        _delete.HorizontalAlignment = HorizontalAlignment.Left;
        _delete.Click += async (_, _) => await run(d => EditOps.DeleteAnalysis(d, id));
        Children.Add(_name);
        Children.Add(_about);
        Children.Add(_scope.View);
        Children.Add(_delete);
    }

    public string Id => _id;

    public void Update(Model model)
    {
        if (!model.Failures.TryGetValue(_id, out var a)) return;
        _name.Sync(a.Name);
        _about.Sync(a.About ?? "");
        List<(string, string)> scopes = [("", "Overview"), .. model.Objects.Keys.Where(o => Views.IsView(model, o)).Select(o => (o, Failures.ShapeName(model, o)))];
        _scope.Set(scopes, a.Scope is { } s && s != Names.Root ? s : "");
        var count = a.Modes.Count;
        Chrome.Fill(_delete, Icons.Trash, $"Delete analysis and its {count} mode{(count == 1 ? "" : "s")}");
    }
}

/// <summary>Where a new mode starts: the part it names, if one is picked.</summary>
internal sealed record ModePreset(string? On = null, string? From = null, string? To = null);

/// <summary>A new mode: the part and the sentence, which is all the checker needs. The rest is filled in on the mode's own form.</summary>
internal sealed class AddModeForm : StackPanel
{
    private readonly string _analysis;
    private readonly TextChooser _kind;
    private readonly TextChooser _shape;
    private readonly TextChooser _from;
    private readonly TextChooser _to;
    private readonly TextBox _sentence = new();
    private readonly StackPanel _shapeRow = new() { Spacing = 12 };
    private readonly StackPanel _lineRow = new() { Spacing = 12 };
    private string _kindNow;
    private string _on;
    private string _fromNow;
    private string _toNow;

    public AddModeForm(string analysis, ModePreset preset, EditRun run, Action<string> added, Action cancel)
    {
        _analysis = analysis;
        Spacing = 12;
        _kindNow = preset.From is not null ? "line" : "shape";
        (_on, _fromNow, _toNow) = (preset.On ?? "", preset.From ?? "", preset.To ?? "");
        _kind = FailureForms.Cells("Part", 2, v =>
        {
            _kindNow = v;
            Show(null);
            return Task.FromResult(true);
        });
        _shape = FailureForms.Cells("Shape", 2, v =>
        {
            _on = v;
            return Task.FromResult(true);
        }, 150);
        _from = FailureForms.Cells("From", 2, v =>
        {
            _fromNow = v;
            _toNow = _model is { } m && FailureForms.Ends(m, v).FirstOrDefault() is { Id: { } first } ? first : "";
            Show(null);
            return Task.FromResult(true);
        }, 150);
        _to = FailureForms.Cells("To", 2, v =>
        {
            _toNow = v;
            return Task.FromResult(true);
        }, 150);
        AutomationProperties.SetName(_sentence, "Mode");
        var caption = new TextBlock { Text = "Mode", FontSize = 12 };
        caption.Classes.Add("muted");
        var add = new Button();
        add.Classes.Add("tool");
        add.Classes.Add("primary");
        Chrome.Fill(add, Icons.Plus, "Add");
        var cancelButton = new Button();
        cancelButton.Classes.Add("tool");
        Chrome.Fill(cancelButton, Icons.Close, "Cancel");
        async Task Do()
        {
            var sentence = (_sentence.Text ?? "").Trim();
            if (sentence == "") return;
            var id = "";
            var saved = await run(d =>
            {
                id = Navigation.NewId(sentence, ModeIds(d, analysis), "mode");
                return _kindNow == "shape" ? EditOps.PutMode(d, analysis, id, sentence, on: _on) : EditOps.PutMode(d, analysis, id, sentence, from: _fromNow, to: _toNow);
            });
            if (saved) added(id);
        }
        add.Click += async (_, _) => await Do();
        cancelButton.Click += (_, _) => cancel();
        _sentence.KeyDown += async (_, e) =>
        {
            if (e.Key != Key.Enter) return;
            e.Handled = true;
            await Do();
        };
        _shapeRow.Children.Add(_shape.View);
        _lineRow.Children.Add(_from.View);
        _lineRow.Children.Add(_to.View);
        Children.Add(_kind.View);
        Children.Add(_shapeRow);
        Children.Add(_lineRow);
        Children.Add(caption);
        Children.Add(_sentence);
        Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { add, cancelButton } });
    }

    private Model? _model;

    private static IEnumerable<string> ModeIds(EditDoc d, string analysis) =>
        d.Failures.TryGetValue(analysis, out var a) && a is OrderedDictionary<string, object?> map && map.GetValueOrDefault("modes") is OrderedDictionary<string, object?> modes ? modes.Keys : [];

    public string Analysis => _analysis;

    public void Update(Model model) => Show(model);

    private void Show(Model? model)
    {
        if (model is not null) _model = model;
        if (_model is not { } m) return;
        _kind.Set([("shape", "A shape"), ("line", "A line")], _kindNow);
        _shapeRow.IsVisible = _kindNow == "shape";
        _lineRow.IsVisible = _kindNow == "line";
        _shape.Set(FailureForms.Shapes(m), _on);
        _from.Set(FailureForms.Starts(m), _fromNow);
        _to.Set(FailureForms.Ends(m, _fromNow), _toNow);
    }

    internal TextBox Sentence => _sentence;

    internal TextChooser Part => _kind;

    internal TextChooser ShapeChooser => _shape;
}

/// <summary>Every field of the picked mode.</summary>
internal sealed class ModeForm : StackPanel
{
    private readonly string _analysis;
    private readonly string _id;
    private readonly EditRun _run;
    private readonly FieldBox _mode;
    private readonly TextChooser _kind;
    private readonly TextChooser _shape;
    private readonly TextChooser _from;
    private readonly TextChooser _to;
    private readonly StackPanel _shapeRow = new() { Spacing = 12 };
    private readonly StackPanel _lineRow = new() { Spacing = 12 };
    private readonly FieldBox _effect;
    private readonly FieldBox _cause;
    private readonly Dictionary<string, TextChooser> _ratings = [];
    private readonly Dictionary<string, TextChooser> _after = [];
    private readonly StackPanel _riskRow = new() { Orientation = Orientation.Horizontal, Spacing = 8 };
    private readonly FieldBox _controls;
    private readonly FieldBox _action;
    private readonly FieldBox _owner;
    private readonly TextChooser _status;
    private readonly StackPanel _affectsList = new() { Spacing = 2 };
    private readonly TextChooser _affectsAdd;
    private readonly TextChooser _flow;
    private readonly FieldBox _step;
    private readonly TextChooser _runChoice;
    private readonly FieldBox _description;
    private readonly Button _show = new();
    private IReadOnlyList<string> _affects = [];

    /// <summary>The reader pressed Show it: the flow's id, and the step it names.</summary>
    public event Action<string, int?>? FlowShown;

    public ModeForm(string analysis, string id, EditRun run)
    {
        (_analysis, _id, _run) = (analysis, id, run);
        Spacing = 12;
        Task<bool> Save(ModeChanges changes) => run(d => EditOps.UpdateMode(d, analysis, id, changes));
        Task<bool> Text(string key, string value) => Save(new ModeChanges().Text(key, value));
        _mode = new FieldBox("Mode", "", false, v => Text("mode", v));
        _kind = FailureForms.Cells("Part", 2, async v =>
        {
            var model = _model;
            if (model is null || ModeNow(model) is not { } m) return false;
            var to = v == "shape" ? FailuresView.ToShape(m) : FailuresView.ToLine(model, m);
            return to is not null && await Save(to);
        });
        _shape = FailureForms.Cells("Shape", 2, v => Text("on", v), 150);
        _from = FailureForms.Cells("From", 2, v => Save(new ModeChanges().Text("from", v).Text("to", _model is { } m ? FailureForms.Ends(m, v).FirstOrDefault().Id ?? "" : "")), 150);
        _to = FailureForms.Cells("To", 2, v => Text("to", v), 150);
        _effect = new FieldBox("Effect", "", false, v => Text("effect", v));
        _cause = new FieldBox("Cause", "", false, v => Text("cause", v));
        foreach (var (key, label) in new[] { ("severity", "Severity (1 to 10)"), ("occurrence", "Likelihood (1 to 10)"), ("detection", "Hard to spot (1 to 10)") })
            _ratings[key] = FailureForms.Cells(label, 6, v => Text(key, v));
        foreach (var (key, label) in new[] { ("severity", "After: Severity (1 to 10)"), ("occurrence", "After: Likelihood (1 to 10)"), ("detection", "After: Hard to spot (1 to 10)") })
            _after[key] = FailureForms.Cells(label, 6, v => Save(new ModeChanges().After((key, v))));
        _controls = new FieldBox("Controls", "", true, v => Text("controls", v));
        _action = new FieldBox("Next action", "", true, v => Text("action", v));
        _owner = new FieldBox("Owner", "", false, v => Text("owner", v));
        _status = FailureForms.Cells("Status", 4, v => Text("status", v == "open" ? "" : v));
        _affectsAdd = FailureForms.Cells("Add a shape to Affects", 2, v => Save(new ModeChanges().Affects([.. _affects, v])), 150);
        _flow = FailureForms.Cells("Flow", 2, v => Save(v == "" ? new ModeChanges().Text("flow", "").Text("step", "") : new ModeChanges().Text("flow", v)), 150);
        _step = new FieldBox("Step (from 1)", "", false, v => Text("step", v));
        _runChoice = FailureForms.Cells("Run", 2, v => Text("run", v), 150);
        _description = new FieldBox("More (Markdown)", "", true, v => Text("description", v));
        _show.Classes.Add("tool");
        Chrome.Fill(_show, Icons.Route, "Show it");
        _show.Click += (_, _) =>
        {
            if (_show.Tag is string flow && _model is { } model && ModeNow(model) is { } m) FlowShown?.Invoke(flow, FailuresView.StepOf(m.Step));
        };
        var delete = new Button { HorizontalAlignment = HorizontalAlignment.Left };
        delete.Classes.Add("danger");
        Chrome.Fill(delete, Icons.Trash, "Delete mode");
        delete.Click += async (_, _) => await run(d => EditOps.DeleteMode(d, analysis, id));

        _shapeRow.Children.Add(_shape.View);
        _lineRow.Children.Add(_from.View);
        _lineRow.Children.Add(_to.View);
        Children.Add(_mode);
        Children.Add(_kind.View);
        Children.Add(_shapeRow);
        Children.Add(_lineRow);
        Children.Add(_effect);
        Children.Add(_cause);
        foreach (var chooser in _ratings.Values) Children.Add(chooser.View);
        Children.Add(_riskRow);
        foreach (var chooser in _after.Values) Children.Add(chooser.View);
        Children.Add(_controls);
        Children.Add(_action);
        Children.Add(_owner);
        Children.Add(_status.View);
        var caption = new TextBlock { Text = "Affects", FontSize = 12 };
        caption.Classes.Add("muted");
        Children.Add(new StackPanel { Spacing = 6, Children = { caption, _affectsList, _affectsAdd.View } });
        Children.Add(_flow.View);
        Children.Add(_step);
        Children.Add(_runChoice.View);
        Children.Add(_description);
        Children.Add(_show);
        Children.Add(delete);
    }

    private Model? _model;

    public string Analysis => _analysis;

    public string Id => _id;

    private FailureMode? ModeNow(Model model) => FailuresView.ModeIn(model, _analysis, _id);

    // What a test can look at.
    internal FieldBox ModeField => _mode;

    internal TextChooser Part => _kind;

    internal IReadOnlyDictionary<string, TextChooser> Ratings => _ratings;

    internal TextChooser StatusChooser => _status;

    internal IReadOnlyList<string> AffectsNow => _affects;

    internal TextChooser AffectsAdd => _affectsAdd;

    internal Task<bool> Press(string key, string id) => _ratings[key].View.Choose(id);

    public void Update(Model model, IdMap<LoadRun> runs)
    {
        _model = model;
        if (ModeNow(model) is not { } m) return;
        _mode.Sync(m.Mode ?? "");
        var isShape = !string.IsNullOrEmpty(m.On) || (m.From is null && m.To is null);
        _kind.Set([("shape", "A shape"), ("line", "A line")], isShape ? "shape" : "line");
        // A line is offered for a shape only when a connection starts there: a line mode needs one that exists.
        _kind.View.Allow("line", isShape && FailuresView.ToLine(model, m) is null ? "No line starts at this shape" : null);
        _shapeRow.IsVisible = isShape;
        _lineRow.IsVisible = !isShape;
        _shape.Set(FailureForms.Shapes(model), m.On);
        _from.Set(FailureForms.Starts(model), m.From);
        _to.Set(FailureForms.Ends(model, m.From), m.To);
        _effect.Sync(m.Effect ?? "");
        _cause.Sync(m.Cause ?? "");
        _ratings["severity"].Set(FailureForms.RatingOptions, m.Severity ?? "");
        _ratings["occurrence"].Set(FailureForms.RatingOptions, m.Occurrence ?? "");
        _ratings["detection"].Set(FailureForms.RatingOptions, m.Detection ?? "");
        _after["severity"].Set(FailureForms.RatingOptions, m.After?.Severity ?? "");
        _after["occurrence"].Set(FailureForms.RatingOptions, m.After?.Occurrence ?? "");
        _after["detection"].Set(FailureForms.RatingOptions, m.After?.Detection ?? "");
        ShowRisk(m);
        _controls.Sync(m.Controls ?? "");
        _action.Sync(m.Action ?? "");
        _owner.Sync(m.Owner ?? "");
        _status.Set(FailureForms.StatusOptions, m.Status is { } s && FailuresView.StatusNames.ContainsKey(s) ? s : "open");
        _affects = m.Affects ?? [];
        ShowAffects(model);
        _flow.Set([("", "None"), .. model.Flows.Select(f => (f.Key, JsCompat.Blank(f.Value.Name) ? f.Key : f.Value.Name!))], m.Flow ?? "");
        _step.Sync(m.Step ?? "");
        _runChoice.Set([("", "None"), .. runs.Select(r => (r.Key, JsCompat.Blank(r.Value.Name) ? r.Key : r.Value.Name))], m.Run ?? "");
        _description.Sync(m.Description ?? "");
        var flow = m.Flow is { } f && model.Flows.Contains(f) ? f : null;
        _show.IsVisible = flow is not null;
        _show.Tag = flow;
    }

    private void ShowRisk(FailureMode m)
    {
        var band = Failures.BandOf(m);
        _riskRow.Children.Clear();
        _riskRow.Children.Add(new TextBlock { Text = "Risk", Classes = { "muted" }, VerticalAlignment = VerticalAlignment.Center });
        _riskRow.Children.Add(new TextBlock { Text = Failures.RiskOf(m) is { } n ? n.ToString(CultureInfo.InvariantCulture) : "None", FontWeight = FontWeight.SemiBold, VerticalAlignment = VerticalAlignment.Center });
        _riskRow.Children.Add(KeyRow.Mark(Failures.BandKey(band)));
        _riskRow.Children.Add(new TextBlock { Text = Failures.BandName(band), VerticalAlignment = VerticalAlignment.Center });
    }

    private void ShowAffects(Model model)
    {
        _affectsList.Children.Clear();
        foreach (var id in _affects)
        {
            var name = new TextBlock { Text = Failures.ShapeName(model, id), VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
            var remove = new Button { Content = "Remove" };
            remove.Classes.Add("link");
            AutomationProperties.SetName(remove, $"Remove {Failures.ShapeName(model, id)}");
            var gone = id;
            remove.Click += async (_, _) => await _run(d => EditOps.UpdateMode(d, _analysis, _id, new ModeChanges().Affects(_affects.Where(a => a != gone))));
            _affectsList.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { name, remove } });
        }
        _affectsAdd.Set(FailureForms.Shapes(model).Where(s => !_affects.Contains(s.Id)).ToList(), null);
    }
}
