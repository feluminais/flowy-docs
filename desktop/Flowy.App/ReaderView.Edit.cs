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
    private bool _editMode;
    private bool _undoMove; // the last thing done was dragging a box, and nothing has been done since
    private readonly Button _editButton = new();
    private readonly Button _addButton = new();
    private readonly Button _newFlowButton = new();
    private readonly Button _undoButton = new();
    private readonly Button _redoButton = new();
    private readonly Button _tidyButton = new();
    private readonly StackPanel _editTools = new() { Orientation = Avalonia.Layout.Orientation.Horizontal, Spacing = 8, IsVisible = false, VerticalAlignment = Avalonia.Layout.VerticalAlignment.Center };

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
        DismissNotice();
        _playing = null;
        if (!on && _side is { Kind: SideKind.Add or SideKind.Flow }) _side = null;
        Refresh();
    }

    /// <summary>What the bar shows for edit mode, after every redraw.</summary>
    private void RefreshEdit()
    {
        _editTools.IsVisible = Editing;
        _canvas.Editable = Editing && _side is not { Kind: SideKind.Flow };
        _editButton.IsEnabled = Editing || !ReadOnly;
        if (Editing) _editButton.Classes.Add("pressed");
        else _editButton.Classes.Remove("pressed");
        _undoButton.IsEnabled = _session?.CanUndo == true;
        _redoButton.IsEnabled = _session?.CanRedo == true;
        UpdateEmpty();
    }

    /// <summary>The line picker. Reading, it changes only this screen and has a "project default"; editing, it changes the project's own style.</summary>
    private void SyncLinePicker(Model model)
    {
        _linePicker.Items.Clear();
        if (Editing)
        {
            foreach (var item in new[] { "Lines: straight", "Lines: curved", "Lines: right-angled" }) _linePicker.Items.Add(item);
            _linePicker.SelectedIndex = model.LineStyle switch { "curved" => 1, "angled" => 2, _ => 0 };
            return;
        }
        _linePicker.Items.Add($"Lines: project default ({LineName(model.LineStyle)})");
        foreach (var item in new[] { "Lines: straight", "Lines: curved", "Lines: right-angled" }) _linePicker.Items.Add(item);
        _linePicker.SelectedIndex = _ownLines switch { "straight" => 1, "curved" => 2, "angled" => 3, _ => 0 };
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
        _undoMove = false;
        string? message;
        try
        {
            message = await Task.Run(() => session.Apply(op));
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            message = $"Couldn't save: {e.Message}";
        }
        if (message is null)
        {
            await ReloadFromDiskAsync(session.Dir);
            return true;
        }
        ShowNotice(message);
        if (message == EditSession.ChangedOutside) await ReloadFromDiskAsync(session.Dir);
        return false;
    }

    /// <summary>What a test calls: the same as the forms do.</summary>
    internal Task<bool> EditAsync(Func<EditDoc, EditDoc> op) => RunAsync(op);

    private async Task ReloadFromDiskAsync(string dir)
    {
        try
        {
            var folder = await Task.Run(() => FolderLoader.Load(dir));
            if (_session?.Dir == dir) Reload(folder);
        }
        catch (ParseError e)
        {
            SetBanner(e.Message);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            SetBanner($"Can't read the folder: {e.Message}");
        }
    }

    internal Task UndoAsync() => BackAsync(s => s.Undo(), "Undone.");

    internal Task RedoAsync() => BackAsync(s => s.Redo(), "Redone.");

    private async Task BackAsync(Func<EditSession, string?> step, string done)
    {
        if (_session is not { } session) return;
        DismissNotice();
        _undoMove = false;
        var message = await Task.Run(() => step(session));
        if (message is null) ShowNotice(done, 3);
        else ShowNotice(message);
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
        _undoMove = false;
        _ = UndoAsync();
        return true;
    }

    private void OpenAdd()
    {
        if (!Editing) return;
        _undoMove = false;
        _side = new Side(SideKind.Add);
        Refresh();
    }

    /// <summary>The flow being recorded or edited, while edit mode is on.</summary>
    private Side? Recording => Editing && _side is { Kind: SideKind.Flow } ? _side : null;

    private void NewFlow()
    {
        if (!Editing) return;
        _undoMove = false;
        _side = new Side(SideKind.Flow, Id: "", FlowName: "");
        Refresh();
    }

    private void EditFlow(string id)
    {
        if (_folder is null) return;
        _side = new Side(SideKind.Flow, Id: id, FlowName: _folder.Model.Flows.TryGetValue(id, out var f) ? f.Name ?? "" : "");
        Refresh();
        FitNow(); // every box has to stay reachable beside the panel: they are what is clicked
    }

    private void SetRecording(Recording rec)
    {
        var starting = _side is { Kind: SideKind.Flow, Id: "" };
        _side = new Side(SideKind.Flow, Id: rec.Id, FlowName: rec.Name, From: rec.From, To: rec.To);
        Refresh();
        if (starting) FitNow();
    }

    /// <summary>A box clicked while recording: the first starts the step, the second ends it (the same box again: a step it does on its own), a third starts over.</summary>
    private void PickBox(Side rec, string id)
    {
        if (string.IsNullOrEmpty(rec.Id)) return; // still being named
        _side = rec.From is null || rec.To is not null ? rec with { From = id, To = null } : rec with { To = id };
        Refresh();
    }

    /// <summary>Escape while a step is half picked clears the pick, before it closes the panel.</summary>
    private bool ResetPick()
    {
        if (Recording is not { From: not null } rec) return false;
        _side = rec with { From = null, To = null };
        Refresh();
        return true;
    }

    /// <summary>What the canvas shows while recording: the flow's steps so far, and the step being picked lit.</summary>
    private static Playing RecordingShown(Model model, string view, Side rec)
    {
        var done = (model.Flows.TryGetValue(rec.Id ?? "", out var flow) ? flow.Steps : []).Select(s => Views.PlaceStep(model, view, s.From, s.To)).ToList();
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

    /// <summary>A line drawn from one box to another: a connection with no label, and its panel opens to type one. Only lines this view can show.</summary>
    private async Task ConnectAsync(string from, string to)
    {
        if (_folder is not { } folder || !Editing || Views.PlaceEnds(folder.Model, CurrentView(), from, to) is null) return;
        if (await RunAsync(d => EditOps.Connect(d, new ConnectionInput(from, to)))) OpenLine(from, to);
    }

    private void CloseSide()
    {
        _side = null;
        Refresh();
        Focus();
    }

    /// <summary>Delete: the open box, or the open line when it stands for just one connection.</summary>
    internal async Task DeleteSelectedAsync()
    {
        if (_folder is not { } folder || !Editing) return;
        if (_side is { Kind: SideKind.Object, Id: { } id })
        {
            if (await RunAsync(d => EditOps.DeleteObject(d, id))) CloseSide();
            return;
        }
        if (_side is not { Kind: SideKind.Line, From: { } from, To: { } to }) return;
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

    internal bool CanRedo => _session?.CanRedo == true;

    internal string? NoticeText => _notice?.Text;

    internal ComboBox LinePicker => _linePicker;

    internal ComboBox FlowPicker => _flowPicker;

    internal Recording? RecordingNow => Recording is { } r ? new Recording(r.Id ?? "", r.FlowName ?? "", r.From, r.To) : null;

    internal Task TidyForTestAsync() => TidyAsync();
}
