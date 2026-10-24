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
/// flows, which draw their own levels; two runs are compared on the level, and both follow it. It holds the comparison, the picker that chooses what to compare with, the notes typed on a pair,
/// and the two questions that guard them.
/// </summary>
internal sealed class CompareMode
{
    private readonly Border _host; // the comparison, in the place of the canvas while it is open
    private readonly Panel _overlay;
    private readonly PlayerCard _player;
    private readonly NavigatorPanel _nav;
    private readonly PerfSession _perf;
    private readonly IReader _reader;

    private CompareState? _compare;
    private CompareView? _compareView;
    private (string Flow, int Step)? _compareStart; // the stop the flow that was playing was at, for its pane to start at
    private ComparePicker? _picker;
    private string? _pickerFlow;
    private bool _pickerOnRow; // the flyout of a Compare button on a row of the navigator, not of the player's: it is hosted under the navigator's tabs

    // The note on the pair: what is typed in its editor is kept here, not in the strip, so it survives the strip going away (the Performance tab opening over the panes) and so leaving can ask
    // first. Each pair keeps its own, by pair; another pair starts with none, and typing on one never replaces another's. A pair with no tag has no file to hold it, so there it is a draft.
    // A pair's is only dropped by Discard or Cancel on that pair, by saving it, or by opening another folder (which asks first): closing the comparison any other way (a change on disk that
    // takes a flow away) keeps it, and it is back when the pair is compared again. `Saved` is the note the pair held when it was last typed in, to tell a draft that differs from it.
    private readonly Dictionary<string, (string Text, string Saved)> _drafts = [];
    private DraftAsk? _ask; // the question "Discard the note?", while it is asked
    private Action? _afterDiscard; // what to do once the reader says to discard the note
    private bool _discardAll; // the question is about leaving the folder or the window, so Discard drops every pair's note, not just the pair on show
    private DraftAsk? _unlinkAsk; // the question "Remove the link and its note?", while it is asked
    private Action? _afterUnlink; // what to do once the reader says to remove them

    public CompareMode(Border host, Panel overlay, PlayerCard player, NavigatorPanel nav, PerfSession perf, IReader reader)
    {
        _host = host;
        _overlay = overlay;
        _player = player;
        _nav = nav;
        _perf = perf;
        _reader = reader;
        _nav.Flows.CompareRequested += FromRow;
        _nav.Explorer.CompareRequested += FromRow;
        _player.CompareClicked += Toggle;
        _nav.Perf.CompareChosen += other => OpenRuns(PerfRunId, other);
        _nav.RunLinks.LinkChosen += (id, other) => LinkRun(id, other);
        _nav.RunLinks.Unlinked += id => LinkRun(id, null);
    }

    /// <summary>Whether Show changes is on: the panes mark what differs between the flows. It is the reader's, kept between runs.</summary>
    internal bool ShowChanges { get; set; }

    /// <summary>The reader turned Show changes on or off: the app keeps it for the next window.</summary>
    public event Action<bool>? ChangesPicked;

    internal CompareState? State => _compare;

    internal CompareView? View => _compareView;

    internal ComparePicker? Picker => _picker;

    /// <summary>The flow whose Compare button opened the flyout that is open, and whether it hangs on a row of the navigator.</summary>
    internal (string? Flow, bool OnRow) PickerFor => (_pickerFlow, _pickerOnRow);

    internal DraftAsk? Ask => _ask;

    internal DraftAsk? UnlinkAsk => _unlinkAsk;

    private IReadOnlyDictionary<string, LoadRun> RunMap => RunDrawing.MapOf(_reader.Folder?.Runs);

    /// <summary>The run the Performance panel shows (the first when none was picked).</summary>
    private string PerfRunId => _reader.Folder?.Runs is { } runs ? PerfView.ActiveRun(runs, _perf.RunId) : _perf.RunId;

    /// <summary>Whether the comparison is on screen: it is open, and no tab that draws on the one canvas is in front of it.</summary>
    internal bool Showing => _compare is not null && !_reader.PerfOpen && !_reader.FailuresOpen;

