using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>The flow being recorded. While <see cref="Id"/> is "", it still needs a name. <see cref="From"/> and <see cref="To"/> are the step being picked.</summary>
internal sealed record Recording(string Id, string Name, string? From = null, string? To = null);

/// <summary>
/// The panel for a flow in edit mode: a name for a new one, then its steps (each with its text, a detail a reader can open, and up, down and
/// delete) and, below them, the step being picked: click the box it starts at and the box it goes to (the same box twice: a step that box
/// does on its own), type what happens, press Enter. Desktop twin of the Recorder in ui/src/Panel.tsx.
/// </summary>
internal sealed class Recorder : StackPanel
{
    private sealed class Row
    {
        public required FieldBox Text;
        public required FieldBox Detail;
    }

    private readonly SidePanel _owner;
    private readonly EditRun _run;
    private readonly Action<Recording> _change;
    private readonly Func<string, string> _makeId;
    private readonly Action _closed;
    private readonly StackPanel _head = new() { Spacing = 12 };
    private readonly StackPanel _steps = new() { Spacing = 16 };
    private readonly StackPanel _pick = new() { Spacing = 8 };
    private readonly StackPanel _buttons = new() { Spacing = 8, Orientation = Orientation.Horizontal };
    private readonly List<Row> _rows = [];
    private string _signature = "";
    private string? _headFor;
    private Recording _rec = new("", "");
    private TextBox? _stepBox;
    private FieldBox? _flowName;
    private List<string> _shownSigs = []; // the steps as the list shows them now: an edit is refused if the files no longer say the same
    private Func<Task> _submitStep = () => Task.CompletedTask;
    private Action<string> _startNamed = _ => { };

    /// <param name="makeId">The id for a new flow with this name, one that no flow has yet.</param>
    public Recorder(SidePanel owner, EditRun run, Action<Recording> change, Func<string, string> makeId, Action closed)
    {
        (_owner, _run, _change, _makeId, _closed) = (owner, run, change, makeId, closed);
        Spacing = 16;
        Children.Add(_head);
        Children.Add(_steps);
        Children.Add(_pick);
        Children.Add(_buttons);
    }

    // What a test can look at and do.
    internal IReadOnlyList<FieldBox> StepTexts => _rows.Select(r => r.Text).ToList();

    internal IReadOnlyList<FieldBox> StepDetails => _rows.Select(r => r.Detail).ToList();

    internal TextBox? StepBox => _stepBox;

    internal FieldBox? FlowNameField => _flowName;

    internal TextBox? NameBox { get; private set; }

    private static string Ends(Model model, string? from, string? to) =>
        string.IsNullOrEmpty(to) || to == from ? $"{Views.NameOf(model, from ?? "")}, on its own" : $"{Views.NameOf(model, from ?? "")} → {Views.NameOf(model, to)}";

    /// <summary>The text the step list shows, to tell whether what an edit will change is still what is on screen.</summary>
    private static string Sig(Step s) => string.Join('\u0001', s.From, s.To, s.Text, s.Description);

    private static string Sig(OrderedDictionary<string, object?> s) =>
        string.Join('\u0001', Field(s, "from"), Field(s, "to"), Field(s, "text"), Field(s, "description"));

    private static string? Field(OrderedDictionary<string, object?> s, string key) => s.TryGetValue(key, out var v) ? v as string : null;

    /// <summary>The steps of a flow in a copy of the document, for an edit to change without touching the one it started from.</summary>
    private static List<OrderedDictionary<string, object?>> StepsOf(EditDoc copy, string id) =>
        copy.Flows.TryGetValue(id, out var flow) && flow is OrderedDictionary<string, object?> map && map.TryGetValue("steps", out var steps) && steps is List<object?> list
            ? list.OfType<OrderedDictionary<string, object?>>().ToList()
            : [];

