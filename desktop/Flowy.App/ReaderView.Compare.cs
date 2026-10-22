using Avalonia;
using Avalonia.Controls;
using Avalonia.VisualTree;
using Flowy.Core;

namespace Flowy.App;

/// <summary>What the comparison shows: two flows or two runs (<c>Kind</c>), <c>A</c> first (the older, left), and how they are viewed (<c>side</c> by side, or <c>swap</c> on one canvas). A port of <c>Compare</c> in ui/src/compare.ts.</summary>
internal sealed record CompareState(string Kind, string A, string B, string Mode);

/// <summary>
/// Two flows (or two runs) side by side, or swapping on one canvas: the comparison takes the canvas's place, each in a pane of its own (see <see cref="CompareView"/>), and the flow player waits behind it as it does behind
/// editing, the Performance tab and the Failures tab. A port of what App.tsx does for the comparison, with the same rules: it never opens while editing, and starting to edit ends it;
/// a flow that can't play (or a run that is not there) does not open; the Performance and Failures tabs hide it and it is back when they close. Going to another level ends a comparison of
/// flows, which draw their own levels; two runs are compared on the level, and both follow it.
/// </summary>
internal sealed partial class ReaderView
{
    private CompareState? _compare;
    private CompareView? _compareView;
    private (string Flow, int Step)? _compareStart; // the stop the flow that was playing was at, for its pane to start at
    private ComparePicker? _picker;
    private string? _pickerFlow;
    private bool _pickerOnRow; // the flyout of a Compare button on a row of the navigator, not of the player's: it is hosted under the navigator's tabs

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

    private DraftAsk? _unlinkAsk; // the question "Remove the link and its note?", while it is asked
    private Action? _afterUnlink; // what to do once the reader says to remove them
    private IReadOnlyDictionary<string, LoadRun> RunMap => RunDrawing.MapOf(_folder?.Runs);

    /// <summary>For a test: called between reading a run file and writing its tag, so a change made in that moment is felt as the file changing under the write.</summary>
    internal Action? BeforeRunWrite { get; set; }

    /// <summary>Whether the comparison is on screen: it is open, and no tab that draws on the one canvas is in front of it.</summary>
    private bool Comparing => _compare is not null && !PerfOpen && !FailuresOpen;

    /// <summary>Whether two flows are on screen: they draw their own levels, so the shared panels follow the level only for two runs.</summary>
    private bool ComparingFlows => Comparing && _compare is { Kind: "flow" };

    /// <summary>Whether two runs are on screen: the keys of the Performance panel act on the pane with the focus, and the keys of a flow stay out.</summary>
    private bool ComparingRuns => Comparing && _compare is { Kind: "run" };

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
    /// Two runs side by side: <paramref name="id"/> is the one the Performance panel showed, <paramref name="other"/> the one picked to go with it, the one that holds the tag second. The
    /// panel leaves, as the comparison has one of its own for each run. A run that is not there doesn't open, and says so.
    /// </summary>
    internal void OpenRunCompare(string id, string other, string mode = "side")
    {
        DropPicker();
        _perfPanel.CloseRunPicker();
        if (_folder is not { } folder || Editing) return;
        if (CompareChoices.FromAddress(folder.Model, RunMap, "run", id, other) is { } notice)
        {
            ShowNotice(notice, 4);
            return;
        }
        DidSomethingElse();
        LeavePerformance(); // the Performance tab gives way, and a ramp stops with it
        _playback.StopAuto(); // nor does a flow play behind the panes
        var (older, newer) = CompareChoices.RunPairOf(RunMap, id, other);
        _compare = new CompareState("run", older, newer, mode);
        _compareView = null;
        _compareStart = null;
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
        DropUnlinkAsk();
        DropPicker();
        if (_compare is null) return;
        _compareView?.StopRamps(); // a ramp ends with its comparison
        _compare = null;
        _compareView = null;
        _compareHost.Child = null;
        _compareStart = null;
        _side = null; // what the Details panel showed was clicked in a pane
        if (!redraw) return;
        Refresh();
        Focus();
    }

