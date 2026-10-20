using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The language of one snippet as a drawn choice: Auto (with the language worked out named beside the label) and every language by name, the
/// chosen one ringed. The grid is closed until the chevron opens it, and a pick closes it. The twin of <c>LanguagePicker</c> in ui/src/Code.tsx.
/// </summary>
internal sealed class LanguagePicker : StackPanel
{
    private readonly TextBlock _value;
    private readonly Control _chevron = Icons.Make(Icons.ChevronRight, "rowicon", 14);
    private readonly Avalonia.Controls.Primitives.ToggleButton _toggle = new();
    private readonly WrapPanel _cells = new() { IsVisible = false, Margin = new Thickness(-3) };
    private readonly Dictionary<string, Button> _byId = [];
    private readonly Func<string, Task<bool>> _picked;
    private string _chosen = "";

    public LanguagePicker(Func<string, Task<bool>> picked)
    {
        Spacing = 6;
        _picked = picked;
        _toggle.Classes.Add("tool");
        _toggle.Content = _chevron;
        Avalonia.Automation.AutomationProperties.SetName(_toggle, "Languages");
        _toggle.IsCheckedChanged += (_, _) => Open(_toggle.IsChecked == true);
        Children.Add(Pick.Head("Language", out _value, _toggle));
        Add("", "Auto");
        foreach (var language in Snippets.Languages) Add(language.Id, language.Name);
        Avalonia.Automation.AutomationProperties.SetName(_cells, "Language");
        Children.Add(_cells);
    }

    private void Add(string id, string name)
    {
        var cell = Pick.Cell(name, new TextBlock { Text = name, FontSize = 12 }, "lang");
        cell.Click += async (_, _) => await Choose(id);
        _cells.Children.Add(cell);
        _byId[id] = cell;
    }

    /// <summary>What a test looks at: whether the grid is open, and the choices on offer by id ("" for Auto).</summary>
    internal bool IsOpen => _cells.IsVisible;

    internal IReadOnlyList<string> Ids => _byId.Keys.ToList();

    internal string Chosen => _chosen;

    internal string Shown => _value.Text ?? "";

    internal void Open(bool open)
    {
        _cells.IsVisible = open;
        _toggle.IsChecked = open;
        _chevron.RenderTransform = new RotateTransform(open ? 90 : 0);
    }

    /// <summary>Shows <paramref name="id"/> as the chosen one ("" is Auto); <paramref name="guess"/> is the language worked out, named while Auto is chosen.</summary>
    public void Show(string id, Language? guess)
    {
        _chosen = id;
        _value.Text = id == "" ? $"Auto: {guess?.Name ?? "Plain text"}" : Snippets.LanguageOf(id)?.Name ?? id;
        foreach (var (key, cell) in _byId) cell.Classes.Set("on", key == id);
    }

    /// <summary>What a click does, and what a test does: pick one.</summary>
    internal async Task<bool> Choose(string id)
    {
        Open(false);
        if (id == _chosen) return true;
        return await _picked(id);
    }
}

/// <summary>
/// A shape's snippets in its form: a card each (title, language, code, remove) and a button that adds one. A new card is only on this page until
/// it has code, so leaving it empty saves nothing. Every edit writes the whole list, as <c>put_object</c> does, from the entries the file held, so an
/// extra key on a snippet survives. The twin of <c>CodeFields</c> in ui/src/Code.tsx.
/// </summary>
internal sealed class SnippetsEditor : StackPanel
{
    private sealed class Card(StackPanel body, FieldBox title, LanguagePicker language, FieldBox code, Button remove)
    {
        public StackPanel Body { get; } = body;
        public FieldBox Title { get; } = title;
        public LanguagePicker Language { get; } = language;
        public FieldBox Code { get; } = code;
        public Button Remove { get; } = remove;
    }

    private readonly string _id;
    private readonly EditRun _run;
    private readonly StackPanel _cards = new() { Spacing = 12 };
    private readonly Button _add = new() { HorizontalAlignment = HorizontalAlignment.Left };
    private readonly List<Card> _shown = [];
    private List<OrderedDictionary<string, object?>> _saved = [];
    private OrderedDictionary<string, object?>? _draft;

    public SnippetsEditor(string id, EditRun run)
    {
        (_id, _run) = (id, run);
        Spacing = 12;
        _add.Classes.Add("tool");
        Chrome.Fill(_add, Icons.Plus, "Add code");
        _add.Click += (_, _) =>
        {
            if (_draft is not null || _saved.Count >= Snippets.MaxSnippets) return;
            _draft = [];
            Rebuild();
            UpdateAdd();
            if (_shown.Count > 0) Dispatcher.UIThread.Post(() => _shown[^1].Code.Box.Focus());
        };
        Children.Add(_cards);
        Children.Add(_add);
    }

