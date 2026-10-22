using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// What is waiting on the shapes or lines about to be deleted: a row for each, with the ways to settle it, and Delete once every row is. The choices are
/// made here and applied together by <see cref="EditOps.DeleteWith"/>, so the whole delete is one edit and one undo. The rules are in <see cref="UsedBy"/>;
/// the browser has the same panel in ui/src/UsedBy.tsx.
/// </summary>
internal sealed class UsedByPanel : StackPanel
{
    private readonly SidePanel _owner;
    private readonly IReadOnlyList<Target> _targets;
    private readonly EditRun _run;
    private readonly Dictionary<string, Choice> _choices = [];
    private readonly StackPanel _rows = new() { Spacing = 8 };
    private readonly StackPanel _chooser = new() { Spacing = 6, IsVisible = false };
    private readonly TextBlock _names = new() { FontSize = 14 };
    private readonly TextBlock _along = new() { FontSize = 13, TextWrapping = TextWrapping.Wrap };
    private readonly TextBlock _reason = new() { FontSize = 12, VerticalAlignment = VerticalAlignment.Center };
    private readonly Button _removeAll = new();
    private readonly Button _rerouteAll = new();
    private readonly Button _cancel = new();
    private readonly Button _delete = new();
    private readonly Border _deleteHost = new();
    private readonly TextBlock _enterHint = new() { VerticalAlignment = VerticalAlignment.Center, FontSize = 12 };
    private Model _model;
    private string? _active; // the row in focus, by key
    private string? _picking; // the row whose shape is being picked, by key, or "*" for all of them
    private string _find = "";

    /// <summary>The shapes that are about to go, and the ones the focused row names: for the canvas to outline.</summary>
    public event Action<IReadOnlySet<string>, IReadOnlySet<string>>? Marked;

    /// <summary>The delete was made. Says what it came to.</summary>
    public event Action<string>? Done;

    public event Action? Cancelled;

    public UsedByPanel(SidePanel owner, Model model, IReadOnlyList<Target> targets, EditRun run)
    {
        _owner = owner;
        _model = model;
        _targets = targets;
        _run = run;
        Spacing = 14;
        Focusable = true;
        AutomationProperties.SetName(this, "Used by");
        _names.Classes.Add("muted");

        Configure(_removeAll, Icons.Trash, "Remove all", "Remove every row (Enter)", RemoveAll);
        Configure(_rerouteAll, Icons.Route, "Reroute all to…", "Send every step and mode to one shape (R)", () => ShowChooser("*"));
        Configure(_cancel, Icons.Close, "Cancel", "Change nothing (Esc)", () => Cancelled?.Invoke());
        Configure(_delete, Icons.Trash, "Delete", null, () => _ = ApplyAsync());
        _delete.Classes.Add("danger");
        _deleteHost.Child = _delete;
        _reason.Classes.Add("muted");
        _enterHint.Classes.Add("muted");

        var foot = new WrapPanel { Orientation = Orientation.Horizontal };
        foreach (var b in new Control[] { _removeAll, _rerouteAll, _cancel, _deleteHost, _reason }) foot.Children.Add(b);
        Children.Add(_owner.Heading("Used by"));
        Children.Add(_names);
        Children.Add(_rows);
        Children.Add(_along);
        Children.Add(_chooser);
        Children.Add(foot);
        Children.Add(Hint());
        Render();
    }

    private static void Configure(Button button, string icon, string text, string? tip, Action click)
    {
        button.Classes.Add("tool");
        button.Focusable = false;
        Chrome.Fill(button, icon, text);
        if (tip is not null) ToolTip.SetTip(button, tip);
        button.Click += (_, _) => click();
    }

    // ---- what tests look at -------------------------------------------------------------------------------------

    private UsedByPlan Plan => UsedBy.PlanOf(_model, _targets, _choices);

