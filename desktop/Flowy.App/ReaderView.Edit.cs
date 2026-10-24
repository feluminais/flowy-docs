using Avalonia.Controls;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

// Edit mode as the reader routes it: the switch in the bar (and E), Tidy, and what a redraw shows for it. The mode and its files are EditMode, and what the reader does with the canvas while editing is EditGestures.
internal sealed partial class ReaderView
{
    private readonly EditMode _edit;
    private readonly EditGestures _gestures;

    private void DidSomethingElse() => _edit.DidSomethingElse();

    /// <summary>False for a model that must not be written, such as the sample that ships inside the app.</summary>
    public bool CanEdit
    {
        get => _edit.CanEdit;
        set => _edit.CanEdit = value;
    }

    /// <summary>Whether edit mode is on. It is off whenever the folder can't be changed: nothing loaded, a file that can't be read, or a model that is only for reading.</summary>
    public bool Editing => _edit.Editing;

    private bool ReadOnly => _edit.ReadOnly;

    /// <summary>The flow being recorded or edited, while edit mode is on.</summary>
    private Recording? Recording => _gestures.Recording;

    /// <summary>Turns edit mode on or off. Off when the model can't be changed now.</summary>
    public void SetEditing(bool on)
    {
        if (on && ReadOnly) return;
        if (_edit.On == on) return;
        if (on && _compareMode.State is not null && UnlessDraft(() => SetEditing(true))) return; // editing ends the comparison: a note that isn't saved asks first
        _edit.On = on;
        CloseCompare(false); // nor does a comparison: it shows the flows as they are
        _perf.StopRamp(); // editing and the numbers of the Performance panel don't mix: they would sit on a model that is changing, so the tab lists the runs to link instead
        DismissNotice();
        _playback.Head = null;
        if (!on && _side is Side.Add or Side.Flow or Side.Boxes) _side = null;
        Refresh();
    }

    /// <summary>What the bar shows for edit mode, after every redraw.</summary>
    private void RefreshEdit()
    {
        _bar.ShowEdit(Editing, Editing || !ReadOnly, _edit.CanUndo, _edit.CanRedo);
        _pickedBar.Show(Editing && _side is Side.Boxes picked ? picked.Ids.Count : 0);
        _canvas.Editable = Editing && _side is not Side.Flow;
        UpdateEmpty();
    }

    private async Task TidyAsync()
    {
        var view = CurrentView();
        if (await RunAsync(d => EditOps.TidyLayout(d, view)))
        {
            _fitKey = ""; // the camera fits the new layout
            Refresh();
        }
    }

    public void OpenAddPanel() => _gestures.OpenAdd();

    /// <summary>Opens a flow in the recorder (edit mode only).</summary>
    public void OpenFlowEditor(string id)
    {
        if (Editing) _gestures.EditFlow(id);
    }

    /// <summary>Presses Remove in the flow form's Compare with, which asks first when the link holds a note (--remove-link, for a picture).</summary>
    public void AskToRemoveFlowLink() => _panel.CurrentRecorder?.PartnerPicker?.AskToRemove();

    /// <summary>One edit. Resolves to true once it is saved and on screen; a refusal is said in a notice and changes nothing.</summary>
    internal Task<bool> RunAsync(Func<EditDoc, EditDoc> op) => _edit.RunAsync(op);

    /// <summary>What a test calls: the same as the forms do.</summary>
    internal Task<bool> EditAsync(Func<EditDoc, EditDoc> op) => RunAsync(op);

    internal Task UndoAsync() => _edit.UndoAsync();

    internal Task RedoAsync() => _edit.RedoAsync();

    /// <summary>Deletes shapes or lines; <paramref name="then"/> runs once they are gone (see <see cref="EditGestures.AskDelete"/>).</summary>
    internal void AskDelete(IReadOnlyList<Target> targets, Action? then = null) => _gestures.AskDelete(targets, then);

    internal Task AskDeleteAsync(IReadOnlyList<Target> targets, Action? then = null) => _gestures.AskDeleteAsync(targets, then);

    internal Task DeleteSelectedAsync() => _gestures.DeleteSelectedAsync();

    /// <summary>For a test: called between reading a run file and writing its tag, so a change made in that moment is felt as the file changing under the write.</summary>
    internal Action? BeforeRunWrite
    {
        get => _edit.BeforeRunWrite;
        set => _edit.BeforeRunWrite = value;
    }

    /// <summary>Writes the tag of a run as Link with and a note do (for tests).</summary>
    internal Task<bool> WriteRunTagForTest(string id, CompareTag? tag) => _edit.WriteRunTagAsync(id, tag);

    // What a test can look at.
    internal Notice? NoticeNow => _notice;

    internal UsedByPanel? UsedByNow => _panel.CurrentUsedBy;

    internal SidePanel Panel => _panel;

    internal bool EditToolsVisible => _bar.EditToolsVisible;

    internal bool CanUndo => _edit.CanUndo;

    internal bool CanUndoMove => _edit.UndoMove;

    /// <summary>The boxes picked now, for tests: the open box, or the several in the panel.</summary>
    internal IReadOnlyList<string> PickedNow => _gestures.PickedBoxes();

    /// <summary>The bar that says how many boxes are picked, and has Delete.</summary>
    internal PickedBar Picked => _pickedBar;

    internal bool CanRedo => _edit.CanRedo;

    internal string? NoticeText => _notice?.Text;

    internal ComboBox LinePicker => _bar.LinePicker;

    internal Recording? RecordingNow => Recording;

    internal Task TidyForTestAsync() => TidyAsync();
}
