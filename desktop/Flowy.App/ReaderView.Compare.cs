using Avalonia;
using Avalonia.Controls;
using Avalonia.VisualTree;
using Flowy.Core;

namespace Flowy.App;

/// <summary>What the comparison shows: two flows, <c>A</c> first (the older, left), and how they are viewed (<c>side</c> by side, or <c>swap</c> on one canvas). A port of <c>Compare</c> in ui/src/compare.ts.</summary>
internal sealed record CompareState(string Kind, string A, string B, string Mode);

/// <summary>
/// Two flows side by side, or swapping on one canvas: the comparison takes the canvas's place, each flow in a pane of its own (see <see cref="CompareView"/>), and the flow player waits behind it as it does behind
/// editing, the Performance tab and the Failures tab. A port of what App.tsx does for the comparison, with the same rules: it never opens while editing, and starting to edit ends it;
/// a flow that can't play does not open; the Performance and Failures tabs hide it and it is back when they close; going to another level ends it.
/// </summary>
internal sealed partial class ReaderView
{
    private CompareState? _compare;
    private CompareView? _compareView;
    private (string Flow, int Step)? _compareStart; // the stop the flow that was playing was at, for its pane to start at
    private ComparePicker? _picker;
    private string? _pickerFlow;

    // The note on the pair: what is typed in its editor is kept here, not in the strip, so it survives the strip going away (the Performance tab opening over the panes) and so leaving can ask
    // first. It belongs to one pair; another pair starts with none. A pair with no tag has no file to hold it, so there it is a draft. It is only dropped by Discard, by saving it, or by opening
    // another folder: closing the comparison any other way (a change on disk that takes a flow away) keeps it, and it is back when the pair is compared again.
    private (string Pair, string Text)? _noteDraft;
    private DraftAsk? _ask; // the question "Discard the note?", while it is asked
    private Action? _afterDiscard; // what to do once the reader says to discard the note

    /// <summary>Whether Show changes is on: the panes mark what differs between the flows. It is the reader's, kept between runs.</summary>
    internal bool ShowChanges { get; set; }

    /// <summary>The reader turned Show changes on or off: the app keeps it for the next window.</summary>
    public event Action<bool>? ChangesPicked;

    /// <summary>Whether the comparison is on screen: it is open, and no tab that draws on the one canvas is in front of it.</summary>
    private bool Comparing => _compare is not null && !PerfOpen && !FailuresOpen;

    // ---- opening and closing -------------------------------------------------------------------------------------

    /// <summary>
    /// Two flows side by side: <paramref name="id"/> is the one that was playing (or picked on a row), <paramref name="other"/> the one picked to go with it, the one that holds the tag second.
    /// A flow that can't play doesn't open, and nothing opens while editing.
    /// </summary>
    internal void OpenCompare(string id, string other, string mode = "side")
    {
        DropPicker();
        if (_folder is not { } folder || Editing) return;
        if (!CompareChoices.Playable(folder.Model, id) || !CompareChoices.Playable(folder.Model, other))
        {
            ShowNotice("That flow can't play yet.", 4);
            return;
        }
        DidSomethingElse();
        _compareStart = PlayingFlow() is { } playing && playing.Id == id ? (id, StopIndex()) : null;
        _playback.StopAuto(); // it must not start up again behind the panes, or when the comparison closes
        var (older, newer) = CompareChoices.Order("flow", CompareChoices.TagsOf(folder.Model, new Dictionary<string, LoadRun>(), "flow"), id, other);
        _compare = new CompareState("flow", older, newer, mode);
        _compareView = null;
        _side = null;
        Refresh();
    }

    /// <summary>
    /// Ends the comparison. What it showed was clicked in a pane, so the panel goes with it. Close, Esc and C come here with a redraw, and a note that isn't saved asks first (see
    /// <see cref="UnlessDraft"/>); one more of them while it asks is a Keep. The ways that end it for the reader's own work (a level, edit mode, another flow) ask before they come here.
    /// </summary>
    private void CloseCompare(bool redraw = true)
    {
        if (redraw && _compare is not null)
        {
            if (_ask is not null)
            {
                KeepNote();
                return;
            }
            if (UnlessDraft(() => CloseCompare())) return;
        }
        DropAsk();
        DropPicker();
        if (_compare is null) return;
        _compare = null;
        _compareView = null;
        _compareHost.Child = null;
        _compareStart = null;
        _side = null; // what the Details panel showed was clicked in a pane
        if (!redraw) return;
        Refresh();
        Focus();
    }

    /// <summary>C: close the comparison, or open it beside the flow playing, with the first one it is linked to or else the picker.</summary>
    private void ToggleCompare()
    {
        if (_compare is not null)
        {
            CloseCompare();
            return;
        }
        if (_folder is not { } folder) return;
        if (CompareChoices.Off(folder.Model, Editing) is { } off)
        {
            ShowNotice(off, 4);
            return;
        }
        if (PlayingFlow() is not { } playing) return;
        if (CompareChoices.FirstLinked(folder.Model, playing.Id) is { } other) OpenCompare(playing.Id, other);
        else TogglePicker(playing.Id);
    }

