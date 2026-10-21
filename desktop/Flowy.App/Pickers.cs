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