    /// <summary>Whether two flows are on screen: they draw their own levels, so the shared panels follow the level only for two runs.</summary>
    internal bool ShowingFlows => Showing && _compare is { Kind: "flow" };

    /// <summary>Whether two runs are on screen: the keys of the Performance panel act on the pane with the focus, and the keys of a flow stay out.</summary>
    internal bool ShowingRuns => Showing && _compare is { Kind: "run" };

    /// <summary>Another folder was loaded: it has other flows. A note about two of them is no use there. The same folder read again keeps its notes (they are by pair), and a window asks before it goes to another folder (MainWindow.Open).</summary>
    internal void Reset(bool sameFolder)
    {
        Close(false);
        if (!sameFolder) _drafts.Clear();
    }

    /// <summary>Esc answers the question that is asked, with Keep. True when one was.</summary>
    internal bool AnswerEscape()
    {
        if (_ask is not null)
        {
            KeepNote(); // the question is the innermost layer, and Esc answers it with Keep
            return true;
        }
        if (_unlinkAsk is not null)
        {
            KeepLink(); // the same, for the question about a link and its note
            return true;
        }
        return false;
    }

    // ---- opening and closing -------------------------------------------------------------------------------------

    /// <summary>
    /// Two flows side by side: <paramref name="id"/> is the one that was playing (or picked on a row), <paramref name="other"/> the one picked to go with it, the one that holds the tag second.
    /// A flow that can't play doesn't open, and nothing opens while editing.
    /// </summary>
    internal void Open(string id, string other, string mode = "side")
    {
        DropPicker();
        if (_reader.Folder is not { } folder || _reader.Editing) return;
        if (!CompareChoices.Playable(folder.Model, id) || !CompareChoices.Playable(folder.Model, other))
        {
            _reader.ShowNotice("That flow can't play yet.", 4);
            return;
        }
        _reader.DidSomethingElse();
        _compareStart = _reader.Playing is { } playing && playing.Flow == id ? playing : null;
        _reader.StopAutoplay(); // it must not start up again behind the panes, or when the comparison closes
        var (older, newer) = CompareChoices.Order("flow", CompareChoices.TagsOf(folder.Model, new Dictionary<string, LoadRun>(), "flow"), id, other);
        _compare = new CompareState("flow", older, newer, mode);
        _compareView = null;
        _reader.Pick = null;
        _reader.Refresh();
    }

    /// <summary>
    /// Two runs side by side: <paramref name="id"/> is the one the Performance panel showed, <paramref name="other"/> the one picked to go with it, the one that holds the tag second. The
    /// panel leaves, as the comparison has one of its own for each run. A run that is not there doesn't open, and says so.
    /// </summary>
    internal void OpenRuns(string id, string other, string mode = "side")
    {
        DropPicker();
        _nav.Perf.CloseRunPicker();
        if (_reader.Folder is not { } folder || _reader.Editing) return;
        if (CompareChoices.FromAddress(folder.Model, RunMap, "run", id, other) is { } notice)
        {
            _reader.ShowNotice(notice, 4);
            return;
        }
        _reader.DidSomethingElse();
        _reader.LeavePerformance(); // the Performance tab gives way, and a ramp stops with it
        _reader.StopAutoplay(); // nor does a flow play behind the panes
        var (older, newer) = CompareChoices.RunPairOf(RunMap, id, other);
        _compare = new CompareState("run", older, newer, mode);
        _compareView = null;
        _compareStart = null;
        _reader.Pick = null;
        _reader.Refresh();
    }