    public void Update(Model model, string view, Recording rec)
    {
        _rec = rec;
        if (rec.Id == "")
        {
            ShowNaming();
            return;
        }
        var flow = model.Flows.TryGetValue(rec.Id, out var f) ? f : null;
        var steps = flow?.Steps ?? [];
        _shownSigs = steps.Select(Sig).ToList();

        // The head: a field to rename a flow that exists, the name of one that is still being recorded.
        if (_headFor != $"flow:{rec.Id}:{flow is not null}")
        {
            _head.Children.Clear();
            _flowName = null;
            NameBox = null;
            if (flow is not null)
            {
                _flowName = new FieldBox("Flow", flow.Name ?? "", false, v => _run(d => EditOps.UpdateFlow(d, rec.Id, name: v)));
                _head.Children.Add(Chrome.Section(Icons.Route, "Flow"));
                _head.Children.Add(_flowName);
            }
            else _head.Children.Add(_owner.IconHeading(Icons.Route, rec.Name));
            _headFor = $"flow:{rec.Id}:{flow is not null}";
        }
        _flowName?.Sync(flow?.Name ?? "");

        // The steps: the rows stay as they are while only the text changed, so a field being typed in keeps its focus.
        var signature = string.Join('\u0002', steps.Select(s => $"{s.From}\u0001{s.To}"));
        if (signature != _signature || _rows.Count != steps.Count)
        {
            _signature = signature;
            _rows.Clear();
            _steps.Children.Clear();
            for (var i = 0; i < steps.Count; i++) _steps.Children.Add(BuildRow(model, rec.Id, steps, i));
        }
        for (var i = 0; i < steps.Count; i++)
        {
            _rows[i].Text.Sync(steps[i].Text ?? "");
            _rows[i].Detail.Sync(steps[i].Description ?? "");
        }

        // The step being picked.
        _pick.Children.Clear();
        _stepBox = null;
        if (rec.From is not null && rec.To is not null)
        {
            var caption = new TextBlock { Text = Ends(model, rec.From, rec.To), FontWeight = Avalonia.Media.FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap };
            var pickCard = new StackPanel { Spacing = 8 };
            _stepBox = new TextBox { PlaceholderText = "What happens? Press Enter" };
            Avalonia.Automation.AutomationProperties.SetName(_stepBox, "What happens");
            var box = _stepBox;
            _submitStep = () => AddStepAsync(model, view, rec, steps, box.Text ?? "");
            box.KeyDown += async (_, e) =>
            {
                if (e.Key == Key.Escape)
                {
                    e.Handled = true;
                    _change(new Recording(rec.Id, rec.Name));
                }
                else if (e.Key == Key.Enter)
                {
                    e.Handled = true;
                    await _submitStep();
                }
            };
            pickCard.Children.Add(caption);
            pickCard.Children.Add(box);
            _pick.Children.Add(Chrome.Section(Icons.Plus, "Next step"));
            _pick.Children.Add(Chrome.Card(pickCard));
            Dispatcher.UIThread.Post(() => box.Focus());
        }
        else
        {
            _pick.Children.Add(Chrome.Section(Icons.Plus, "Next step"));
            _pick.Children.Add(Chrome.Card(_owner.Muted(rec.From is not null
                ? $"From {Views.NameOf(model, rec.From)}. Now click the shape it goes to, or the same shape for a step it does on its own."
                : "Click the shape where the next step starts.")));
        }

        _buttons.Children.Clear();
        if (flow is not null)
        {
            var delete = new Button();
            delete.Classes.Add("tool");
            delete.Classes.Add("danger");
            Chrome.Fill(delete, Icons.Trash, "Delete flow");
            delete.Click += async (_, _) =>
            {
                if (await _run(d => EditOps.DeleteFlow(d, rec.Id))) _closed();
            };
            _buttons.Children.Add(delete);
        }
        var done = new Button();
        done.Classes.Add("tool");
        done.Classes.Add("primary");
        Chrome.Fill(done, Icons.Check, "Done");
        done.Click += (_, _) => _closed();
        _buttons.Children.Add(done);
    }

    /// <summary>A flow that has no name yet: a name, and Start recording.</summary>
    private void ShowNaming()
    {
        if (_headFor == "naming") return;
        _headFor = "naming";
        _signature = "";
        _rows.Clear();
        _steps.Children.Clear();
        _pick.Children.Clear();
        _buttons.Children.Clear();
        _head.Children.Clear();
        _head.Children.Add(_owner.IconHeading(Icons.Route, "New flow"));
        var caption = new TextBlock { Text = "Name", FontSize = 12 };
        caption.Classes.Add("muted");
        var name = new TextBox { PlaceholderText = "e.g. Customer checks out" };
        NameBox = name;
        Avalonia.Automation.AutomationProperties.SetName(name, "Name");
        void Start()
        {
            var text = (name.Text ?? "").Trim();
            if (text != "") _change(new Recording(_makeId(text), text));
        }
        _startNamed = text =>
        {
            name.Text = text;
            Start();
        };
        var start = new Button { HorizontalAlignment = HorizontalAlignment.Left };
        start.Classes.Add("tool");
        start.Classes.Add("primary");
        Chrome.Fill(start, Icons.Play, "Start recording");
        start.Click += (_, _) => Start();
        name.KeyDown += (_, e) =>
        {
            if (e.Key != Key.Enter) return;
            e.Handled = true;
            Start();
        };
        _head.Children.Add(new StackPanel { Spacing = 4, Children = { caption, name } });
        _head.Children.Add(start);
        Dispatcher.UIThread.Post(() => name.Focus());
    }

