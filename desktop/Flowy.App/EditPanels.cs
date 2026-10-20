using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Controls.Shapes;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Flowy.App.Canvas;
using Flowy.Core;
using Path = Avalonia.Controls.Shapes.Path;

namespace Flowy.App;

/// <summary>Runs one edit. Resolves to true once it is saved; whatever went wrong has been said in a notice.</summary>
internal delegate Task<bool> EditRun(Func<EditDoc, EditDoc> op);

/// <summary>
/// A text field that saves when you leave it (or press Enter, in a single line) and shows the saved text again if the edit is refused. After a
/// save the panel is updated from the reloaded model with <see cref="Sync"/>, which leaves a field alone while it has the focus: the reader may be
/// half way through typing in the next one.
/// </summary>
internal sealed class FieldBox : StackPanel
{
    private readonly TextBox _box;
    private readonly Func<string, Task<bool>> _save;
    private string _saved;

    public FieldBox(string label, string value, bool multiline, Func<string, Task<bool>> save)
    {
        Spacing = 4;
        _saved = value;
        _save = save;
        var caption = new TextBlock { Text = label, FontSize = 12 };
        caption.Classes.Add("muted");
        _box = new TextBox
        {
            Text = value,
            AcceptsReturn = multiline,
            TextWrapping = multiline ? TextWrapping.Wrap : TextWrapping.NoWrap,
            MinHeight = multiline ? 96 : 0,
            MaxHeight = multiline ? 320 : double.PositiveInfinity,
        };
        Avalonia.Automation.AutomationProperties.SetName(_box, label);
        _box.LostFocus += async (_, _) => await Commit();
        if (!multiline)
            _box.KeyDown += async (_, e) =>
            {
                if (e.Key != Key.Enter) return;
                e.Handled = true;
                await Commit();
            };
        Children.Add(caption);
        Children.Add(_box);
    }

    /// <summary>What a test can type: the text in the box.</summary>
    internal string Text
    {
        get => _box.Text ?? "";
        set => _box.Text = value;
    }

    internal TextBox Box => _box;

    /// <summary>The same text with Windows line ends made plain, as every other part of Flowy keeps it.</summary>
    private static string Plain(string text) => text.Replace("\r\n", "\n").Replace('\r', '\n');

    public async Task Commit()
    {
        var text = Plain(Text);
        if (text == _saved) return;
        if (await _save(text)) _saved = text;
        else Text = _saved;
    }

    /// <summary>The model now says <paramref name="value"/>. A box with the focus keeps what is being typed.</summary>
    public void Sync(string value)
    {
        _saved = value;
        if (!_box.IsFocused) _box.Text = value;
    }
}

/// <summary>An object's form: name, type, outside service, tech, its look (shape, colour, opacity, icon), description, links and code, then its problems and connections, its id, and delete.</summary>
internal sealed class ObjectEditor : StackPanel
{
    private readonly SidePanel _owner;
    private readonly EditRun _run;
    private readonly Action<string> _pick;
    private readonly Action<string?> _hover;
    private readonly FieldBox _name;
    private readonly FieldBox _tech;
    private readonly FieldBox _description;
    private readonly FieldBox _links;
    private readonly FieldBox _code;
    private readonly Chooser _type;
    private readonly ToggleButton _external = Chrome.OutsideSwitch();
    private readonly Chooser _shape;
    private readonly Chooser _color;
    private readonly IconPicker _icon;
    private readonly FieldBox _hex;
    private readonly FadeBar _fade = new();
    private readonly TextBlock _fadeValue;
    private readonly Button _fadeReset = new();
    private readonly List<(string Shape, Path Outline)> _outlines = [];
    private readonly Ellipse _defaultSwatch = new() { Width = 20, Height = 20, StrokeThickness = 2, StrokeDashArray = [2, 2] };
    private string? _customColor;
    private string _defaultShape = "rectangle";
    private const string Default = "";
    private readonly StackPanel _header = new();
    private readonly StackPanel _problems = new();
    private readonly StackPanel _lines = new();
    private bool _syncing;
    private object? _rawLinks; // the list the file held, so a link's extra keys survive an edit