    /// <summary>What a test looks at: the cards, the add button and what is typed in a card.</summary>
    internal int CardCount => _shown.Count;

    internal Button AddButton => _add;

    internal FieldBox TitleOf(int i) => _shown[i].Title;

    internal FieldBox CodeOf(int i) => _shown[i].Code;

    internal LanguagePicker LanguageOf(int i) => _shown[i].Language;

    internal Button RemoveOf(int i) => _shown[i].Remove;

    private int Count => _saved.Count + (_draft is null ? 0 : 1);

    private static string Text(OrderedDictionary<string, object?> entry, string key) => entry.TryGetValue(key, out var v) && v is string s ? s : "";

    /// <summary>The shape now holds <paramref name="o"/>'s snippets. A card with the focus keeps what is being typed; cards are only made again when there are more or fewer.</summary>
    public void Sync(FlowyObject o)
    {
        var entries = Snippets.Entries(o);
        var rebuilt = entries.Count != _saved.Count;
        _saved = entries;
        if (rebuilt) _draft = null;
        if (rebuilt || _shown.Count != Count) Rebuild();
        else Fill();
        UpdateAdd();
    }

    /// <summary>The add button is greyed out, with the reason as its tip, while there is a card with no code yet or the shape holds as many as it may.</summary>
    private void UpdateAdd()
    {
        _add.IsEnabled = _draft is null && _saved.Count < Snippets.MaxSnippets;
        ToolTip.SetTip(_add, _saved.Count >= Snippets.MaxSnippets ? $"At most {Snippets.MaxSnippets}" : null);
    }

    private OrderedDictionary<string, object?> Entry(int i) => i < _saved.Count ? _saved[i] : _draft!;

    private void Rebuild()
    {
        _cards.Children.Clear();
        _shown.Clear();
        for (var i = 0; i < Count; i++)
        {
            var at = i;
            var title = new FieldBox("Title", "", false, v => Change(at, e => Set(e, "title", v)));
            var language = new LanguagePicker(id => Change(at, e => Set(e, "language", id)));
            var code = new FieldBox("Code", "", true, v => Change(at, e => Set(e, "text", v)), keepOnRefusal: true, mono: true);
            var remove = new Button { HorizontalAlignment = HorizontalAlignment.Left };
            remove.Classes.Add("tool");
            remove.Classes.Add("danger");
            Chrome.Fill(remove, Icons.Trash, "Remove");
            remove.Click += async (_, _) => await Remove(at);
            var body = new StackPanel { Spacing = 12, Children = { title, language, code, remove } };
            var card = new Border { Child = body };
            card.Classes.Add("codecard");
            _cards.Children.Add(card);
            _shown.Add(new Card(body, title, language, code, remove));
        }
        Fill();
    }

    private void Fill()
    {
        for (var i = 0; i < _shown.Count; i++)
        {
            var entry = Entry(i);
            var card = _shown[i];
            card.Title.Sync(Text(entry, "title"));
            card.Code.Sync(Text(entry, "text"));
            var named = Snippets.LanguageOf(Text(entry, "language"));
            card.Language.Show(named?.Id ?? "", CodeInk.LanguageFor(Text(entry, "text"), null).Language);
        }
    }

    /// <summary>A title or language is blank when it is left out, and the keys come out in the file's order whatever order they were typed in (see <see cref="Snippets.Tidy"/>).</summary>
    private static void Set(OrderedDictionary<string, object?> entry, string key, string value) => entry[key] = value;

    /// <summary>Applies a change to one card and saves the whole list. A card with no code yet only keeps what was typed, until it has some.</summary>
    private async Task<bool> Change(int index, Action<OrderedDictionary<string, object?>> apply)
    {
        var list = _saved.Select(e => new OrderedDictionary<string, object?>(e)).ToList();
        if (index < list.Count)
        {
            apply(list[index]);
            return await Save(list);
        }
        var draft = new OrderedDictionary<string, object?>(_draft!);
        apply(draft);
        if (Snippets.IsBlank(Text(draft, "text")))
        {
            _draft = draft;
            Fill();
            return true;
        }
        list.Add(draft);
        return await Save(list);
    }

    private Task<bool> Save(List<OrderedDictionary<string, object?>> list) =>
        _run(d => EditOps.PutObject(d, new ObjectInput(_id, Snippets: list)));

    private async Task Remove(int index)
    {
        if (index >= _saved.Count)
        {
            _draft = null;
            Rebuild();
            UpdateAdd();
            return;
        }
        await Save(_saved.Where((_, i) => i != index).ToList());
    }
}
