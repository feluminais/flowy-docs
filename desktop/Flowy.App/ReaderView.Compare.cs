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

    /// <summary>Ends the comparison. What it showed was clicked in a pane, so the panel goes with it.</summary>
    private void CloseCompare(bool redraw = true)
    {
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
        _compareHost.Child = view;
        return view;
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
        _compareView.Show(now, folder, LineStyle, _side, _compareStart);
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
