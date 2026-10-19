using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Controls.Shapes;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.Core;
using Path = Avalonia.Controls.Shapes.Path;

namespace Flowy.App.Canvas;

/// <summary>
/// One object on the canvas: its shape (an outline drawn behind the rest, in the colour and fill it names), a tile with its icon (grey with a
/// cloud when it's external), its name, its tech (or type), and how many shapes it opens onto. Its look comes from the classes it carries (see
/// Styles.axaml): its type, outsider, lit, dim, selected, problem, and colored and tinted when it names a colour or an opacity.
/// </summary>
internal sealed class BoxControl : Grid
{
    private static readonly string[] TypeClasses = ["actor", "system", "app", "store", "component"];

    // A shape's outline is parsed once and shared by every box that draws it.
    private static readonly Dictionary<string, Geometry> Outlines = [];

    private readonly TextBlock _name = new();
    private readonly TextBlock _meta = new();
    private readonly StackPanel _content;
    private readonly StackPanel _inside = new();
    private readonly TextBlock _insideText = new();
    private readonly Path _zoom;
    private readonly Border _tile = new();
    private readonly Path _glow = Layer("glow");
    private readonly Path _fill = Layer("fillbase");
    private readonly Path _tint = Layer("tint");
    private readonly Path _outline = Layer("outline");
    private readonly Path _colorline = Layer("colorline");
    private readonly Path _strainGlow = Layer("strainglow");
    private readonly Path _strain = Layer("strain");
    private readonly Border _queue = new();
    private readonly TextBlock _queueText = new();
    private readonly Ellipse _handle = new() { Width = 10, Height = 10, IsHitTestVisible = false, IsVisible = false, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, 3) };
    private Path? _icon;
    private string? _teaser;
    private bool _external;
    private string _type = "";
    private string _iconData = "";
    private string _shape = "";

    public string Id { get; }

    private static Path Layer(string name)
    {
        var path = new Path { Width = 200, Height = 72, IsHitTestVisible = false };
        path.Classes.Add(name);
        return path;
    }

    private static Geometry OutlineOf(string shape)
    {
        if (!Outlines.TryGetValue(shape, out var geometry)) Outlines[shape] = geometry = Geometry.Parse(LookData.Shapes[shape].Path);
        return geometry;
    }

    public BoxControl(SceneBox box)
    {
        Id = box.Id;
        Classes.Add("box");
        Background = Brushes.Transparent; // the whole area takes the pointer, not only the outline
        Focusable = true;
        IsTabStop = true;

        _tile.Classes.Add("tile");
        _name.Classes.Add("name");
        _meta.Classes.Add("meta");
        var text = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Children = { _name, _meta } };
        _content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 10,
            VerticalAlignment = VerticalAlignment.Center,
            IsHitTestVisible = false,
            Children = { _tile, text },
        };
        text.MaxWidth = 130;

        _insideText.Classes.Add("inside");
        _inside.Orientation = Orientation.Horizontal;
        _inside.Spacing = 3;
        _inside.HorizontalAlignment = HorizontalAlignment.Right;
        _inside.VerticalAlignment = VerticalAlignment.Bottom;
        _inside.IsHitTestVisible = false;
        _inside.Children.Add(Icons.Make(Icons.ZoomIn, "zoom", 12, out _zoom));
        _inside.Children.Add(_insideText);

        var badge = new Border
        {
            Width = 18, Height = 18, CornerRadius = new CornerRadius(9),
            HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, -9, -9, 0), IsHitTestVisible = false,
            Child = new TextBlock { Text = "!", Foreground = Brushes.White, FontWeight = FontWeight.Bold, FontSize = 12, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center },
        };
        badge.Classes.Add("badge");

        _queue.Classes.Add("queue");
        _queue.Child = _queueText;
        _queue.IsVisible = false;
        _queue.IsHitTestVisible = false;

        Children.Add(_glow);
        Children.Add(_strainGlow);
        Children.Add(_fill);
        Children.Add(_tint);
        Children.Add(_outline);
        Children.Add(_colorline);
        Children.Add(_strain); // over the author's colour, which stays as it is underneath
        Children.Add(_content);
        Children.Add(_inside);
        Children.Add(badge);
        Children.Add(_queue);
        _handle.Classes.Add("handle");
        Children.Add(_handle);
        Update(box);
    }

    public void Update(SceneBox box)
    {
        Avalonia.Controls.Canvas.SetLeft(this, box.Rect.X);
        Avalonia.Controls.Canvas.SetTop(this, box.Rect.Y);
        var o = box.Object;
        var external = Model.IsExternal(o);
        var type = TypeClasses.Contains(o.Type ?? "") ? o.Type! : "system";
        var shape = Look.ShapeOf(o);
        var def = LookData.Shapes[shape];
        var opacity = Look.FillOpacity(o);
        var colored = Look.IsColor(o.Color);
        var pair = Look.ColorPair(colored ? o.Color : Look.TypeColor(o))!.Value;
        var on = Look.OnFill(o);

        foreach (var t in TypeClasses) Classes.Set(t, t == type);
        Classes.Set("external", external);
        Classes.Set("outsider", box.Outsider);
        Classes.Set("lit", box.Mode == BoxMode.Lit);
        Classes.Set("dim", box.Mode == BoxMode.Dim);
        Classes.Set("problem", box.Problem);
        PlaceQueue();
        Classes.Set("colored", colored);
        Classes.Set("tinted", opacity > 0);

        if (shape != _shape)
        {
            var outline = OutlineOf(shape);
            _glow.Data = _fill.Data = _tint.Data = _outline.Data = _colorline.Data = _strain.Data = _strainGlow.Data = outline;
            _shape = shape;
        }
        // Where content may sit inside the shape, and where "3 inside" goes.
        _content.Margin = new Thickness(def.Pad[3], def.Pad[0], def.Pad[1], def.Pad[2]);
        _inside.Margin = new Thickness(0, 0, def.Badge[0], def.Badge[1]);
        _tile.IsVisible = Look.ShowsTile(o);

        _tint.Opacity = opacity / 100.0;
        if (opacity > 0) _tint.Fill = ThemeBrushes.For(pair.Light, pair.Dark);
        if (colored) _colorline.Stroke = ThemeBrushes.For(pair.Light, pair.Dark);

        var icon = string.IsNullOrEmpty(box.Icon) ? Look.IconData(new Model(), o) : box.Icon;
        if (external != _external || type != _type || icon != _iconData || _tile.Child is null)
        {
            _tile.Child = Icons.Make(icon, "icon", 18, out _icon);
            _tile.Width = _tile.Height = 34;
            _external = external;
            _type = type;
            _iconData = icon;
        }
        // The tile and icon are the type's (by class) unless the object names a colour or its fill is too strong for them to show.
        if (on is { } ink)
        {
            _tile.Background = ThemeBrushes.For(ink.Light, ink.Dark, 0.16);
            _icon!.Stroke = ThemeBrushes.For(ink.Light, ink.Dark);
        }
        else if (colored)
        {
            _tile.Background = ThemeBrushes.For(pair.Light, pair.Dark, 0.18);
            _icon!.Stroke = ThemeBrushes.For(pair.Light, pair.Dark);
        }
        else
        {
            _tile.ClearValue(Border.BackgroundProperty);
            _icon!.ClearValue(Shape.StrokeProperty);
        }
        if (on is { } text)
        {
            _name.Foreground = ThemeBrushes.For(text.Light, text.Dark);
            _meta.Foreground = _insideText.Foreground = ThemeBrushes.For(text.Light, text.Dark, 0.78);
            _zoom.Stroke = ThemeBrushes.For(text.Light, text.Dark, 0.78);
        }
        else
        {
            _name.ClearValue(TextBlock.ForegroundProperty);
            _meta.ClearValue(TextBlock.ForegroundProperty);
            _insideText.ClearValue(TextBlock.ForegroundProperty);
            _zoom.ClearValue(Shape.StrokeProperty);
        }

        _name.Text = string.IsNullOrEmpty(o.Name) ? box.Id : o.Name;
        _meta.Text = string.Join(" · ", new[] { external ? "external" : null, string.IsNullOrEmpty(o.Tech) ? o.Type : o.Tech }.Where(s => !string.IsNullOrEmpty(s)));
        _inside.IsVisible = box.Inside > 0;
        _insideText.Text = $"{box.Inside} inside";
        // Pointing at a box for a moment shows the first paragraph of its description.
        var teaser = Navigation.Teaser(o.Description);
        if (teaser is { Length: > 400 }) teaser = teaser[..400] + "…"; // a tooltip is built for every box, so it stays small
        if (teaser != _teaser)
        {
            _teaser = teaser;
            ToolTip.SetTip(this, string.IsNullOrWhiteSpace(teaser) ? null : new Border { MaxWidth = 260, Child = new MarkdownView(teaser, 13) });
            ToolTip.SetPlacement(this, PlacementMode.Bottom);
            ToolTip.SetShowDelay(this, 400);
        }
        AutomationProperties.SetName(this, $"{_name.Text}, {(external ? "external " : "")}{o.Type}");
    }

    /// <summary>Edit mode: a dot at the bottom edge to draw a connection from, and a cursor that says the shape can be moved.</summary>
    public void SetEditable(bool editable)
    {
        _handle.IsVisible = editable;
        Cursor = editable ? new Avalonia.Input.Cursor(Avalonia.Input.StandardCursorType.SizeAll) : null;
    }

    /// <summary>
    /// What a load does to this shape (see <see cref="Perf.TrafficFor"/>): an outline from green to red along its own outline, with a glow, and how many
    /// are waiting as a number in the corner. Null (or nothing measured) leaves the shape as it is.
    /// </summary>
    public void SetPerf(BoxTraffic? perf)
    {
        Classes.Set("strained", perf?.Strain is not null);
        if (perf?.Strain is { } strain)
        {
            _strain.Stroke = ThemeBrushes.For(PerfColors.Hex(strain, false), PerfColors.Hex(strain, true));
            _strainGlow.Stroke = ThemeBrushes.For(PerfColors.Hex(strain, false), PerfColors.Hex(strain, true), 0.35);
            _strainGlow.StrokeThickness = 4 + 9 * strain;
        }
        var queue = perf?.Queue ?? 0;
        _queue.IsVisible = queue > 0;
        _queueText.Text = queue.ToString(System.Globalization.CultureInfo.InvariantCulture);
        PlaceQueue();
    }

    /// <summary>The queue number sits beside the problem mark, not over it.</summary>
    private void PlaceQueue() => _queue.Margin = new Thickness(0, -9, Classes.Contains("problem") ? 14 : -7, 0);

    /// <summary>What a test can look at: whether the strain outline is on, and the number of what is waiting (null when none are).</summary>
    internal (bool Strained, string? Queue) PerfShown => (Classes.Contains("strained"), _queue.IsVisible ? _queueText.Text : null);

    /// <summary>Called by the canvas as the selection changes.</summary>
    public void SetSelected(bool selected) => Classes.Set("selected", selected);

    /// <summary>A step's gulp: 0 is the box as it is, 1 is squashed as far as it goes (a little wider and flatter). Taking something in, or giving it up.</summary>
    public void SetSquash(double amount)
    {
        RenderTransformOrigin = RelativePoint.Center;
        RenderTransform = amount > 0 ? new ScaleTransform(1 + 0.07 * amount, 1 - 0.1 * amount) : null;
    }
}
