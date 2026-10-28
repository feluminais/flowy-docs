using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.VisualTree;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>The flow a step says its story continues in: its id and name, and whether it can play (it has steps, and its view opens).</summary>
internal sealed record LinkedFlow(string Id, string Name, bool Playable);

/// <summary>One step of the stop on show, as the card tells it. <c>Lane</c> is "" unless the stop is in a parallel group; <c>Outcome</c> is how its request ended, in the words of <see cref="Animations.OutcomeLine"/>.</summary>
internal sealed record PlayerStep(string Ends, string Text, string? Description, string Lane, LinkedFlow? Link, string? Outcome = null, bool IsChannel = false);

/// <summary>
/// Everything the card shows: where the flow is (a stop of <c>Count</c>), the group the stop is in, the progress bar, the steps, the trail back, and the states on the canvas now (for the key), and <c>ChannelKinds</c> the kinds of channel open now (for the key below it).
/// <c>Changes</c> is the kind of change each cell of the progress bar carries (one for each of its cells, null for none), while a comparison has Show changes on.
/// </summary>
internal sealed record PlayerView(
    string FlowName, int Stop, int Count, string? Kind, Caption Caption, Progress Progress, bool Auto, bool Moving, (string Name, int Step)? Trail, IReadOnlyList<PlayerStep> Steps,
    IReadOnlyList<StateMark>? States = null, IReadOnlyList<Change?>? Changes = null, IReadOnlyList<string>? ChannelKinds = null);

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
        AreaStyles.Add(this, "Player");
        _inPane = inPane;
        Classes.Add("card");
        HorizontalAlignment = HorizontalAlignment.Center;
        VerticalAlignment = VerticalAlignment.Bottom;
        MaxWidth = 520;
        Margin = inPane ? new Thickness(10, 0, 10, 12) : new Thickness(16, 24, 16, 24);
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

    /// <summary>A branch's lanes on the bar: a name 14 high over a strip 8 high (the cell and the room round it to point at), 4 apart, so a strip's middle is 18 down its lane.</summary>
    private const double LaneName = 14, LaneGap = 4, Lane = 26, Strip = 18, ElbowWidth = 16;

    /// <summary>
    /// Where a branch splits, or with <paramref name="join"/> where its lanes meet again: straight lines with square corners between the bar's line and each of
    /// <paramref name="rows"/> lanes. The way to lane <paramref name="on"/> is drawn over the rest in the accent (-1 for none). The browser's Elbow draws the same.
    /// </summary>
    private static Control Elbow(int rows, int on, bool join)
    {
        static double Y(int r) => r * Lane + Strip;
        string Way(int r) => join
            ? FormattableString.Invariant($"M0,{Y(r)} H{ElbowWidth / 2} V{Y(0)} H{ElbowWidth}")
            : FormattableString.Invariant($"M0,{Y(0)} H{ElbowWidth / 2} V{Y(r)} H{ElbowWidth}");
        var canvas = new Avalonia.Controls.Canvas { Width = ElbowWidth, Height = Y(rows - 1) + 2, VerticalAlignment = VerticalAlignment.Top };
        for (var r = 0; r < rows; r++) canvas.Children.Add(new Avalonia.Controls.Shapes.Path { Data = Geometry.Parse(Way(r)), Classes = { "elbow" } });
        if (on >= 0) canvas.Children.Add(new Avalonia.Controls.Shapes.Path { Data = Geometry.Parse(Way(on)), Classes = { "elbow", "on" } });
        return canvas;
    }

    /// <summary>
    /// How far a flow has got: a cell for each stop, filled up to the stop shown. A repeat or parallel group is boxed, with the line that says what it is at the
    /// foot of the box, and a box with an <c>until</c> is dashed (it may stop before its last time). A branch is a fork: the bar splits into a row for each lane,
    /// each named, and meets again when steps follow; an "only if" has an empty way round. The lanes the stop shown is not in are hollow. A cell says its lane
    /// and a group says what it means when you point at it.
    /// </summary>
    private static Control Bar(Progress progress, int now, IReadOnlyList<Change?>? changes)
    {
        var here = progress.Cells.FirstOrDefault(c => c.Stop == now);
        // The cells by where they go, read once: looking each column up in every cell would cost the square of the steps, at every step of a long flow.
        var index = new Dictionary<Cell, int>(ReferenceEqualityComparer.Instance);
        var groupAt = new Dictionary<int, int>();
        var plainAt = new Dictionary<int, Cell>();
        var inGroup = new Dictionary<int, List<Cell>>();
        for (var n = 0; n < progress.Cells.Count; n++)
        {
            var c = progress.Cells[n];
            index.TryAdd(c, n);
            if (c.Group < 0) plainAt.TryAdd(c.Col, c);
            else
            {
                if (c.Row == 0) groupAt.TryAdd(c.Col, c.Group);
                if (!inGroup.TryGetValue(c.Group, out var list)) inGroup[c.Group] = list = [];
                list.Add(c);
            }
        }
        // What differs at a cell's stop: `changes` runs along the cells.
        Change? ChangeAt(Cell cell) => changes is not null && index.TryGetValue(cell, out var n) && n < changes.Count ? changes[n] : null;
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
            var group = groupAt.TryGetValue(col, out var g) ? g : -1;
            parts.Add((col, group));
            col = group < 0 ? col + 1 : progress.Brackets[group].To + 1;
        }
        Grid Cells(Bracket b, IEnumerable<Cell> mine)
        {
            var cells = new Grid { ColumnSpacing = 3 };
            for (var c = 0; c <= b.To - b.From; c++) cells.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Star));
            foreach (var cell in mine)
            {
                var hit = Cell(cell);
                Grid.SetColumn(hit, cell.Col - b.From);
                cells.Children.Add(hit);
            }
            return cells;
        }
        Control Fork(Bracket b, int group, List<Cell> mine)
        {
            var rows = Math.Max(b.Lanes.Count, mine.Max(c => c.Row) + 1);
            var ways = rows == 1 ? 2 : rows; // an "only if" may also go round its lane
            var on = here is not null && here.Group == group ? here.Row : -1;
            var lanes = new StackPanel { Spacing = LaneGap };
            var byRow = mine.ToLookup(c => c.Row);
            for (var r = 0; r < ways; r++)
            {
                var name = new TextBlock { Text = r < b.Lanes.Count ? b.Lanes[r] : "", Height = LaneName };
                name.Classes.Add("barlane");
                if (r == on) name.Classes.Add("on");
                Control way = r < rows ? Cells(b, byRow[r]) : new Border { Height = 2, Margin = new Thickness(0, 3), Classes = { "round" } };
                lanes.Children.Add(new StackPanel { Children = { name, way } });
            }
            var fork = new DockPanel { VerticalAlignment = VerticalAlignment.Top, Background = Brushes.Transparent };
            var split = Elbow(ways, on, false);
            DockPanel.SetDock(split, Dock.Left);
            fork.Children.Add(split);
            if (b.To + 1 < progress.Cols)
            {
                var join = Elbow(ways, on, true);
                DockPanel.SetDock(join, Dock.Right);
                fork.Children.Add(join);
            }
            fork.Children.Add(lanes);
            // Many lanes: five and half of a sixth, then the lanes and their elbows scroll together, kept on the lane this stop is in and its cells.
            var scroll = Scrolled(fork, 5.5 * Lane, "barlane", below: Lane - LaneName - LaneGap);
            scroll.VerticalAlignment = VerticalAlignment.Top;
            return scroll;
        }
        // On a bar with a fork, the rest sits level with the first lane's strip.
        var forked = progress.Brackets.Any(b => b.Kind == "branch");
        var strip = new Grid { ColumnSpacing = 3, Margin = new Thickness(0, 4) };
        for (var i = 0; i < parts.Count; i++)
        {
            var (at, group) = parts[i];
            Control part;
            if (group < 0)
            {
                part = Cell(plainAt[at]);
                if (forked) (part.VerticalAlignment, part.Margin) = (VerticalAlignment.Top, new Thickness(0, Strip - 4, 0, 0));
            }
            else if (progress.Brackets[group].Kind == "branch")
            {
                // A fork reaches over the gap to its neighbours, so its line runs on from them: the bar's gap, and a box's margin too. None at an end.
                double Reach(int n) => n < 0 || n >= parts.Count ? 0 : parts[n].Group >= 0 && progress.Brackets[parts[n].Group].Kind != "branch" ? -8 : -3;
                part = Fork(progress.Brackets[group], group, inGroup[group]);
                part.Margin = new Thickness(Reach(i - 1), 0, Reach(i + 1), 0);
                ToolTip.SetTip(part, progress.Brackets[group].Title);
            }
            else
            {
                var b = progress.Brackets[group];
                var cells = Cells(b, inGroup[group]);
                var label = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 3, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 0, 0, 2) };
                label.Children.Add(Icons.Make(Icons.ForKind(b.Kind), "chipicon", 11));
                label.Children.Add(new TextBlock { Text = b.Text, FontSize = 10.5, Classes = { "muted" } });
                var box = new Rectangle();
                box.Classes.Add("box");
                if (b.Maybe) box.Classes.Add("maybe");
                // A box's strip is 7 down it, so on a forked bar the box drops by the rest.
                part = new Grid { Margin = new Thickness(5, forked ? Strip - 7 : 0, 5, 0), VerticalAlignment = VerticalAlignment.Top, Background = Brushes.Transparent, Children = { box, new StackPanel { Margin = new Thickness(5, 3, 5, 0), Children = { cells, label } } } };
                ToolTip.SetTip(part, b.Title);
            }
            strip.ColumnDefinitions.Add(new ColumnDefinition(new GridLength(group < 0 ? 1 : progress.Brackets[group].To - progress.Brackets[group].From + 1, GridUnitType.Star)));
            Grid.SetColumn(part, i);
            strip.Children.Add(part);
        }
        return strip;
    }

    /// <summary>
    /// <paramref name="content"/> in a box at most <paramref name="height"/> high that scrolls, with the scroll kept on its child that is on (the lane
    /// this stop is in, of class <paramref name="kind"/>), which may be deep inside it, and <paramref name="below"/> pixels under that child.
    /// </summary>
    private static ScrollViewer Scrolled(Control content, double height, string kind, double below = 0)
    {
        var scroll = new ScrollViewer { Content = content, MaxHeight = height, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled };
        scroll.Loaded += (_, _) =>
        {
            if (content.GetVisualDescendants().OfType<Control>().FirstOrDefault(c => c.Classes.Contains(kind) && c.Classes.Contains("on")) is { } on && on.TranslatePoint(default, content) is { } at)
                scroll.Offset = new Vector(0, Math.Max(0, at.Y + on.Bounds.Height + below - scroll.Viewport.Height));
        };
        return scroll;
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
            var text = new SelectableTextBlock { Text = row.Text, FontSize = 12.5, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(19, 0, 0, 0), Classes = { "muted" } };
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
        block.Children.Add(new SelectableTextBlock { Text = step.Ends, FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap });
        block.Children.Add(new SelectableTextBlock { Text = step.Text, TextWrapping = TextWrapping.Wrap });
        if (step.Outcome is { } outcome)
        {
            // How the request ended: a fact the picture can't give, so it is text, with a mark beside it.
            var dot = new Border { Width = 8, Height = 8, CornerRadius = new CornerRadius(4), VerticalAlignment = VerticalAlignment.Center };
            dot.Classes.Add(step.IsChannel ? "channeldot" : "outcomedot");
            var words = new SelectableTextBlock { Text = outcome, TextWrapping = TextWrapping.Wrap };
            words.Classes.Add(step.IsChannel ? "channelline" : "outcome");
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
        var top = new StackPanel { Spacing = 8, Margin = new Thickness(0, 0, 0, 8) };
        var column = new StackPanel { Spacing = 8 };
        if (v.Trail is { } trail)
        {
            var back = Tool(Icons.ArrowLeft, $"Back to “{trail.Name}”, step {trail.Step}", () => BackToFlow?.Invoke());
            back.Classes.Add("trail");
            back.HorizontalAlignment = HorizontalAlignment.Stretch;
            back.HorizontalContentAlignment = HorizontalAlignment.Left;
            top.Children.Add(back);
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
        top.Children.Add(head);
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
            column.Children.Add(Scrolled(tabs, 84, "tab")); // three rows and half of a fourth (24 each), then they scroll
        }
        if (v.Caption.Text != "") column.Children.Add(new SelectableTextBlock { Text = v.Caption.Text, FontSize = 12.5, TextWrapping = TextWrapping.Wrap, Classes = { "muted" } });
        column.Children.Add(Bar(v.Progress, v.Stop, v.Changes));
        // The key: one mark for each state that is on the canvas now, drawn as it looks there.
        if (v.States is { Count: > 0 } && StateKey.Of(v.States) is { } key) column.Children.Add(key);
        if (v.ChannelKinds is { Count: > 0 } kinds) column.Children.Add(ChannelKey.Of(kinds));
        foreach (var step in v.Steps) column.Children.Add(Block(step, v.Steps.Count > 1));
        var buttons = new DockPanel { Margin = new Thickness(0, 14, 0, 0), LastChildFill = false }; // the 8 between the card's lines and 6 more
        var stop = Tool(Icons.Close, "Stop", () => Stop?.Invoke(), !_inPane);
        if (_inPane) GreyedWith(stop, "Close the comparison to stop");
        stop.Margin = new Thickness(16, 0, 0, 0);
        DockPanel.SetDock(stop, Dock.Right);
        buttons.Children.Add(stop);
        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { Tool(Icons.StepBack, "Back", () => Back?.Invoke(), v.Stop > 0), Tool(Icons.StepForward, "Next", () => Next?.Invoke(), v.Stop < v.Count - 1, primary: true) } };
        left.Children.Add(v.Auto ? Tool(Icons.Pause, "Pause", () => Auto?.Invoke()) : Tool(Icons.Play, "Autoplay", () => Auto?.Invoke()));
        if (v.Moving) left.Children.Add(Tool(Icons.Reload, null, () => Replay?.Invoke(), name: "Replay this step"));
        buttons.Children.Add(left);
        // The flyout from the Compare button sits above the card's content. The last rebuild still holds it, so it is let go of before it is given a new place.
        Detach(_picker);
        // The card never grows past the canvas (or its pane, which sets MaxHeight): its name and its buttons stay, and what is between them scrolls.
        DockPanel.SetDock(top, Dock.Top);
        DockPanel.SetDock(buttons, Dock.Bottom);
        var middle = new ScrollViewer { Content = column, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled };
        Control body = new DockPanel { Children = { top, buttons, middle } };
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
