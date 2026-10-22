using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Controls.Shapes;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;
using Avalonia.Threading;
using Flowy.App.Canvas;
using Flowy.Core;
using Path = Avalonia.Controls.Shapes.Path;

namespace Flowy.App;

/// <summary>
/// The pickers of an object's form, which the browser's panel has too (ui/src/Pickers.tsx). Each draws what it offers, the type's tile, the
/// shape's outline, the colour, the icon, so a choice is made by eye. The chosen one is ringed and its name sits beside the label.
/// </summary>
internal static class Pick
{
    public static string Cap(string text) => text == "" ? text : char.ToUpperInvariant(text[0]) + text[1..];

    /// <summary>A label with the name of what is chosen at its right.</summary>
    public static Control Head(string label, out TextBlock value, Control? extra = null)
    {
        var caption = new TextBlock { Text = label, FontSize = 12, VerticalAlignment = VerticalAlignment.Center };
        caption.Classes.Add("muted");
        value = new TextBlock { FontSize = 12, FontWeight = FontWeight.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, TextAlignment = TextAlignment.Right };
        var row = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 10 };
        row.Children.Add(caption);
        row.Children.Add(value);
        Grid.SetColumn(value, 1);
        if (extra is not null)
        {
            row.Children.Add(extra);
            Grid.SetColumn(extra, 2);
        }
        return row;
    }

    /// <summary>The colour an object is drawn in, light and dark: the one it names, else its type's.</summary>
    public static (string Light, string Dark) ColorOf(FlowyObject o) => Look.ColorPair(o.Color) ?? Look.ColorPair(Look.TypeColor(o))!.Value;

    /// <summary>The kinds of a group as cells, each with its icon, so which one a group is can be seen without reading.</summary>
    public static Chooser Kinds(string label, IEnumerable<(string Kind, string Name)> kinds, string? chosen, Func<string, Task<bool>> picked)
    {
        var chooser = new Chooser(label, new UniformGrid { Columns = 3 }, picked, _ => "");
        foreach (var (kind, name) in kinds)
        {
            var icon = Icons.Make(Icons.ForKind(kind), "pickicon", 20);
            icon.HorizontalAlignment = HorizontalAlignment.Center;
            chooser.Add(kind, name, new StackPanel { Spacing = 5, Children = { icon, new TextBlock { Text = name, FontSize = 11, HorizontalAlignment = HorizontalAlignment.Center } } });
        }
        chooser.Show(chosen);
        return chooser;
    }

    /// <summary>
    /// The six states as tiles drawn the way the canvas draws them, with None first for a step that leaves the shape as it is. <paramref name="chosen"/> is
    /// a state word or "" for None; a pick is a word or "". Twin of StatePicker in ui/src/Pickers.tsx.
    /// </summary>
    public static Chooser StateTiles(string label, string chosen, Func<string, Task<bool>> picked)
    {
        var chooser = new Chooser(label, new UniformGrid { Columns = 4 }, picked, id => id == "" ? "None" : States.Labels[id]);
        foreach (var id in new[] { "" }.Concat(States.Names))
        {
            Control swatch = id switch { "" => new PlainSwatch(true), "running" => new PlainSwatch(false), _ => new StateSwatch(new StateMark(id, false)) };
            swatch.HorizontalAlignment = HorizontalAlignment.Center;
            var name = id == "" ? "None" : States.Labels[id];
            chooser.Add(id, name, new StackPanel { Spacing = 6, Children = { swatch, new TextBlock { Text = name, FontSize = 11, HorizontalAlignment = HorizontalAlignment.Center } } });
        }
        chooser.Show(chosen);
        return chooser;
    }

    /// <summary>One thing to pick: a soft tile, ringed once it is the chosen one.</summary>
    public static Button Cell(string name, Control content, params string[] classes)
    {
        var cell = new Button { Content = content };
        cell.Classes.Add("pick");
        foreach (var c in classes) cell.Classes.Add(c);
        AutomationProperties.SetName(cell, name);
        ToolTip.SetTip(cell, name);
        return cell;
    }
}

/// <summary>A label, the name of what is chosen, and cells to pick from. Picking rings the cell at once and asks the owner to save it; a refusal puts the ring back.</summary>
internal sealed class Chooser : StackPanel
{
    private readonly TextBlock _value;
    private readonly Panel _cells;
    private readonly List<string> _ids = [];
    private readonly Dictionary<string, Button> _byId = [];
    private readonly Func<string, Task<bool>> _picked;
    private readonly Func<string, string> _describe;
    private string? _chosen;