    /// <summary>
    /// C: close the comparison, or open it beside the flow playing (or the run the Performance panel shows), with the first one it is linked to or else the picker. A comparison that waits
    /// behind the Performance tab is not the one on screen: C there is for the run.
    /// </summary>
    private void ToggleCompare()
    {
        if (_compare is not null && !PerfOpen)
        {
            CloseCompare();
            return;
        }
        if (_folder is not { } folder) return;
        if (PerfOpen)
        {
            if (CompareChoices.RunOff(RunMap, Editing) is { } blocked)
            {
                ShowNotice(blocked, 4);
                return;
            }
            var runId = PerfView.ActiveRun(folder.Runs!, _perf.RunId);
            if (CompareChoices.FirstLinkedRun(RunMap, runId) is { } linked) OpenRunCompare(runId, linked);
            else _perfPanel.TogglePicker("compare");
            return;
        }
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
        if (!Comparing || _compare is not { Mode: "swap" } state) return;
        if (state.Kind == "run")
        {
            // Two runs: the same level on one canvas, so what the Details panel shows is on it whichever run is on show, and it stays open.
            if (_compareView?.RunStage is not { } runStage) return;
            Interacted();
            if (reads is { } which) runStage.SwapTo(CompareView.KeysOf(state)[which]);
            else runStage.Swap();
            Refresh();
            Focus();
            return;
        }
        if (_compareView?.Stage is not { } stage) return;
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
        view.ControlUsed += () => Focus(); // a control in a run's panel took the keyboard: give it back, so the keys work
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

    /// <summary>Every flow's (or, for two runs, every run's) raw <c>compare</c> tag.</summary>
    private IReadOnlyDictionary<string, object?> TagsNow() => CompareChoices.TagsOf(_folder!.Model, RunMap, _compare?.Kind ?? "flow");

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

    /// <summary>
    /// Writes the tag (and its note) onto the flow in its own file, as one edit that can be undone. For two runs it goes onto the run's own file instead, in place and with nothing else of the
    /// file touched (see <see cref="WriteRunTagAsync"/>). True once it is saved and on screen; a refusal has been said in a notice.
    /// </summary>
    private Task<bool> SaveNoteAsync(string id, CompareTag tag) => _compare is { Kind: "run" } ? WriteRunTagAsync(id, tag) : RunAsync(d => EditOps.SetCompare(d, id, tag));

    /// <summary>Why a tag can't be written: the folder is open and can be written (not a sample inside the install, and no file that can't be read). Null when it can.</summary>
    private string? SaveOff => CompareUi.NoteOff(_session is not null, !CanEdit || _banner.IsVisible);

    /// <summary>What the note strip is told: the tags, the names, the pair as it reads, why it can't be written, and the draft held for this pair.</summary>
    private NoteInput NoteInputFor(Folder folder, CompareState state)
    {
        string NameOf(string id) =>
            state.Kind == "run" ? (folder.Runs is { } runs && runs.TryGetValue(id, out var run) && !string.IsNullOrEmpty(run.Name) ? run.Name : id)
            : folder.Model.Flows.TryGetValue(id, out var flow) && !string.IsNullOrEmpty(flow.Name) ? flow.Name : id;
        return new NoteInput(TagsNow(), NameOf, state.A, state.B, SaveOff, _noteDraft is { } draft && draft.Pair == PairNow ? draft.Text : null, state.Kind);
    }

    // ---- the link of a run -----------------------------------------------------------------------------------------

    /// <summary>
    /// Writes the tag of run <paramref name="id"/> (null takes it out) into the run's own file, in place: the one thing Flowy writes into a run. The file is read just before, and written only if it
    /// is still as it was read, through a temporary file; one that changed under the write, or can't be read, writes nothing and says so. The history does not keep it (a run is not a file Flowy
    /// writes whole). True once it is saved and the folder is read again.
    /// </summary>
    private async Task<bool> WriteRunTagAsync(string id, CompareTag? tag)
    {
        if (_session is not { } session || _folder is null) return false;
        DismissNotice();
        DidSomethingElse();
        // The same refusals as a flow's, in the same words.
        string? refusal = null;
        if (!RunMap.ContainsKey(id)) refusal = $"unknown run \"{id}\"";
        else if (tag is not null && tag.With == id) refusal = $"run \"{id}\" cannot compare with itself";
        else if (tag is not null && !RunMap.ContainsKey(tag.With)) refusal = $"unknown run \"{tag.With}\"";
        if (refusal is not null)
        {
            ShowNotice(refusal);
            return false;
        }
        var changedUnder = false;
        string? problem = null;
        try
        {
            await Task.Run(() =>
            {
                var (_, version) = FileStore.Read(session.Dir, FolderLayout.PerfFile(id));
                BeforeRunWrite?.Invoke();
                FileStore.SaveRunCompare(session.Dir, id, tag, version);
            });
        }
        catch (VersionConflict)
        {
            changedUnder = true;
            problem = EditSession.ChangedOutside;
        }
        catch (ParseError e)
        {
            problem = $"Can't read {e.File}{(e.Line is { } line ? $" (line {line})" : "")}: {e.Reason}. Fix the file and the view updates.";
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            problem = $"Couldn't save: {e.Message}";
        }
        if (problem is not null)
        {
            ShowNotice(problem);
            if (changedUnder) await ReloadFromDiskAsync(session.Dir);
            return false;
        }
        await ReloadFromDiskAsync(session.Dir);
        return true;
    }

    /// <summary>
    /// Link with, Unlink: run <paramref name="id"/> is linked to <paramref name="other"/> (the older), or its link is taken away when that is null. A run's note belongs to its link, so one that
    /// would go with it asks first.
    /// </summary>
    private void LinkRun(string id, string? other)
    {
        if (_folder is null || !RunMap.TryGetValue(id, out var run)) return;
        if (SaveOff is { } off)
        {
            ShowNotice(off, 4);
            return;
        }
        var was = run.Compare;
        if (was?.With == other || (was is null && other is null)) return; // nothing to change
        Action write = () => _ = WriteRunTagAsync(id, other is null ? null : new CompareTag(other));
        if (was?.Note is not null) AskToRemoveLink(write);
        else write();
    }

    /// <summary>Asks "Remove the link and its note?": Remove goes ahead, Keep (or Esc) leaves the link as it is.</summary>
    private void AskToRemoveLink(Action remove)
    {
        DropUnlinkAsk();
        _afterUnlink = remove;
        _unlinkAsk = new DraftAsk(() =>
        {
            var go = _afterUnlink;
            DropUnlinkAsk();
            go?.Invoke();
            Focus();
        }, KeepLink, "Remove the link and its note", "Remove", "Take away the link and the note it holds", "Keep the link (Esc)");
        _overlay.Children.Add(_unlinkAsk);
    }

    /// <summary>Keep: the link and its note stay.</summary>
    private void KeepLink()
    {
        DropUnlinkAsk();
        Focus();
    }

    private void DropUnlinkAsk()
    {
        if (_unlinkAsk is null) return;
        _overlay.Children.Remove(_unlinkAsk);
        _unlinkAsk = null;
        _afterUnlink = null;
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

    /// <summary>A change on disk took one of the flows away, or left it unable to play (or took one of the runs away): the comparison ends, as in the browser.</summary>
    private void CloseCompareIfBroken(Folder folder)
    {
        if (_compare is not { } state) return;
        var open = state.Kind == "run"
            ? CompareChoices.Openable(RunDrawing.MapOf(folder.Runs), state.A) && CompareChoices.Openable(RunDrawing.MapOf(folder.Runs), state.B)
            : CompareChoices.Playable(folder.Model, state.A) && CompareChoices.Playable(folder.Model, state.B);
        if (!open) CloseCompare(false);
    }

    /// <summary>Draws the comparison, and puts it in the canvas's place (or the canvas back in its own).</summary>
    private void RefreshCompare(Folder folder)
    {
        var on = Comparing;
        _compareHost.IsVisible = on;
        _motionHost.IsVisible = !on;
        if (_zoomButtons is not null) _zoomButtons.IsVisible = !on;
        if (!on || _compare is not { } now)
        {
            _compareView?.StopRamps(); // another tab is in front of it: a ramp stops with it
            return;
        }
        _compareView ??= BuildCompareView();
        _compareView.Show(now, folder, LineStyle, _side, _compareStart, ShowChanges, CurrentView());
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

    /// <summary>
    /// The Compare button on a flow's row (Flows tab or Explorer): the comparison of that flow with the first one it is linked to that is there, else the same flyout the player's button opens, hosted
    /// under the navigator's tabs. A second press on the same row's button closes the flyout; on another row's, it moves there. Nothing opens while editing (the button is greyed out then).
    /// </summary>
    private void CompareFromRow(string flow)
    {
        if (_folder is not { } folder || CompareChoices.Off(folder.Model, Editing) is not null || !folder.Model.Flows.Contains(flow)) return;
        if (_picker is not null && _pickerOnRow && _pickerFlow == flow)
        {
            ClosePicker();
            return;
        }
        DropPicker();
        if (CompareChoices.FirstLinked(folder.Model, flow) is { } other)
        {
            OpenCompare(flow, other);
            return;
        }
        _pickerFlow = flow;
        _pickerOnRow = true;
        _picker = new ComparePicker(folder.Model, flow, partner => OpenCompare(flow, partner), ClosePicker);
        _nav.Picker = _picker;
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
        _pickerOnRow = false;
        _player.Picker = null;
        _nav.Picker = null;
    }

    /// <summary>A press anywhere but on the flyout or a button that opens it (the player's, or one on a row, which decides for itself) closes the flyout.</summary>
    private void PressedOutsidePicker(object? source)
    {
        if (_picker is null || source is not Visual pressed) return;
        bool Inside(Control owner) => ReferenceEquals(pressed, owner) || pressed.GetVisualAncestors().Contains(owner);
        if (Inside(_picker) || (_player.CompareButton is { } button && Inside(button))) return;
        if (pressed.GetSelfAndVisualAncestors().OfType<Button>().Any(b => b.Classes.Contains("rowcompare"))) return;
        ClosePicker();
    }

    // What a test can look at.
    internal CompareState? CompareNow => _compare;

    internal CompareView? CompareShown => _compareView is not null && Comparing ? _compareView : null;

    internal ComparePicker? PickerShown => _picker;

    /// <summary>The flow whose Compare button opened the flyout that is open, and whether it hangs on a row of the navigator (for tests).</summary>
    internal (string? Flow, bool OnRow) PickerFor => (_pickerFlow, _pickerOnRow);

    /// <summary>The Compare button on a flow's row, as a press on it does (for tests).</summary>
    internal void CompareRow(string flow) => CompareFromRow(flow);

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

    /// <summary>
    /// Opens a comparison of two runs by id, for a picture (<c>--compare run:a,b</c>). A pair that holds a tag reads with the one that holds it second. With <paramref name="swap"/> it opens in
    /// Swap, on the run that reads first, or on the other one with <paramref name="swapped"/>. A run that is not there says so in a notice and opens nothing.
    /// </summary>
    public void OpenRunCompareById(string id, string other, bool swap = false, bool swapped = false)
    {
        OpenRunCompare(id, other, swap ? "swap" : "side");
        if (swap && swapped) SwapCompare();
    }

    internal void ToggleCompareKey() => ToggleCompare();

    /// <summary>Writes the tag of a run as Link with and a note do (for tests).</summary>
    internal Task<bool> WriteRunTagForTest(string id, CompareTag? tag) => WriteRunTagAsync(id, tag);

    /// <summary>The question "Remove the link and its note", while it is asked (for tests).</summary>
    internal DraftAsk? UnlinkAskShown => _unlinkAsk;
}
