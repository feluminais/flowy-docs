using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// What the note strip needs to know about the pair (two flows, or two runs): every flow's (or run's) raw <c>compare</c> tag (see <see cref="CompareChoices.TagsOf"/>), how to name a flow, the pair as it reads (<c>A</c> first,
/// <c>B</c> second: with no tag the line goes to <c>B</c>), why a note can't be written (null when it can) and the draft the reader holds for this pair (null while no editor is open).
/// </summary>
internal sealed record NoteInput(IReadOnlyDictionary<string, object?> Tags, Func<string, string> NameOf, string A, string B, string? Off, string? Draft, string Kind = "flow");

/// <summary>
/// Asked when a note that isn't saved is about to be lost: Discard it and go on, or Keep it (focused, so Enter keeps) and stay. A small card over the top of the canvas, under the bar, so the
/// note it is about stays in view.
/// </summary>
internal sealed class DraftAsk : Border
{
    /// <summary>Asks "Discard the note?", or, with the words given, another question with the same two answers: the first goes ahead and loses something, Keep stays.</summary>
    public DraftAsk(Action discard, Action keep, string ask = "Discard the note?", string discardLabel = "Discard", string discardTip = "Throw the note away", string keepTip = "Keep the note (Esc)")
    {
        Classes.Add("card");
        HorizontalAlignment = HorizontalAlignment.Center;
        VerticalAlignment = VerticalAlignment.Top;
        Margin = new Thickness(16, 56, 16, 12); // under the compare bar, so what the bar says stays in view
        Padding = new Thickness(14, 6, 8, 6);
        Discard = new Button();
        Keep = new Button();
        CompareBar.Make(Discard, null, discardLabel, discardLabel, discardTip, discard);
        CompareBar.Make(Keep, null, "Keep", "Keep", keepTip, keep);
        Keep.Classes.Add("primary");
        var question = new TextBlock { Text = ask, FontWeight = FontWeight.SemiBold, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 10, 0) };
        Child = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, Children = { question, Discard, Keep } };
        AutomationProperties.SetName(this, ask);
        // Once it is on screen: a control can't take the focus before it has been laid out.
        AttachedToVisualTree += (_, _) => Dispatcher.UIThread.Post(() => Keep.Focus(), DispatcherPriority.Loaded);
    }

    public Button Discard { get; }

    public Button Keep { get; }
}