    public string Id { get; }

    public ObjectEditor(SidePanel owner, string id, EditRun run, Action<string> pick, Action<string?> hover, Action deleted)
    {
        (_owner, Id, _run, _pick, _hover) = (owner, id, run, pick, hover);
        Spacing = 12;
        Task<bool> Put(ObjectInput input) => run(d => EditOps.PutObject(d, input));
        _name = new FieldBox("Name", "", false, v => Put(new ObjectInput(id, Name: v)));
        _tech = new FieldBox("Tech", "", false, v => Put(new ObjectInput(id, Tech: v)));
        _description = new FieldBox("Description (Markdown)", "", true, v => Put(new ObjectInput(id, Description: v)));
        _links = new FieldBox("Links (one per line: title | address)", "", true, v => Put(new ObjectInput(id, Links: LinkText.Parse(v, _rawLinks))));
        _code = new FieldBox("Code (one path per line)", "", true, v => Put(new ObjectInput(id, Code: v.Split('\n').Select(l => l.Trim()).Where(l => l != "").ToList())));
        _hex = new FieldBox("Custom color (#rrggbb)", "", false, v => Put(new ObjectInput(id, Color: v.Trim())));
        _type = new Chooser("Type", new WrapPanel(), v => Put(new ObjectInput(id, Type: v)));
        _shape = new Chooser("Shape", new UniformGrid { Columns = 4 }, v => Put(new ObjectInput(id, Shape: v)), v => v == Default ? $"Default ({_defaultShape})" : Pick.Cap(v));
        _color = new Chooser("Color", new UniformGrid { Columns = 6 }, v => Put(new ObjectInput(id, Color: v)), v => v == Default ? "Default (the type's)" : Look.IsColorName(v) ? Pick.Cap(v) : v);
        _icon = new IconPicker(v => Put(new ObjectInput(id, Icon: v)));
        BuildShapes();
        BuildColors();
        _external.IsCheckedChanged += async (_, _) =>
        {
            if (!_syncing) await Put(new ObjectInput(id, External: _external.IsChecked == true));
        };
        Avalonia.Automation.AutomationProperties.SetName(_fade, "Opacity (0 to 100)");
        _fade.Moved += v => _fadeValue!.Text = $"{v}%";
        _fade.Committed += v => Put(new ObjectInput(id, Opacity: v.ToString(CultureInfo.InvariantCulture)));
        _fadeReset.Classes.Add("reset");
        _fadeReset.Content = new TextBlock { Text = "Default", FontSize = 12 };
        Avalonia.Automation.AutomationProperties.SetName(_fadeReset, "Default opacity");
        _fadeReset.Click += async (_, _) => await Put(new ObjectInput(id, Opacity: ""));
        var opacityHead = Pick.Head("Opacity", out _fadeValue, _fadeReset);

        var delete = new Button { HorizontalAlignment = HorizontalAlignment.Left };
        delete.Classes.Add("tool");
        delete.Classes.Add("danger");
        Chrome.Fill(delete, Icons.Trash, "Delete");
        delete.Click += async (_, _) =>
        {
            if (await run(d => EditOps.DeleteObject(d, id))) deleted();
        };
        Children.Add(_header);
        Children.Add(_problems);
        Children.Add(Chrome.Section(Icons.Pencil, "Details"));
        Children.Add(new StackPanel { Spacing = 12, Children = { _name, _type, _external, _tech } });
        Children.Add(Chrome.Section(Icons.Sparkles, "Look"));
        Children.Add(new StackPanel { Spacing = 14, Children = { _shape, _color, _hex, new StackPanel { Spacing = 6, Children = { opacityHead, _fade } }, _icon } });
        Children.Add(Chrome.Section(Icons.Text, "Description"));
        Children.Add(_description);
        Children.Add(Chrome.Section(Icons.Link, "Links"));
        Children.Add(_links);
        Children.Add(Chrome.Section(Icons.Code, "Code"));
        Children.Add(_code);
        Children.Add(_lines);
        Children.Add(owner.Muted($"id: {id}", 12));
        Children.Add(delete);
    }

