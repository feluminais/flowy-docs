using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>The flow a step says its story continues in: its id and name, and whether it can play (it has steps, and its view opens).</summary>
internal sealed record LinkedFlow(string Id, string Name, bool Playable);

/// <summary>One step of the stop on show, as the card tells it. <c>Lane</c> is "" unless the stop is in a parallel group; <c>Outcome</c> is how its request ended, in the words of <see cref="Animations.OutcomeLine"/>.</summary>
internal sealed record PlayerStep(string Ends, string Text, string? Description, string Lane, LinkedFlow? Link, string? Outcome = null);

/// <summary>
/// Everything the card shows: where the flow is (a stop of <c>Count</c>), the group the stop is in, the progress bar, the steps, the trail back, and the states on the canvas now (for the key).
/// <c>Changes</c> is the kind of change each cell of the progress bar carries (one for each of its cells, null for none), while a comparison has Show changes on.
/// </summary>
internal sealed record PlayerView(
    string FlowName, int Stop, int Count, string? Kind, Caption Caption, Progress Progress, bool Auto, bool Moving, (string Name, int Step)? Trail, IReadOnlyList<PlayerStep> Steps,
    IReadOnlyList<StateMark>? States = null, IReadOnlyList<Change?>? Changes = null);

/// <summary>The card at the bottom while a flow plays: which stop, the group it is in, who talks to whom, what happens, and Back, Next and Stop.</summary>
internal sealed class PlayerCard : Border
{
    public event Action? Back;
    public event Action? Next;
    public event Action? Stop;
    public event Action? Auto;
    public event Action? Replay;
    /// <summary>The reader chose to open the flow a step continues in.</summary>
    public event Action<string>? OpenFlow;
    /// <summary>The reader chose to go back to the flow this one was opened from.</summary>
    public event Action? BackToFlow;

    /// <summary>The reader chose Compare (the button is there only on the reader's own card).</summary>
    public event Action? CompareClicked;

    // Whether the legend is open. It stays as the reader left it for as long as the app runs, and every card shares it, so the two cards of a comparison never disagree.
    private static bool s_legend;
    private readonly bool _inPane;
    private PlayerView? _shown;
    private string? _compareOff;

    /// <summary>
    /// <paramref name="inPane"/>: the card of one pane of a comparison. It never leaves its flow, so its Stop and Open flow are greyed out with the reason in their tooltips, it has no Compare button,
    /// and it sits closer to its pane's edge.
    /// </summary>
    public PlayerCard(bool inPane = false)
    {
        _inPane = inPane;
        Classes.Add("card");
        HorizontalAlignment = HorizontalAlignment.Center;
        VerticalAlignment = VerticalAlignment.Bottom;
        MaxWidth = 520;
        Margin = inPane ? new Thickness(10, 0, 10, 12) : new Thickness(16, 0, 16, 24);
        IsVisible = false;
    }

    /// <summary>Why Compare is greyed out (it is the tooltip), or null when it is not. The card shows the button only on the reader's own card.</summary>
    public string? CompareOff
    {
        get => _compareOff;
        set
        {
            _compareOff = value;
            if (CompareButton is { } button)
            {
                button.IsEnabled = value is null;
                ToolTip.SetTip(button, value ?? "Compare with another flow (C)");
            }
        }
    }

    /// <summary>The Compare button now on the card, or null when there is none (no flow shows, or this is a pane's card).</summary>
    public Button? CompareButton { get; private set; }

    /// <summary>The flyout of the Compare button, shown above the card's content for as long as it is set. The card is rebuilt at every step, so it keeps hold of this and puts it back.</summary>
    public Control? Picker
    {
        get => _picker;
        set
        {
            _picker = value;
            if (_shown is { } again && IsVisible) Show(again);
        }
    }

    private Control? _picker;

    private Button Tool(string icon, string? text, Action click, bool enabled = true, bool primary = false, string? name = null)
    {
        var button = new Button { IsEnabled = enabled };
        button.Classes.Add("tool");
        if (primary) button.Classes.Add("primary");
        Chrome.Fill(button, icon, text, name);
        button.Click += (_, _) => click();
        return button;
    }