/// <summary>
/// The note on a pair, under the panes. A pair with a tag shows its saved note as Markdown, and Note opens the editor on it; Save writes it with the tag. A pair with no tag has no file to
/// hold a note, so what is typed is a draft (the reader keeps it until it is saved or discarded), and Save as pair names the flow that gets the line, then writes the tag with the draft as its
/// note. Nothing is hidden when a note can't be written: the controls are greyed out and their tooltips say why. Saved notes always show. A port of CompareNote.tsx.
/// </summary>
internal sealed class CompareNote : Border
{
    private readonly StackPanel _body = new() { Spacing = 8 };
    private readonly WrapPanel _actions = new() { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBox _field = new()
    {
        AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MinHeight = 56, MaxHeight = 140, PlaceholderText = "Note",
    };
    private NoteInput? _input;
    private string? _pair;
    private string? _bodyKey;
    private bool _confirming;
    private bool _busy;
    private bool _syncing;

    /// <summary>The draft changed: the text in the editor, or null once it is closed. The reader keeps it, so it outlives this strip and closing the comparison can ask first.</summary>
    public event Action<string?>? DraftChanged;

    /// <summary>The tag (and its note) is to be written onto the flow with this id. Resolves to true once it is saved; whatever went wrong has been said in a notice.</summary>
    public Func<string, CompareTag, Task<bool>>? Save { get; set; }

    /// <summary>Swap sides, from the confirm: it changes which flow gets the line.</summary>
    public event Action? Flipped;

    /// <summary>Escape in the editor: it gives the keys back to the reader (a second Escape is the comparison's).</summary>
    public event Action? Left;

    public CompareNote()
    {
        Classes.Add("comparenote");
        AutomationProperties.SetName(this, "Note");
        AutomationProperties.SetName(_field, "Note");
        Child = new StackPanel { Spacing = 8, Children = { _body, _actions } };
        // The property itself, not TextChanged: the change is known when it is made, whatever the control posts after.
        _field.PropertyChanged += (_, e) =>
        {
            if (e.Property != TextBox.TextProperty || _syncing || _input is null) return;
            var text = _field.Text ?? "";
            _input = _input with { Draft = text };
            DraftChanged?.Invoke(text);
            Rebuild(actionsOnly: true); // the field keeps the focus: only the buttons follow what is typed
        };
        _field.KeyDown += OnFieldKey;
    }

    private (string Text, string? Holder) Saved => _input is null ? ("", null) : CompareUi.NoteOf(_input.Tags, _input.A, _input.B);

    /// <summary>Shows the pair's note as it is now. The editor, if one is open, is kept as it is, caret and all; another pair asks again from the start.</summary>
    public void Show(NoteInput input)
    {
        var key = CompareUi.PairKey(input.A, input.B);
        if (key != _pair)
        {
            _pair = key;
            _confirming = false;
        }
        _input = input;
        Rebuild();
    }

    private void Rebuild(bool actionsOnly = false)
    {
        if (_input is not { } input) return;
        var saved = Saved;
        var editing = input.Draft is not null;
        if (!actionsOnly)
        {
            var key = editing ? "\0edit" : saved.Text;
            if (key != _bodyKey)
            {
                _bodyKey = key;
                _body.Children.Clear();
                if (editing) _body.Children.Add(_field);
                else if (saved.Text != "") _body.Children.Add(new ScrollViewer { Content = new MarkdownView(saved.Text, 13), MaxHeight = 120, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled });
                if (editing) OpenField(input.Draft!);
            }
            if (editing && (_field.Text ?? "") != input.Draft)
            {
                _syncing = true;
                _field.Text = input.Draft;
                _syncing = false;
            }
            _field.IsEnabled = input.Off is null;
            ToolTip.SetTip(_field, input.Off);
            ToolTip.SetShowOnDisabled(_field, true);
            _body.IsVisible = _body.Children.Count > 0;
        }
        BuildActions(input, saved, editing);
    }

    /// <summary>Puts the text in the editor and the keyboard in it, with the caret at the end to write on from there.</summary>
    private void OpenField(string text)
    {
        _syncing = true;
        _field.Text = text;
        _syncing = false;
        Dispatcher.UIThread.Post(() =>
        {
            if (!_field.IsEffectivelyVisible) return;
            _field.Focus();
            _field.CaretIndex = text.Length;
        }, DispatcherPriority.Loaded);
    }

    private Button Tool(string text, string? tip, Action click, bool enabled = true, bool primary = false)
    {
        var button = new Button { IsEnabled = enabled, Margin = new Thickness(0, 0, 6, 0) };
        CompareBar.Make(button, null, text, text, tip ?? text, click);
        if (primary) button.Classes.Add("primary");
        _actions.Children.Add(button);
        return button;
    }

    /// <summary>A name in a line of the confirm: it is set in bold, the words round it are not.</summary>
    private sealed record Strong(string Text);

    /// <summary>One line of the confirm, put in the row: its words (plain text, and <see cref="Strong"/> names) as one string for a test to read.</summary>
    private string Line(bool warn, params object[] parts)
    {
        var line = new TextBlock { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 12, 0), TextWrapping = TextWrapping.Wrap, Inlines = new InlineCollection() };
        line.Classes.Add("noteconfirm");
        if (warn) line.Classes.Add("warn");
        foreach (var part in parts)
            line.Inlines.Add(part is Strong name ? new Run(name.Text) { FontWeight = FontWeight.SemiBold } : new Run((string)part));
        _actions.Children.Add(line);
        return string.Concat(parts.Select(p => p is Strong name ? name.Text : (string)p));
    }

