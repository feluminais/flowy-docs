using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The Details panel at the right of the canvas: a box's description, code and connections, or the connections one line stands for. It shows one
/// thing at a time. Pointing at a connection lights its line on the canvas; the other box's name opens its panel. In edit mode the same
/// panel holds the forms (see <c>EditPanels.cs</c>), which stay put while the model reloads around them, so a field being typed in keeps its focus.
/// </summary>
internal sealed class SidePanel : Border
{
    private readonly StackPanel _holder = new() { Margin = new Thickness(22, 22, 22, 28) };
    private readonly ScrollViewer _scroll = new() { VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
    private string? _shown; // what the holder has in it, by name, so a redraw of the same thing keeps its scroll
    private readonly Dictionary<(string Id, string Entry), bool> _openEntries = []; // which entries of a store's Data the reader opened or closed, kept when the panel is drawn again
    private ObjectEditor? _objectEditor;
    private LineEditor? _lineEditor;
    private AddForm? _addForm;
    private Recorder? _recorder;
    private UsedByPanel? _usedBy;

    // What a test can look at.

    internal ObjectEditor? CurrentObjectEditor => _objectEditor;

    internal LineEditor? CurrentLineEditor => _lineEditor;

    internal AddForm? CurrentAddForm => _addForm;

    internal Recorder? CurrentRecorder => _recorder;

    internal UsedByPanel? CurrentUsedBy => _usedBy;

    public event Action? Closed;

    public SidePanel()
    {
        Classes.Add("panel");
        Width = Camera.Panel;
        HorizontalAlignment = HorizontalAlignment.Right;
        IsVisible = false;
        Focusable = false;
        _scroll.Content = _holder;
        var close = new Button { Content = Icons.Make(Icons.Close, "closeicon", 16), HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 14, 14, 0) };
        close.Classes.Add("close");
        close.Click += (_, _) => Closed?.Invoke();
        Avalonia.Automation.AutomationProperties.SetName(close, "Close");
        Child = new Grid { Children = { _scroll, close } };
    }

    internal IBrush Resource(string key) => AppTheme.Brush(this, key);

    public void Clear()
    {
        IsVisible = false;
        _holder.Children.Clear();
        _shown = null;
        _objectEditor = null;
        _lineEditor = null;
        _addForm = null;
        _recorder = null;
        _usedBy = null;
    }

    /// <summary>Puts <paramref name="content"/> in the panel. Showing the same thing again (by <paramref name="key"/>) keeps where the reader had scrolled to.</summary>
    private void Show(Control content, string key)
    {
        var same = key == _shown;
        _holder.Children.Clear();
        _holder.Children.Add(content);
        _objectEditor = null;
        _lineEditor = null;
        _addForm = null;
        _recorder = null;
        _usedBy = null;
        _shown = key;
        IsVisible = true;
        if (!same) _scroll.Offset = default;
    }

    /// <summary>What Details shows at the top level when nothing is picked: how much there is, and where to go next.</summary>
    public void ShowOverview(OutlineTotals totals)
    {
        static string Count(int n, string word) => $"{n} {word}{(n == 1 ? "" : "s")}";
        var summary = $"{Count(totals.Shapes, "shape")} · {Count(totals.Flows, "flow")}{(totals.Problems > 0 ? $" · {Count(totals.Problems, "problem")}" : "")}";
        var advice = new TextBlock { Text = "Pick a shape to read about it. Press O for the Explorer.", TextWrapping = TextWrapping.Wrap };
        Show(new StackPanel { Spacing = 14, Children = { Heading("Overview"), Muted(summary), advice } }, "overview");
    }