    /// <summary>
    /// Ends the comparison. What it showed was clicked in a pane, so the panel goes with it. Close, Esc and C come here with a redraw, and a note that isn't saved asks first (see
    /// <see cref="UnlessDraft"/>); one more of them while it asks is a Keep. The ways that end it for the reader's own work (a level, edit mode, another flow) ask before they come here.
    /// </summary>
    internal void Close(bool redraw = true)
    {
        if (redraw && _compare is not null)
        {
            if (_ask is not null)
            {
                KeepNote();
                return;
            }
            if (UnlessDraft(() => Close())) return;
        }
        DropAsk();
        DropUnlinkAsk();
        DropPicker();
        if (_compare is null) return;
        _compareView?.StopRamps(); // a ramp ends with its comparison
        _compareView?.StopPlayback(); // and so does an Autoplay: the panes are detached, but their timers would go on stepping
        _compare = null;
        _compareView = null;
        _host.Child = null;
        _compareStart = null;
        _reader.Pick = null; // what the Details panel showed was clicked in a pane
        if (!redraw) return;
        _reader.Refresh();
        _reader.TakeFocus();
    }

    /// <summary>
    /// C: close the comparison, or open it beside the flow playing (or the run the Performance panel shows), with the first one it is linked to or else the picker. A comparison that waits
    /// behind the Performance tab is not the one on screen: C there is for the run.
    /// </summary>
    internal void Toggle()
    {
        if (_compare is not null && !_reader.PerfOpen)
        {
            Close();
            return;
        }
        if (_reader.Folder is not { } folder) return;
        if (_reader.PerfOpen)
        {
            if (CompareChoices.RunOff(RunMap, _reader.Editing) is { } blocked)
            {
                _reader.ShowNotice(blocked, 4);
                return;
            }
            var runId = PerfView.ActiveRun(folder.Runs!, _perf.RunId);
            if (CompareChoices.FirstLinkedRun(RunMap, runId) is { } linked) OpenRuns(runId, linked);
            else _nav.Perf.TogglePicker("compare");
            return;
        }
        if (CompareChoices.Off(folder.Model, _reader.Editing) is { } off)
        {
            _reader.ShowNotice(off, 4);
            return;
        }
        if (_reader.Playing is not { } playing) return;
        if (CompareChoices.FirstLinked(folder.Model, playing.Flow) is { } other) Open(playing.Flow, other);
        else TogglePicker(playing.Flow);
    }

    private void Flip()
    {
        if (_compare is not { } state) return;
        _compare = state with { A = state.B, B = state.A };
        _reader.Refresh();
    }

    /// <summary>Side by side or Swap, from the bar. It is part of the comparison's state, so a reload or Swap sides keeps it.</summary>
    private void SetMode(string mode)
    {
        if (_compare is not { } state || state.Mode == mode) return;
        _compare = state with { Mode = mode };
        _reader.Refresh();
    }

    /// <summary>
    /// Swap: puts the other flow on show (X), or the one that reads first or second in the bar (<paramref name="reads"/> 0 or 1). The Details panel stays open if its shape is in the
    /// flow that comes on, and closes if it is not.
    /// </summary>
    internal void Swap(int? reads = null)
    {
        if (!Showing || _compare is not { Mode: "swap" } state) return;
        if (state.Kind == "run")
        {
            // Two runs: the same level on one canvas, so what the Details panel shows is on it whichever run is on show, and it stays open.
            if (_compareView?.RunStage is not { } runStage) return;
            _reader.Interacted();
            if (reads is { } which) runStage.SwapTo(CompareView.KeysOf(state)[which]);
            else runStage.Swap();
            _reader.Refresh();
            _reader.TakeFocus();
            return;
        }
        if (_compareView?.Stage is not { } stage) return;
        _reader.Interacted();
        if (reads is { } side) stage.SwapTo(CompareView.KeysOf(state)[side]);
        else stage.Swap();
        if (_reader.Pick is { } shown && !stage.Holds(shown)) _reader.CloseDetails();
        else
        {
            _reader.Refresh();
            _reader.TakeFocus();
        }
    }