    private void BuildActions(NoteInput input, (string Text, string? Holder) saved, bool editing)
    {
        _actions.Children.Clear();
        ConfirmLines = [];
        NoteButton = SaveButton = CancelButton = PairButton = null;
        var tagged = saved.Holder is not null;
        var off = input.Off;
        var target = CompareUi.SaveTarget(input.Tags, input.A, input.B, input.Draft ?? "");
        if (_confirming && !tagged)
        {
            // Save as pair names the flow that gets the line before it writes. Swap sides (here and on the bar) changes it.
            var (newer, older) = (target.Id, target.Tag.With);
            // The line goes to the right-hand flow, unless that one already links elsewhere and the other does not: then it goes to the other, and the confirm says why.
            var usual = CompareChoices.Order("flow", input.Tags, input.A, input.B).Newer;
            var moved = newer != usual ? usual : null;
            var lines = new List<string> { Line(false, "Tag ", new Strong(input.NameOf(newer)), " as the newer of ", new Strong(input.NameOf(older))) };
            if (moved is not null)
                lines.Add(Line(false, input.NameOf(moved), " already links to ", new Strong(input.NameOf(input.Tags.TryGetValue(moved, out var raw) ? Compares.Of(raw)?.With ?? "" : ""))));
            if (target.Replaces is { } replaces) lines.Add(Line(true, "Replaces its link to ", new Strong(input.NameOf(replaces))));
            ConfirmLines = lines;
            var flip = new Button { Margin = new Thickness(0, 0, 6, 0) };
            CompareBar.Make(flip, Icons.ArrowsLeftRight, null, "Swap sides", "Swap sides", () => Flipped?.Invoke());
            _actions.Children.Add(flip);
            SaveButton = Tool("Save", off, () => _ = SaveAsync(target.Id, target.Tag), off is null && !_busy, primary: true);
            CancelButton = Tool("Cancel", null, () =>
            {
                _confirming = false;
                Rebuild(actionsOnly: true);
            }, !_busy);
            return;
        }
        if (!editing) NoteButton = Tool("Note", off ?? (saved.Text == "" ? "Write a note" : "Change the note"), () => SetDraft(saved.Text), off is null);
        if (editing && tagged) SaveButton = Tool("Save", off, () => _ = SaveAsync(target.Id, target.Tag), off is null && !_busy && CompareUi.Unsaved(input.Draft, saved.Text), primary: true);
        if (editing) CancelButton = Tool("Cancel", null, () => SetDraft(null), !_busy);
        if (!tagged)
        {
            var same = CompareUi.PairOff(input.Kind, input.A, input.B);
            PairButton = Tool("Save as pair", off ?? same ?? $"Link these {input.Kind}s", () =>
            {
                _confirming = true;
                Rebuild(actionsOnly: true);
            }, off is null && same is null);
        }
    }

    /// <summary>Asks which flow gets the line, as Save as pair does (--pair, for a picture). Nothing happens for a pair that is tagged already.</summary>
    internal void AskToPair()
    {
        if (_input is null || Saved.Holder is not null) return;
        _confirming = true;
        Rebuild(actionsOnly: true);
    }

    /// <summary>Opens the editor on this text, or closes it (null).</summary>
    private void SetDraft(string? text)
    {
        if (_input is null) return;
        _input = _input with { Draft = text };
        DraftChanged?.Invoke(text);
        Rebuild();
    }

    private async Task SaveAsync(string id, CompareTag tag)
    {
        if (Save is not { } save) return;
        _busy = true;
        Rebuild(actionsOnly: true);
        var saved = false;
        try
        {
            saved = await save(id, tag);
        }
        finally
        {
            _busy = false;
        }
        if (saved)
        {
            _confirming = false;
            SetDraft(null);
        }
        else Rebuild(actionsOnly: true);
    }

    private void OnFieldKey(object? sender, KeyEventArgs e)
    {
        // The keys of a field are its own: Escape leaves it, and a second one is the comparison's.
        if (e.Key == Key.Escape)
        {
            e.Handled = true;
            Left?.Invoke();
        }
        else if (e.Key == Key.Enter && (e.KeyModifiers & (KeyModifiers.Control | KeyModifiers.Meta)) != 0 && _input is { } input && !_busy && input.Off is null && Saved.Holder is not null
            && CompareUi.Unsaved(input.Draft, Saved.Text))
        {
            e.Handled = true;
            var target = CompareUi.SaveTarget(input.Tags, input.A, input.B, input.Draft ?? "");
            _ = SaveAsync(target.Id, target.Tag);
        }
    }

    // What a test can look at.
    internal Button? NoteButton { get; private set; }

    internal Button? SaveButton { get; private set; }

    internal Button? CancelButton { get; private set; }

    internal Button? PairButton { get; private set; }

    internal TextBox Field => _field;

    /// <summary>Whether the editor is on screen.</summary>
    internal bool Editing => _body.Children.Contains(_field);

    /// <summary>The words of the confirm that Save as pair asks, a line each; empty while it is not asking.</summary>
    internal IReadOnlyList<string> ConfirmLines { get; private set; } = [];

    /// <summary>The saved note, drawn as Markdown, or null when none is.</summary>
    internal MarkdownView? SavedView => _body.Children.OfType<ScrollViewer>().Select(s => s.Content).OfType<MarkdownView>().FirstOrDefault();
}
