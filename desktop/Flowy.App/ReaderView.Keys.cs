using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.VisualTree;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

// The keys: what the reader looks like when one is pressed (KeyState), and what each can do (KeyActions). Which key does what is in KeyMap.
internal sealed partial class ReaderView
{
    private IKeyActions? _keyActions;

    private bool InNavigator(object? source) => _nav.IsVisible && source is Visual v && (ReferenceEquals(v, _nav) || v.GetVisualAncestors().Contains(_nav));

    /// <summary>A click in the navigator makes Escape close it. A click anywhere else (the diagram, Details) makes Escape leave it alone, and takes the keyboard out of it.</summary>
    private void OnPointerDown(object? sender, PointerPressedEventArgs e)
    {
        var inside = InNavigator(e.Source);
        PressedOutsidePicker(e.Source);
        _perfPanel.PressedOutside(e.Source);
        _nav.RunLinks.PressedOutside(e.Source);
        _navUsed = inside;
        if (!inside && InNavigator(TopLevel.GetTopLevel(this)?.FocusManager?.GetFocusedElement())) Focus();
    }

    /// <summary>What the keys' conditions ask about, as the reader is now. <paramref name="inNavigator"/>: the press came from inside the navigator.</summary>
    private KeyState KeyStateNow(bool inNavigator) => new(
        Editing, ReadOnly, _undoMove, _search is not null, _shortcuts is not null, _side is Side.Boxes, Recording is not null,
        PlayingFlow() is not null, Comparing, Comparing && _compare is { Mode: "swap" }, ComparingRuns, PerfOpen, LoadTest is not null, FailuresOpen, ShowFlows, CanPerf, CanFailures,
        ShownTab is not null, _navUsed, inNavigator, RightOpen, CurrentView() != Names.Root, ComparingFlows && _compareView is { } view && view.Target.Inside);

    private void OnKeyDown(object? sender, KeyEventArgs e)
    {
        if (_folder is null) return;
        if (_ask is not null && e.Key == Key.Escape)
        {
            KeepNote(); // the question is the innermost layer, and Esc answers it with Keep
            e.Handled = true;
            return;
        }
        if (_unlinkAsk is not null && e.Key == Key.Escape)
        {
            KeepLink(); // the same, for the question about a link and its note
            e.Handled = true;
            return;
        }
        var inNavigator = InNavigator(e.Source);
        if (e.Source is TextBox field)
        {
            // A field keeps its keys. The navigator's filters give up Escape once they are empty, so it closes with a click in one.
            if (e.Key != Key.Escape || !inNavigator) return;
            if (!string.IsNullOrEmpty(field.Text))
            {
                field.Text = "";
                e.Handled = true;
                return;
            }
        }
        if (_nav.Explorer.Holds(e.Source) && e.Key != Key.Escape) return; // the tree has its own keys, and a letter typed in it goes to its filter
        if (KeyMap.Dispatch(KeyPress.Of(e), KeyStateNow(inNavigator), _keyActions ??= new KeyActions(this))) e.Handled = true;
    }

    /// <summary>What the keys of the Performance panel act on while two runs are compared: the pane with the focus, or the run on show in Swap. Null otherwise.</summary>
    private IRunKeys? RunKeys => ComparingRuns && _compareView is { } view ? view.RunTarget : null;

    /// <summary>Up a level on purpose (Z, Backspace, the breadcrumb): Esc has nothing to go back to from there.</summary>
    private void Up()
    {
        if (ComparingFlows && _compareView is { } view)
        {
            view.Target.Up(); // a pane of a comparison goes up from where it is zoomed to
            return;
        }
        if (_folder is { } folder) JumpTo(Views.ParentOf(folder.Model, CurrentView()));
    }

    /// <summary>Esc: back to the level the reader came from, or up a level when they did not come from one.</summary>
    private void Back()
    {
        if (ComparingFlows && _compareView is { } view)
        {
            view.Target.Up();
            return;
        }
        if (_folder is not { } folder) return;
        var here = CurrentView();
        var came = Levels.CameBack(_levels, here, id => id == Names.Root || CanOpen(id));
        var to = came ?? Views.ParentOf(folder.Model, here);
        _arriving = (to, came is not null);
        ZoomOut(to);
    }