    /// <param name="maxHeight">The most the cells may take: more of them scroll, for a long list such as every shape of the model.</param>
    public Chooser(string label, Panel cells, Func<string, Task<bool>> picked, Func<string, string>? describe = null, double? maxHeight = null)
    {
        Spacing = 6;
        _cells = cells;
        _picked = picked;
        _describe = describe ?? (id => id);
        cells.Margin = new Thickness(-3); // the cells carry 3 on each side, so the first row and column sit at the edge
        AutomationProperties.SetName(cells, label);
        Children.Add(Pick.Head(label, out _value));
        if (maxHeight is { } height)
        {
            cells.Margin = new Thickness(0);
            Children.Add(new ScrollViewer { Content = cells, MaxHeight = height, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled });
        }
        else Children.Add(cells);
    }

    /// <summary>The ids on offer, in order.</summary>
    internal IReadOnlyList<string> Ids => _ids;

    /// <summary>Whether the cell of <paramref name="id"/> can be picked, and, when it cannot, why (its tooltip). A cell that cannot be picked stays where it is, dimmed.</summary>
    public void Allow(string id, string? blocked)
    {
        if (!_byId.TryGetValue(id, out var cell)) return;
        cell.IsEnabled = blocked is null;
        cell.Opacity = blocked is null ? 1 : 0.4;
        ToolTip.SetTip(cell, blocked is null ? AutomationProperties.GetName(cell) : blocked);
    }

    /// <summary>Whether the cell of <paramref name="id"/> can be picked now, for the tests.</summary>
    internal bool Allowed(string id) => _byId.TryGetValue(id, out var cell) && cell.IsEnabled;

    internal string? Chosen => _chosen;

    public Button Add(string id, string name, Control content, params string[] classes)
    {
        var cell = Pick.Cell(name, content, classes);
        cell.Click += async (_, _) => await Choose(id);
        _cells.Children.Add(cell);
        _ids.Add(id);
        _byId[id] = cell;
        cell.Classes.Set("on", id == _chosen);
        return cell;
    }

    public void Remove(string id)
    {
        if (!_byId.Remove(id, out var cell)) return;
        _cells.Children.Remove(cell);
        _ids.Remove(id);
    }

    public void Clear()
    {
        _cells.Children.Clear();
        _ids.Clear();
        _byId.Clear();
    }

    public bool Has(string id) => _byId.ContainsKey(id);

    /// <summary>Shows <paramref name="id"/> as the chosen one.</summary>
    public void Show(string? id)
    {
        _chosen = id;
        _value.Text = id is null ? "" : _describe(id);
        foreach (var (key, cell) in _byId) cell.Classes.Set("on", key == id);
    }

    /// <summary>What a click does, and what a test does: pick one.</summary>
    internal async Task<bool> Choose(string id)
    {
        if (id == _chosen) return true;
        var before = _chosen;
        Show(id);
        var saved = await _picked(id);
        if (!saved) Show(before);
        return saved;
    }
}

/// <summary>
/// How much of the colour fills the shape: a track that fades from clear to the colour, over the checks a clear fill shows, and a thumb. Drag it,
/// or press Left and Right (Shift for tens), and it is saved when it is let go.
/// </summary>
internal sealed class FadeBar : Control
{
    private const double Pad = 9;
    private int _value;
    private bool _dragging;
    private (string Light, string Dark) _color = ("#378add", "#85b7eb");

    public FadeBar()
    {
        Height = 24;
        Focusable = true;
        Cursor = new Cursor(StandardCursorType.Hand);
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
        GotFocus += (_, _) => InvalidateVisual();
        LostFocus += (_, _) => InvalidateVisual();
    }

    /// <summary>The value moved, to show it while it is being dragged.</summary>
    public event Action<int>? Moved;

    /// <summary>The value was let go.</summary>
    public event Func<int, Task>? Committed;

    public int Value
    {
        get => _value;
        set
        {
            var v = Math.Clamp(value, 0, 100);
            if (v == _value) return;
            _value = v;
            InvalidateVisual();
        }
    }

    public void SetColor((string Light, string Dark) color)
    {
        if (_color == color) return;
        _color = color;
        InvalidateVisual();
    }