    /// <summary>What a test does: type a name and press Start recording.</summary>
    internal void StartNamed(string name) => _startNamed(name);

    /// <summary>What a test does: type what happens and press Enter.</summary>
    internal Task SubmitStepAsync(string text)
    {
        if (_stepBox is not null) _stepBox.Text = text;
        return _submitStep();
    }

    private async Task AddStepAsync(Model model, string view, Recording rec, IReadOnlyList<Step> shown, string text)
    {
        text = text.Trim();
        if (text == "" || rec.From is null || rec.To is null) return;
        var from = rec.From;
        var to = rec.To == rec.From ? null : rec.To;
        // The first step creates the file: a flow with no steps is a problem, so it can't be saved before.
        var saved = await _run(d =>
        {
            if (!d.Flows.ContainsKey(rec.Id)) return EditOps.PutFlow(d, rec.Id, rec.Name, view, [EditOps.NewStep(from, to, text)]);
            var copy = d.Clone();
            var steps = StepsOf(copy, rec.Id);
            if (!steps.Select(Sig).SequenceEqual(_shownSigs)) throw new OpError("The steps just changed. Check them and try again.");
            steps.Add(EditOps.NewStep(from, to, text));
            return EditOps.UpdateFlow(d, rec.Id, steps: steps);
        });
        if (saved) _change(new Recording(rec.Id, rec.Name));
    }

    private Control BuildRow(Model model, string flowId, IReadOnlyList<Step> shown, int i)
    {
        // One change to the steps, refused if they are no longer the steps on screen (a quick second click, someone else's edit).
        Task<bool> Change(Action<List<OrderedDictionary<string, object?>>> edit) => _run(d =>
        {
            var copy = d.Clone();
            var steps = StepsOf(copy, flowId);
            if (!steps.Select(Sig).SequenceEqual(_shownSigs)) throw new OpError("The steps just changed. Check them and try again.");
            edit(steps);
            return EditOps.UpdateFlow(d, flowId, steps: steps);
        });

        var text = new FieldBox(Ends(model, shown[i].From, shown[i].To), "", false, v => Change(steps => steps[i]["text"] = v));
        // An empty detail removes the key, so the step stays as short as it can be.
        var detail = new FieldBox("Detail a reader can open (Markdown)", "", true, v => Change(steps =>
        {
            if (v.Trim() == "") steps[i].Remove("description");
            else steps[i]["description"] = v;
        }));
        var more = new Button { Content = "▸ More", HorizontalAlignment = HorizontalAlignment.Left };
        more.Classes.Add("disclosure");
        var open = !string.IsNullOrEmpty(shown[i].Description);
        detail.IsVisible = open;
        more.Content = open ? "▾ More" : "▸ More";
        more.Click += (_, _) =>
        {
            detail.IsVisible = !detail.IsVisible;
            more.Content = detail.IsVisible ? "▾ More" : "▸ More";
        };

        Button Small(string icon, string name, bool enabled, Func<Task<bool>> click, bool danger = false)
        {
            var b = new Button { IsEnabled = enabled };
            b.Classes.Add("tool");
            if (danger) b.Classes.Add("danger");
            Chrome.Fill(b, icon, null, name);
            ToolTip.SetTip(b, name);
            b.Click += async (_, _) => await click();
            return b;
        }
        var buttons = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            Children =
            {
                Small(Icons.ArrowUp, "Move up", i > 0, () => Change(steps => (steps[i - 1], steps[i]) = (steps[i], steps[i - 1]))),
                Small(Icons.ArrowDown, "Move down", i < shown.Count - 1, () => Change(steps => (steps[i + 1], steps[i]) = (steps[i], steps[i + 1]))),
                Small(Icons.Trash, "Delete step", true, () => Change(steps => steps.RemoveAt(i)), danger: true),
            },
        };
        _rows.Add(new Row { Text = text, Detail = detail });
        // A number before each step, so the order reads at a glance.
        var number = new Border { Child = new TextBlock { Text = (i + 1).ToString() }, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 22, 0, 0) };
        number.Classes.Add("dirn");
        var top = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 10, Children = { number, text } };
        Grid.SetColumn(text, 1);
        return Chrome.Card(new StackPanel { Spacing = 8, Children = { top, more, detail, buttons } });
    }
}