    private CompareView BuildView()
    {
        var view = new CompareView();
        view.Picked += Picked;
        view.EmptyClicked += _reader.PaneClicked; // as on the single canvas, a click on nothing closes the panel
        view.Bar.Closed += () => Close();
        view.Bar.Flipped += Flip;
        view.Bar.ModePicked += SetMode;
        view.Bar.FlowPicked += reads => Swap(reads);
        view.Bar.ChangesToggled += () => SetShowChanges(!ShowChanges);
        view.ControlUsed += () => _reader.TakeFocus(); // a control in a run's panel took the keyboard: give it back, so the keys work
        view.Note.DraftChanged += text =>
        {
            if (_compare is null) return;
            if (text is null) _drafts.Remove(PairNow);
            else _drafts[PairNow] = (text, SavedNote());
        };
        view.Note.Save = SaveNoteAsync;
        view.Note.Flipped += Flip;
        view.Note.Left += () =>
        {
            if (_ask is not null) KeepNote(); // the question is the innermost layer
            else _reader.TakeFocus(); // the keys are the reader's again; a second Esc closes the comparison
        };
        _host.Child = view;
        return view;
    }

    // ---- change marks and the note ---------------------------------------------------------------------------------

    /// <summary>Show changes, from the bar: the app remembers it for the next window.</summary>
    internal void SetShowChanges(bool on)
    {
        if (ShowChanges == on) return;
        ShowChanges = on;
        ChangesPicked?.Invoke(on);
        _reader.Refresh();
    }

    /// <summary>The pair on show, as the draft is keyed: the same whichever way round the sides are.</summary>
    private string PairNow => _compare is { } c ? $"{c.Kind}:{CompareUi.PairKey(c.A, c.B)}" : "";

    /// <summary>Every flow's (or, for two runs, every run's) raw <c>compare</c> tag.</summary>
    private IReadOnlyDictionary<string, object?> TagsNow() => CompareChoices.TagsOf(_reader.Folder!.Model, RunMap, _compare?.Kind ?? "flow");

    /// <summary>The note the pair on show holds now, or "" when it holds none.</summary>
    private string SavedNote() => _compare is { } c && _reader.Folder is not null ? CompareUi.NoteOf(TagsNow(), c.A, c.B).Text : "";

    /// <summary>Whether leaving the comparison would lose a note: the editor holds text that is not what the pair holds.</summary>
    private bool NoteDirty => _compare is not null && _drafts.TryGetValue(PairNow, out var draft) && CompareUi.Unsaved(draft.Text, SavedNote());

    /// <summary>Whether some pair, not just the one on show, holds a note that differs from what the pair held: leaving the folder or the window would lose it.</summary>
    internal bool HoldsUnsavedNote => _drafts.Values.Any(d => CompareUi.Unsaved(d.Text, d.Saved));

    /// <summary>Whether a note is held for any pair at all.</summary>
    internal bool HoldsNote => _drafts.Count > 0;

    /// <summary>The text of the draft held for the pair on show, or null.</summary>
    internal string? NoteDraftNow => _compare is not null && _drafts.TryGetValue(PairNow, out var draft) ? draft.Text : null;

    /// <summary>The text of the note held for the pair <paramref name="a"/>, <paramref name="b"/> of <paramref name="kind"/>, whichever way round, or null.</summary>
    internal string? NoteDraftFor(string kind, string a, string b) => _drafts.TryGetValue($"{kind}:{CompareUi.PairKey(a, b)}", out var draft) ? draft.Text : null;

    /// <summary>
    /// Runs nothing, but a note that isn't saved asks first: <paramref name="leave"/> waits for Discard (Keep stays where it is). True when it asked, and a caller must stop; false when there was
    /// nothing to lose, and the caller goes on. It is about the pair on show: Discard drops its note and keeps the other pairs'.
    /// </summary>
    internal bool UnlessDraft(Action leave) => AskFirst(NoteDirty, false, leave);

    /// <summary>
    /// As <see cref="UnlessDraft"/>, for leaving the folder or the window, which loses every pair's note: it asks when any pair holds one, and Discard drops them all. The question names no pair.
    /// </summary>
    internal bool UnlessNotesKept(Action leave) => AskFirst(HoldsUnsavedNote, true, leave);