    private void FlipCompare()
    {
        if (_compare is not { } state) return;
        _compare = state with { A = state.B, B = state.A };
        Refresh();
    }

    /// <summary>Side by side or Swap, from the bar. It is part of the comparison's state, so a reload or Swap sides keeps it.</summary>
    private void SetCompareMode(string mode)
    {
        if (_compare is not { } state || state.Mode == mode) return;
        _compare = state with { Mode = mode };
        Refresh();
    }

    /// <summary>
    /// Swap: puts the other flow on show (X), or the one that reads first or second in the bar (<paramref name="reads"/> 0 or 1). The Details panel stays open if its shape is in the
    /// flow that comes on, and closes if it is not.
    /// </summary>
    private void SwapCompare(int? reads = null)
    {
        if (!Comparing || _compare is not { Mode: "swap" } state || _compareView?.Stage is not { } stage) return;
        Interacted();
        if (reads is { } side) stage.SwapTo(CompareView.KeysOf(state)[side]);
        else stage.Swap();
        if (_side is { } shown && !stage.Holds(shown)) CloseDetails();
        else
        {
            Refresh();
            Focus();
        }
    }

    private CompareView BuildCompareView()
    {
        var view = new CompareView();
        view.Picked += ComparePicked;
        view.EmptyClicked += PaneClicked; // as on the single canvas, a click on nothing closes the panel
        view.Bar.Closed += () => CloseCompare();
        view.Bar.Flipped += FlipCompare;
        view.Bar.ModePicked += SetCompareMode;
        view.Bar.FlowPicked += reads => SwapCompare(reads);
        view.Bar.ChangesToggled += () => SetShowChanges(!ShowChanges);
        view.Note.DraftChanged += text => _noteDraft = text is null || _compare is null ? null : (PairNow, text);
        view.Note.Save = SaveNoteAsync;
        view.Note.Flipped += FlipCompare;
        view.Note.Left += () =>
        {
            if (_ask is not null) KeepNote(); // the question is the innermost layer
            else Focus(); // the keys are the reader's again; a second Esc closes the comparison
        };
        _compareHost.Child = view;
        return view;
    }

    // ---- change marks and the note ---------------------------------------------------------------------------------

    /// <summary>Show changes, from the bar: the app remembers it for the next window.</summary>
    internal void SetShowChanges(bool on)
    {
        if (ShowChanges == on) return;
        ShowChanges = on;
        ChangesPicked?.Invoke(on);
        Refresh();
    }

    /// <summary>The pair on show, as the draft is keyed: the same whichever way round the sides are.</summary>
    private string PairNow => _compare is { } c ? $"{c.Kind}:{CompareUi.PairKey(c.A, c.B)}" : "";

    private IReadOnlyDictionary<string, object?> TagsNow() => CompareChoices.TagsOf(_folder!.Model, new Dictionary<string, LoadRun>(), "flow");

    /// <summary>The note the pair on show holds now, or "" when it holds none.</summary>
    private string SavedNote() => _compare is { } c && _folder is not null ? CompareUi.NoteOf(TagsNow(), c.A, c.B).Text : "";

    /// <summary>Whether leaving the comparison would lose a note: the editor holds text that is not what the pair holds.</summary>
    private bool NoteDirty => _compare is not null && _noteDraft is { } draft && draft.Pair == PairNow && CompareUi.Unsaved(draft.Text, SavedNote());

    /// <summary>
    /// Runs nothing, but a note that isn't saved asks first: <paramref name="leave"/> waits for Discard (Keep stays where it is). True when it asked, and a caller must stop; false when there was
    /// nothing to lose, and the caller goes on.
    /// </summary>
    private bool UnlessDraft(Action leave)
    {
        if (!NoteDirty) return false;
        DropAsk();
        _afterDiscard = leave;
        _ask = new DraftAsk(DiscardNote, KeepNote);
        _overlay.Children.Add(_ask);
        return true;
    }

    private void DropAsk()
    {
        if (_ask is null) return;
        _overlay.Children.Remove(_ask);
        _ask = null;
        _afterDiscard = null;
    }

    /// <summary>Discard: the note goes, and what was asked for goes ahead.</summary>
    private void DiscardNote()
    {
        var leave = _afterDiscard;
        _noteDraft = null;
        DropAsk();
        leave?.Invoke();
    }

    /// <summary>Keep: the note stays in its editor, and so does the comparison.</summary>
    private void KeepNote()
    {
        DropAsk();
        Focus();
    }

    /// <summary>Writes the tag (and its note) onto the flow in its own file, as one edit that can be undone. True once it is saved and on screen; a refusal has been said in a notice.</summary>
    private Task<bool> SaveNoteAsync(string id, CompareTag tag) => RunAsync(d => EditOps.SetCompare(d, id, tag));

