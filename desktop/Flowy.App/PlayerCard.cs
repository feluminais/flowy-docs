using System.Globalization;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>The flow a step says its story continues in: its id and name, and whether it can play (it has steps, and its view opens).</summary>
internal sealed record LinkedFlow(string Id, string Name, bool Playable);

/// <summary>One step of the stop on show, as the card tells it. <c>Lane</c> is "" unless the stop is in a parallel group; <c>Outcome</c> is how its request ended, in the words of <see cref="Animations.OutcomeLine"/>.</summary>
internal sealed record PlayerStep(string Ends, string Text, string? Description, string Lane, LinkedFlow? Link, string? Outcome = null, bool IsChannel = false)
{
    /// <summary>What the step sends and what comes back (see <see cref="Payloads"/>), each a row that folds out; null when it names none, or one that is not there.</summary>
    public Payloads.Shown? Sends { get; init; }

    public Payloads.Shown? Reply { get; init; }
}

/// <summary>
/// Everything the card shows: where the flow is (a stop of <c>Count</c>), the group the stop is in, the progress bar, the steps, the trail back, and the states on the canvas now (for the key), and <c>ChannelKinds</c> the kinds of channel open now (for the key below it).
/// <c>Changes</c> is the kind of change each cell of the progress bar carries (one for each of its cells, null for none), while a comparison has Show changes on.
/// </summary>
internal sealed record PlayerView(
    string FlowName, int Stop, int Count, string? Kind, Caption Caption, Progress Progress, bool ShowsPause, bool Moving, (string Name, int Step)? Trail, IReadOnlyList<PlayerStep> Steps,
    IReadOnlyList<StateMark>? States = null, IReadOnlyList<Change?>? Changes = null, IReadOnlyList<string>? ChannelKinds = null, bool Auto = false);

/// <summary>The card at the bottom while a flow plays: which stop, the group it is in, who talks to whom, what happens, and Back, Next and Stop.</summary>
internal sealed class PlayerCard : Border
{
    public event Action? Back;
    public event Action? Next;
    public event Action? Stop;
    public event Action? Play;
    public event Action? Autoplay;
    /// <summary>Back on a step that moves: the step plays again from its start.</summary>
    public event Action? Replay;
    /// <summary>The bar is taken hold of, dragged to a stop and a fraction of the way through it, and let go of (see <see cref="Playback.ScrubStart"/>).</summary>
    public event Action? ScrubStart;
    public event Action<int, double>? ScrubTo;
    public event Action? ScrubEnd;
    /// <summary>A speed was chosen (one of <see cref="PlayerClock.Speeds"/>).</summary>
    public event Action<double>? Speed;

    /// <summary>The player's time: the cell of the stop on show fills as far as its motion has got, and the speed buttons show its speed.</summary>
    public PlayerClock? Clock { get; set; }

    /// <summary>A cell of the bar as the pointer finds it: its place on the card and the stop it stands for.</summary>
    internal readonly record struct CellBox(double X, double Y, double Width, double Height, int Stop);

    /// <summary>
    /// The cell under the pointer at (<paramref name="x"/>, <paramref name="y"/>), or the nearest one (a cell is four pixels high, so a drag strays off it), and how far
    /// along it the pointer is. Cells of another lane of a branch count too: a drag can go into any of them. The browser's bar (ui/src/Player.tsx) finds it the same way.
    /// </summary>
    internal static (int Stop, double Fraction)? CellAt(IReadOnlyList<CellBox> cells, double x, double y)
    {
        (int Stop, double Fraction, double Score)? best = null;
        foreach (var c in cells)
        {
            var dx = Math.Max(Math.Max(c.X - x, 0), x - (c.X + c.Width));
            var dy = Math.Max(Math.Max(c.Y - y, 0), y - (c.Y + c.Height));
            var score = dx * 4 + dy;
            if (best is null || score < best.Value.Score) best = (c.Stop, c.Width > 0 ? Math.Clamp((x - c.X) / c.Width, 0, 1) : 0, score);
        }
        return best is { } b ? (b.Stop, b.Fraction) : null;
    }