    private bool AskFirst(bool toLose, bool all, Action leave)
    {
        if (!toLose) return false;
        DropAsk();
        _afterDiscard = leave;
        _discardAll = all;
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
        _discardAll = false;
    }

    /// <summary>Discard: the note goes (the pair on show's, or every pair's when the question is about leaving), and what was asked for goes ahead.</summary>
    private void DiscardNote()
    {
        var leave = _afterDiscard;
        if (_discardAll) _drafts.Clear();
        else _drafts.Remove(PairNow);
        DropAsk();
        leave?.Invoke();
    }

    /// <summary>Keep: the note stays in its editor, and so does the comparison.</summary>
    private void KeepNote()
    {
        DropAsk();
        _reader.TakeFocus();
    }

    /// <summary>
    /// Writes the tag (and its note) onto the flow in its own file, as one edit that can be undone. For two runs it goes onto the run's own file instead, in place and with nothing else of the
    /// file touched (see <see cref="IReader.WriteRunTagAsync"/>). True once it is saved and on screen; a refusal has been said in a notice.
    /// </summary>
    private Task<bool> SaveNoteAsync(string id, CompareTag tag) => _compare is { Kind: "run" } ? _reader.WriteRunTagAsync(id, tag) : _reader.RunAsync(d => EditOps.SetCompare(d, id, tag));

    /// <summary>What the note strip is told: the tags, the names, the pair as it reads, why it can't be written, and the draft held for this pair.</summary>
    private NoteInput NoteInputFor(Folder folder, CompareState state)
    {
        string NameOf(string id) =>
            state.Kind == "run" ? (folder.Runs is { } runs && runs.TryGetValue(id, out var run) && !string.IsNullOrEmpty(run.Name) ? run.Name : id)
            : folder.Model.Flows.TryGetValue(id, out var flow) && !string.IsNullOrEmpty(flow.Name) ? flow.Name : id;
        return new NoteInput(TagsNow(), NameOf, state.A, state.B, _reader.SaveOff, _drafts.TryGetValue(PairNow, out var draft) ? draft.Text : null, state.Kind);
    }

    // ---- the link of a run -----------------------------------------------------------------------------------------