    /// <summary>The keys of the rows that need a decision, in the order shown.</summary>
    internal IReadOnlyList<string> RowKeys => Plan.Rows.Where(r => r.NeedsDecision).Select(r => r.Key).ToList();

    /// <summary>The keys of the rows with nothing usable chosen yet.</summary>
    internal IReadOnlyList<string> OpenKeys => Plan.Open.Select(r => r.Key).ToList();

    /// <summary>Whether Delete can be pressed, and when it can't, why.</summary>
    internal bool CanDelete => _delete.IsEnabled;

    internal string? Reason => _delete.IsEnabled ? null : ToolTip.GetTip(_deleteHost) as string;

    internal string? ActiveKey => _active;

    internal bool Choosing => _chooser.IsVisible;

    internal string AlongText => _along.Text ?? "";

    internal Choice? ChoiceOf(string key) => _choices.GetValueOrDefault(key);

    /// <summary>What a test does for the reader: picks an action for a row (and where to, for the actions that go to a shape).</summary>
    internal void Choose(string key, string action, string? to = null)
    {
        _choices[key] = new Choice(action, to);
        Render();
    }

    internal void PressRemoveAll() => RemoveAll();

    internal void PressRerouteAll(string to) => RerouteAll(to);

    internal Task<bool> PressDeleteAsync() => ApplyAsync();

    internal void PressCancel() => Cancelled?.Invoke();

    /// <summary>The words shown for each row, for tests: title and place.</summary>
    internal IReadOnlyList<(string Key, string Title, string Where)> RowWords => Plan.Rows.Where(r => r.NeedsDecision).Select(r => (r.Key, UsedBy.TextOf(_model, r).Title, UsedBy.TextOf(_model, r).Where)).ToList();

    // ---- doing -------------------------------------------------------------------------------------------------

    /// <summary>The folder changed (this edit, or someone else's): the rows are worked out again, and the choices stay where they still fit.</summary>
    public void Update(Model model)
    {
        _model = model;
        Render();
    }

    private void RemoveAll()
    {
        var next = UsedBy.RemoveAll(_model, _targets, _choices);
        _choices.Clear();
        foreach (var (key, choice) in next) _choices[key] = choice;
        Render();
    }

    private void RerouteAll(string to)
    {
        var next = UsedBy.RerouteAll(_model, _targets, _choices, to);
        _choices.Clear();
        foreach (var (key, choice) in next) _choices[key] = choice;
        _picking = null;
        Render();
    }

    private async Task<bool> ApplyAsync()
    {
        var plan = Plan;
        if (plan.Open.Count > 0) return false;
        var text = UsedBy.DoneText(_model, plan, _choices, _targets);
        var resolutions = UsedBy.ResolutionsOf(plan, _choices);
        var saved = await _run(d => EditOps.DeleteWith(d, _targets, resolutions));
        if (saved) Done?.Invoke(text);
        return saved;
    }

    /// <summary>Enter: settle every open row by removing it, and once nothing is open, delete.</summary>
    private void EnterPressed()
    {
        if (Plan.Open.Count > 0) RemoveAll();
        else _ = ApplyAsync();
    }

    private void Activate(string? key)
    {
        _active = key;
        Render();
    }

    private void PickAction(Dependent row, string action)
    {
        _active = row.Key;
        if (!UsedBy.NeedsShape(action) && !UsedBy.NeedsPlace(action))
        {
            _picking = null;
            _choices[row.Key] = new Choice(action);
            Render();
            return;
        }
        // A place defaults to the top level until another is picked; a shape has to be picked.
        if (UsedBy.NeedsPlace(action)) _choices[row.Key] = new Choice(action);
        ShowChooser(row.Key);
    }

    private void Picked(string key, string id)
    {
        if (key == "*")
        {
            RerouteAll(id);
            return;
        }
        var row = Plan.Rows.FirstOrDefault(r => r.Key == key);
        if (row is null) return;
        var action = _choices.TryGetValue(key, out var chosen) && (UsedBy.NeedsShape(chosen.Action) || UsedBy.NeedsPlace(chosen.Action))
            ? chosen.Action
            : row.Actions.FirstOrDefault(UsedBy.NeedsShape) ?? row.Actions[0];
        _choices[key] = new Choice(action, id);
        _picking = null;
        Render();
    }