    private IBrush Brush(string key) => AppTheme.Brush(this, key);

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        var track = new Avalonia.Rect(Pad, 5, Math.Max(1, Bounds.Width - 2 * Pad), 14);
        var round = new RoundedRect(track, 7);
        var color = Color.Parse(AppTheme.IsDark(this) ? _color.Dark : _color.Light);
        using (context.PushClip(round))
        {
            var checks = new SolidColorBrush(Colors.Gray, 0.3);
            for (var col = 0; col * 7 < track.Width; col++)
                for (var row = 0; row < 2; row++)
                    if ((col + row) % 2 == 0) context.DrawRectangle(checks, null, new Avalonia.Rect(track.Left + col * 7, track.Top + row * 7, 7, 7));
            var fade = new LinearGradientBrush
            {
                StartPoint = new RelativePoint(0, 0, RelativeUnit.Relative),
                EndPoint = new RelativePoint(1, 0, RelativeUnit.Relative),
                GradientStops = [new GradientStop(Color.FromArgb(0, color.R, color.G, color.B), 0), new GradientStop(color, 1)],
            };
            context.DrawRectangle(fade, null, track);
        }
        context.DrawRectangle(null, new Pen(Brush("LineBrush"), 1), round);
        var x = Pad + _value / 100.0 * track.Width;
        if (IsKeyboardFocusWithin) context.DrawEllipse(Brush("AccentTintBrush"), null, new Point(x, 12), 12, 12);
        context.DrawEllipse(Brush("BoxBrush"), new Pen(Brush("AccentBrush"), 2), new Point(x, 12), 8, 8);
    }

    private int At(Point p) => (int)Math.Round(Math.Clamp((p.X - Pad) / Math.Max(1, Bounds.Width - 2 * Pad), 0, 1) * 100);

    private void MoveTo(int value)
    {
        Value = value;
        Moved?.Invoke(_value);
    }

    private Task Commit() => Committed?.Invoke(_value) ?? Task.CompletedTask;

    /// <summary>What a test does: set it as if it were dragged and let go.</summary>
    internal Task Set(int value)
    {
        MoveTo(value);
        return Commit();
    }

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;
        _dragging = true;
        e.Pointer.Capture(this);
        Focus();
        MoveTo(At(e.GetPosition(this)));
        e.Handled = true;
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);
        if (_dragging) MoveTo(At(e.GetPosition(this)));
    }

    protected override async void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        if (!_dragging) return;
        _dragging = false;
        e.Pointer.Capture(null);
        await Commit();
    }

    private static bool IsStep(Key key) => key is Key.Left or Key.Right or Key.Home or Key.End;

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        var step = e.KeyModifiers.HasFlag(KeyModifiers.Shift) ? 10 : 1;
        var next = e.Key switch { Key.Left => _value - step, Key.Right => _value + step, Key.Home => 0, Key.End => 100, _ => -1 };
        if (!IsStep(e.Key)) return;
        MoveTo(next);
        e.Handled = true;
    }

    protected override async void OnKeyUp(KeyEventArgs e)
    {
        base.OnKeyUp(e);
        if (IsStep(e.Key)) await Commit();
    }
}