    private readonly List<(Control Hit, int Stop)> _cells = []; // the bar's cells as last built, for the pointer
    private Border? _fill; // the part of the stop on show's cell its motion has got through
    private IDisposable? _filling;
    private bool _dragging;
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
        HorizontalAlignment = HorizontalAlignment.Stretch; // 520 wide when there is room, centred: its words never make it wider or narrower
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

    /// <summary>How soon a second click of Back goes to the step before, in ms. The browser's Back (ui/src/Player.tsx) waits the same.</summary>
    internal const long BackAgain = 2000;

    private long _lastBack = long.MinValue / 2;

    /// <summary>Back plays the step again, and a second click soon after goes to the step before; on a step that doesn't move it goes there at once.</summary>
    private void BackClicked(PlayerView v)
    {
        var now = Environment.TickCount64;
        var again = now - _lastBack < BackAgain;
        _lastBack = now;
        if (v.Moving && (!again || v.Stop == 0)) Replay?.Invoke();
        else Back?.Invoke();
    }

    /// <summary>What Back does on this stop: a step that moves plays again first.</summary>
    internal static string? BackTip(int stop, bool moving) =>
        !moving ? (stop == 0 ? "Nothing moves on this step" : null) : stop == 0 ? "Replay the step" : "Replay the step, twice for the one before";

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
    private Control Bar(Progress progress, int now, IReadOnlyList<Change?>? changes)
    {
        _cells.Clear();
        _fill = null;
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
            if (cell.Stop < now) segment.Classes.Add("done");
            if (cell.Stop == now)
            {
                // The stop on show fills from the left as far as its motion has got (see FollowFill).
                _fill = new Border { RenderTransformOrigin = new RelativePoint(0, 0.5, RelativeUnit.Relative), RenderTransform = new ScaleTransform(1, 1) };
                _fill.Classes.Add("fill");
                segment.Child = _fill;
            }
            if (here is not null && cell.Group >= 0 && cell.Group == here.Group && progress.Brackets[cell.Group].Kind == "branch" && cell.Row != here.Row) segment.Classes.Add("off");
            var change = ChangeAt(cell);
            if (change is { } kind) segment.Classes.Add("chg-" + BoxControl.Word(kind));
            // A strip four pixels high is hard to point at, so each sits in a taller one that takes the pointer.
            var hit = new Border { Background = Brushes.Transparent, Padding = new Thickness(0, 2), Child = segment };
            _cells.Add((hit, cell.Stop));
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
                var label = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 3, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(3, 0, 3, 2) };
                label.Children.Add(Icons.Make(Icons.ForKind(b.Kind), "chipicon", 11));
                label.Children.Add(new TextBlock { Text = b.Text, FontSize = 10.5, TextTrimming = TextTrimming.CharacterEllipsis, Classes = { "muted" } });
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
        // What the step sends and what comes back, folded away.
        if (step.Sends is { } sends) block.Children.Add(PayloadView.Row(sends, false, false, key => AppTheme.Brush(this, key)));
        if (step.Reply is { } reply) block.Children.Add(PayloadView.Row(reply, true, false, key => AppTheme.Brush(this, key)));
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

    /// <summary>The button on the card that has the keyboard, by its name (Play and Pause are one button that changes), or null when it is elsewhere.</summary>
    private string? KeyboardOnButton()
    {
        if (!IsVisible || TopLevel.GetTopLevel(this)?.FocusManager?.GetFocusedElement() is not Button button || !this.IsVisualAncestorOf(button)) return null;
        var name = AutomationProperties.GetName(button);
        return name is "Pause" ? "Play" : name;
    }

    /// <summary>The card was built again, so the button that had the keyboard is gone: the same one on the new card gets it, or the first that can be used. Silent, as code focus is.</summary>
    private void RestoreKeyboard(string name)
    {
        var buttons = this.GetVisualDescendants().OfType<Button>().Where(b => b.IsEffectivelyEnabled && b.IsEffectivelyVisible).ToList();
        var same = buttons.FirstOrDefault(b => AutomationProperties.GetName(b) is var n && (n == name || (name == "Play" && n == "Pause")));
        (same ?? buttons.FirstOrDefault())?.Focus();
    }

