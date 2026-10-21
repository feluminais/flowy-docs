using Avalonia.Controls;
using Avalonia.Input;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// Edit mode: a switch in the bar (and E), then the forms in the side panel, Add, Delete, Tidy, Undo and Redo. Every change is one
/// <see cref="EditSession"/> edit on the files, which refuses what would add a problem; the reader then shows the folder as it is on disk, so what
/// is on screen is what was saved. The folder is read-only to the reader (and so editing is off) while a file can't be read.
/// </summary>
internal sealed partial class ReaderView
{
    private EditSession? _session;
    private FolderSession? _disk; // the folder on disk, read again after each edit
    private bool _editMode;
    private bool _undoMove; // the last thing done was dragging a box, and nothing has been done since
    private readonly Button _editButton = new();
    private readonly Button _addButton = new();
    private readonly Button _newFlowButton = new();
    private readonly Button _undoButton = new();
    private readonly Button _redoButton = new();
    private readonly Button _tidyButton = new();
    private readonly StackPanel _editTools = new() { Orientation = Avalonia.Layout.Orientation.Horizontal, Spacing = 2, IsVisible = false, VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center };

    /// <summary>Anything done but dragging a box ends the chance to take that drag back with Esc.</summary>
    private void DidSomethingElse() => _undoMove = false;

    /// <summary>False for a model that must not be written, such as the sample that ships inside the app.</summary>
    public bool CanEdit { get; set; } = true;

    /// <summary>Whether edit mode is on. It is off whenever the folder can't be changed: nothing loaded, a file that can't be read, or a model that is only for reading.</summary>
    public bool Editing => _editMode && !ReadOnly;