    internal Control Heading(string text) => new TextBlock { Text = text, FontSize = 18, FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 32, 0) };

    /// <summary>A heading with a round icon before it, for a panel that is about no box in particular (add, a new flow).</summary>
    internal Control IconHeading(string icon, string text)
    {
        var badge = new Border { Child = Icons.Make(icon, "dirnicon", 14), VerticalAlignment = VerticalAlignment.Center };
        badge.Classes.Add("badge");
        badge.Child!.HorizontalAlignment = HorizontalAlignment.Center;
        badge.Child.VerticalAlignment = VerticalAlignment.Center;
        var title = Heading(text);
        title.VerticalAlignment = VerticalAlignment.Center;
        var row = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 10, Children = { badge, title } };
        Grid.SetColumn(title, 1);
        return row;
    }

    internal Control Muted(string text, double size = 14) => new TextBlock { Text = text, FontSize = size, Foreground = Resource("MutedBrush"), TextWrapping = TextWrapping.Wrap };

    private static string KindOf(string? type) => Names.ObjectTypes.Contains(type ?? "") ? type! : "system";

    /// <summary>The colour of an object type (or of an outside service), for the rule under a title.</summary>
    private IBrush KindBrush(string kind) => Resource($"{char.ToUpperInvariant(kind[0])}{kind[1..]}Brush");

    /// <summary>What is wrong with a box or a line, in the warning colours with an alert icon; nothing at all when all is well.</summary>
    internal Control Problems(IEnumerable<string> messages)
    {
        var list = messages.ToList();
        if (list.Count == 0) return new Panel();
        var items = new StackPanel { Spacing = 3 };
        foreach (var m in list) items.Children.Add(new TextBlock { Text = m, Foreground = Resource("WarnFgBrush"), TextWrapping = TextWrapping.Wrap });
        var icon = Icons.Make(Icons.Alert, "warnicon", 16);
        icon.VerticalAlignment = VerticalAlignment.Top;
        icon.Margin = new Thickness(0, 1, 0, 0);
        var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 10, Children = { icon, items } };
        Grid.SetColumn(items, 1);
        var callout = new Border { Child = grid };
        callout.Classes.Add("callout");
        return callout;
    }

    internal Button Link(string text, Action click, bool mono = false)
    {
        var button = new Button { Content = new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap, FontFamily = mono ? Fonts.Mono : FontFamily.Default, FontSize = mono ? 13 : 14 } };
        button.Classes.Add("link");
        button.Click += (_, _) => click();
        return button;
    }

    internal static string Describe(Model model, Connection c) => $"{Views.NameOf(model, c.From ?? "")} → {Views.NameOf(model, c.To ?? "")}";

    /// <summary>The title of a box's panel: its tile and name, its type, tech, whether it is outside and what is wrong with it as small words under the name, and a rule in the type's colour.</summary>
    internal Control Header(Model model, string id, FlowyObject o, int problems)
    {
        var external = Model.IsExternal(o);
        var chips = new List<Control> { Chrome.Chip(string.IsNullOrEmpty(o.Type) ? "shape" : o.Type, Icons.ForType(o.Type), KindOf(o.Type)) };
        if (!string.IsNullOrEmpty(o.Tech)) chips.Add(Chrome.Chip(o.Tech, Icons.Code));
        if (external) chips.Add(Chrome.Chip("external", Icons.Cloud, "external"));
        if (problems > 0) chips.Add(Chrome.Chip(problems == 1 ? "1 problem" : $"{problems} problems", Icons.Alert, "warn"));
        var name = new TextBlock { Text = string.IsNullOrEmpty(o.Name) ? id : o.Name, FontSize = 22, FontWeight = FontWeight.SemiBold, LetterSpacing = -0.2, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 26, 0) };
        var text = new StackPanel { Spacing = 6, VerticalAlignment = VerticalAlignment.Center, Children = { name, Chrome.Chips(chips.ToArray()) } };
        var tile = Chrome.ObjectTile(model, o, 48);
        tile.VerticalAlignment = VerticalAlignment.Center;
        var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 14, Children = { tile, text } };
        Grid.SetColumn(text, 1);
        // The rule under the header is in the shape's own colour when it names one, else its type's.
        var rule = Look.IsColor(o.Color) && Look.ColorPair(o.Color) is { } pair ? ThemeBrushes.For(pair.Light, pair.Dark) : KindBrush(external ? "external" : KindOf(o.Type));
        return new StackPanel { Spacing = 18, Children = { grid, Chrome.Rule(rule) } };
    }

    /// <summary>The state of the shape at the stop on show: the word State, its glyph and its name. The glyph's colour is the state's own.</summary>
    private Control StateLine(StateMark state)
    {
        var label = new TextBlock { Text = "State", VerticalAlignment = VerticalAlignment.Center };
        label.Classes.Add("muted");
        var name = new TextBlock { Text = StateKey.Word(state), VerticalAlignment = VerticalAlignment.Center };
        return new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { label, new StateGlyph(state), name } };
    }

    /// <summary>A box: its header, any problems, its description, the files it lives in, and every line out and in.</summary>
    public void ShowObject(Model model, string id, IReadOnlyList<Problem> problems, string? codeBase, LinkContext links, Action<string> pick, Action<string?> hover, StateMark? state = null)
    {
        if (model.GetObject(id) is not { } o)
        {
            Clear();
            return;
        }
        var mine = Navigation.ProblemsOf(model, problems, id);
        var column = new StackPanel { Spacing = 14 };
        column.Children.Add(Header(model, id, o, mine.Count));
        if (state is not null) column.Children.Add(StateLine(state));
        if (mine.Count > 0) column.Children.Add(Problems(mine.Select(p => p.Message)));
        column.Children.Add(Chrome.Section(Icons.Text, "Description"));
        column.Children.Add(string.IsNullOrEmpty(o.Description) ? Muted("No description yet.") : new MarkdownView(o.Description, 14.5));
        if (DataView.Build(id, o, Resource, _openEntries) is { } data) column.Children.Add(data);
        if (CodeView.Build(o, Resource) is { } snippets) column.Children.Add(snippets);

        var boxLinks = Links.Of(o);
        if (boxLinks.Count > 0)
        {
            column.Children.Add(Chrome.Section(Icons.Link, "Links", boxLinks.Count));
            column.Children.Add(LinkList(boxLinks, links));
        }

        var paths = o.Code is List<object?> code ? code.OfType<string>().ToList() : [];
        if (paths.Count > 0)
        {
            column.Children.Add(Chrome.Section(Icons.Folder, "Source", paths.Count));
            column.Children.Add(CodeList(paths, codeBase));
        }
        column.Children.Add(LinesOf(model, id, pick, hover));
        Show(column, $"object:{id}");
    }

    /// <summary>
    /// A row each. A web address opens in the browser; a path in the repo opens on this computer as <see cref="LinkOpening"/> decides, judged again
    /// at the click; one that points at nothing it may open is plain text (a missing path is already a problem in the list). A file also has a small
    /// button that shows it in its folder and runs nothing.
    /// </summary>
    private Control LinkList(IReadOnlyList<BoxLink> links, LinkContext context)
    {
        var list = new StackPanel { Spacing = 0 };
        foreach (var link in links)
        {
            var web = Checks.IsWebAddress(link.Url);
            var now = LinkOpening.Decide(link.Url, context.RepoRoot, context.CustomApp());
            var text = string.IsNullOrEmpty(link.Title) ? link.Url : link.Title;
            Control label = now.Kind == LinkKind.Refused
                ? new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap, Foreground = Resource("MutedBrush") }
                : Link(text, () => _ = context.Run(LinkOpening.Decide(link.Url, context.RepoRoot, context.CustomApp())));
            var body = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center, Children = { label } };
            if (!web && !string.IsNullOrEmpty(link.Title))
                body.Children.Add(new TextBlock { Text = link.Url, FontFamily = Fonts.Mono, FontSize = 12, Foreground = Resource("MutedBrush"), TextWrapping = TextWrapping.Wrap });
            var icon = Icons.Make(web ? Icons.Link : link.Url.EndsWith('/') ? Icons.Folder : Icons.File, "rowicon", 16);
            icon.VerticalAlignment = VerticalAlignment.Center;
            var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 10, Children = { icon, body } };
            Grid.SetColumn(body, 1);
            if (now.Kind is LinkKind.DefaultApp or LinkKind.CustomApp)
            {
                var show = new Button { Content = Icons.Make(Icons.Folder, "rowicon", 14), VerticalAlignment = VerticalAlignment.Center };
                show.Classes.Add("tool");
                Avalonia.Automation.AutomationProperties.SetName(show, "Show in folder");
                ToolTip.SetTip(show, "Show in folder");
                show.Click += (_, _) =>
                {
                    if (LinkOpening.Locate(context.RepoRoot, link.Url) is { } real) _ = context.Run(new LinkAction(LinkKind.ShowInFolder, real));
                };
                Grid.SetColumn(show, 2);
                grid.Children.Add(show);
            }
            var row = new Border { Child = grid };
            row.Classes.Add("row");
            list.Children.Add(row);
        }
        return list;
    }

    /// <summary>The files and folders a box lives in: a chip each with a file or folder icon, a link when the repo's origin is on a host that has them.</summary>
    private Control CodeList(List<string> paths, string? codeBase)
    {
        var list = new StackPanel { Spacing = 0 };
        foreach (var path in paths)
        {
            // A path the checks flag (../..) is shown, not linked: the address would be built from it.
            var address = codeBase is null || !Checks.IsRepoPath(path) ? null : codeBase + CodeLinks.EncodePath(path);
            Control label = address is not null && WebAddress.IsSafe(address)
                ? Link(path, () => Open(address), mono: true)
                : new TextBlock { Text = path, FontFamily = Fonts.Mono, FontSize = 13, TextWrapping = TextWrapping.Wrap };
            var icon = Icons.Make(path.EndsWith('/') ? Icons.Folder : Icons.File, "rowicon", 16);
            icon.VerticalAlignment = VerticalAlignment.Center;
            var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 10, Children = { icon, label } };
            Grid.SetColumn(label, 1);
            label.VerticalAlignment = VerticalAlignment.Center;
            var row = new Border { Child = grid };
            row.Classes.Add("row");
            list.Children.Add(row);
        }
        return list;
    }

    /// <summary>Every line out and in of a box, as cards: the other box's name opens its panel, and pointing at a card lights its line.</summary>
    internal Control LinesOf(Model model, string id, Action<string> pick, Action<string?> hover)
    {
        var column = new StackPanel { Spacing = 14 };
        var (outgoing, incoming) = Navigation.LinesOf(model, id);
        if (outgoing.Count > 0) column.Children.Add(Lines(model, "Out", Icons.ArrowRight, outgoing, pick, hover));
        if (incoming.Count > 0) column.Children.Add(Lines(model, "In", Icons.ArrowLeft, incoming, pick, hover));
        return column;
    }

    private Control Lines(Model model, string title, string arrow, List<BoxLine> lines, Action<string> pick, Action<string?> hover)
    {
        var section = new StackPanel { Spacing = 2 };
        section.Children.Add(Chrome.Section(arrow, title, lines.Count));
        foreach (var line in lines) section.Children.Add(Row(model, line, arrow, pick, hover));
        return section;
    }

    private Control Row(Model model, BoxLine line, string arrow, Action<string> pick, Action<string?> hover)
    {
        var lineId = SceneBuilder.LineId(line.From, line.To);
        var other = model.GetObject(line.Other);
        var head = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Children = { Chrome.ObjectTile(model, other, 22), Link(Views.NameOf(model, line.Other), () => pick(line.Other)) },
        };
        var body = new StackPanel { Spacing = 4, Children = { head } };
        if (line.Connections.Count == 1)
        {
            var c = line.Connections[0];
            body.Children.Add(string.IsNullOrEmpty(c.Label) ? new TextBlock { Text = "no label", FontStyle = FontStyle.Italic, FontSize = 13, Foreground = Resource("MutedBrush") } : new TextBlock { Text = c.Label, TextWrapping = TextWrapping.Wrap });
            if (c.From != line.From || c.To != line.To) body.Children.Add(Muted(Describe(model, c), 12));
        }
        else body.Children.Add(Disclosure($"{line.Connections.Count} connections", model, line.Connections));
        var direction = new Border { Child = Icons.Make(arrow, "dirnicon", 14), VerticalAlignment = VerticalAlignment.Top };
        direction.Classes.Add("dirn");
        direction.Child!.HorizontalAlignment = HorizontalAlignment.Center;
        direction.Child.VerticalAlignment = VerticalAlignment.Center;
        var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 10, Children = { direction, body } };
        Grid.SetColumn(body, 1);
        var row = new Border { Child = grid };
        row.Classes.Add("row");
        row.Classes.Add("lines");
        row.PointerEntered += (_, _) => hover(lineId);
        row.PointerExited += (_, _) => hover(null);
        return row;
    }

    /// <summary>"N connections", opening to list each with its label and the boxes inside it that it joins.</summary>
    private Control Disclosure(string title, Model model, IReadOnlyList<Connection> connections)
    {
        var items = new StackPanel { Spacing = 8, Margin = new Thickness(0, 6, 0, 0), IsVisible = false };
        var header = new Button { Content = $"▸ {title}" };
        header.Classes.Add("disclosure");
        header.Click += (_, _) =>
        {
            // Built on the first open: a box that holds others can stand for hundreds of connections, and every row is controls to style.
            if (items.Children.Count == 0)
                foreach (var c in connections)
                {
                    var item = new StackPanel { Spacing = 0 };
                    item.Children.Add(string.IsNullOrEmpty(c.Label) ? new TextBlock { Text = "no label", FontStyle = FontStyle.Italic, FontSize = 13, Foreground = Resource("MutedBrush") } : new TextBlock { Text = c.Label, TextWrapping = TextWrapping.Wrap });
                    item.Children.Add(Muted(Describe(model, c), 12));
                    items.Children.Add(item);
                }
            items.IsVisible = !items.IsVisible;
            header.Content = $"{(items.IsVisible ? "▾" : "▸")} {title}";
        };
        return new StackPanel { Children = { header, items } };
    }

    /// <summary>The two ends of a line at the top of its panel: a tile and a name each, with an arrow between.</summary>
    internal Control LineHeader(Model model, string from, string to)
    {
        Control End(string id)
        {
            var o = model.GetObject(id);
            var name = new TextBlock { Text = Views.NameOf(model, id), FontWeight = FontWeight.SemiBold, TextAlignment = TextAlignment.Center, TextWrapping = TextWrapping.Wrap };
            var tile = Chrome.ObjectTile(model, o, 40);
            tile.HorizontalAlignment = HorizontalAlignment.Center;
            return new StackPanel { Spacing = 8, Children = { tile, name } };
        }
        var left = End(from);
        var right = End(to);
        var arrow = Icons.Make(Icons.ArrowRight, "rowicon", 22);
        arrow.VerticalAlignment = VerticalAlignment.Top;
        arrow.Margin = new Thickness(8, 9, 8, 0);
        var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], Children = { left, arrow, right } };
        Grid.SetColumn(arrow, 1);
        Grid.SetColumn(right, 2);
        return new StackPanel { Spacing = 18, Children = { grid, Chrome.Rule(Resource("AccentBrush")) } };
    }

    /// <summary>A line in the view: its two ends, and the connections it stands for, each with its label and problems.</summary>
    public void ShowLine(Model model, string view, string from, string to, IReadOnlyList<Problem> problems)
    {
        var lines = Navigation.ConnectionsOf(model, view, from, to);
        if (lines.Count == 0)
        {
            Clear();
            return;
        }
        var column = new StackPanel { Spacing = 14 };
        column.Children.Add(LineHeader(model, from, to));
        column.Children.Add(Chrome.Section(Icons.Route, lines.Count == 1 ? "Connection" : "Connections", lines.Count));
        foreach (var (index, c) in lines)
        {
            var section = new StackPanel { Spacing = 6 };
            section.Children.Add(string.IsNullOrEmpty(c.Label) ? new TextBlock { Text = "No label", FontStyle = FontStyle.Italic, Foreground = Resource("MutedBrush") } : new TextBlock { Text = c.Label, FontSize = 15, TextWrapping = TextWrapping.Wrap });
            if (c.From != from || c.To != to) section.Children.Add(Muted(Describe(model, c), 12));
            var mine = problems.Where(p => p.Connection == index).Select(p => p.Message).ToList();
            if (mine.Count > 0) section.Children.Add(Problems(mine));
            column.Children.Add(Chrome.Card(section));
        }
        Show(column, $"line:{from}>{to}");
    }

    // ---- edit mode ---------------------------------------------------------------------------------------------

    /// <summary>What is waiting on a delete (see <see cref="UsedByPanel"/>). Showing the same one again keeps its choices and gives it the folder as it is now.</summary>
    public void ShowUsedBy(UsedByPanel panel, Model model)
    {
        if (_usedBy is { } open && ReferenceEquals(open, panel) && _shown == "usedby")
        {
            open.Update(model);
            return;
        }
        Show(panel, "usedby");
        _usedBy = panel;
    }

    /// <summary>The form for a box. Showing the same box again updates its fields in place, except one being typed in.</summary>
    public void ShowObjectEditor(Model model, string id, IReadOnlyList<Problem> problems, EditRun run, Action<string> pick, Action<string?> hover, Action<IReadOnlyList<Target>, Action?> askDelete)
    {
        if (model.GetObject(id) is null)
        {
            Clear();
            return;
        }
        if (_objectEditor is { } editor && editor.Id == id && _shown == $"edit-object:{id}")
        {
            editor.Update(model, problems);
            return;
        }
        var fresh = new ObjectEditor(this, id, run, pick, hover, askDelete);
        fresh.Update(model, problems);
        Show(fresh, $"edit-object:{id}");
        _objectEditor = fresh;
    }

    /// <summary>The forms for the connections one line stands for: a label each, and delete.</summary>
    public void ShowLineEditor(Model model, string view, string from, string to, IReadOnlyList<Problem> problems, EditRun run, Action closed, Action<IReadOnlyList<Target>, Action?> askDelete)
    {
        if (Navigation.ConnectionsOf(model, view, from, to).Count == 0)
        {
            Clear();
            return;
        }
        var key = $"edit-line:{from}>{to}";
        if (_lineEditor is { } editor && _shown == key)
        {
            editor.Update(model, view, problems);
            return;
        }
        var fresh = new LineEditor(this, from, to, run, closed, askDelete);
        fresh.Update(model, view, problems);
        Show(fresh, key);
        _lineEditor = fresh;
    }

    /// <summary>A new box in the view, with only the types that fit there.</summary>
    public void ShowAdd(Model model, string view, EditRun run, Action<string> added)
    {
        var form = new AddForm(this, model, view, run, added);
        Show(form, $"add:{view}");
        _addForm = form;
    }

    /// <summary>The panel for a flow being recorded or edited. The same flow shown again updates in place.</summary>
    public void ShowRecorder(Model model, string view, Recording rec, EditRun run, Action<Recording> change, Func<string, string> makeId, Action closed)
    {
        var key = rec.Id == "" ? "flow:new" : $"flow:{rec.Id}";
        if (_recorder is { } existing && _shown == key)
        {
            existing.Update(model, view, rec);
            return;
        }
        var fresh = new Recorder(this, run, change, makeId, closed);
        fresh.Update(model, view, rec);
        Show(fresh, key);
        _recorder = fresh;
    }

    private void Open(string address)
    {
        if (TopLevel.GetTopLevel(this) is { } top) _ = top.Launcher.LaunchUriAsync(new Uri(address));
    }
}

/// <summary>
/// What the Links section needs to decide and carry out a click: the folder that holds <c>flowy/</c>, the app the person chose (read at
/// the click, so a change applies at once), and what to do with the decision.
/// </summary>
internal sealed record LinkContext(string RepoRoot, Func<string?> CustomApp, Func<LinkAction, Task> Run);