    /// <summary>
    /// The card of every stop of the flow on show, for <see cref="Show"/> to keep the size of the tallest. <c>Key</c> is the same object for as long as those cards
    /// look the same (the flow, its stops and the model), so they are measured again only when it changes, or the card's width or the legend does.
    /// </summary>
    internal sealed record Every(object Key, Func<IReadOnlyList<PlayerView>> Views);

    /// <summary>The stops a card measures to keep the size of its tallest; a longer flow keeps the card as each stop draws it. The browser's card has the same.</summary>
    private const int ReserveMost = 300;

    /// <summary>
    /// The most room a card keeps for the part between its chips and its buttons: an ordinary stop is 100 to 180 tall, and the rest of a flow should not pay for one
    /// parallel stop with many lanes or a long description. A taller stop makes the card taller for that stop only. The browser's card has the same (RESERVE_BODY_MOST).
    /// </summary>
    private const double ReserveColumnMost = 180;

    private (object? Key, double Width, bool Legend) _reserveFor;
    private (double Top, double Column)? _reserve;
    private Every? _every; // the flow's cards, kept for the card's own rebuilds (the legend, the Compare flyout, a new width)

    /// <summary>
    /// The card at <paramref name="v"/>. With <paramref name="every"/> it is as tall as at its tallest stop, so its edge and its buttons stay put as the flow plays: the
    /// part above the buttons of every stop is built once out of sight and measured, and the tallest is kept. Left out, the cards of the last call are used.
    /// </summary>
    public void Show(PlayerView v, Every? every = null)
    {
        var keyboard = KeyboardOnButton();
        _shown = v;
        if (every is not null) _every = every;
        Reserve(_every);
        var (top, column) = Parts(v);
        if (_reserve is { } room)
        {
            top.MinHeight = room.Top;
            column.MinHeight = room.Column - top.Margin.Bottom;
        }
        Buttons(v, top, column, keyboard);
    }

    /// <summary>A card that gets wider or narrower (the window did) measures its stops again at the new width.</summary>
    protected override void OnSizeChanged(SizeChangedEventArgs e)
    {
        base.OnSizeChanged(e);
        if (e.WidthChanged && _every is not null && _reserveFor.Key is not null && Math.Round(ContentWidth()) != _reserveFor.Width && _shown is { } v)
            Dispatcher.UIThread.Post(() =>
            {
                if (_shown == v && IsVisible) Show(v);
            });
    }

    /// <summary>The width the card's content gets: the card's own, once it has one, less its padding and border.</summary>
    private double ContentWidth() =>
        (Bounds.Width > 0 ? Bounds.Width : MaxWidth) - Padding.Left - Padding.Right - BorderThickness.Left - BorderThickness.Right;

    private void Reserve(Every? every)
    {
        if (every is null)
        {
            _reserve = null;
            _reserveFor = default;
            return;
        }
        var width = Math.Round(ContentWidth());
        var key = (every.Key, width, s_legend);
        if (_reserve is not null && _reserveFor.Equals(key)) return;
        _reserveFor = key;
        var views = every.Views();
        if (views.Count > ReserveMost)
        {
            _reserve = null;
            return;
        }
        // Each stop's parts are put on the card for a moment, so they take its styles, and measured at its width; the card on show is built after them.
        double tallestTop = 0, tallestColumn = 0;
        foreach (var view in views)
        {
            var (top, column) = Parts(view);
            var probe = new StackPanel { Children = { top, column } };
            Child = probe;
            probe.Measure(new Size(width, double.PositiveInfinity));
            tallestTop = Math.Max(tallestTop, top.DesiredSize.Height - top.Margin.Top - top.Margin.Bottom);
            tallestColumn = Math.Max(tallestColumn, Math.Min(column.DesiredSize.Height, ReserveColumnMost) + top.Margin.Bottom); // the gap over the column is the chips' margin, or the bar's own room
        }
        Child = null;
        _reserve = (tallestTop, tallestColumn);
    }

