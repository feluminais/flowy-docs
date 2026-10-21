using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Controls.Templates;
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
/// The panel for a flow in edit mode: a name for a new one, then its steps (each with its text, a detail a reader can open, the group it is in,
/// its lane and the flow it opens, and up, down and delete) and, below them, the step being picked: click the box it starts at and the box it
/// goes to (the same box twice: a step that box does on its own), type what happens, press Enter; then the flow's groups, and a form that puts a
/// stretch of its steps in a new one. Desktop twin of the Recorder in ui/src/Panel.tsx.
/// </summary>
internal sealed class Recorder : StackPanel
{
    private sealed class Row
    {
        public required FieldBox Text;
        public required FieldBox Detail;
        public required Choice<string> Group;
        public required FieldBox Lane;
        public required Choice<string> Flow;
        public required List<(string Shape, Chooser Tiles)> States;
        public required AnimationRow Animation;
    }

    /// <summary>
    /// How a step plays, as its row shows it: the way it travels and the way its request ends as sketches to pick from, a share and a reason, and for an interception who takes it
    /// (a shape of the model, or a name). What the step cannot have is dimmed with the reason in its tooltip, so the form never changes shape. Desktop twin of StepAnimation in ui/src/Panel.tsx.
    /// </summary>
    private sealed class AnimationRow
    {
        public required Chooser Kind;
        public required Chooser Outcome;
        public required FieldBox Share;
        public required FieldBox Reason;
        public required Chooser Takers;
        public required FieldBox TakerName;
        public required Control Panel;
        public required Action<Step> Sync;
    }

    private sealed class GroupCard
    {
        public required string Id;
        public required Chooser Kind;
        public FieldBox? Times;
        public FieldBox? Until;
        public required FieldBox Text;
        public required Button Remove;
    }

    private static readonly (string Kind, string Name)[] KindNames =
    [
        ("repeat", "Repeat"), ("branch", "Branch"), ("parallel", "Parallel"),
    ];

