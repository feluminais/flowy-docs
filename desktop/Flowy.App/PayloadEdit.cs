using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The payloads of the model as chips to press, in the order the model lists them: on a line any number, on a step one or none. A reason greys every chip out with it in the
/// tooltip. A field makes a new one from a name, on a line only. Desktop twin of PayloadPicker in ui/src/Pickers.tsx, drawn like the tag picker.
/// </summary>
internal sealed class PayloadPicker : StackPanel
{
    private readonly bool _many;
    private readonly IReadOnlyList<string> _chosen;
    private readonly Func<IReadOnlyList<string>, Task<bool>> _set;
    private readonly Action<string>? _onNew;

    public PayloadPicker(string label, IReadOnlyList<(string Id, string Name)> all, IReadOnlyList<string> chosen, bool many, string? off, Func<IReadOnlyList<string>, Task<bool>> set, Action<string>? onNew = null)
    {
        (_many, _chosen, _set, _onNew) = (many, chosen, set, onNew);
        Spacing = 6;
        AutomationProperties.SetName(this, label);
        // The heading names what is picked on its right, as the tag picker's does.
        var caption = new TextBlock { Text = label, FontSize = 12 };
        caption.Classes.Add("muted");
        var value = new TextBlock
        {
            Text = string.Join(", ", all.Where(p => chosen.Contains(p.Id)).Select(p => p.Name)),
            FontSize = 12,
            FontWeight = FontWeight.SemiBold,
            TextTrimming = TextTrimming.CharacterEllipsis,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        Grid.SetColumn(value, 1);
        Children.Add(new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 8, Children = { caption, value } });
        var chips = new WrapPanel { Orientation = Orientation.Horizontal };
        foreach (var (id, name) in all)
        {
            var button = new Button { Content = new TextBlock { Text = name, FontSize = 12 }, IsEnabled = off is null };
            button.Classes.Add("tagchip");
            button.Classes.Set("on", chosen.Contains(id));
            AutomationProperties.SetName(button, name);
            if (off is not null) ToolTip.SetTip(button, off);
            var picked = id;
            button.Click += async (_, _) => await ToggleAsync(picked);
            chips.Children.Add(button);
        }
        // A greyed chip shows no tooltip of its own, so the row of them says why.
        if (off is not null) ToolTip.SetTip(chips, off);
        Children.Add(chips);
        if (onNew is null) return;
        var add = new TextBox { PlaceholderText = "New payload" };
        AutomationProperties.SetName(add, "New payload");
        add.KeyDown += (_, e) =>
        {
            if (e.Key != Key.Enter) return;
            e.Handled = true;
            AddTyped(add);
        };
        AddBox = add;
        Children.Add(add);
    }

    /// <summary>The field for a new payload's name, on a line's picker.</summary>
    internal TextBox? AddBox { get; }

    /// <summary>Presses the chip of a payload, as a click does.</summary>
    internal Task<bool> ToggleAsync(string id) =>
        _set(_chosen.Contains(id) ? [.. _chosen.Where(c => c != id)] : _many ? [.. _chosen, id] : [id]);

    /// <summary>Makes a new payload from what is typed, as Enter does.</summary>
    internal void AddTyped(TextBox box)
    {
        var name = (box.Text ?? "").Trim();
        if (name == "") return;
        box.Text = "";
        _onNew?.Invoke(name);
    }
}

/// <summary>The payload edit forms (twins of ui/src/Payloads.tsx): the form of one payload, a new one made from a name, and a step's two pickers.</summary>
internal static class PayloadEdit
{
    /// <summary>Every payload of the model as the pickers list them: its id and the name a reader knows it by.</summary>
    public static List<(string Id, string Name)> Choices(Model model) =>
        [.. Payloads.Of(model).Select(kv => (kv.Key, kv.Value.GetValueOrDefault("name") is string n && !JsCompat.Blank(n) ? n : kv.Key))];

    /// <summary>The ids a connection or a step names, without the payloads written in place.</summary>
    public static List<string> IdsOf(object? list) => list switch
    {
        string id => [id],
        List<object?> items => [.. items.OfType<string>()],
        _ => [],
    };

    /// <summary>The payloads written in place on a connection, kept as they are when the picker changes the ones it names.</summary>
    public static List<object?> InlineOf(object? list) => list is List<object?> items ? [.. items.Where(i => i is not string)] : [];

    private static Dictionary<string, object?> Field(string key, object? value) => new() { [key] = value };

