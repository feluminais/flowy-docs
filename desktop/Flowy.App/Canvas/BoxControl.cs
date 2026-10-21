using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Controls.Shapes;
using Avalonia.Animation;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.Core;
using Path = Avalonia.Controls.Shapes.Path;

namespace Flowy.App.Canvas;

/// <summary>
/// One object on the canvas: its shape (an outline drawn behind the rest, in the colour and fill it names), a tile with its icon (grey with a
/// cloud when it's external), its name, its tech (or type), and how many shapes it opens onto. Its look comes from the classes it carries (see
/// Styles.axaml): its type, outsider, lit, dim, selected, problem, and colored and tinted when it names a colour or an opacity. A shape in a state
/// other than Running (see <see cref="SetState"/>) also carries <c>state-stopped</c> and the like, dims, and gets a second outline and a glyph.
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
    private readonly Path _stateline = Layer("stateline");
    private readonly Border _queue = new();
    private readonly TextBlock _queueText = new();
    private readonly Ellipse _handle = new() { Width = 10, Height = 10, IsHitTestVisible = false, IsVisible = false, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, 3) };
    private Path? _icon;
    private string? _teaser;
    private bool _external;
    private string _type = "";
    private string _iconData = "";
    private string _shape = "";
    private StateMark? _state;
    private StateGlyph? _glyph;
    private double _dim = 1; // how far the content dims for a state: 1 is as it is
    private double _tintAlpha; // how much of its colour the tint fills the shape with (0 to 1)
    private double _enter = 1; // 0 to 1: the state's outline and glyph fading in
    private double _pulse = 1; // 1 down to 0.35 and back: a shape that is not well breathes
    private double _perimeter = 544;
    private IDisposable? _loop;
    private IDisposable? _fade;
    private IDisposable? _drain;

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
        Children.Add(_stateline); // over that: a state beats the strain colour
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
            _glow.Data = _fill.Data = _tint.Data = _outline.Data = _colorline.Data = _strain.Data = _strainGlow.Data = _stateline.Data = outline;
            _shape = shape;
            _perimeter = outline.ContourLength > 0 ? outline.ContourLength : 544;
            if (_state is { Inside: false } own) DashFor(own, Looks[own.State].Dash == Dash.Drained ? 1 : 0);
        }
        // Where content may sit inside the shape, and where "3 inside" goes.
        _content.Margin = new Thickness(def.Pad[3], def.Pad[0], def.Pad[1], def.Pad[2]);
        _inside.Margin = new Thickness(0, 0, def.Badge[0], def.Badge[1]);
        _tile.IsVisible = Look.ShowsTile(o);

        _tintAlpha = opacity / 100.0;
        _tint.Opacity = _tintAlpha * _dim;
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

    /// <summary>
    /// The state this shape is in, or null for Running: it dims, draws a second outline over its own in the state's dash and carries a glyph on a ring at its
    /// corner. A shape that only holds one in a state (<see cref="StateMark.Inside"/>) gets the glyph on a dashed ring and nothing else. Starting and Restarting
    /// loop, Degraded breathes, and a change eases over 0.6 s; none of it runs when motion is reduced, and no clock runs unless a state that loops is showing.
    /// The classes are Styles.axaml's: they colour the outline and the glyph, and a state beats the strain colour.
    /// </summary>
    public void SetState(StateMark? mark)
    {
        if (mark == _state) return;
        var was = _state;
        _state = mark;
        StopMotion();
        foreach (var name in States.Names) Classes.Set("state-" + name, mark?.State == name);
        Classes.Set("stated", mark is { Inside: false });
        Classes.Set("state-inside", mark is { Inside: true });
        Classes.Set("state-leaving", false);
        if (mark is null)
        {
            SetDim(1);
            Leave(was);
            return;
        }
        EnsureTransitions();
        SetDim(mark.Inside ? 1 : Looks[mark.State].Dim);
        if (_glyph is not null) Children.Remove(_glyph);
        _glyph = new StateGlyph(mark)
        {
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = mark.Inside ? VerticalAlignment.Bottom : VerticalAlignment.Top,
            Margin = mark.Inside ? new Thickness(-7, 0, 0, -9) : new Thickness(-7, -9, 0, 0),
        };
        Children.Add(_glyph);
        _stateline.IsVisible = !mark.Inside;
        _enter = _pulse = 1;
        Paint();
        // Still, a stopping shape's outline is already drained (phase 1); with motion it starts full and StartMotion drains it.
        if (!mark.Inside) DashFor(mark, Looks[mark.State].Dash == Dash.Drained ? 1 : 0);
        StartMotion();
    }

    /// <summary>What a test can look at: the state shown (null when Running), whether it is only held, whether the outline and glyph are on, and whether a loop runs.</summary>
    internal (string? State, bool Inside, bool Outline, bool Glyph, bool Looping) StateShown =>
        (_state?.State, _state?.Inside ?? false, _stateline.IsVisible, _glyph is { IsVisible: true } && _state is not null, _loop is not null);

    /// <summary>The mark this shape shows, or null.</summary>
    internal StateMark? State => _state;

    /// <summary>How a state looks on the outline: its dash, how thick it is, how far the content dims, and how long its loop is (0 when it does not loop).</summary>
    private enum Dash { Dots, Drained, Dashed, Arc, Solid }

    private sealed record StateLook(Dash Dash, double Thickness, double Dim, double LoopMs);

    private static readonly Dictionary<string, StateLook> Looks = new()
    {
        ["starting"] = new(Dash.Dots, 2.6, 0.72, 1200),
        ["stopping"] = new(Dash.Drained, 2.4, 0.6, 0),
        ["stopped"] = new(Dash.Dashed, 2, 0.55, 0),
        ["restarting"] = new(Dash.Arc, 3, 0.55, 1400),
        ["degraded"] = new(Dash.Solid, 2.6, 1, 2400),
    };

    /// <summary>
    /// The outline's dash at phase <paramref name="t"/> of the state's loop (or of its one move, for Stopping). Dashes are counted in stroke widths, so each is
    /// worked out from the outline's length: whole dots or dashes round it, whatever the shape, and a loop of whole periods does not jump.
    /// </summary>
    private void DashFor(StateMark mark, double t)
    {
        var look = Looks[mark.State];
        var th = look.Thickness;
        var full = _perimeter / th;
        _stateline.StrokeThickness = th;
        _stateline.StrokeLineCap = look.Dash is Dash.Dots or Dash.Drained or Dash.Arc ? PenLineCap.Round : PenLineCap.Flat;
        switch (look.Dash)
        {
            case Dash.Dots:
            {
                var period = _perimeter / Math.Max(8, Math.Round(_perimeter / 8.7)) / th;
                _stateline.StrokeDashArray = [0.01, period - 0.01];
                _stateline.StrokeDashOffset = -t * 8 * period;
                break;
            }
            case Dash.Drained:
            {
                var length = full * (1 - 0.54 * t);
                _stateline.StrokeDashArray = [length, Math.Max(0.001, full - length)];
                break;
            }
            case Dash.Dashed:
            {
                var period = _perimeter / Math.Max(6, Math.Round(_perimeter / 20.7)) / th;
                _stateline.StrokeDashArray = [period * 0.58, period * 0.42];
                break;
            }
            case Dash.Arc:
                _stateline.StrokeDashArray = [full * 0.2, full * 0.8];
                _stateline.StrokeDashOffset = -t * full;
                break;
            default:
                _stateline.StrokeDashArray = null;
                break;
        }
    }

    /// <summary>The outline's and the glyph's opacity: fading in, and breathing for a shape that is not well.</summary>
    private void Paint()
    {
        _stateline.Opacity = _enter * _pulse;
        if (_glyph is not null) _glyph.Opacity = _enter * (_state?.State == "degraded" ? 0.55 + 0.45 * _pulse : 1);
    }

    /// <summary>The content dims and comes back over 0.6 s: a transition on each layer's opacity, unless motion is reduced.</summary>
    private void EnsureTransitions()
    {
        if (MotionSettings.Reduced || _fill.Transitions is not null) return;
        foreach (var layer in Dimmed)
            layer.Transitions = [new DoubleTransition { Property = OpacityProperty, Duration = TimeSpan.FromMilliseconds(600) }];
    }

    private IEnumerable<Control> Dimmed => [_fill, _tint, _outline, _colorline, _content];

    private void SetDim(double dim)
    {
        _dim = dim;
        foreach (var layer in Dimmed.Where(l => l != _tint)) layer.Opacity = dim;
        _tint.Opacity = _tintAlpha * dim; // the tint's own opacity is how much of its colour fills the shape
    }

    /// <summary>The outline and glyph of a state that went fade out over the box coming back, then go; with reduced motion they go at once.</summary>
    private void Leave(StateMark? was)
    {
        if (was is null || MotionSettings.Reduced || TopLevel.GetTopLevel(this) is null)
        {
            Hide();
            return;
        }
        // The old state's classes stay for the fade, so the outline and glyph keep their colours; they colour nothing else once the content is back.
        foreach (var name in States.Names) Classes.Set("state-" + name, was.State == name);
        Classes.Set("state-inside", was.Inside);
        Classes.Set("state-leaving", true);
        _fade = Anim.Run(this, 600, Anim.EaseOut, t =>
        {
            _enter = 1 - t;
            Paint();
        }, () =>
        {
            _fade = null;
            Hide();
        });
    }

    private void Hide()
    {
        foreach (var name in States.Names) Classes.Set("state-" + name, false);
        Classes.Set("state-leaving", false);
        Classes.Set("state-inside", false);
        _stateline.IsVisible = false;
        if (_glyph is not null) Children.Remove(_glyph);
        _glyph = null;
        _enter = _pulse = 1;
        Paint();
    }

    /// <summary>Starts what moves for the state now showing: Stopping drains once, Starting and Restarting loop (and spin the glyph), Degraded breathes.</summary>
    private void StartMotion()
    {
        if (_state is not { } mark || MotionSettings.Reduced || TopLevel.GetTopLevel(this) is null) return;
        var look = Looks[mark.State];
        _enter = 0;
        Paint();
        _fade = Anim.Run(this, 600, Anim.EaseOut, t =>
        {
            _enter = t;
            Paint();
        }, () => _fade = null);
        if (look.Dash == Dash.Drained && !mark.Inside)
        {
            DashFor(mark, 0);
            _drain = Anim.Run(this, 900, Anim.EaseOut, t => DashFor(mark, t), () => _drain = null);
        }
        if (look.LoopMs <= 0) return;
        void Round() => _loop = Anim.Run(this, look.LoopMs, t => t, t =>
        {
            if (mark.State == "degraded") _pulse = 0.675 + 0.325 * Math.Cos(2 * Math.PI * t);
            else
            {
                if (!mark.Inside) DashFor(mark, t);
                _glyph?.Spin(360 * t);
            }
            Paint();
        }, Round);
        Round();
    }

    private void StopMotion()
    {
        _loop?.Dispose();
        _loop = null;
        _fade?.Dispose();
        _fade = null;
        _drain?.Dispose();
        _drain = null;
        _glyph?.Spin(0);
        _pulse = 1;
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        if (_state is not null && _loop is null) StartMotion();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        StopMotion();
        base.OnDetachedFromVisualTree(e);
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