    /// <summary>
    /// How far a flow has got: a cell for each stop, filled up to the stop shown. A group is boxed, with the line that says what it is at the foot of the
    /// box, and a box with an <c>until</c> is dashed (it may stop before its last time). A branch's lanes are rows of their own, each named, and the lanes the
    /// stop shown is not in are hollow. A cell says its lane and a box says what its group means when you point at it.
    /// </summary>
    private static Control Bar(Progress progress, int now, IReadOnlyList<Change?>? changes)
    {
        var here = progress.Cells.FirstOrDefault(c => c.Stop == now);
        // What differs at a cell's stop: `changes` runs along the cells.
        Change? ChangeAt(Cell cell)
        {
            for (var n = 0; n < progress.Cells.Count; n++)
                if (progress.Cells[n] == cell) return changes is not null && n < changes.Count ? changes[n] : null;
            return null;
        }
        Control Cell(Cell cell)
        {
            var segment = new Border();
            segment.Classes.Add("seg");
            if (cell.Stop <= now) segment.Classes.Add("done");
            if (here is not null && cell.Group >= 0 && cell.Group == here.Group && progress.Brackets[cell.Group].Kind == "branch" && cell.Row != here.Row) segment.Classes.Add("off");
            var change = ChangeAt(cell);
            if (change is { } kind) segment.Classes.Add("chg-" + BoxControl.Word(kind));
            // A strip four pixels high is hard to point at, so each sits in a taller one that takes the pointer.
            var hit = new Border { Background = Brushes.Transparent, Padding = new Thickness(0, 2), Child = segment };
            var title = string.Join(", ", new[] { cell.Title, change is { } named ? CompareUi.Name(named) : "" }.Where(t => t != ""));
            if (title != "") ToolTip.SetTip(hit, title);
            return hit;
        }
        var parts = new List<(int At, int Group)>();
        for (var col = 0; col < progress.Cols;)
        {
            var group = progress.Cells.FirstOrDefault(c => c.Col == col && c.Row == 0 && c.Group >= 0)?.Group ?? -1;
            parts.Add((col, group));
            col = group < 0 ? col + 1 : progress.Brackets[group].To + 1;
        }
        var strip = new Grid { ColumnSpacing = 3, Margin = new Thickness(0, 4) };
        for (var i = 0; i < parts.Count; i++)
        {
            var (at, group) = parts[i];
            Control part;
            if (group < 0)
                part = Cell(progress.Cells.First(c => c.Col == at && c.Group < 0));
            else
            {
                var b = progress.Brackets[group];
                var span = b.To - b.From + 1;
                var branch = b.Kind == "branch";
                var mine = progress.Cells.Where(c => c.Group == group).ToList();
                var rows = branch ? Math.Max(b.Lanes.Count, mine.Max(c => c.Row) + 1) : 1;
                var cells = new Grid { ColumnSpacing = 3 };
                for (var c = 0; c < span; c++) cells.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Star));
                for (var r = 0; r < (branch ? rows * 2 : 1); r++) cells.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
                if (branch)
                    for (var r = 0; r < rows; r++)
                    {
                        var name = new TextBlock { Text = r < b.Lanes.Count ? b.Lanes[r] : "" };
                        name.Classes.Add("barlane");
                        if (here is not null && here.Group == group && here.Row == r) name.Classes.Add("on");
                        Grid.SetRow(name, r * 2);
                        Grid.SetColumnSpan(name, span);
                        cells.Children.Add(name);
                    }
                foreach (var cell in mine)
                {
                    var hit = Cell(cell);
                    Grid.SetColumn(hit, cell.Col - b.From);
                    Grid.SetRow(hit, branch ? cell.Row * 2 + 1 : 0);
                    cells.Children.Add(hit);
                }
                var label = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 3, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 0, 0, 2) };
                label.Children.Add(Icons.Make(Icons.ForKind(b.Kind), "chipicon", 11));
                label.Children.Add(new TextBlock { Text = b.Text, FontSize = 10.5, Classes = { "muted" } });
                var box = new Rectangle();
                box.Classes.Add("box");
                if (b.Maybe) box.Classes.Add("maybe");
                part = new Grid { Margin = new Thickness(5, 0), VerticalAlignment = VerticalAlignment.Top, Background = Brushes.Transparent, Children = { box, new StackPanel { Margin = new Thickness(5, 3, 5, 0), Children = { cells, label } } } };
                ToolTip.SetTip(part, b.Title);
            }
            strip.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(group < 0 ? 1 : progress.Brackets[group].To - progress.Brackets[group].From + 1, GridUnitType.Star)));
            Grid.SetColumn(part, i);
            strip.Children.Add(part);
        }
        return strip;
    }

    /// <summary>What the chips, the bar and the labels on lines mean, in the words core gives it (see <see cref="Captions.Legend"/>).</summary>
    private static Control LegendBlock()
    {
        var rows = new StackPanel { Spacing = 6 };
        foreach (var row in Captions.Legend)
        {
            var title = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
            if (row.Kind is not null) title.Children.Add(Icons.Make(Icons.ForKind(row.Kind), "chipicon", 13));
            title.Children.Add(new TextBlock { Text = row.Title, FontWeight = FontWeight.SemiBold, FontSize = 12.5 });
            var text = new TextBlock { Text = row.Text, FontSize = 12.5, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(19, 0, 0, 0), Classes = { "muted" } };
            rows.Children.Add(new StackPanel { Children = { title, text } });
        }
        var box = new Border
        {
            Child = new ScrollViewer { Content = rows, MaxHeight = 190, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled },
            Padding = new Thickness(10, 8),
            CornerRadius = new CornerRadius(8),
        };
        box.Classes.Add("legend");
        return box;
    }

    /// <summary>A control that is greyed out says why when the pointer rests on it, since it does not take the pointer itself.</summary>
    private static void GreyedWith(Control control, string reason)
    {
        ToolTip.SetTip(control, reason);
        ToolTip.SetShowOnDisabled(control, true);
    }

    private Control Block(PlayerStep step, bool lane)
    {
        var block = new StackPanel { Spacing = lane ? 4 : 8 }; // a card for one step spaces its lines as it always did
        if (step.Lane != "")
        {
            var name = new TextBlock { Text = step.Lane };
            name.Classes.Add("lane");
            block.Children.Add(name);
        }
        block.Children.Add(new TextBlock { Text = step.Ends, FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap });
        block.Children.Add(new TextBlock { Text = step.Text, TextWrapping = TextWrapping.Wrap });
        if (step.Outcome is { } outcome)
        {
            // How the request ended: a fact the picture can't give, so it is text, with a mark beside it.
            var dot = new Border { Width = 8, Height = 8, CornerRadius = new CornerRadius(4), VerticalAlignment = VerticalAlignment.Center };
            dot.Classes.Add("outcomedot");
            var words = new TextBlock { Text = outcome, TextWrapping = TextWrapping.Wrap };
            words.Classes.Add("outcome");
            block.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { dot, words } });
        }
        if (!string.IsNullOrEmpty(step.Description))
        {
            var more = new MarkdownView(step.Description) { IsVisible = false, Margin = new Thickness(0, 4, 0, 0) };
            var header = new Button { Content = "▸ More" };
            header.Classes.Add("disclosure");
            header.Click += (_, _) =>
            {
                more.IsVisible = !more.IsVisible;
                header.Content = more.IsVisible ? "▾ More" : "▸ More";
            };
            block.Children.Add(new StackPanel { Children = { header, more } });
        }
        if (step.Link is { } link)
        {
            var open = Tool(Icons.Route, $"Open flow: {link.Name}", () => OpenFlow?.Invoke(link.Id), link.Playable && !_inPane);
            open.HorizontalAlignment = HorizontalAlignment.Left;
            if (_inPane) GreyedWith(open, "Not while comparing");
            block.Children.Add(open);
        }
        if (!lane) return block;
        var framed = new Border { Child = block, Padding = new Thickness(10, 0, 0, 0), BorderThickness = new Thickness(3, 0, 0, 0) };
        framed.Classes.Add("laneblock");
        return framed;
    }

    public void Show(PlayerView v)
    {
        _shown = v;
        var grouped = v.Progress.Brackets.Count > 0; // the legend explains groups, so a flow with none has no button
        var column = new StackPanel { Spacing = 8 };
        if (v.Trail is { } trail)
        {
            var back = Tool(Icons.ArrowLeft, $"Back to “{trail.Name}”, step {trail.Step}", () => BackToFlow?.Invoke());
            back.Classes.Add("trail");
            back.HorizontalAlignment = HorizontalAlignment.Stretch;
            back.HorizontalContentAlignment = HorizontalAlignment.Left;
            column.Children.Add(back);
        }
        var chips = new List<Control> { Chrome.Chip(v.FlowName, Icons.Play), Chrome.Chip($"Step {v.Stop + 1} of {v.Count}", null, "accent") };
        if (v.Caption.Chip != "") chips.Add(Chrome.Chip(v.Caption.Chip, Icons.ForKind(v.Kind)));
        var head = new DockPanel { LastChildFill = true };
        if (grouped)
        {
            var help = Tool(Icons.Help, null, () =>
            {
                s_legend = !s_legend;
                if (_shown is { } again) Show(again);
            }, name: "What do these mean?");
            help.Classes.Add("legendbutton");
            if (s_legend) help.Classes.Add("on");
            ToolTip.SetTip(help, "What do these mean?");
            DockPanel.SetDock(help, Dock.Right);
            head.Children.Add(help);
        }
        CompareButton = null;
        if (!_inPane)
        {
            var compare = Tool(Icons.Columns, "Compare", () => CompareClicked?.Invoke(), _compareOff is null, name: "Compare");
            ToolTip.SetTip(compare, _compareOff ?? "Compare with another flow (C)");
            ToolTip.SetShowOnDisabled(compare, true);
            if (_picker is not null) compare.Classes.Add("pressed");
            DockPanel.SetDock(compare, Dock.Right);
            head.Children.Add(compare);
            CompareButton = compare;
        }
        head.Children.Add(Chrome.Chips([.. chips]));
        column.Children.Add(head);
        if (grouped && s_legend) column.Children.Add(LegendBlock());
        if (v.Caption.Tabs.Count > 0)
        {
            var tabs = new WrapPanel { Orientation = Orientation.Horizontal };
            for (var i = 0; i < v.Caption.Tabs.Count; i++)
            {
                var tab = new Border { Child = new TextBlock { Text = v.Caption.Tabs[i] }, Margin = new Thickness(0, 0, 6, 4) };
                tab.Classes.Add("tab");
                if (i == v.Caption.Tab) tab.Classes.Add("on");
                tabs.Children.Add(tab);
            }
            column.Children.Add(tabs);
        }
        if (v.Caption.Text != "") column.Children.Add(new TextBlock { Text = v.Caption.Text, FontSize = 12.5, TextWrapping = TextWrapping.Wrap, Classes = { "muted" } });
        column.Children.Add(Bar(v.Progress, v.Stop, v.Changes));
        // The key: one mark for each state that is on the canvas now, drawn as it looks there.
        if (v.States is { Count: > 0 } && StateKey.Of(v.States) is { } key) column.Children.Add(key);
        foreach (var step in v.Steps) column.Children.Add(Block(step, v.Steps.Count > 1));
        var buttons = new DockPanel { Margin = new Thickness(0, 6, 0, 0), LastChildFill = false };
        var stop = Tool(Icons.Close, "Stop", () => Stop?.Invoke(), !_inPane);
        if (_inPane) GreyedWith(stop, "Close the comparison to stop");
        stop.Margin = new Thickness(16, 0, 0, 0);
        DockPanel.SetDock(stop, Dock.Right);
        buttons.Children.Add(stop);
        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { Tool(Icons.ArrowLeft, "Back", () => Back?.Invoke(), v.Stop > 0), Tool(Icons.ArrowRight, "Next", () => Next?.Invoke(), v.Stop < v.Count - 1, primary: true) } };
        left.Children.Add(v.Auto ? Tool(Icons.Pause, "Pause", () => Auto?.Invoke()) : Tool(Icons.Play, "Autoplay", () => Auto?.Invoke()));
        if (v.Moving) left.Children.Add(Tool(Icons.Reload, null, () => Replay?.Invoke(), name: "Replay this step"));
        buttons.Children.Add(left);
        column.Children.Add(buttons);
        // The flyout from the Compare button sits above the card's content. The last rebuild still holds it, so it is let go of before it is given a new place.
        Detach(_picker);
        // A pane has little room: its card scrolls when its pane (which sets MaxHeight) is shorter than the card.
        Control body = _inPane ? new ScrollViewer { Content = column, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled } : column;
        Child = _picker is null ? body : new StackPanel { Spacing = 10, Children = { _picker, body } };
        IsVisible = true;
    }

    /// <summary>Lets go of a control the last build of the card put in a panel of its own, so the next build can give it a place.</summary>
    private static void Detach(Control? control)
    {
        if (control is not null && control.Parent is Panel panel) panel.Children.Remove(control);
    }

    public void Clear()
    {
        Detach(_picker);
        IsVisible = false;
        Child = null;
        CompareButton = null;
    }
}