    /// <summary>
    /// Link with, Unlink: run <paramref name="id"/> is linked to <paramref name="other"/> (the older), or its link is taken away when that is null. A run's note belongs to its link, so one that
    /// would go with it asks first.
    /// </summary>
    private void LinkRun(string id, string? other)
    {
        if (_reader.Folder is null || !RunMap.TryGetValue(id, out var run)) return;
        if (_reader.SaveOff is { } off)
        {
            _reader.ShowNotice(off, 4);
            return;
        }
        var was = run.Compare;
        if (was?.With == other || (was is null && other is null)) return; // nothing to change
        Action write = () => _ = _reader.WriteRunTagAsync(id, other is null ? null : new CompareTag(other));
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
            _reader.TakeFocus();
        }, KeepLink, "Remove the link and its note", "Remove", "Take away the link and the note it holds", "Keep the link (Esc)");
        _overlay.Children.Add(_unlinkAsk);
    }

    /// <summary>Keep: the link and its note stay.</summary>
    private void KeepLink()
    {
        DropUnlinkAsk();
        _reader.TakeFocus();
    }

    private void DropUnlinkAsk()
    {
        if (_unlinkAsk is null) return;
        _overlay.Children.Remove(_unlinkAsk);
        _unlinkAsk = null;
        _afterUnlink = null;
    }

    /// <summary>Opens the confirm of Save as pair, which names the flow that gets the line (--pair, for a picture).</summary>
    internal void AskToPair() => _compareView?.Note.AskToPair();

    /// <summary>Puts text in the note editor of the pair on show, as if it had been typed (--note, for a picture).</summary>
    internal void PrefillNote(string text)
    {
        if (_compare is null) return;
        _drafts[PairNow] = (text, SavedNote());
        _reader.Refresh();
    }

    /// <summary>A box or a line was clicked in a pane: its panel shows in Details, and a second click on what the panel shows closes it.</summary>
    internal void Picked(string pane, ReaderView.Side picked)
    {
        _reader.Interacted();
        if (_compareView is not { } view) return;
        view.FocusPane(pane);
        if (view.Last == pane && _reader.Pick == picked)
        {
            _reader.CloseDetails();
            return;
        }
        view.Last = pane;
        _reader.Pick = picked;
        _reader.Refresh();
    }

    /// <summary>A change on disk took one of the flows away, or left it unable to play (or took one of the runs away): the comparison ends, as in the browser.</summary>
    internal void CloseIfBroken(Folder folder)
    {
        if (_compare is not { } state) return;
        var open = state.Kind == "run"
            ? CompareChoices.Openable(RunDrawing.MapOf(folder.Runs), state.A) && CompareChoices.Openable(RunDrawing.MapOf(folder.Runs), state.B)
            : CompareChoices.Playable(folder.Model, state.A) && CompareChoices.Playable(folder.Model, state.B);
        if (!open) Close(false);
    }

    /// <summary>Draws the comparison, when it is on screen.</summary>
    internal void Refresh(Folder folder)
    {
        if (!Showing || _compare is not { } now)
        {
            _compareView?.StopRamps(); // another tab is in front of it: a ramp stops with it
            return;
        }
        _compareView ??= BuildView();
        _compareView.Show(now, folder, _reader.LineStyle, _reader.Pick, _compareStart, ShowChanges, _reader.CurrentView);
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
        if (_reader.Folder is not { } folder) return;
        _pickerFlow = flow;
        _picker = new ComparePicker(folder.Model, flow, other => Open(flow, other), ClosePicker);
        _player.Picker = _picker;
    }

    /// <summary>
    /// The Compare button on a flow's row (Flows tab or Explorer): the comparison of that flow with the first one it is linked to that is there, else the same flyout the player's button opens, hosted
    /// under the navigator's tabs. A second press on the same row's button closes the flyout; on another row's, it moves there. Nothing opens while editing (the button is greyed out then).
    /// </summary>
    internal void FromRow(string flow)
    {
        if (_reader.Folder is not { } folder || CompareChoices.Off(folder.Model, _reader.Editing) is not null || !folder.Model.Flows.Contains(flow)) return;
        if (_picker is not null && _pickerOnRow && _pickerFlow == flow)
        {
            ClosePicker();
            return;
        }
        DropPicker();
        if (CompareChoices.FirstLinked(folder.Model, flow) is { } other)
        {
            Open(flow, other);
            return;
        }
        _pickerFlow = flow;
        _pickerOnRow = true;
        _picker = new ComparePicker(folder.Model, flow, partner => Open(flow, partner), ClosePicker);
        _nav.Picker = _picker;
    }

    /// <summary>Takes the flyout away and gives the keys back to the reader.</summary>
    internal void ClosePicker()
    {
        if (_picker is null) return;
        DropPicker();
        _reader.TakeFocus();
    }

    /// <summary>Takes the flyout away, wherever the keyboard focus is going next.</summary>
    internal void DropPicker()
    {
        if (_picker is null) return;
        _picker = null;
        _pickerFlow = null;
        _pickerOnRow = false;
        _player.Picker = null;
        _nav.Picker = null;
    }

    /// <summary>A press anywhere but on the flyout or a button that opens it (the player's, or one on a row, which decides for itself) closes the flyout.</summary>
    internal void PressedOutsidePicker(object? source)
    {
        if (_picker is null || source is not Visual pressed) return;
        bool Inside(Control owner) => ReferenceEquals(pressed, owner) || pressed.GetVisualAncestors().Contains(owner);
        if (Inside(_picker) || (_player.CompareButton is { } button && Inside(button))) return;
        if (pressed.GetSelfAndVisualAncestors().OfType<Button>().Any(b => b.Classes.Contains("rowcompare"))) return;
        ClosePicker();
    }
}