    /// <summary>What the forms show of the model's payloads, as one string: a form is built again only when it changes, so typing in one is never cut off by an edit elsewhere.</summary>
    public static string Signature(Model model, object? named) => Flat(model.Meta.GetValueOrDefault("payloads")) + '\u0003' + Flat(named);

    private static string Flat(object? v) => v switch
    {
        null => "",
        string s => s,
        List<object?> list => "[" + string.Join('\u0001', list.Select(Flat)) + "]",
        OrderedDictionary<string, object?> map => "{" + string.Join('\u0001', map.Select(kv => kv.Key + "\u0002" + Flat(kv.Value))) + "}",
        _ => v.ToString() ?? "",
    };

    /// <summary>
    /// One payload's form, folded away under its name: Name, About, Shape and Example, each saved when you leave it, and Delete. Delete takes it off the line the form is
    /// under (<paramref name="offLine"/>) and then out of the model; when another line or a step still names it, the refusal says which. <paramref name="open"/> and
    /// <paramref name="toggled"/> keep it open across a rebuild. Each field's <see cref="Control.Tag"/> names it, so the focus can be put back (see <see cref="FieldKey"/>).
    /// </summary>
    public static Control Form(Model model, string id, EditRun run, Func<EditDoc, EditDoc> offLine, bool open = false, Action<bool>? toggled = null)
    {
        var p = Payloads.Of(model).GetValueOrDefault(id) ?? [];
        var name = p.GetValueOrDefault("name") as string;
        var body = new StackPanel { Spacing = 8, Margin = new Thickness(0, 6, 0, 0), IsVisible = open };
        var header = new Button { Content = $"{(string.IsNullOrEmpty(name) ? id : name)} {(open ? "▾" : "▸")}", HorizontalAlignment = HorizontalAlignment.Left };
        header.Classes.Add("disclosure");
        header.Classes.Add("payload");
        AutomationProperties.SetName(header, string.IsNullOrEmpty(name) ? id : name);
        header.Click += (_, _) =>
        {
            body.IsVisible = !body.IsVisible;
            header.Content = $"{(string.IsNullOrEmpty(name) ? id : name)} {(body.IsVisible ? "▾" : "▸")}";
            toggled?.Invoke(body.IsVisible);
        };
        Task<bool> Put(string key, object? value) => run(d => EditOps.PutPayload(d, id, Field(key, value)));
        body.Children.Add(new FieldBox("Name", name ?? "", false, v => Put("name", v)) { Tag = FieldKey(id, "Name") });
        body.Children.Add(new FieldBox("About (Markdown)", p.GetValueOrDefault("about") as string ?? "", true, v => Put("about", v)) { Tag = FieldKey(id, "About") });
        body.Children.Add(Block("Shape", FieldKey(id, "Shape"), p.GetValueOrDefault("shape"), v => Put("shape", v)));
        body.Children.Add(Block("Example", FieldKey(id, "Example"), p.GetValueOrDefault("example"), v => Put("example", v)));
        var refused = new TextBlock { TextWrapping = TextWrapping.Wrap, IsVisible = false };
        refused.Classes.Add("refused");
        AutomationProperties.SetLiveSetting(refused, Avalonia.Automation.AutomationLiveSetting.Assertive);
        var delete = new Button { HorizontalAlignment = HorizontalAlignment.Left };
        delete.Classes.Add("tool");
        delete.Classes.Add("danger");
        Chrome.Fill(delete, Icons.Trash, "Delete payload");
        delete.Click += async (_, _) =>
        {
            // The op runs off the UI thread, so the refusal is kept and said here, where the button is, once the run is back: who still names it.
            string? why = null;
            await run(d =>
            {
                try
                {
                    return EditOps.DeletePayload(offLine(d), id);
                }
                catch (OpError e)
                {
                    why = e.Message;
                    throw;
                }
            });
            refused.Text = why;
            refused.IsVisible = why is not null;
        };
        body.Children.Add(delete);
        body.Children.Add(refused);
        var form = new StackPanel { Children = { header, body } };
        form.Classes.Add("payloadform");
        return form;
    }

    /// <summary>A shape or an example as a card: its language and its code, saved when you leave the box; Remove takes it off. Without one, a button adds it.</summary>
    /// <summary>What names one field of one payload's form, in its <see cref="Control.Tag"/>.</summary>
    public static string FieldKey(string id, string field) => id + '' + field;

