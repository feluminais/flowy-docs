using Avalonia.Controls;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

// Edit mode as the reader shows it: the switch in the bar (and E), the tools beside it, and what the line picker does. The mode and its files are EditMode, and what the reader does with the canvas while editing is EditGestures.
internal sealed partial class ReaderView
{
    private readonly EditMode _edit;
    private readonly EditGestures _gestures;
    private readonly Button _editButton = new();
    private readonly Button _addButton = new();
    private readonly Button _newFlowButton = new();
    private readonly Button _undoButton = new();
    private readonly Button _redoButton = new();
    private readonly Button _tidyButton = new();
    private readonly StackPanel _editTools = new() { Orientation = Avalonia.Layout.Orientation.Horizontal, Spacing = 2, IsVisible = false, VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center };

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

    private void BuildEditBar()
    {
        // Undo and redo are only their arrows; the rest say what they do.
        void Make(Button button, string icon, string? text, string name, string tip, Action click)
        {
            button.Classes.Add("tool");
            Chrome.Fill(button, icon, text, name);
            ToolTip.SetTip(button, tip);
            button.Click += (_, _) => click();
        }
        Make(_editButton, Icons.Pencil, "Edit", "Edit", "Edit mode (E)", () => SetEditing(!Editing));
        Make(_addButton, Icons.Plus, "Add", "Add", "Add a shape here (N)", _gestures.OpenAdd);
        Make(_newFlowButton, Icons.Route, "New flow", "New flow", "Record a flow", _gestures.NewFlow);
        Make(_undoButton, Icons.Undo, null, "Undo", "Undo the last change (Ctrl+Z)", () => _ = UndoAsync());
        Make(_redoButton, Icons.Redo, null, "Redo", "Redo what you undid (Ctrl+Y or Ctrl+Shift+Z)", () => _ = RedoAsync());
        Make(_tidyButton, Icons.Grid, "Tidy", "Tidy", "Lay this view out again", () => _ = TidyAsync());
        foreach (var b in new[] { _newFlowButton, _addButton, _undoButton, _redoButton, _tidyButton }) _editTools.Children.Add(b);
    }

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
        _editTools.IsVisible = Editing;
        _pickedBar.Show(Editing && _side is Side.Boxes picked ? picked.Ids.Count : 0);
        _canvas.Editable = Editing && _side is not Side.Flow;
        _editButton.IsEnabled = Editing || !ReadOnly;
        if (Editing) _editButton.Classes.Add("pressed");
        else _editButton.Classes.Remove("pressed");
        _undoButton.IsEnabled = _edit.CanUndo;
        _redoButton.IsEnabled = _edit.CanRedo;
        UpdateEmpty();
    }

    /// <summary>The line picker. Reading, it changes only this screen; editing, it changes the project's own style. Its list never changes: a pick redraws from inside its own SelectionChanged, and clearing its items there throws.</summary>
    private void SyncLinePicker(Model model)
    {
        var style = Editing ? model.LineStyle : _ownLines ?? model.LineStyle;
        _linePicker.SelectedIndex = style switch { "curved" => 1, "angled" => 2, _ => 0 };
        ToolTip.SetTip(_linePicker, Editing ? "How lines look for everyone (saved in model.yaml)" : "How lines look on this screen");
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

    internal bool EditToolsVisible => _editTools.IsVisible;

    internal bool CanUndo => _edit.CanUndo;

    internal bool CanUndoMove => _edit.UndoMove;

    /// <summary>The boxes picked now, for tests: the open box, or the several in the panel.</summary>
    internal IReadOnlyList<string> PickedNow => _gestures.PickedBoxes();

    /// <summary>The bar that says how many boxes are picked, and has Delete.</summary>
    internal PickedBar Picked => _pickedBar;

    internal bool CanRedo => _edit.CanRedo;

    internal string? NoticeText => _notice?.Text;

    internal ComboBox LinePicker => _linePicker;

    internal Recording? RecordingNow => Recording;

    internal Task TidyForTestAsync() => TidyAsync();
}