/// <summary>
/// The icon of an object: its tile and name in a row, and, opened, every icon drawn in groups with a filter. The type's own icon is the first choice;
/// the name of the icon pointed at is shown above the grid. The grid is built the first time it opens.
/// </summary>
internal sealed class IconPicker : StackPanel
{
    private const string DefaultName = "Default (the type's)";
    private readonly Func<string, Task<bool>> _picked;
    private readonly Border _tile = new();
    private readonly TextBlock _name = new() { VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
    private readonly Control _chevron = Icons.Make(Icons.ChevronRight, "btnicon", 14);
    private readonly Button _row = new();
    private readonly Border _pop = new() { IsVisible = false, CornerRadius = new CornerRadius(10), Padding = new Thickness(8) };
    private readonly TextBox _filter = new() { PlaceholderText = "Find an icon" };
    private readonly TextBlock _hint = new() { FontSize = 12, FontWeight = FontWeight.SemiBold, MinHeight = 16 };
    private readonly Button _default = new();
    private readonly StackPanel _groups = new() { Spacing = 4 };
    private readonly TextBlock _none = new() { IsVisible = false };
    private readonly List<(string Name, string Group, Button Cell, Path Path)> _cells = [];
    private readonly List<(string Group, TextBlock Header, Control Grid)> _sections = [];
    private string _builtFor = "\0";
    private string _current = "";
    private IBrush? _ink;
    private Model _model = null!;
    private FlowyObject _object = null!;

    public IconPicker(Func<string, Task<bool>> picked)
    {
        _picked = picked;
        Spacing = 6;
        var holder = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, VerticalAlignment = VerticalAlignment.Center };
        holder.Children.Add(_tile);
        holder.Children.Add(_name);
        var row = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)] };
        row.Children.Add(holder);
        row.Children.Add(_chevron);
        Grid.SetColumn(_chevron, 1);
        _chevron.VerticalAlignment = VerticalAlignment.Center;
        _chevron.RenderTransformOrigin = RelativePoint.Center;
        _row.Content = row;
        _row.Classes.Add("pick");
        _row.Classes.Add("wide");
        AutomationProperties.SetName(_row, "Icon");
        _row.Click += (_, _) => Open(!_pop.IsVisible);

        _pop.Classes.Add("pop");
        _filter.TextChanged += (_, _) => ApplyFilter();
        AutomationProperties.SetName(_filter, "Find an icon");
        _default.Classes.Add("pick");
        _default.Classes.Add("wide");
        _default.Click += async (_, _) => await Select("");
        _default.PointerEntered += (_, _) => _hint.Text = DefaultName;
        _default.PointerExited += (_, _) => _hint.Text = Shown();
        AutomationProperties.SetName(_default, DefaultName);
        _none.Classes.Add("muted");
        var scroll = new ScrollViewer { MaxHeight = 300, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, Content = new StackPanel { Spacing = 6, Children = { _default, _groups, _none } } };
        _pop.Child = new StackPanel { Spacing = 6, Children = { _filter, _hint, scroll } };
        _pop.KeyDown += (_, e) =>
        {
            if (e.Key != Key.Escape) return;
            e.Handled = true;
            Open(false);
            _row.Focus();
        };

        Children.Add(Pick.Head("Icon", out _));
        Children.Add(_row);
        Children.Add(_pop);
    }

    /// <summary>What a test can look at: whether the grid is open, and the icons in it by name.</summary>
    internal bool IsOpen => _pop.IsVisible;

    internal Button Row => _row;

    internal IReadOnlyList<string> Names => _cells.Select(c => c.Name).ToList();

    internal IReadOnlyList<string> VisibleNames => _cells.Where(c => c.Cell.IsVisible).Select(c => c.Name).ToList();

    internal bool SaysNone => _none.IsVisible;

    internal TextBox FilterBox => _filter;

    private string Shown() => _current == "" ? DefaultName : _current;

    internal void Open(bool open)
    {
        _pop.IsVisible = open;
        _chevron.RenderTransform = new RotateTransform(open ? 90 : 0);
        if (!open) return;
        Build();
        Dispatcher.UIThread.Post(() => _filter.Focus());
    }

    private async Task Select(string icon)
    {
        Open(false);
        _filter.Text = "";
        _hint.Text = Shown();
        if (icon != _current) await _picked(icon);
    }

    /// <summary>What a test does: pick an icon by its name ("" for the type's).</summary>
    internal Task Choose(string icon) => Select(icon);

    public void Update(Model model, FlowyObject o)
    {
        (_model, _object) = (model, o);
        _current = o.Icon ?? "";
        _tile.Child = Chrome.ObjectTile(model, o, 28);
        _name.Text = Shown();
        _default.Content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 10,
            Children = { Chrome.TypeTile(o.Type, Model.IsExternal(o), 28), new TextBlock { Text = DefaultName, VerticalAlignment = VerticalAlignment.Center } },
        };
        _default.Classes.Set("on", _current == "");
        _ink = Look.IsColor(o.Color) && Look.ColorPair(o.Color) is { } pair ? ThemeBrushes.For(pair.Light, pair.Dark) : null;
        if (_builtFor == "\0") return;
        if (_builtFor != CustomKey(model)) Build(true);
        else Mark();
    }

    private static string CustomKey(Model model) => string.Join("|", Look.CustomIcons(model.Meta).Keys);

    private void Mark()
    {
        _hint.Text = Shown();
        foreach (var (name, _, cell, path) in _cells)
        {
            cell.Classes.Set("on", name == _current);
            if (_ink is null) path.ClearValue(Shape.StrokeProperty);
            else path.Stroke = _ink;
        }
    }

    private void Build(bool force = false)
    {
        var key = CustomKey(_model);
        if (!force && _builtFor == key) { Mark(); return; }
        _builtFor = key;
        _cells.Clear();
        _sections.Clear();
        _groups.Children.Clear();
        var custom = Look.CustomIcons(_model.Meta);
        var groups = LookData.IconGroups.Select(g => (g.Group, Names: g.Names.AsEnumerable())).ToList();
        if (custom.Count > 0) groups.Add(("This model", custom.Keys.AsEnumerable()));
        foreach (var (group, names) in groups)
        {
            var header = new TextBlock { Text = group.ToUpperInvariant(), FontSize = 11, FontWeight = FontWeight.SemiBold, LetterSpacing = 1, Margin = new Thickness(0, 8, 0, 2) };
            header.Classes.Add("muted");
            var grid = new WrapPanel { Orientation = Orientation.Horizontal };
            foreach (var name in names)
            {
                var d = custom.TryGetValue(name, out var own) ? own : LookData.Icons[name];
                var icon = Icons.Make(d, "pickicon", 20, out var path);
                var cell = Pick.Cell(name, icon, "icon");
                var chosen = name;
                cell.Click += async (_, _) => await Select(chosen);
                cell.PointerEntered += (_, _) => _hint.Text = chosen;
                cell.PointerExited += (_, _) => _hint.Text = Shown();
                cell.GotFocus += (_, _) => _hint.Text = chosen;
                grid.Children.Add(cell);
                _cells.Add((name, group, cell, path));
            }
            _groups.Children.Add(header);
            _groups.Children.Add(grid);
            _sections.Add((group, header, grid));
        }
        Mark();
        ApplyFilter();
    }

    private void ApplyFilter()
    {
        var needle = (_filter.Text ?? "").Trim().ToLowerInvariant();
        _default.IsVisible = needle == "";
        var any = false;
        foreach (var (group, header, grid) in _sections)
        {
            var shown = 0;
            foreach (var c in _cells.Where(c => c.Group == group))
            {
                var visible = needle == "" || c.Name.Contains(needle) || group.ToLowerInvariant().Contains(needle);
                c.Cell.IsVisible = visible;
                if (visible) shown++;
            }
            header.IsVisible = grid.IsVisible = shown > 0;
            any |= shown > 0;
        }
        _none.IsVisible = !any;
        _none.Text = $"No icon called \"{needle}\".";
    }
}