    /// <summary>The model with one connection no longer naming a payload, read from that model so a change made since is kept.</summary>
    public static EditDoc WithoutPayload(EditDoc doc, ConnectionInput which, string id)
    {
        var c = doc.Connections.OfType<OrderedDictionary<string, object?>>().FirstOrDefault(k =>
            k.GetValueOrDefault("from") as string == which.From && k.GetValueOrDefault("to") as string == which.To && (k.GetValueOrDefault("label") as string ?? "") == (which.Label ?? ""));
        if (c is null) return doc;
        var list = c.GetValueOrDefault("payloads");
        return EditOps.SetLinePayloads(doc, which, [.. IdsOf(list).Where(x => x != id).Cast<object?>(), .. InlineOf(list)]);
    }

    private static Control Block(string title, string key, object? held, Func<object?, Task<bool>> save)
    {
        var map = held as OrderedDictionary<string, object?>;
        var text = map?.GetValueOrDefault("text") as string ?? "";
        var language = map?.GetValueOrDefault("language") as string ?? "";
        var card = new StackPanel { Spacing = 6, IsVisible = map is not null };
        var add = new Button { HorizontalAlignment = HorizontalAlignment.Left, IsVisible = map is null };
        add.Classes.Add("tool");
        Chrome.Fill(add, Icons.Plus, title == "Shape" ? "Add a shape" : "Add an example");
        add.Click += (_, _) => (add.IsVisible, card.IsVisible) = (false, true);
        OrderedDictionary<string, object?> With(string code, string lang)
        {
            var next = new OrderedDictionary<string, object?>();
            if (lang != "") next["language"] = lang;
            next["text"] = code;
            return next;
        }
        var picker = new LanguagePicker(id => save(With(text, id)));
        picker.Show(language, CodeInk.LanguageFor(text, null).Language);
        var code = new FieldBox(title, text, true, v => Snippets.IsBlank(v) ? Task.FromResult(false) : save(With(v, language)), keepOnRefusal: true, mono: true) { Tag = key };
        var remove = new Button { HorizontalAlignment = HorizontalAlignment.Left };
        remove.Classes.Add("tool");
        remove.Classes.Add("danger");
        Chrome.Fill(remove, Icons.Trash, "Remove");
        remove.Click += async (_, _) =>
        {
            if (map is null) (add.IsVisible, card.IsVisible) = (true, false);
            else await save(null);
        };
        card.Children.Add(picker);
        card.Children.Add(code);
        card.Children.Add(remove);
        return new StackPanel { Children = { add, Chrome.Card(card) } };
    }

    /// <summary>A payload made from a name in the picker, not saved until it says something: the first About saved makes it (see <paramref name="save"/>).</summary>
    public static Control New(string name, Func<string, Task<bool>> save)
    {
        var card = new StackPanel { Spacing = 6, Children = { new TextBlock { Text = name, FontWeight = FontWeight.SemiBold }, new FieldBox("About (Markdown)", "", true, save) } };
        card.Classes.Add("payloadnew");
        return Chrome.Card(card);
    }

    /// <summary>What a step sends and gets back, as two pickers: the payloads its line carries first, then the rest. A reply is greyed out on a step that gets no answer.</summary>
    public static Control? StepPickers(Model model, Step step, Func<string, object?, Task<bool>> set)
    {
        var all = Choices(model);
        if (all.Count == 0) return null;
        var onLine = model.Connections.Where(c => (c.From == step.From && c.To == step.To) || (c.From == step.To && c.To == step.From)).SelectMany(c => IdsOf(c.Payloads)).ToHashSet();
        var choices = all.Where(p => onLine.Contains(p.Id)).Concat(all.Where(p => !onLine.Contains(p.Id))).ToList();
        var kind = Animations.Read(step)?.Kind;
        var sendOff = step.To is null && kind != "recurse" ? "A payload needs a step that goes to another shape" : null;
        var replyOff = Payloads.ReplyKinds.Contains(kind) ? null : "A reply needs a call, a callback or a recurse";
        return new StackPanel
        {
            Spacing = 8,
            Children =
            {
                new PayloadPicker("Payload", choices, IdsOf(step.Payload), false, sendOff, next => set("payload", next.Count == 0 ? null : next[0])),
                new PayloadPicker("Reply", choices, IdsOf(step.Reply), false, replyOff, next => set("reply", next.Count == 0 ? null : next[0])),
            },
        };
    }
}