    private void ShowChooser(string key)
    {
        _picking = key;
        _find = "";
        Render();
        Dispatcher.UIThread.Post(() => (_chooser.Children.OfType<TextBox>().FirstOrDefault())?.Focus());
    }

    // ---- drawing -----------------------------------------------------------------------------------------------

    private IBrush Brush(string key) => _owner.Resource(key);

    private void Render()
    {
        var plan = Plan;
        var rows = plan.Rows.Where(r => r.NeedsDecision).ToList();
        if (_active is not null && rows.All(r => r.Key != _active)) _active = null;
        var going = plan.Targets.Where(t => t.Object is not null).Select(t => t.Object!).ToHashSet();
        _names.Text = going.Count == 1 ? Views.NameOf(_model, going.First()) : going.Count > 1 ? $"{going.Count} shapes" : "A line";
        _rows.Children.Clear();
        foreach (var row in rows) _rows.Children.Add(Row(row, plan));
        var along = UsedBy.AlongText(plan.Along);
        _along.Text = along == "" ? "" : $"Goes too: {along}";
        _along.IsVisible = along != "";
        var open = plan.Open.Count;
        _delete.IsEnabled = open == 0;
        _reason.Text = open == 0 ? "" : $"Choose for {open} more";
        ToolTip.SetTip(_deleteHost, open == 0 ? null : $"Choose for {open} more");
        _enterHint.Text = open > 0 ? "Remove all" : "Delete";
        DrawChooser(plan);
        var flagged = _active is { } key && rows.FirstOrDefault(r => r.Key == key) is { } active ? UsedBy.TextOf(_model, active).Shapes.ToHashSet() : [];
        Marked?.Invoke(going, flagged);
    }