/// <summary>A flow as a tile, or a tag to one that is not there (<c>Missing</c>, named by its id).</summary>
internal sealed record PartnerTile(string Id, string Name, string View, bool Missing = false);

/// <summary>
/// The flow a flow is compared with, for the edit form: the partner now as a ringed tile with Remove, then every other flow as a tile under a search field, and the flows that compare with this one
/// (read-only; each opens its own form). A pick or a removal is one edit, made by the owner. Remove on a link that holds a note asks first, inside the partner's tile. When <c>off</c> is set
/// everything is greyed out and the reason is its tooltip. Desktop twin of PartnerPicker in ui/src/Pickers.tsx.
/// </summary>
internal sealed class PartnerPicker : StackPanel
{
    private readonly PartnerTile? _partner;
    private readonly IReadOnlyList<FlowTile> _choices;
    private readonly string? _off;
    private readonly Func<string, Task<bool>> _pick;
    private readonly Func<Task<bool>> _remove;
    private readonly Action<string> _queryChanged;
    private readonly TextBox _find = new() { PlaceholderText = "Find a flow", Classes = { "bare" } };
    private readonly StackPanel _tiles = new() { Spacing = 4 };
    private readonly TextBlock _nothing = new() { Text = "Nothing called that", FontSize = 13, Classes = { "muted" }, IsVisible = false };
    private readonly List<(string Id, Button Cell)> _cells = [];
    private readonly List<(string Id, Button Cell)> _comparedBy = [];
    private Button? _removeButton;
    private Border? _ask;
    private Button? _confirm;
    private Button? _keep;