    private readonly SidePanel _owner;
    private readonly EditRun _run;
    private readonly Action<Recording> _change;
    private readonly Func<string, string> _makeId;
    private readonly Action _closed;
    private readonly StackPanel _head = new() { Spacing = 12 };
    private readonly StackPanel _steps = new() { Spacing = 16 };
    private readonly StackPanel _pick = new() { Spacing = 8 };
    private readonly StackPanel _groups = new() { Spacing = 12 };
    private readonly StackPanel _buttons = new() { Spacing = 8, Orientation = Orientation.Horizontal };
    private readonly List<Row> _rows = [];
    private readonly List<GroupCard> _cards = [];
    private string _signature = "";
    private string _groupSignature = "";
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
        Children.Add(_groups);
        Children.Add(_buttons);
    }

    // What a test can look at and do.
    internal IReadOnlyList<FieldBox> StepTexts => _rows.Select(r => r.Text).ToList();

    internal IReadOnlyList<FieldBox> StepDetails => _rows.Select(r => r.Detail).ToList();

    internal IReadOnlyList<ComboBox> StepGroupBoxes => _rows.Select(r => r.Group.Box).ToList();

    internal IReadOnlyList<FieldBox> StepLanes => _rows.Select(r => r.Lane).ToList();

    internal IReadOnlyList<Chooser> StepKinds => _rows.Select(r => r.Animation.Kind).ToList();

    internal IReadOnlyList<Chooser> StepOutcomes => _rows.Select(r => r.Animation.Outcome).ToList();

    internal IReadOnlyList<FieldBox> StepShares => _rows.Select(r => r.Animation.Share).ToList();

    internal IReadOnlyList<FieldBox> StepReasons => _rows.Select(r => r.Animation.Reason).ToList();

    internal IReadOnlyList<Chooser> StepTakers => _rows.Select(r => r.Animation.Takers).ToList();

    internal IReadOnlyList<FieldBox> StepTakerNames => _rows.Select(r => r.Animation.TakerName).ToList();

    internal IReadOnlyList<ComboBox> StepFlowBoxes => _rows.Select(r => r.Flow.Box).ToList();

    /// <summary>The state tiles of step <paramref name="step"/>: one picker for each end of it that is a shape (the same shape once when it starts and ends there).</summary>
    internal IReadOnlyList<(string Shape, Chooser Tiles)> StepStatePickers(int step) => _rows[step].States;

    internal IReadOnlyList<string> GroupIds => _cards.Select(c => c.Id).ToList();

    internal Chooser GroupKind(string id) => _cards.First(c => c.Id == id).Kind;

    internal FieldBox? GroupTimes(string id) => _cards.First(c => c.Id == id).Times;

    internal FieldBox? GroupUntil(string id) => _cards.First(c => c.Id == id).Until;

    internal FieldBox GroupText(string id) => _cards.First(c => c.Id == id).Text;

    internal Button GroupRemove(string id) => _cards.First(c => c.Id == id).Remove;

    private Func<Task<bool>> _addGroup = () => Task.FromResult(false);
    private TextBox? _newGroupText;
    private Chooser? _newGroupKind;
    private ComboBox? _newGroupFirst;
    private ComboBox? _newGroupLast;

    /// <summary>What a test does: fill the new-group form (steps counted from 1) and press Group these steps.</summary>
    internal Task<bool> AddGroupAsync(string text, string kind, int first, int last)
    {
        _newGroupText!.Text = text;
        _newGroupKind!.Show(kind);
        _newGroupFirst!.SelectedItem = first;
        _newGroupLast!.SelectedItem = last;
        return _addGroup();
    }

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

    /// <summary>The state a step sets a shape to, or "" when it does not say (or says something that is not a state).</summary>
    private static string StateWord(object? states, string shape) =>
        states is OrderedDictionary<string, object?> map && map.TryGetValue(shape, out var v) && v is string word && States.Names.Contains(word) ? word : "";

    /// <summary>
    /// A step's <c>states</c> with <paramref name="shape"/> set to <paramref name="word"/> ("" takes it out). Every other entry is kept as it is, so a pick changes
    /// only what it was asked to; an entry that is not text can't be kept in a map of text, and is left out. Twin of <c>pickStepState</c> in ui/src/edit.ts.
    /// </summary>
    internal static OrderedDictionary<string, string> StatesWith(OrderedDictionary<string, object?> step, string shape, string word)
    {
        var next = new OrderedDictionary<string, string>();
        if (step.TryGetValue("states", out var own) && own is OrderedDictionary<string, object?> map)
            foreach (var id in JsCompat.OrderKeys(map.Keys))
                if (id != shape && map[id] is string text) next[id] = text;
        if (word != "") next[shape] = word;
        return next;
    }

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
        // What a row can pick comes from the flow's groups and the other flows (and a group or flow a step names that is not there), so those rebuild the
        // rows. The group, lane and flow a step has are synced in place below, as its text is: a save must not take the focus away from the next field.
        var declared = flow?.Groups ?? [];
        var others = model.Flows.Where(kv => kv.Key != rec.Id).Select(kv => (Id: kv.Key, Name: kv.Value.Name ?? "")).ToList();
        var strange = steps.Select(s =>
        {
            var g = JsCompat.JsTrim(s.Group ?? "");
            var t = JsCompat.JsTrim(s.FlowId ?? "");
            return $"{(g != "" && !declared.ContainsKey(g) ? g : "")}\u0001{(t != "" && !others.Any(o => o.Id == t) ? t : "")}";
        });
        var signature = string.Join('\u0002', steps.Select(s => $"{s.From}\u0001{s.To}")) + '\u0003' + string.Join('\u0002', strange)
            + '\u0003' + string.Join('\u0002', declared.Select(g => $"{g.Key}\u0001{KindOf(declared, g.Key)}"))
            + '\u0003' + string.Join('\u0002', others.Select(o => $"{o.Id}\u0001{o.Name}"))
            + '\u0003' + string.Join('\u0002', model.Objects.Select(o => $"{o.Key}\u0001{o.Value.Name}\u0001{o.Value.Type}"));
        if (signature != _signature || _rows.Count != steps.Count)
        {
            _signature = signature;
            _rows.Clear();
            _steps.Children.Clear();
            for (var i = 0; i < steps.Count; i++) _steps.Children.Add(BuildRow(model, rec.Id, steps, i, declared, others));
        }
        for (var i = 0; i < steps.Count; i++)
        {
            _rows[i].Text.Sync(steps[i].Text ?? "");
            _rows[i].Detail.Sync(steps[i].Description ?? "");
            var group = JsCompat.JsTrim(steps[i].Group ?? "");
            _rows[i].Group.Sync(group);
            _rows[i].Flow.Sync(JsCompat.JsTrim(steps[i].FlowId ?? ""));
            _rows[i].Lane.Sync(steps[i].Lane ?? "");
            _rows[i].Lane.IsVisible = group != "" && HasLanes(KindOf(declared, group));
            _rows[i].Animation.Sync(steps[i]);
            foreach (var (shape, tiles) in _rows[i].States) tiles.Show(StateWord(steps[i].States, shape));
        }
        if (flow is not null) ShowGroups(rec.Id, steps.Count, declared);
        else
        {
            _groups.Children.Clear();
            _cards.Clear();
            _groupSignature = "";
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
                ? $"From {Views.NameOf(model, rec.From)}. Click where it goes, or the same shape if it acts alone."
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
        _groups.Children.Clear();
        _cards.Clear();
        _groupSignature = "";
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

    private static string? KindOf(OrderedDictionary<string, object?> groups, string id) =>
        groups.TryGetValue(id, out var g) && g is OrderedDictionary<string, object?> map ? Field(map, "kind") : null;

    private static bool HasLanes(string? kind) => kind is "branch" or "parallel";

    private static string KindName(string? kind) => KindNames.FirstOrDefault(k => k.Kind == kind).Name ?? "no kind";

    private static TextBlock Caption(string text)
    {
        var caption = new TextBlock { Text = text, FontSize = 12 };
        caption.Classes.Add("muted");
        return caption;
    }

    private static StackPanel Captioned(string text, Control control) => new() { Spacing = 4, Children = { Caption(text), control } };

    /// <summary>A change that counts steps or groups, refused if the steps are no longer the steps on screen (a quick second click, someone else's edit).</summary>
    private Task<bool> Edit(string flowId, Func<EditDoc, EditDoc> op) => _run(d =>
    {
        if (!StepsOf(d, flowId).Select(Sig).SequenceEqual(_shownSigs)) throw new OpError("The steps just changed. Check them and try again.");
        return op(d);
    });

    /// <summary>A choice list that saves the pick, shows the saved choice again if the edit is refused, and follows the model with <see cref="Sync"/>.</summary>
    private sealed class Choice<T> where T : notnull
    {
        private T _current;
        private bool _syncing;

        public ComboBox Box { get; }

        public Choice(string name, IReadOnlyList<T> items, T selected, Func<T, string> label, Func<T, Task<bool>> save)
        {
            _current = selected;
            Box = new ComboBox
            {
                HorizontalAlignment = HorizontalAlignment.Stretch,
                ItemsSource = items,
                SelectedItem = selected,
                ItemTemplate = new FuncDataTemplate<T>((item, _) => new TextBlock { Text = label(item), VerticalAlignment = VerticalAlignment.Center }),
            };
            Avalonia.Automation.AutomationProperties.SetName(Box, name);
            Box.SelectionChanged += async (_, _) =>
            {
                if (_syncing || Box.SelectedItem is not T pick || EqualityComparer<T>.Default.Equals(pick, _current)) return;
                if (await save(pick)) _current = pick;
                else Show(_current);
            };
        }

        private void Show(T value)
        {
            _syncing = true;
            Box.SelectedItem = value;
            _syncing = false;
        }

        /// <summary>The model now says <paramref name="value"/>.</summary>
        public void Sync(T value)
        {
            _current = value;
            if (!EqualityComparer<T>.Default.Equals(Box.SelectedItem is T shown ? shown : default!, value)) Show(value);
        }
    }

    private Control BuildRow(Model model, string flowId, IReadOnlyList<Step> shown, int i, OrderedDictionary<string, object?> groups, IReadOnlyList<(string Id, string Name)> others)
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
        var detail = new FieldBox("More (Markdown)", "", true, v => Change(steps =>
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
                Small(Icons.Trash, "Delete step", true, () => Edit(flowId, d => EditOps.RemoveStep(d, flowId, i)), danger: true),
            },
        };

        // The group the step is in, the lane it starts, and the flow it opens: each choice is one edit, which keeps the files valid or says why not.
        var group = JsCompat.JsTrim(shown[i].Group ?? "");
        var target = JsCompat.JsTrim(shown[i].FlowId ?? "");
        var groupChoices = new List<string> { "" };
        groupChoices.AddRange(groups.Keys);
        if (group != "" && !groups.ContainsKey(group)) groupChoices.Add(group);
        var groupChoice = new Choice<string>("Group", groupChoices, group,
            g => g == "" ? "None" : groups.ContainsKey(g) ? $"{g} · {KindName(KindOf(groups, g))}" : $"{g} · not declared",
            g => Edit(flowId, d => EditOps.SetStepGroup(d, flowId, i, g)));
        var lane = new FieldBox("Lane (a new lane starts here)", "", false, v => Change(steps =>
        {
            if (JsCompat.JsTrim(v) == "") steps[i].Remove("lane");
            else steps[i]["lane"] = JsCompat.JsTrim(v);
        }));
        lane.IsVisible = group != "" && HasLanes(KindOf(groups, group));
        var flowNames = others.ToDictionary(o => o.Id, o => o.Name);
        var flowChoices = new List<string> { "" };
        flowChoices.AddRange(others.Select(o => o.Id));
        if (target != "" && !others.Any(o => o.Id == target)) flowChoices.Add(target);
        var flowChoice = new Choice<string>("Opens flow", flowChoices, target,
            id => id == "" ? "None" : id == flowId ? "This flow" : flowNames.TryGetValue(id, out var name) ? (name == "" ? id : name) : $"{id} · no such flow",
            id => Change(steps =>
            {
                if (id == "") steps[i].Remove("flow");
                else steps[i]["flow"] = id;
            }));
        var structure = new StackPanel { Spacing = 8, IsVisible = group != "" || target != "", Children = { Captioned("Group", groupChoice.Box), lane, Captioned("Opens flow", flowChoice.Box) } };
        var structureToggle = new Button { Content = structure.IsVisible ? "▾ Group and flow" : "▸ Group and flow", HorizontalAlignment = HorizontalAlignment.Left };
        structureToggle.Classes.Add("disclosure");
        structureToggle.Click += (_, _) =>
        {
            structure.IsVisible = !structure.IsVisible;
            structureToggle.Content = structure.IsVisible ? "▾ Group and flow" : "▸ Group and flow";
        };
        var animation = BuildAnimation(model, flowId, shown[i], i);
        var animationToggle = new Button { Content = animation.Panel.IsVisible ? "▾ Animation" : "▸ Animation", HorizontalAlignment = HorizontalAlignment.Left };
        animationToggle.Classes.Add("disclosure");
        animationToggle.Click += (_, _) =>
        {
            animation.Panel.IsVisible = !animation.Panel.IsVisible;
            animationToggle.Content = animation.Panel.IsVisible ? "▾ Animation" : "▸ Animation";
        };
        // A state for each end of the step, as tiles: one edit for a pick, and None takes the state out. A shape the model no longer has is left out; the checks report it.
        var ends = new[] { shown[i].From, shown[i].To ?? shown[i].From }.Where(e => e is not null && model.GetObject(e) is not null).Distinct().Cast<string>().ToList();
        var tiles = ends.Select(shape => (Shape: shape, Tiles: Pick.StateTiles(Views.NameOf(model, shape), StateWord(shown[i].States, shape),
            word => Edit(flowId, d => EditOps.SetStepStates(d, flowId, i, StatesWith(StepsOf(d, flowId)[i], shape, word)))))).ToList();
        var states = new StackPanel { Spacing = 10, IsVisible = tiles.Any(t => t.Tiles.Chosen != ""), Children = { } };
        foreach (var (_, picker) in tiles) states.Children.Add(picker);
        var statesToggle = new Button { Content = states.IsVisible ? "▾ State" : "▸ State", HorizontalAlignment = HorizontalAlignment.Left, IsVisible = tiles.Count > 0 };
        statesToggle.Classes.Add("disclosure");
        statesToggle.Click += (_, _) =>
        {
            states.IsVisible = !states.IsVisible;
            statesToggle.Content = states.IsVisible ? "▾ State" : "▸ State";
        };
        _rows.Add(new Row { Text = text, Detail = detail, Group = groupChoice, Lane = lane, Flow = flowChoice, States = tiles, Animation = animation });
        // A number before each step, so the order reads at a glance.
        var number = new Border { Child = new TextBlock { Text = (i + 1).ToString() }, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 22, 0, 0) };
        number.Classes.Add("badge");
        var top = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 10, Children = { number, text } };
        Grid.SetColumn(text, 1);
        return Chrome.Card(new StackPanel { Spacing = 8, Children = { top, more, detail, animationToggle, animation.Panel, structureToggle, structure, statesToggle, states, buttons } });
    }

    private static string Title(string word) => word == "" ? word : char.ToUpperInvariant(word[0]) + word[1..];

    /// <summary>One sketch of the pickers: the drawing and its name under it.</summary>
    private static Control SketchCell(string path, string name)
    {
        var drawing = new Avalonia.Controls.Shapes.Path { Data = Geometry.Parse(path), Width = 44, Height = 24, HorizontalAlignment = HorizontalAlignment.Center };
        drawing.Classes.Add("sketch");
        return new StackPanel { Spacing = 4, Children = { drawing, new TextBlock { Text = name, FontSize = 10.5, HorizontalAlignment = HorizontalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis } } };
    }

    /// <summary>What a step's <c>animation</c> says, read for the form: its kind, outcome, share, reason, the shape that takes it and the name that does.</summary>
    private static (string Kind, string Outcome, string Share, string Reason, string By, string ByName) ReadAnimation(object? raw)
    {
        var map = raw as OrderedDictionary<string, object?> ?? (raw is string bare && bare != "" ? new OrderedDictionary<string, object?> { ["kind"] = bare } : []);
        string Text(string key) => map.TryGetValue(key, out var v) && v is string s ? s : "";
        var by = map.TryGetValue("by", out var taker) ? taker : null;
        return (Text("kind"), Text("outcome"), Text("share"), Text("reason"), by as string ?? "", by is OrderedDictionary<string, object?> named && named.TryGetValue("name", out var n) && n is string name ? name : "");
    }

    private AnimationRow BuildAnimation(Model model, string flowId, Step first, int i)
    {
        // The step's animation as it is in the document now, which an edit builds on: the form may have been synced after another edit.
        Task<bool> Set(string key, string value) => Edit(flowId, d =>
        {
            var step = StepsOf(d, flowId).ElementAtOrDefault(i);
            return EditOps.SetStepAnimation(d, flowId, i, Animations.With(step is not null && step.TryGetValue("animation", out var now) ? now : null, key, value));
        });
        var kind = new Chooser("Travels as", new UniformGrid { Columns = 5 }, id => Set("kind", id), id => id == "" ? "None" : Title(id));
        foreach (var (id, path) in Animations.KindSketches) kind.Add(id == "none" ? "" : id, id == "none" ? "None" : Title(id), SketchCell(path, id == "none" ? "None" : Title(id)));
        var outcome = new Chooser("Ends as", new UniformGrid { Columns = 4 }, id => Set("outcome", id), id => id == "" ? "Arrives" : Title(id));
        foreach (var (id, path) in Animations.OutcomeSketches) outcome.Add(id == "none" ? "" : id, id == "none" ? "Arrives" : Title(id), SketchCell(path, id == "none" ? "Arrives" : Title(id)));
        var share = new FieldBox("Share of requests (1 to 100)", "", false, v => Set("share", v), "e.g. 30");
        var reason = new FieldBox($"Reason ({Animations.ReasonMax} characters)", "", false, v => Set("reason", v), "e.g. Rate limit");
        var takers = new Chooser("Taken by", new UniformGrid { Columns = 2 }, id => Set("by", id), id => model.Objects.TryGetValue(id, out var o) ? o.Name ?? id : id, maxHeight: 150);
        var takerName = new FieldBox($"Or a name ({Animations.NameMax} characters)", "", false, v => Set("byName", v), "e.g. Café wifi proxy");
        foreach (var (id, o) in model.Objects)
        {
            var name = string.IsNullOrEmpty(o.Name) ? id : o.Name;
            takers.Add(id, name, new StackPanel
            {
                Orientation = Orientation.Horizontal, Spacing = 6,
                Children = { Chrome.ObjectTile(model, o, 20), new TextBlock { Text = name, FontSize = 12, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis } },
            });
        }
        var panel = new StackPanel { Spacing = 10, Children = { kind, outcome, share, reason, takers, takerName } };
        void Sync(Step step)
        {
            var (k, o, s, r, by, byName) = ReadAnimation(step.Animation);
            var travels = !string.IsNullOrEmpty(step.To) && step.To != step.From;
            kind.Show(k);
            foreach (var id in kind.Ids) kind.Allow(id, id == "" || travels ? null : "Needs two shapes");
            outcome.Show(o);
            foreach (var id in outcome.Ids) outcome.Allow(id, Animations.OutcomeBlock(k, id));
            var ended = o != "";
            share.Sync(s);
            share.IsEnabled = ended;
            ToolTip.SetTip(share, ended ? null : "Pick an outcome first");
            reason.Sync(r);
            reason.IsEnabled = ended;
            ToolTip.SetTip(reason, ended ? null : "Pick an outcome first");
            var intercepted = o == "intercepted";
            takers.Show(by == "" ? null : by);
            foreach (var id in takers.Ids) takers.Allow(id, intercepted && id != step.From && id != step.To ? null : intercepted ? "An end of the step" : "Only for Intercepted");
            takerName.Sync(byName);
            takerName.IsEnabled = intercepted;
            ToolTip.SetTip(takerName, intercepted ? null : "Only for Intercepted");
        }
        panel.IsVisible = first.Animation is not null && first.Animation is not "";
        var row = new AnimationRow { Kind = kind, Outcome = outcome, Share = share, Reason = reason, Takers = takers, TakerName = takerName, Panel = panel, Sync = Sync };
        Sync(first);
        return row;
    }

    /// <summary>The copy of one group's options in a document, to change one and give it back to <see cref="EditOps.PutGroup"/>.</summary>
    private static OrderedDictionary<string, object?> GroupOptions(EditDoc d, string flowId, string id)
    {
        var copy = new OrderedDictionary<string, object?>();
        if (d.Flows.TryGetValue(flowId, out var f) && f is OrderedDictionary<string, object?> flow && flow.TryGetValue("groups", out var gs)
            && gs is OrderedDictionary<string, object?> all && all.TryGetValue(id, out var g) && g is OrderedDictionary<string, object?> map)
            foreach (var (key, value) in map) copy[key] = value;
        return copy;
    }

    /// <summary>
    /// The flow's groups: how each behaves (kind, and for a repeat its times and until, and the text the player shows) and a form that puts a stretch
    /// of the steps in a new one. The cards stay as they are while only a text changed, so a field being typed in keeps its focus.
    /// </summary>
    private void ShowGroups(string flowId, int stepCount, OrderedDictionary<string, object?> declared)
    {
        var signature = $"{flowId}\u0003{stepCount}\u0003" + string.Join('\u0002', declared.Select(g => $"{g.Key}\u0001{KindOf(declared, g.Key)}"));
        if (signature != _groupSignature)
        {
            _groupSignature = signature;
            _groups.Children.Clear();
            _cards.Clear();
            _groups.Children.Add(Chrome.Section(Icons.Repeat, "Groups", declared.Count));
            foreach (var id in declared.Keys) _groups.Children.Add(BuildCard(flowId, id, KindOf(declared, id)));
            if (stepCount > 0) _groups.Children.Add(BuildAddGroup(flowId, declared, stepCount));
        }
        foreach (var card in _cards)
        {
            var map = declared.TryGetValue(card.Id, out var g) && g is OrderedDictionary<string, object?> m ? m : [];
            card.Times?.Sync(Field(map, "times") ?? "");
            card.Until?.Sync(Field(map, "until") ?? "");
            card.Text.Sync(Field(map, "text") ?? "");
        }
    }

    private Control BuildCard(string flowId, string id, string? kind)
    {
        Task<bool> Option(string key, string value) => Edit(flowId, d =>
        {
            var options = GroupOptions(d, flowId, id);
            options[key] = value;
            return EditOps.PutGroup(d, flowId, id, options);
        });
        var kindChoice = Pick.Kinds("Kind", KindNames, kind, k => Edit(flowId, d => EditOps.SetGroupKind(d, flowId, id, k)));
        var remove = new Button();
        remove.Classes.Add("tool");
        remove.Classes.Add("danger");
        Chrome.Fill(remove, Icons.Trash, null, $"Remove group {id}");
        ToolTip.SetTip(remove, "Remove the group. Its steps stay");
        remove.Click += async (_, _) => await Edit(flowId, d => EditOps.RemoveGroup(d, flowId, id));
        var icon = Icons.Make(kind == "branch" ? Icons.GitFork : kind == "parallel" ? Icons.ArrowsSplit : Icons.Repeat, "ticon", 16);
        var head = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 8 };
        var title = new TextBlock { Text = id, FontWeight = FontWeight.SemiBold, VerticalAlignment = VerticalAlignment.Center };
        head.Children.Add(icon);
        head.Children.Add(title);
        head.Children.Add(remove);
        Grid.SetColumn(title, 1);
        Grid.SetColumn(remove, 2);
        var card = new GroupCard
        {
            Id = id,
            Kind = kindChoice,
            Text = new FieldBox("Text the player shows", "", false, v => Option("text", v)),
            Remove = remove,
        };
        var body = new StackPanel { Spacing = 8, Children = { head, kindChoice } };
        if (kind == "repeat")
        {
            card.Times = new FieldBox("Times (2 to 99)", "", false, v => Option("times", JsCompat.JsTrim(v)));
            card.Until = new FieldBox("Until (instead of a count)", "", false, v => Option("until", v));
            body.Children.Add(card.Times);
            body.Children.Add(card.Until);
        }
        body.Children.Add(card.Text);
        _cards.Add(card);
        return Chrome.Card(body);
    }

    private Control BuildAddGroup(string flowId, OrderedDictionary<string, object?> declared, int stepCount)
    {
        var text = new TextBox { PlaceholderText = "What it is, e.g. Retry the charge" };
        Avalonia.Automation.AutomationProperties.SetName(text, "Put steps in a new group");
        var kinds = Pick.Kinds("Kind", KindNames, "repeat", _ => Task.FromResult(true));
        var numbers = Enumerable.Range(1, stepCount).ToList();
        ComboBox Range() => new() { HorizontalAlignment = HorizontalAlignment.Stretch, ItemsSource = numbers, SelectedItem = stepCount };
        var first = Range();
        var last = Range();
        Avalonia.Automation.AutomationProperties.SetName(first, "From step");
        Avalonia.Automation.AutomationProperties.SetName(last, "To step");
        var ids = declared.Keys.ToList();
        var add = new Button { HorizontalAlignment = HorizontalAlignment.Left };
        add.Classes.Add("tool");
        add.Classes.Add("primary");
        Chrome.Fill(add, Icons.Plus, "Group these steps");
        async Task<bool> Submit()
        {
            var what = (text.Text ?? "").Trim();
            var kind = kinds.Chosen ?? "repeat";
            var from = (first.SelectedItem as int? ?? stepCount) - 1;
            var to = (last.SelectedItem as int? ?? stepCount) - 1;
            var id = Navigation.NewId(what == "" ? kind : what, ids, "group");
            var saved = await Edit(flowId, d =>
            {
                var grouped = EditOps.GroupSteps(d, flowId, id, kind, from, to);
                if (what == "") return grouped;
                var options = GroupOptions(grouped, flowId, id);
                options["text"] = what;
                return EditOps.PutGroup(grouped, flowId, id, options);
            });
            if (saved) text.Text = "";
            return saved;
        }
        _addGroup = Submit;
        (_newGroupText, _newGroupKind, _newGroupFirst, _newGroupLast) = (text, kinds, first, last);
        add.Click += async (_, _) => await Submit();
        text.KeyDown += async (_, e) =>
        {
            if (e.Key != Key.Enter) return;
            e.Handled = true;
            await Submit();
        };
        var pair = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 8 };
        var from1 = Captioned("From step", first);
        var to1 = Captioned("To step", last);
        pair.Children.Add(from1);
        pair.Children.Add(to1);
        Grid.SetColumn(to1, 1);
        return new StackPanel { Spacing = 8, Children = { Captioned("Put steps in a new group", text), kinds, pair, add } };
    }
}