    private bool ReadOnly => _session is null || !CanEdit || _banner.IsVisible;

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
        Make(_addButton, Icons.Plus, "Add", "Add", "Add a shape here (N)", OpenAdd);
        Make(_newFlowButton, Icons.Route, "New flow", "New flow", "Record a flow", NewFlow);
        Make(_undoButton, Icons.Undo, null, "Undo", "Undo the last change (Ctrl+Z)", () => _ = UndoAsync());
        Make(_redoButton, Icons.Redo, null, "Redo", "Redo what you undid (Ctrl+Y or Ctrl+Shift+Z)", () => _ = RedoAsync());
        Make(_tidyButton, Icons.Grid, "Tidy", "Tidy", "Forget where shapes here were dragged, and lay this view out again", () => _ = TidyAsync());
        foreach (var b in new[] { _newFlowButton, _addButton, _undoButton, _redoButton, _tidyButton }) _editTools.Children.Add(b);
    }

    /// <summary>Turns edit mode on or off. Off when the model can't be changed now.</summary>
    public void SetEditing(bool on)
    {
        if (on && ReadOnly) return;
        if (_editMode == on) return;
        _editMode = on;
        LeavePerformance(); // editing and the Performance panel don't mix: the numbers would sit on a model that is changing
        if (_tab == PanelTab.Failures) _tab = null; // nor does the Failures tab: its marks would sit on a model that is changing, and it has no forms here yet
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
        _undoButton.IsEnabled = _session?.CanUndo == true;
        _redoButton.IsEnabled = _session?.CanRedo == true;
        UpdateEmpty();
    }

    /// <summary>The line picker. Reading, it changes only this screen; editing, it changes the project's own style. Its list never changes: a pick redraws from inside its own SelectionChanged, and clearing its items there throws.</summary>
    private void SyncLinePicker(Model model)
    {
        var style = Editing ? model.LineStyle : _ownLines ?? model.LineStyle;
        _linePicker.SelectedIndex = style switch { "curved" => 1, "angled" => 2, _ => 0 };
    }

    // ---- doing it ----------------------------------------------------------------------------------------------

    /// <summary>
    /// One edit. Resolves to true once it is saved and on screen. A refusal (it would add a problem, a file changed outside, a file can't be
    /// written) is said in a notice and changes nothing.
    /// </summary>
    internal async Task<bool> RunAsync(Func<EditDoc, EditDoc> op)
    {
        if (_session is not { } session || _folder is null) return false;
        DismissNotice();
        DidSomethingElse();
        EditResult result;
        try
        {
            result = await Task.Run(() => session.Apply(op));
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            result = EditResult.Refused($"Couldn't save: {e.Message}");
        }
        if (result.IsOk)
        {
            await ReloadFromDiskAsync(session.Dir);
            return true;
        }
        ShowNotice(result.Message!);
        if (result.ChangedOutside) await ReloadFromDiskAsync(session.Dir);
        return false;
    }

    /// <summary>What a test calls: the same as the forms do.</summary>
    internal Task<bool> EditAsync(Func<EditDoc, EditDoc> op) => RunAsync(op);

    private async Task ReloadFromDiskAsync(string dir)
    {
        if (_disk is { } disk && disk.Dir == dir) await disk.LoadAsync();
    }

    internal Task UndoAsync() => BackAsync(s => s.Undo(), "Undone.");

    internal Task RedoAsync() => BackAsync(s => s.Redo(), "Redone.");

    private async Task BackAsync(Func<EditSession, EditResult> step, string done)
    {
        if (_session is not { } session) return;
        DismissNotice();
        DidSomethingElse();
        var result = await Task.Run(() => step(session));
        if (result.IsOk) ShowNotice(done, 3);
        else ShowNotice(result.Message!);
        await ReloadFromDiskAsync(session.Dir);
    }

    private async Task TidyAsync()
    {
        var view = CurrentView();
        if (await RunAsync(d => EditOps.ForgetLayout(d, view)))
        {
            _fitKey = ""; // the camera fits the new layout
            Refresh();
        }
    }

    public void OpenAddPanel() => OpenAdd();

    /// <summary>Opens a flow in the recorder (edit mode only).</summary>
    public void OpenFlowEditor(string id)
    {
        if (Editing) EditFlow(id);
    }

    /// <summary>
    /// Right after a box was dragged, Esc or Backspace take the drag back, which is what someone who just moved a box and got it wrong reaches for.
    /// It is only that one move: once anything else is done (a click, another edit, a move to another level), they go up a level again.
    /// </summary>
    private bool UndoMoveKey(KeyEventArgs e)
    {
        if (!_undoMove || !Editing || _shortcuts is not null) return false;
        if (e.Key != Key.Escape && !(e.Key == Key.Back && e.KeyModifiers == KeyModifiers.None)) return false;
        DidSomethingElse();
        _ = UndoAsync();
        return true;
    }

    private void OpenAdd()
    {
        if (!Editing) return;
        DidSomethingElse();
        _side = new Side.Add();
        Refresh();
    }

    /// <summary>The flow being recorded or edited, while edit mode is on.</summary>
    private Recording? Recording => Editing && _side is Side.Flow flow ? flow.Rec : null;

    private void NewFlow()
    {
        if (!Editing) return;
        DidSomethingElse();
        _side = new Side.Flow(new Recording("", ""));
        Refresh();
    }

    private void EditFlow(string id)
    {
        if (_folder is null) return;
        _side = new Side.Flow(new Recording(id, _folder.Model.Flows.TryGetValue(id, out var f) ? f.Name ?? "" : ""));
        Refresh();
        FitNow(); // every box has to stay reachable beside the panel: they are what is clicked
    }

    private void SetRecording(Recording rec)
    {
        var starting = _side is Side.Flow { Rec.Id: "" };
        _side = new Side.Flow(rec);
        Refresh();
        if (starting) FitNow();
    }

    /// <summary>A box clicked while recording: the first starts the step, the second ends it (the same box again: a step it does on its own), a third starts over.</summary>
    private void PickBox(Recording rec, string id)
    {
        if (string.IsNullOrEmpty(rec.Id)) return; // still being named
        _side = new Side.Flow(rec.From is null || rec.To is not null ? rec with { From = id, To = null } : rec with { To = id });
        Refresh();
    }

    /// <summary>Escape while a step is half picked clears the pick, before it closes the panel.</summary>
    private bool ResetPick()
    {
        if (Recording is not { From: not null } rec) return false;
        _side = new Side.Flow(rec with { From = null, To = null });
        Refresh();
        return true;
    }

    /// <summary>What the canvas shows while recording: the flow's steps so far, and the step being picked lit.</summary>
    private static Playing RecordingShown(Model model, string view, Recording rec)
    {
        var done = (model.Flows.TryGetValue(rec.Id, out var flow) ? flow.Steps : []).Select(s => Views.PlaceStep(model, view, s.From, s.To)).ToList();
        if (rec.From is null || rec.To is null) return new Playing(done);
        done.Add(Views.PlaceStep(model, view, rec.From, rec.To == rec.From ? null : rec.To));
        return new Playing(done, done.Count - 1);
    }

    /// <summary>Boxes were dragged: the places of every box in the view go to layout.yaml, to whole pixels, as the browser saves them.</summary>
    private async Task MoveBoxesAsync(IReadOnlyList<(string Id, double X, double Y)> moved)
    {
        var view = CurrentView();
        // JavaScript's Math.round: halves go up.
        static double Round(double v) => Math.Floor(v + 0.5);
        var saved = await RunAsync(d => EditOps.PlaceBoxes(d, view, moved.Select(m => (m.Id, Round(m.X), Round(m.Y)))));
        _canvas.ClearMoved();
        _undoMove = saved;
    }

    /// <summary>What the side panel shows for these boxes picked: none shows nothing, one is its own panel, several are the many-boxes panel.</summary>
    private static Side? SideOf(IReadOnlyList<string> ids) =>
        ids.Count switch { 0 => null, 1 => new Side.Box(ids[0]), _ => new Side.Boxes(ids) };

    /// <summary>The boxes picked now: the open box, or the several in the panel.</summary>
    private IReadOnlyList<string> PickedBoxes() => _side is Side.Boxes many ? many.Ids : SelectedBox is { } one ? [one] : [];

    /// <summary>Ctrl, Cmd or Shift+click on a box: it joins the boxes picked, or leaves them. A box clicked a moment ago, whose panel is still waiting out the double-click, counts as picked.</summary>
    private void ToggleBox(string id)
    {
        if (!Editing || Recording is not null || _folder?.Model.GetObject(id) is null) return;
        var waiting = _opening is { IsEnabled: true } ? _openingBox : null;
        Interacted();
        var now = _side is null && waiting is not null ? [waiting] : PickedBoxes();
        SetPicked(now.Contains(id) ? now.Where(b => b != id).ToList() : [.. now, id]);
    }

    /// <summary>Shows these boxes as picked: one opens its panel as a click would, several open the many-boxes panel, none closes the panel.</summary>
    private void SetPicked(IReadOnlyList<string> ids)
    {
        if (!Editing) return;
        Interacted();
        if (ids.Count == 1)
        {
            OpenObject(ids[0]);
            return;
        }
        _side = SideOf(ids);
        Refresh();
    }

    /// <summary>Lets the boxes picked go: Esc, or the bar's clear button.</summary>
    private void ClearPicked()
    {
        _side = null;
        Refresh();
    }

    /// <summary>A box drawn round boxes (Shift and drag): they are the boxes picked.</summary>
    private void PickBoxes(IReadOnlyList<string> ids) => SetPicked(ids);

    /// <summary>Ctrl+A: every box that belongs to this view. The boxes around it that only show who it talks to are left out.</summary>
    private void PickAll()
    {
        if (Recording is not null || _canvas.Scene is not { } scene) return;
        SetPicked(scene.Members.ToList());
    }

    /// <summary>A line drawn from one box to another: a connection with no label, and its panel opens to type one. Only lines this view can show.</summary>
    private async Task ConnectAsync(string from, string to)
    {
        if (_folder is not { } folder || !Editing || Views.PlaceEnds(folder.Model, CurrentView(), from, to) is null) return;
        if (await RunAsync(d => EditOps.Connect(d, new ConnectionInput(from, to)))) OpenLine(from, to);
    }

    private void CloseSide() => CloseDetails();

    /// <summary>Delete: the open box, or the open line when it stands for just one connection.</summary>
    internal async Task DeleteSelectedAsync()
    {
        if (_folder is not { } folder || !Editing) return;
        if (_side is Side.Box { Id: var id })
        {
            if (await RunAsync(d => EditOps.DeleteObject(d, id))) CloseSide();
            return;
        }
        if (_side is Side.Boxes { Ids: var picked })
        {
            // One edit for the lot, so one undo brings them all back, and a box that can't go (it has boxes inside, or a flow uses it) stops them all.
            if (await RunAsync(d => EditOps.DeleteObjects(d, picked))) CloseSide();
            return;
        }
        if (_side is not Side.Line { From: var from, To: var to }) return;
        var merged = Navigation.ConnectionsOf(folder.Model, CurrentView(), from, to);
        if (merged.Count > 1)
        {
            ShowNotice($"This line stands for {merged.Count} connections. Delete them one at a time in the panel.");
            return;
        }
        if (merged.Count == 1)
        {
            var c = merged[0].Connection;
            if (await RunAsync(d => EditOps.RemoveConnection(d, new ConnectionInput(c.From ?? "", c.To ?? "", c.Label ?? "")))) CloseSide();
        }
    }

    // ---- keys --------------------------------------------------------------------------------------------------

    /// <summary>E turns edit mode on and off; in edit mode N adds, Delete deletes, Ctrl+Z and Ctrl+Y undo and redo. True when the key was one of these.</summary>
    private bool EditKey(KeyEventArgs e)
    {
        var plain = e.KeyModifiers == KeyModifiers.None;
        if (e.PhysicalKey == PhysicalKey.E && plain && !ReadOnly)
        {
            SetEditing(!Editing);
            return true;
        }
        if (!Editing) return false;
        if (e.PhysicalKey == PhysicalKey.N && plain)
        {
            OpenAdd();
            return true;
        }
        if (e.Key == Key.Delete && plain)
        {
            _ = DeleteSelectedAsync();
            return true;
        }
        var command = (e.KeyModifiers & (KeyModifiers.Control | KeyModifiers.Meta)) != 0;
        var shift = (e.KeyModifiers & KeyModifiers.Shift) != 0;
        if (command && !shift && e.PhysicalKey == PhysicalKey.A)
        {
            PickAll();
            return true;
        }
        if (command && e.PhysicalKey == PhysicalKey.Y)
        {
            _ = RedoAsync();
            return true;
        }
        if (command && e.PhysicalKey == PhysicalKey.Z)
        {
            _ = shift ? RedoAsync() : UndoAsync();
            return true;
        }
        return false;
    }

    // What a test can look at.
    internal SidePanel Panel => _panel;

    internal bool EditToolsVisible => _editTools.IsVisible;

    internal bool CanUndo => _session?.CanUndo == true;

    internal bool CanUndoMove => _undoMove;

    /// <summary>The boxes picked now, for tests: the open box, or the several in the panel.</summary>
    internal IReadOnlyList<string> PickedNow => PickedBoxes();

    /// <summary>The bar that says how many boxes are picked, and has Delete.</summary>
    internal PickedBar Picked => _pickedBar;

    internal bool CanRedo => _session?.CanRedo == true;

    internal string? NoticeText => _notice?.Text;

    internal ComboBox LinePicker => _linePicker;


    internal Recording? RecordingNow => Recording;

    internal Task TidyForTestAsync() => TidyAsync();
}