    /// <summary>What the note strip is told: the tags, the names, the pair as it reads, why it can't be written, and the draft held for this pair.</summary>
    private NoteInput NoteInputFor(Folder folder, CompareState state)
    {
        string NameOf(string id) => folder.Model.Flows.TryGetValue(id, out var flow) && !string.IsNullOrEmpty(flow.Name) ? flow.Name : id;
        // The folder is open and can be written: not a sample inside the install, and no file that can't be read.
        var off = CompareUi.NoteOff(_session is not null, !CanEdit || _banner.IsVisible);
        return new NoteInput(TagsNow(), NameOf, state.A, state.B, off, _noteDraft is { } draft && draft.Pair == PairNow ? draft.Text : null);
    }

    /// <summary>Opens the confirm of Save as pair, which names the flow that gets the line (--pair, for a picture).</summary>
    public void AskToPair() => _compareView?.Note.AskToPair();

    /// <summary>Tries to close the comparison as Close does: a note that isn't saved asks first (--leave, for a picture).</summary>
    public void TryCloseCompare() => CloseCompare();

    /// <summary>Puts text in the note editor of the pair on show, as if it had been typed (--note, for a picture).</summary>
    public void PrefillNote(string text)
    {
        if (_compare is null) return;
        _noteDraft = (PairNow, text);
        Refresh();
    }

    /// <summary>A box or a line was clicked in a pane: its panel shows in Details, and a second click on what the panel shows closes it.</summary>
    internal void ComparePicked(string pane, Side picked)
    {
        Interacted();
        if (_compareView is not { } view) return;
        view.FocusPane(pane);
        if (view.Last == pane && _side == picked)
        {
            CloseDetails();
            return;
        }
        view.Last = pane;
        _side = picked;
        Refresh();
    }

    /// <summary>A change on disk took one of the flows away, or left it unable to play: the comparison ends, as in the browser.</summary>
    private void CloseCompareIfBroken(Model model)
    {
        if (_compare is { } state && !(CompareChoices.Playable(model, state.A) && CompareChoices.Playable(model, state.B))) CloseCompare(false);
    }

    /// <summary>Draws the comparison, and puts it in the canvas's place (or the canvas back in its own).</summary>
    private void RefreshCompare(Folder folder)
    {
        var on = Comparing;
        _compareHost.IsVisible = on;
        _motionHost.IsVisible = !on;
        if (_zoomButtons is not null) _zoomButtons.IsVisible = !on;
        if (!on || _compare is not { } now) return;
        _compareView ??= BuildCompareView();
        _compareView.Show(now, folder, LineStyle, _side, _compareStart, ShowChanges);
        _compareView.Note.Show(NoteInputFor(folder, now));
        _compareStart = null;
    }

    // ---- the picker ----------------------------------------------------------------------------------------------

    /// <summary>The Compare button's flyout: open it above the player, or close it.</summary>
    private void TogglePicker(string flow)
    {
        if (_picker is not null)
        {
            ClosePicker();
            return;
        }
        if (_folder is not { } folder) return;
        _pickerFlow = flow;
        _picker = new ComparePicker(folder.Model, flow, other => OpenCompare(flow, other), ClosePicker);
        _player.Picker = _picker;
    }

    /// <summary>Takes the flyout away and gives the keys back to the reader.</summary>
    private void ClosePicker()
    {
        if (_picker is null) return;
        DropPicker();
        Focus();
    }

    /// <summary>Takes the flyout away, wherever the keyboard focus is going next.</summary>
    private void DropPicker()
    {
        if (_picker is null) return;
        _picker = null;
        _pickerFlow = null;
        _player.Picker = null;
    }

    /// <summary>A press anywhere but on the flyout or the button that opened it closes the flyout.</summary>
    private void PressedOutsidePicker(object? source)
    {
        if (_picker is null || source is not Visual pressed) return;
        bool Inside(Control owner) => ReferenceEquals(pressed, owner) || pressed.GetVisualAncestors().Contains(owner);
        if (Inside(_picker) || (_player.CompareButton is { } button && Inside(button))) return;
        ClosePicker();
    }

    // What a test can look at.
    internal CompareState? CompareNow => _compare;

    internal CompareView? CompareShown => _compareView is not null && Comparing ? _compareView : null;

    internal ComparePicker? PickerShown => _picker;

    /// <summary>The text of the draft held for the pair on show, or null (for tests).</summary>
    internal string? NoteDraftNow => _noteDraft is { } draft && draft.Pair == PairNow ? draft.Text : null;

    /// <summary>Whether a note is held for any pair at all (for tests).</summary>
    internal bool HoldsNote => _noteDraft is not null;

    /// <summary>The question "Discard the note?", while it is asked (for tests).</summary>
    internal DraftAsk? AskShown => _ask;

    /// <summary>
    /// Opens a comparison of two flows by id, for a picture (--compare). A pair that holds a tag reads with the one that holds it second. With <paramref name="swap"/> it opens in
    /// Swap, on the flow that reads first, or on the other one with <paramref name="swapped"/>.
    /// </summary>
    public void OpenCompareById(string id, string other, bool swap = false, bool swapped = false)
    {
        OpenCompare(id, other, swap ? "swap" : "side");
        if (swap && swapped) SwapCompare();
    }

    internal void ToggleCompareKey() => ToggleCompare();
}