    private double? _playWidth;

    /// <summary>The width of the Play button saying Pause or Play, whichever is wider: both are put on the card for a moment and measured, once.</summary>
    private double PlayWidth()
    {
        if (_playWidth is { } known) return known;
        var pause = Tool(Icons.Pause, "Pause", () => { });
        var play = Tool(Icons.Play, "Play", () => { });
        var probe = new StackPanel { Orientation = Orientation.Horizontal, Children = { pause, play } };
        Child = probe;
        probe.Measure(Size.Infinity);
        Child = null;
        var widest = Math.Ceiling(Math.Max(pause.DesiredSize.Width, play.DesiredSize.Width));
        if (widest > 0) _playWidth = widest; // measured before the card has its styles, it is left to be measured again
        return widest;
    }

    /// <summary>What the card shows of one stop above its buttons: the trail back and the chips (<c>Top</c>), then the legend, the group's words, the bar, the keys and each step.</summary>
    private (StackPanel Top, StackPanel Column) Parts(PlayerView v)
    {
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
        // The cells are four pixels high: the strip that takes a click or a drag reaches 8 more each way, into the room between the card's lines. When the bar comes
        // first, the room above it is the chips' margin, outside the part that scrolls, so the strip takes that room inside instead.
        var first = column.Children.Count == 0;
        if (first) top.Margin = new Thickness(0);
        var bar = new Border { Background = Brushes.Transparent, Child = Bar(v.Progress, v.Stop, v.Changes), Cursor = new Cursor(StandardCursorType.Hand), Padding = new Thickness(0, 8), Margin = new Thickness(0, first ? 0 : -8, 0, -8) };
        AutomationProperties.SetName(bar, "Step");
        AutomationProperties.SetHelpText(bar, $"Step {v.Stop + 1} of {v.Count}");
        bar.PointerPressed += (_, e) =>
        {
            if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;
            e.Pointer.Capture(this); // the card is rebuilt as the drag goes through the stops: the card, not the bar, keeps the pointer
            _dragging = true;
            // The cell under the pointer is read before the player holds: holding can rebuild the card (Pause becomes Play), and the new cells have no place yet.
            var at = e.GetPosition(this);
            var hit = CellAt(CellBoxes(), at.X, at.Y);
            ScrubStart?.Invoke();
            if (hit is { } cell) ScrubTo?.Invoke(cell.Stop, cell.Fraction);
            e.Handled = true;
        };
        column.Children.Add(bar);
        // The key: one mark for each state that is on the canvas now, drawn as it looks there.
        if (v.States is { Count: > 0 } && StateKey.Of(v.States) is { } key) column.Children.Add(key);
        if (v.ChannelKinds is { Count: > 0 } kinds) column.Children.Add(ChannelKey.Of(kinds));
        foreach (var step in v.Steps) column.Children.Add(Block(step, v.Steps.Count > 1));
        return (top, column);
    }