    /// <summary>The shapes as outlines, in the object's colour: the type's own first, then every shape. Their colours follow the object in <see cref="Update"/>.</summary>
    private void BuildShapes()
    {
        foreach (var shape in new[] { Default }.Concat(Look.ShapeNames))
        {
            var outline = new Path { Data = Geometry.Parse(LookData.Shapes[shape == Default ? _defaultShape : shape].Path), Stretch = Stretch.Uniform, Width = 62, Height = 23, StrokeThickness = 1.5, StrokeJoin = PenLineJoin.Round, HorizontalAlignment = HorizontalAlignment.Center };
            _outlines.Add((shape, outline));
            var name = shape == Default ? "Default" : Pick.Cap(shape);
            var label = new TextBlock { Text = name, FontSize = 10.5, HorizontalAlignment = HorizontalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
            _shape.Add(shape, shape == Default ? $"Default ({_defaultShape})" : name, new StackPanel { Spacing = 5, Children = { outline, label } }, "outline");
        }
    }

    /// <summary>The colours as swatches in the colour the canvas draws: the type's own first, drawn as an outline, then every name.</summary>
    private void BuildColors()
    {
        _color.Add(Default, "Default (the type's)", _defaultSwatch, "swatch");
        foreach (var name in Look.ColorNames)
        {
            var pair = Look.ColorPair(name)!.Value;
            _color.Add(name, Pick.Cap(name), new Ellipse { Width = 20, Height = 20, Fill = ThemeBrushes.For(pair.Light, pair.Dark) }, "swatch");
        }
    }

    internal FieldBox NameField => _name;

    internal Chooser TypeChoices => _type;

    internal Chooser ShapeChoices => _shape;

    internal Chooser ColorChoices => _color;

    internal IconPicker IconChoice => _icon;

    internal FadeBar OpacityBar => _fade;

    internal FieldBox HexField => _hex;

    internal FieldBox TechField => _tech;

    internal FieldBox DescriptionField => _description;

    internal FieldBox CodeField => _code;

    internal FieldBox LinksField => _links;

    internal ToggleButton ExternalBox => _external;

    public void Update(Model model, IReadOnlyList<Problem> problems)
    {
        if (model.GetObject(Id) is not { } o) return;
        _syncing = true;
        _name.Sync(o.Name ?? "");
        _tech.Sync(o.Tech ?? "");
        _description.Sync(o.Description ?? "");
        _code.Sync(o.Code is List<object?> code ? string.Join("\n", code.OfType<string>()) : "");
        _rawLinks = o.Links;
        _links.Sync(LinkText.Format(o));
        // A type the nesting rules don't allow here stays in the list, so the form shows what the file says.
        var types = Checks.TypesIn(model, Views.ParentOf(model, Id));
        if (!string.IsNullOrEmpty(o.Type) && !types.Contains(o.Type)) types.Add(o.Type);
        if (!_type.Ids.SequenceEqual(types))
        {
            _type.Clear();
            foreach (var t in types) _type.Add(t, t, new StackPanel { Spacing = 5, Children = { Chrome.TypeTile(t, false, 32), new TextBlock { Text = t, FontSize = 11, HorizontalAlignment = HorizontalAlignment.Center } } }, "typecell");
        }
        _type.Show(o.Type);
        _external.IsChecked = Model.IsExternal(o);

        // The shapes: each outline in the object's colour, and the first one as what its type draws.
        _defaultShape = Look.ShapeOf(new FlowyObject(o.Type, null, null, null, null, null, null));
        var pair = Pick.ColorOf(o);
        foreach (var (shape, outline) in _outlines)
        {
            if (shape == Default) outline.Data = Geometry.Parse(LookData.Shapes[_defaultShape].Path);
            outline.Stroke = ThemeBrushes.For(pair.Light, pair.Dark);
            outline.Fill = ThemeBrushes.For(pair.Light, pair.Dark, 0.15);
        }
        _shape.Show(Look.IsShape(o.Shape) ? o.Shape : Default);

        // The colours: a hex colour, or one the checks will report, gets a swatch of its own so the form says what the file says.
        var named = Look.IsColorName(o.Color);
        var typePair = Look.ColorPair(Look.TypeColor(o))!.Value;
        _defaultSwatch.Stroke = ThemeBrushes.For(typePair.Light, typePair.Dark);
        var custom = !string.IsNullOrEmpty(o.Color) && !named ? o.Color : null;
        if (_customColor is not null && _customColor != custom)
        {
            _color.Remove(_customColor);
            _customColor = null;
        }
        if (custom is not null && !_color.Has(custom))
        {
            var drawn = Look.ColorPair(custom);
            var swatch = new Ellipse { Width = 20, Height = 20 };
            if (drawn is { } p) swatch.Fill = ThemeBrushes.For(p.Light, p.Dark);
            else (swatch.Stroke, swatch.StrokeThickness, swatch.StrokeDashArray) = (Brushes.Gray, 2, [1, 1]); // not a colour at all: the checks say so
            _color.Add(custom, custom, swatch, "swatch");
            _customColor = custom;
        }
        _color.Show(string.IsNullOrEmpty(o.Color) ? Default : o.Color);
        _hex.Sync(!named ? o.Color ?? "" : "");

        // The opacity: a bar over a fade of that colour, with a way back to the default once it is set.
        var set = Look.IsOpacity(o.Opacity);
        var shown = Look.FillOpacity(o);
        _fade.SetColor(pair);
        _fade.Value = shown;
        _fadeValue.Text = set ? $"{shown}%" : $"Default ({shown}%)";
        _fadeReset.IsVisible = set;
        _icon.Update(model, o);
        _syncing = false;

        var mine = Navigation.ProblemsOf(model, problems, Id);
        _header.Children.Clear();
        _header.Children.Add(_owner.Header(model, Id, o, mine.Count));
        _problems.Children.Clear();
        _problems.Children.Add(_owner.Problems(mine.Select(p => p.Message)));
        _lines.Children.Clear();
        _lines.Children.Add(_owner.LinesOf(model, Id, _pick, _hover));
    }
}

/// <summary>The connections one line stands for (a zoomed-out line can stand for several), each with a label field and delete.</summary>
internal sealed class LineEditor : StackPanel
{
    private sealed class Row
    {
        public int Index;
        public ConnectionInput Which = new("", "");
        public required FieldBox Label;
        public required StackPanel Problems;
        public required Control Inside;
    }