    private Control Row(Dependent row, UsedByPlan plan)
    {
        var text = UsedBy.TextOf(_model, row);
        _choices.TryGetValue(row.Key, out var choice);
        var joined = row.Flow is not null && plan.Flows.Contains(row.Flow) && choice?.Action != "deleteFlow";
        var done = joined || UsedBy.Settles(row, choice);
        Control mark = row.Kind == "child"
            ? Chrome.ObjectTile(_model, _model.GetObject(row.Child!), 28)
            : new Border { Width = 28, Height = 28, CornerRadius = new CornerRadius(8), Background = new SolidColorBrush(((ISolidColorBrush)Brush(row.Analysis is null ? "AccentBrush" : "WarnBrush")).Color, 0.16), Child = Icons.Make(row.Analysis is null ? Icons.Route : Icons.Alert, row.Analysis is null ? "pickicon" : "warnicon", 16) };
        mark.VerticalAlignment = VerticalAlignment.Center;
        var title = new TextBlock { Text = text.Title, FontWeight = FontWeight.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis };
        var where = new TextBlock { Text = text.Where, FontSize = 12, TextTrimming = TextTrimming.CharacterEllipsis };
        where.Classes.Add("muted");
        var words = new StackPanel { Children = { title, where }, VerticalAlignment = VerticalAlignment.Center };
        var head = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 10 };
        head.Children.Add(mark);
        head.Children.Add(words);
        Grid.SetColumn(words, 1);
        if (row.EmptiesFlow)
        {
            var chip = Chrome.Chip("Last steps", Icons.Alert, "warn");
            chip.VerticalAlignment = VerticalAlignment.Center;
            head.Children.Add(chip);
            Grid.SetColumn(chip, 2);
        }
        var body = new StackPanel { Spacing = 8, Children = { head } };
        if (joined)
        {
            var with = new TextBlock { Text = "With the flow", FontSize = 12 };
            with.Classes.Add("muted");
            body.Children.Add(with);
        }
        else
        {
            var actions = new WrapPanel { Orientation = Orientation.Horizontal };
            foreach (var action in row.Actions)
            {
                var label = UsedBy.Label(action);
                var cell = ActionCell(label, row, action, choice?.Action == action);
                actions.Children.Add(cell);
            }
            body.Children.Add(actions);
            if (choice?.To is { } to)
            {
                var shape = to == Names.Root ? Chrome.TypeTile("", false, 20) : Chrome.ObjectTile(_model, _model.GetObject(to), 20);
                shape.VerticalAlignment = VerticalAlignment.Center;
                var name = new TextBlock { Text = to == Names.Root ? "Top level" : Views.NameOf(_model, to), FontSize = 12, VerticalAlignment = VerticalAlignment.Center };
                body.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { shape, name } });
            }
        }
        var card = new Border { Child = body, Padding = new Thickness(10, 8), CornerRadius = new CornerRadius(8), BorderThickness = new Thickness(3, 1, 1, 1) };
        card.Classes.Add("usedrow");
        card.Classes.Set("active", row.Key == _active);
        card.Classes.Set("done", done);
        card.BorderBrush = Brush(done ? "AccentBrush" : "WarnBrush");
        card.PointerPressed += (_, _) => Activate(row.Key);
        AutomationProperties.SetName(card, $"{text.Title}, {text.Where}");
        return card;
    }

    private Button ActionCell(string label, Dependent row, string action, bool on)
    {
        var cell = Flowy.App.Pick.Cell(label, new TextBlock { Text = label, FontSize = 12 }, "wide");
        cell.Focusable = false;
        cell.Margin = new Thickness(0, 0, 4, 4);
        cell.Classes.Set("on", on);
        if (action is "deleteFlow" or "removeStep" or "removeMode" or "deleteWith") cell.Classes.Add("remove");
        cell.Click += (_, _) => PickAction(row, action);
        return cell;
    }

    /// <summary>The list of shapes to pick one from, with a field to narrow it, shown under the rows while a choice that names a shape is open.</summary>
    private void DrawChooser(UsedByPlan plan)
    {
        _chooser.Children.Clear();
        _chooser.IsVisible = _picking is not null;
        if (_picking is null) return;
        var find = new TextBox { Text = _find, PlaceholderText = "Find a shape" };
        AutomationProperties.SetName(find, "Find a shape");
        find.TextChanged += (_, _) =>
        {
            if ((find.Text ?? "") == _find) return;
            _find = find.Text ?? "";
            DrawChooserList(plan);
        };
        find.KeyDown += (_, e) =>
        {
            if (e.Key == Key.Escape)
            {
                e.Handled = true;
                _picking = null;
                Render();
                Focus();
            }
            else if (e.Key == Key.Enter)
            {
                e.Handled = true;
                if (CurrentCandidates(plan).FirstOrDefault() is { } first) Picked(_picking!, first);
            }
        };
        _chooser.Children.Add(find);
        _chooser.Children.Add(new StackPanel { Name = "ChooserList", Spacing = 2 });
        DrawChooserList(plan);
    }

    private string NameOf(string id) => id == Names.Root ? "Top level" : Views.NameOf(_model, id);

    private List<string> CurrentCandidates(UsedByPlan plan)
    {
        var row = plan.Rows.FirstOrDefault(r => r.Key == _picking);
        var action = row is not null && _choices.TryGetValue(row.Key, out var chosen) ? chosen.Action : null;
        var place = action is not null && UsedBy.NeedsPlace(action);
        var left = UsedBy.ShapesLeft(_model, plan);
        var ids = _picking == "*" ? left : place ? (action == "moveOut" ? left : left.Where(id => Views.IsView(_model, id)).ToList()) : left;
        return (place ? new[] { Names.Root } : []).Concat(ids)
            .Where(id => _find == "" || NameOf(id).Contains(_find, StringComparison.OrdinalIgnoreCase) || id.Contains(_find, StringComparison.OrdinalIgnoreCase)).Take(40).ToList();
    }

    private void DrawChooserList(UsedByPlan plan)
    {
        if (_chooser.Children.OfType<StackPanel>().FirstOrDefault(p => p.Name == "ChooserList") is not { } list) return;
        list.Children.Clear();
        var key = _picking!;
        foreach (var id in CurrentCandidates(plan))
        {
            var tile = id == Names.Root ? Chrome.TypeTile("", false, 22) : Chrome.ObjectTile(_model, _model.GetObject(id), 22);
            var cell = Flowy.App.Pick.Cell(NameOf(id), new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { tile, new TextBlock { Text = NameOf(id), FontSize = 13, VerticalAlignment = VerticalAlignment.Center } } }, "wide");
            cell.Margin = new Thickness(0);
            cell.Focusable = false;
            cell.HorizontalContentAlignment = HorizontalAlignment.Left;
            cell.Click += (_, _) => Picked(key, id);
            list.Children.Add(cell);
        }
        if (list.Children.Count == 0)
        {
            var none = new TextBlock { Text = "No shapes" };
            none.Classes.Add("muted");
            list.Children.Add(none);
        }
    }

    /// <summary>The keys of the panel, drawn as caps and one verb each: <c>[↑][↓] Row  [X] Remove  [R] Reroute  [Enter] Remove all  [Esc] Cancel</c>.</summary>
    private Control Hint()
    {
        var wrap = new WrapPanel { Orientation = Orientation.Horizontal };
        Control Item(string keys, Control verb) { var row = KeyCaps.Of(keys, verb); row.Margin = new Thickness(0, 0, 12, 4); return row; }
        static TextBlock Verb(string text) { var t = new TextBlock { Text = text, FontSize = 12, VerticalAlignment = VerticalAlignment.Center }; t.Classes.Add("muted"); return t; }
        wrap.Children.Add(Item("↑ ↓", Verb("Row")));
        wrap.Children.Add(Item("X", Verb("Remove")));
        wrap.Children.Add(Item("R", Verb("Reroute")));
        wrap.Children.Add(Item("Enter", _enterHint));
        wrap.Children.Add(Item("Esc", Verb("Cancel")));
        return wrap;
    }

    // ---- keys --------------------------------------------------------------------------------------------------

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.Handled || e.Source is TextBox || e.KeyModifiers != KeyModifiers.None) return;
        var plan = Plan;
        var rows = plan.Rows.Where(r => r.NeedsDecision && !(r.Flow is not null && plan.Flows.Contains(r.Flow) && _choices.GetValueOrDefault(r.Key)?.Action != "deleteFlow")).ToList();
        var active = rows.FirstOrDefault(r => r.Key == _active);
        switch (e.Key)
        {
            case Key.Escape:
                e.Handled = true;
                if (_picking is not null)
                {
                    _picking = null;
                    Render();
                }
                else Cancelled?.Invoke();
                return;
            case Key.Enter:
                e.Handled = true;
                EnterPressed();
                return;
            case Key.Down or Key.Up when rows.Count > 0:
                e.Handled = true;
                var i = _active is null ? -1 : rows.FindIndex(r => r.Key == _active);
                Activate(rows[Math.Clamp(i + (e.Key == Key.Down ? 1 : -1), 0, rows.Count - 1)].Key);
                return;
        }
        if (e.PhysicalKey == PhysicalKey.X && active is not null)
        {
            e.Handled = true;
            _choices[active.Key] = UsedBy.DefaultChoice(active);
            Render();
        }
        else if (e.PhysicalKey == PhysicalKey.R)
        {
            e.Handled = true;
            if (active is null) ShowChooser("*");
            else if (active.Actions.FirstOrDefault(UsedBy.NeedsShape) is { } action) PickAction(active, action);
        }
    }
}