    /// <summary>The buttons under the parts, and the card put together.</summary>
    private void Buttons(PlayerView v, StackPanel top, StackPanel column, string? keyboard)
    {
        var buttons = new DockPanel { Margin = new Thickness(0, 14, 0, 0), LastChildFill = false }; // the 8 between the card's lines and 6 more
        var stop = Tool(Icons.Close, "Stop", () => Stop?.Invoke(), !_inPane);
        if (_inPane) GreyedWith(stop, "Close the comparison to stop");
        stop.Margin = new Thickness(16, 0, 0, 0);
        DockPanel.SetDock(stop, Dock.Right);
        buttons.Children.Add(stop);
        var back = Tool(Icons.StepBack, "Back", () => BackClicked(v), v.Stop > 0 || v.Moving);
        if (BackTip(v.Stop, v.Moving) is { } tip)
        {
            if (back.IsEnabled) ToolTip.SetTip(back, tip);
            else GreyedWith(back, tip);
        }
        var play = v.ShowsPause ? Tool(Icons.Pause, "Pause", () => Play?.Invoke()) : Tool(Icons.Play, "Play", () => Play?.Invoke());
        play.MinWidth = PlayWidth(); // as wide as its longer word, so the buttons after it stay put when it changes
        ToolTip.SetTip(play, v.ShowsPause ? "Pause (Space)" : "Play (Space)");
        var auto = Tool(Icons.ListVideo, null, () => Autoplay?.Invoke(), name: "Autoplay");
        auto.Classes.Add("auto");
        ToolTip.SetTip(auto, "Autoplay (A)");
        if (v.Auto)
        {
            auto.Classes.Add("on");
            AutomationProperties.SetItemStatus(auto, "On"); // the tint is not the only copy of it
        }
        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { back, play, Tool(Icons.StepForward, "Next", () => Next?.Invoke(), v.Stop < v.Count - 1, primary: true), auto } };
        var speeds = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, Margin = new Thickness(8, 0, 0, 0) };
        speeds.Classes.Add("speed");
        ToolTip.SetTip(speeds, "Speed (S)");
        AutomationProperties.SetName(speeds, "Speed");
        foreach (var speed in PlayerClock.Speeds)
        {
            var words = speed.ToString("0.#", CultureInfo.InvariantCulture) + "×";
            var button = new Button { Content = new TextBlock { Text = words, VerticalAlignment = VerticalAlignment.Center, Classes = { "btntext" } } };
            button.Classes.Add("tool");
            button.Classes.Add("speed");
            AutomationProperties.SetName(button, words);
            button.Click += (_, _) => Speed?.Invoke(speed);
            if (Clock?.Rate == speed)
            {
                button.Classes.Add("on");
                AutomationProperties.SetItemStatus(button, "Chosen"); // the tint is not the only copy of which speed it is
            }
            speeds.Children.Add(button);
        }
        DockPanel.SetDock(speeds, Dock.Right);
        buttons.Children.Add(speeds);
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
        FollowFill();
        if (keyboard is not null) Dispatcher.UIThread.Post(() => RestoreKeyboard(keyboard));
    }

    /// <summary>Keeps the cell of the stop on show filled as far as the clock has got through its motion, on the clock's frames.</summary>
    private void FollowFill()
    {
        _filling?.Dispose();
        _filling = null;
        if (Clock is not { } clock || _fill is not { } fill) return;
        _filling = Anim.Follow(this, clock, () =>
        {
            var length = clock.Length;
            fill.RenderTransform = new ScaleTransform(length > 0 ? Math.Min(1, clock.Elapsed / length) : 1, 1);
            return length > 0 && clock.Elapsed < length;
        });
    }

    /// <summary>The cells of the bar where they are on the card now; ones not laid out yet (the card was just rebuilt) are left out.</summary>
    private List<CellBox> CellBoxes()
    {
        var boxes = new List<CellBox>();
        foreach (var (hit, stop) in _cells)
            if (hit.Bounds.Width > 0 && hit.TranslatePoint(default, this) is { } at) boxes.Add(new CellBox(at.X, at.Y, hit.Bounds.Width, hit.Bounds.Height, stop));
        return boxes;
    }

    private void DragTo(Point p)
    {
        if (CellAt(CellBoxes(), p.X, p.Y) is { } hit) ScrubTo?.Invoke(hit.Stop, hit.Fraction);
    }

    private void EndDrag()
    {
        if (!_dragging) return;
        _dragging = false;
        ScrubEnd?.Invoke();
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);
        if (_dragging) DragTo(e.GetPosition(this));
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        EndDrag();
    }

    protected override void OnPointerCaptureLost(PointerCaptureLostEventArgs e)
    {
        base.OnPointerCaptureLost(e);
        EndDrag();
    }

    /// <summary>Lets go of a control the last build of the card put in a panel of its own, so the next build can give it a place.</summary>
    private static void Detach(Control? control)
    {
        if (control is not null && control.Parent is Panel panel) panel.Children.Remove(control);
    }

    public void Clear()
    {
        _every = null;
        _filling?.Dispose();
        _filling = null;
        Detach(_picker);
        IsVisible = false;
        Child = null;
        CompareButton = null;
    }
}