    /// <summary>The box with keyboard focus (Tab moves it), else the one whose panel is open: in if it opens, else its panel. False when there is none.</summary>
    private bool EnterBox()
    {
        var id = (TopLevel.GetTopLevel(this)?.FocusManager?.GetFocusedElement() as BoxControl)?.Id ?? SelectedBox;
        if (id is null) return false;
        if (CanOpen(id)) ZoomInto(id);
        else OpenObject(id);
        return true;
    }

    /// <summary>What the keys do, on the reader as it is now.</summary>
    private sealed class KeyActions(ReaderView r) : IKeyActions
    {
        public void CloseSearch() => r.CloseSearch(true);

        public bool CancelGesture() => r._canvas.CancelGesture();

        public void TakeBackDrag()
        {
            r.DidSomethingElse();
            _ = r.UndoAsync();
        }

        public bool ResetPick() => r.ResetPick();

        public void ClearPicked() => r.ClearPicked();

        public void CloseShortcuts() => r.ShowShortcuts(false);

        public void CloseNavigator() => r.CloseNav();

        public void StopFlow()
        {
            if (r._picker is not null) r.ClosePicker(); // the Compare flyout is the innermost layer over the flow
            else r.Stop();
        }

        public void ClosePanel() => r.CloseDetails();

        public void CloseCompare() => r.CloseCompare();

        public void SwapCompare() => r.SwapCompare();

        public void ToggleCompare() => r.ToggleCompare();

        public void Back() => r.Back();

        public void Up() => r.Up();

        public void ToggleEdit() => r.SetEditing(!r.Editing);

        public void Add() => r.OpenAdd();

        public void Delete() => _ = r.DeleteSelectedAsync();

        public void SelectAll() => r.PickAll();

        public void Undo() => _ = r.UndoAsync();

        public void Redo() => _ = r.RedoAsync();

        // While two runs are compared the keys of the Performance panel act on the run of the pane that has the focus (or the run on show in Swap).
        public void PerfStep(int by)
        {
            if (r.RunKeys is { } runs) runs.Step(by);
            else r._perf.StepLevel(PerfView.StepFrom(r._perf.ActivePos, by));
        }

        public void PerfFirst()
        {
            if (r.RunKeys is { } runs) runs.End("first");
            else r._perf.StepLevel(0);
        }

        public void PerfLast()
        {
            if (r.RunKeys is { } runs) runs.End("last");
            else if (r.LoadTest is { } top) r._perf.StepLevel(r._perf.ActiveTop(top));
        }

        public void PerfRamp()
        {
            if (r.RunKeys is { } runs) runs.Ramp();
            else r._perf.ToggleRamp();
        }

        public bool StepFailures(Key key) => r.StepFailures(key);

        // While two flows are compared the keys of a flow act on the pane that has the focus.
        public void FlowStep(int by)
        {
            if (r._compareView is { } view && r.Comparing) view.Target.Step(by);
            else r.StepTo(r.StopIndex() + by);
        }

        public void FlowFirst()
        {
            if (r._compareView is { } view && r.Comparing) view.Target.First();
            else r.StepTo(0);
        }

        public void FlowLast()
        {
            if (r._compareView is { } view && r.Comparing) view.Target.Last();
            else if (r.PlayingFlow() is { } flow) r.StepTo(r.StopsOf(flow.Flow).Count - 1);
        }

        public void FlowPlay()
        {
            if (r._compareView is { } view && r.Comparing) view.Target.TogglePlay();
            else r._playback.ToggleAuto();
        }

        public void FlowReplay()
        {
            if (r._compareView is { } view && r.Comparing) view.Target.Replay();
            else r._playback.Replay();
        }

        public bool Enter() => r.EnterBox();

        public void ToggleShortcuts() => r.ToggleShortcuts();

        public void Search() => r.OpenSearch();

        public void Fit() => r.FitNow();

        public void ToggleTab(PanelTab tab) => r.ToggleTab(tab);

        public void TogglePerf() => r.TogglePerf();

        public void ToggleFailures() => r.ToggleFailures();
    }
}