    private readonly SidePanel _owner;
    private readonly string _from;
    private readonly string _to;
    private readonly EditRun _run;
    private readonly Action _closed;
    private readonly StackPanel _header = new();
    private readonly StackPanel _rows = new() { Spacing = 12 };
    private readonly List<Row> _live = [];

    public LineEditor(SidePanel owner, string from, string to, EditRun run, Action closed)
    {
        (_owner, _from, _to, _run, _closed) = (owner, from, to, run, closed);
        Spacing = 12;
        Children.Add(_header);
        Children.Add(Chrome.Section(Icons.Route, "Connections"));
        Children.Add(_rows);
    }

    internal IReadOnlyList<FieldBox> Labels => _live.Select(r => r.Label).ToList();

    public void Update(Model model, string view, IReadOnlyList<Problem> problems)
    {
        _header.Children.Clear();
        _header.Children.Add(_owner.LineHeader(model, _from, _to));
        var lines = Navigation.ConnectionsOf(model, view, _from, _to);
        if (!lines.Select(l => l.Index).SequenceEqual(_live.Select(r => r.Index)))
        {
            _live.Clear();
            _rows.Children.Clear();
            foreach (var (index, _) in lines) _rows.Children.Add(Build(index));
        }
        for (var i = 0; i < lines.Count; i++)
        {
            var (index, c) = lines[i];
            var row = _live[i];
            row.Which = new ConnectionInput(c.From ?? "", c.To ?? "", c.Label ?? "");
            row.Label.Sync(c.Label ?? "");
            row.Inside.IsVisible = c.From != _from || c.To != _to;
            if (row.Inside is TextBlock t) t.Text = SidePanel.Describe(model, c);
            row.Problems.Children.Clear();
            row.Problems.Children.Add(_owner.Problems(problems.Where(p => p.Connection == index).Select(p => p.Message)));
        }
    }