    /// <param name="partner">The flow now compared with, or null.</param>
    /// <param name="hasNote">The link holds a note, which Remove would lose: it asks first.</param>
    /// <param name="query">What the search field held before the form was drawn again, so a pick does not clear it.</param>
    public PartnerPicker(PartnerTile? partner, IReadOnlyList<FlowTile> choices, IReadOnlyList<FlowTile> comparedBy, bool hasNote, string? off, string query,
        Func<string, Task<bool>> pick, Func<Task<bool>> remove, Action<string> open, Action<string> queryChanged)
    {
        (_partner, _choices, _off, _pick, _remove, _queryChanged) = (partner, choices, off, pick, remove, queryChanged);
        Spacing = 8;
        AutomationProperties.SetName(this, "Compare with");
        if (off is not null)
        {
            ToolTip.SetTip(this, off);
            ToolTip.SetShowOnDisabled(this, true);
        }

        if (partner is null) Children.Add(new TextBlock { Text = "None", FontSize = 13, Classes = { "muted" }, Margin = new Thickness(2, 0) });
        else Children.Add(PartnerNow(partner, hasNote));

        var field = FlowsView.Field(_find, Icons.Search);
        field.IsEnabled = off is null;
        if (off is not null) ToolTip.SetShowOnDisabled(field, true);
        _find.Text = query;
        _find.TextChanged += (_, _) =>
        {
            _queryChanged(_find.Text ?? "");
            Fill();
        };
        Children.Add(field);
        Children.Add(new ScrollViewer { Content = _tiles, MaxHeight = 190, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled });
        Children.Add(_nothing);
        Fill();

        if (comparedBy.Count > 0)
        {
            Children.Add(Pick.Head("Compared by", out var count));
            count.Text = comparedBy.Count.ToString();
            var list = new StackPanel { Spacing = 4 };
            foreach (var c in comparedBy)
            {
                var cell = Cell(c.Name, c.View, false);
                ToolTip.SetTip(cell, $"Open {c.Name}");
                cell.Click += (_, _) => open(c.Id);
                list.Children.Add(cell);
                _comparedBy.Add((c.Id, cell));
            }
            Children.Add(new ScrollViewer { Content = list, MaxHeight = 150, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled });
        }
    }

    // What a test can look at and do.
    internal PartnerTile? Partner => _partner;

    internal string? Off => _off;

    internal TextBox Find => _find;

    /// <summary>The flows offered as tiles now, in order.</summary>
    internal IReadOnlyList<string> OfferedIds => [.. _cells.Select(c => c.Id)];

    /// <summary>The flows that compare with this one, in order.</summary>
    internal IReadOnlyList<string> ComparedByIds => [.. _comparedBy.Select(c => c.Id)];

    internal Button? RemoveButton => _removeButton;

    /// <summary>Whether the question "Remove the link and its note" is on screen.</summary>
    internal bool Asking => _ask?.IsVisible == true;

    internal Button? ConfirmButton => _confirm;

    internal Button? KeepButton => _keep;

