using Flowy.Core;

namespace Flowy.App;

internal sealed partial class ReaderView
{
    private readonly CompareMode _compareMode;

    /// <summary>Whether Show changes is on: the panes mark what differs between the flows. It is the reader's, kept between runs.</summary>
    internal bool ShowChanges
    {
        get => _compareMode.ShowChanges;
        set => _compareMode.ShowChanges = value;
    }

    /// <summary>The reader turned Show changes on or off: the app keeps it for the next window.</summary>
    public event Action<bool>? ChangesPicked;

    private bool Comparing => _compareMode.Showing;

    private bool ComparingFlows => _compareMode.ShowingFlows;

    private bool ComparingRuns => _compareMode.ShowingRuns;

    /// <summary>Draws the comparison, and puts it in the canvas's place (or the canvas back in its own).</summary>
    private void RefreshCompare(Folder folder)
    {
        var on = Comparing;
        _compareHost.IsVisible = on;
        _motionHost.IsVisible = !on;
        if (_zoomButtons is not null) _zoomButtons.IsVisible = !on;
        _compareMode.Refresh(folder);
    }

    /// <summary>
    /// Runs nothing, but a note that isn't saved asks first: <paramref name="leave"/> waits for Discard (Keep stays where it is). True when it asked, and a caller must stop; false when there was
    /// nothing to lose, and the caller goes on. It is about the pair on show.
    /// </summary>
    private bool UnlessDraft(Action leave) => _compareMode.UnlessDraft(leave);

    private void CloseCompare(bool redraw = true) => _compareMode.Close(redraw);

    /// <summary>Whether some pair holds a note that differs from what the pair held: leaving the folder or the window would lose it.</summary>
    internal bool HoldsUnsavedNote => _compareMode.HoldsUnsavedNote;

    /// <summary>As <see cref="UnlessDraft"/>, for leaving the folder or the window, which loses every pair's note.</summary>
    internal bool UnlessNotesKept(Action leave) => _compareMode.UnlessNotesKept(leave);

    /// <summary>Show changes, from the bar: the app remembers it for the next window.</summary>
    internal void SetShowChanges(bool on) => _compareMode.SetShowChanges(on);

    /// <summary>Two flows side by side: <paramref name="id"/> is the one that was playing (or picked on a row), <paramref name="other"/> the one picked to go with it.</summary>
    internal void OpenCompare(string id, string other, string mode = "side") => _compareMode.Open(id, other, mode);

    /// <summary>Two runs side by side: <paramref name="id"/> is the one the Performance panel showed, <paramref name="other"/> the one picked to go with it.</summary>
    internal void OpenRunCompare(string id, string other, string mode = "side") => _compareMode.OpenRuns(id, other, mode);

    /// <summary>Opens the confirm of Save as pair, which names the flow that gets the line (--pair, for a picture).</summary>
    public void AskToPair() => _compareMode.AskToPair();

    /// <summary>Tries to close the comparison as Close does: a note that isn't saved asks first (--leave, for a picture).</summary>
    public void TryCloseCompare() => _compareMode.Close();

    /// <summary>Puts text in the note editor of the pair on show, as if it had been typed (--note, for a picture).</summary>
    public void PrefillNote(string text) => _compareMode.PrefillNote(text);

    /// <summary>A box or a line was clicked in a pane: its panel shows in Details, and a second click on what the panel shows closes it.</summary>
    internal void ComparePicked(string pane, Side picked) => _compareMode.Picked(pane, picked);

    /// <summary>
    /// Opens a comparison of two flows by id, for a picture (--compare). A pair that holds a tag reads with the one that holds it second. With <paramref name="swap"/> it opens in
    /// Swap, on the flow that reads first, or on the other one with <paramref name="swapped"/>.
    /// </summary>
    public void OpenCompareById(string id, string other, bool swap = false, bool swapped = false)
    {
        OpenCompare(id, other, swap ? "swap" : "side");
        if (swap && swapped) _compareMode.Swap();
    }

    /// <summary>
    /// Opens a comparison of two runs by id, for a picture (<c>--compare run:a,b</c>). A pair that holds a tag reads with the one that holds it second. With <paramref name="swap"/> it opens in
    /// Swap, on the run that reads first, or on the other one with <paramref name="swapped"/>. A run that is not there says so in a notice and opens nothing.
    /// </summary>
    public void OpenRunCompareById(string id, string other, bool swap = false, bool swapped = false)
    {
        OpenRunCompare(id, other, swap ? "swap" : "side");
        if (swap && swapped) _compareMode.Swap();
    }

    // What a test can look at.
    internal CompareState? CompareNow => _compareMode.State;

    internal CompareView? CompareShown => _compareMode.View is not null && Comparing ? _compareMode.View : null;

    internal ComparePicker? PickerShown => _compareMode.Picker;

    /// <summary>The flow whose Compare button opened the flyout that is open, and whether it hangs on a row of the navigator (for tests).</summary>
    internal (string? Flow, bool OnRow) PickerFor => _compareMode.PickerFor;

    /// <summary>The Compare button on a flow's row, as a press on it does (for tests).</summary>
    internal void CompareRow(string flow) => _compareMode.FromRow(flow);

    /// <summary>The text of the draft held for the pair on show, or null (for tests).</summary>
    internal string? NoteDraftNow => _compareMode.NoteDraftNow;

    /// <summary>Whether a note is held for any pair at all (for tests).</summary>
    internal bool HoldsNote => _compareMode.HoldsNote;

    /// <summary>The text of the note held for the pair <paramref name="a"/>, <paramref name="b"/> of <paramref name="kind"/>, whichever way round, or null (for tests).</summary>
    internal string? NoteDraftFor(string kind, string a, string b) => _compareMode.NoteDraftFor(kind, a, b);

    /// <summary>The question "Discard the note?", while it is asked (for tests).</summary>
    internal DraftAsk? AskShown => _compareMode.Ask;

    internal void ToggleCompareKey() => _compareMode.Toggle();

    /// <summary>The question "Remove the link and its note", while it is asked (for tests).</summary>
    internal DraftAsk? UnlinkAskShown => _compareMode.UnlinkAsk;
}