    private Control Build(int index)
    {
        Row? row = null;
        var label = new FieldBox("Label", "", false, v => _run(d => EditOps.Relabel(d, row!.Which, v)));
        var inside = _owner.Muted("");
        var problems = new StackPanel();
        row = new Row { Index = index, Label = label, Problems = problems, Inside = inside };
        var delete = new Button { HorizontalAlignment = HorizontalAlignment.Left };
        delete.Classes.Add("tool");
        delete.Classes.Add("danger");
        Chrome.Fill(delete, Icons.Trash, "Delete");
        delete.Click += async (_, _) =>
        {
            if (await _run(d => EditOps.RemoveConnection(d, row.Which)) && _live.Count <= 1) _closed();
        };
        _live.Add(row);
        return Chrome.Card(new StackPanel { Spacing = 8, Children = { inside, label, problems, delete } });
    }
}

/// <summary>Add a box to the view you are in: a type from those that fit here, and a name.</summary>
internal sealed class AddForm : StackPanel
{
    private readonly Chooser _type = new("Type", new WrapPanel(), _ => Task.FromResult(true));
    private readonly TextBox _name = new();
    private Func<Task> _submit = () => Task.CompletedTask;

    public AddForm(SidePanel owner, Model model, string view, EditRun run, Action<string> added)
    {
        Spacing = 12;
        Children.Add(owner.IconHeading(Icons.Plus, $"Add to {Views.NameOf(model, view)}"));
        var types = Checks.TypesIn(model, view);
        if (types.Count == 0)
        {
            Children.Add(owner.Muted($"Nothing can go inside {Views.NameOf(model, view)}."));
            return;
        }
        foreach (var t in types) _type.Add(t, t, new StackPanel { Spacing = 5, Children = { Chrome.TypeTile(t, false, 32), new TextBlock { Text = t, FontSize = 11, HorizontalAlignment = HorizontalAlignment.Center } } }, "typecell");
        _type.Show(types[0]);
        Avalonia.Automation.AutomationProperties.SetName(_name, "Name");
        var nameCaption = new TextBlock { Text = "Name", FontSize = 12 };
        nameCaption.Classes.Add("muted");
        var add = new Button { HorizontalAlignment = HorizontalAlignment.Left };
        add.Classes.Add("tool");
        add.Classes.Add("primary");
        Chrome.Fill(add, Icons.Plus, "Add");
        async Task Do()
        {
            var name = (_name.Text ?? "").Trim();
            if (name == "" || _type.Chosen is not { } type) return;
            var id = "";
            var saved = await run(d =>
            {
                id = Navigation.NewId(name, d.Objects.Keys, type); // from the fresh files, so it never lands on an existing box
                return EditOps.PutObject(d, new ObjectInput(id, type, name, view == Names.Root ? null : view));
            });
            if (saved) added(id);
        }
        _submit = Do;
        add.Click += async (_, _) => await Do();
        _name.KeyDown += async (_, e) =>
        {
            if (e.Key != Key.Enter) return;
            e.Handled = true;
            await Do();
        };
        Children.Add(_type);
        Children.Add(new StackPanel { Spacing = 4, Children = { nameCaption, _name } });
        Children.Add(add);
        AttachedToVisualTree += (_, _) => Dispatcher.UIThread.Post(() => _name.Focus());
    }

    internal TextBox NameBox => _name;

    internal Chooser TypeChoices => _type;

    /// <summary>What a test does: pick a type, type a name and press Add.</summary>
    internal Task SubmitAsync(string type, string name)
    {
        _type.Show(type);
        _name.Text = name;
        return _submit();
    }
}