    /// <summary>Presses Remove, as a click on it does.</summary>
    internal void AskToRemove() => _removeButton?.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));

    /// <summary>The tile of a flow on offer.</summary>
    internal Button? TileOf(string id) => _cells.FirstOrDefault(c => c.Id == id).Cell;

    /// <summary>The tile of a flow that compares with this one.</summary>
    internal Button? ComparedByTileOf(string id) => _comparedBy.FirstOrDefault(c => c.Id == id).Cell;

    /// <summary>The partner's own tile, which is ringed among the offered ones.</summary>
    internal bool IsRinged(string id) => _cells.FirstOrDefault(c => c.Id == id).Cell?.Classes.Contains("on") == true;

    /// <summary>One flow as a tile: its icon, its name and the view it plays in (or the word Missing). A tile is a wide cell of the pickers; the chosen one is ringed.</summary>
    private Button Cell(string name, string view, bool on)
    {
        var glyph = Icons.Make(Icons.Route, "pickicon", 16);
        glyph.VerticalAlignment = VerticalAlignment.Center;
        var text = new StackPanel
        {
            Spacing = 1, VerticalAlignment = VerticalAlignment.Center,
            Children =
            {
                new TextBlock { Text = name, FontSize = 13, TextTrimming = TextTrimming.CharacterEllipsis },
                new TextBlock { Text = view, FontSize = 11, TextTrimming = TextTrimming.CharacterEllipsis, Classes = { "muted" } },
            },
        };
        var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 8, Children = { glyph, text } };
        Grid.SetColumn(text, 1);
        var cell = Pick.Cell(name, grid, "wide", "partner");
        cell.HorizontalContentAlignment = HorizontalAlignment.Stretch;
        cell.Classes.Set("on", on);
        return cell;
    }

    private void Fill()
    {
        var needle = (_find.Text ?? "").Trim().ToLowerInvariant();
        var found = needle == "" ? _choices : [.. _choices.Where(c => c.Name.ToLowerInvariant().Contains(needle) || c.Id.Contains(needle, StringComparison.Ordinal) || c.View.ToLowerInvariant().Contains(needle))];
        _tiles.Children.Clear();
        _cells.Clear();
        foreach (var c in found)
        {
            var cell = Cell(c.Name, c.View, c.Id == _partner?.Id);
            if (_off is not null)
            {
                cell.IsEnabled = false;
                cell.Opacity = 0.4;
                ToolTip.SetTip(cell, _off);
                ToolTip.SetShowOnDisabled(cell, true);
            }
            cell.Click += async (_, _) =>
            {
                if (c.Id != _partner?.Id) await _pick(c.Id);
            };
            _tiles.Children.Add(cell);
            _cells.Add((c.Id, cell));
        }
        _nothing.IsVisible = needle != "" && found.Count == 0;
    }

    /// <summary>The partner now: its tile, ringed in the accent (greyed out with the word Missing when the flow is not there), and Remove.</summary>
    private Control PartnerNow(PartnerTile partner, bool hasNote)
    {
        var link = Icons.Make(Icons.Link, "linkmark", 16);
        link.VerticalAlignment = VerticalAlignment.Center;
        var text = new StackPanel
        {
            Spacing = 1, VerticalAlignment = VerticalAlignment.Center,
            Children =
            {
                new TextBlock { Text = partner.Name, FontSize = 14, FontWeight = FontWeight.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis },
                new TextBlock { Text = partner.Missing ? "Missing" : partner.View, FontSize = 12, TextTrimming = TextTrimming.CharacterEllipsis, Classes = { "muted" } },
            },
        };
        var remove = new Button { VerticalAlignment = VerticalAlignment.Center };
        remove.Classes.Add("tool");
        Chrome.Fill(remove, Icons.Close, "Remove");
        ToolTip.SetTip(remove, _off ?? (hasNote ? "Remove the link and its note" : "Remove the link"));
        ToolTip.SetShowOnDisabled(remove, true);
        remove.IsEnabled = _off is null;
        _removeButton = remove;
        var head = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 10, Children = { link, text, remove } };
        Grid.SetColumn(text, 1);
        Grid.SetColumn(remove, 2);

        var body = new StackPanel { Children = { head } };
        var now = new Border { Child = body };
        now.Classes.Add("partnernow");
        now.Classes.Set("missing", partner.Missing);
        AutomationProperties.SetName(now, partner.Name);

        if (hasNote)
        {
            var question = new TextBlock { Text = "Remove the link and its note", FontSize = 13, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center };
            var confirm = new Button { VerticalAlignment = VerticalAlignment.Center };
            confirm.Classes.Add("tool");
            confirm.Classes.Add("danger");
            Chrome.Fill(confirm, Icons.Trash, "Remove");
            var keep = new Button { VerticalAlignment = VerticalAlignment.Center };
            keep.Classes.Add("tool");
            keep.Classes.Add("primary");
            Chrome.Fill(keep, Icons.Check, "Keep");
            var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { confirm, keep } };
            var row = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 8, Children = { question, buttons } };
            Grid.SetColumn(buttons, 1);
            var ask = new Border { Child = row, IsVisible = false };
            ask.Classes.Add("partnerask");
            AutomationProperties.SetName(ask, "Remove the link and its note");
            (_ask, _confirm, _keep) = (ask, confirm, keep);
            body.Children.Add(ask);
            // Esc answers the question with Keep, and goes no further: it is not meant to close the form too.
            ask.KeyDown += (_, e) =>
            {
                if (e.Key != Key.Escape) return;
                e.Handled = true;
                Keep();
            };
            keep.Click += (_, _) => Keep();
            confirm.Click += async (_, _) =>
            {
                ask.IsVisible = false;
                await _remove();
            };
            remove.Click += (_, _) =>
            {
                ask.IsVisible = true;
                remove.IsEnabled = false;
                Dispatcher.UIThread.Post(() => keep.Focus());
            };
        }
        else remove.Click += async (_, _) => await _remove();
        return now;
    }

    /// <summary>Keep: the question goes away and the link and its note stay.</summary>
    private void Keep()
    {
        if (_ask is null || _removeButton is null) return;
        _ask.IsVisible = false;
        _removeButton.IsEnabled = _off is null;
        _removeButton.Focus();
    }
}
