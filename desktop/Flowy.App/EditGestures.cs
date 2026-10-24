using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// What the reader does with the canvas and the panel while editing: recording a flow, picking several boxes to move or delete together, drawing a line between two boxes, adding a shape, and
/// deleting. What is picked is the reader's (see <see cref="IReader.Pick"/>); every change to the files is one edit of <see cref="EditMode"/>.
/// </summary>
internal sealed class EditGestures
{
    private readonly IReader _reader;
    private readonly EditMode _edit;
    private readonly CanvasView _canvas;

    public EditGestures(IReader reader, EditMode edit, CanvasView canvas, PickedBar pickedBar)
    {
        _reader = reader;
        _edit = edit;
        _canvas = canvas;
        pickedBar.DeleteRequested += () => _ = DeleteSelectedAsync();
        pickedBar.ClearRequested += ClearPicked;
        _canvas.BoxToggled += ToggleBox;
        _canvas.BoxesPicked += PickBoxes;
        _canvas.BoxesMoved += moved => _ = MoveBoxesAsync(moved);
        _canvas.ConnectRequested += (from, to) => _ = ConnectAsync(from, to);
    }

    /// <summary>The flow being recorded or edited, while edit mode is on.</summary>
    internal Recording? Recording => _edit.Editing && _reader.Pick is ReaderView.Side.Flow flow ? flow.Rec : null;

    /// <summary>The box whose panel is open.</summary>
    private string? SelectedBox => _reader.Pick is ReaderView.Side.Box s ? s.Id : null;

    /// <summary>What the side panel shows for these boxes picked: none shows nothing, one is its own panel, several are the many-boxes panel.</summary>
    internal static ReaderView.Side? SideOf(IReadOnlyList<string> ids) =>
        ids.Count switch { 0 => null, 1 => new ReaderView.Side.Box(ids[0]), _ => new ReaderView.Side.Boxes(ids) };

    /// <summary>The boxes picked now: the open box, or the several in the panel.</summary>
    internal IReadOnlyList<string> PickedBoxes() => _reader.Pick is ReaderView.Side.Boxes many ? many.Ids : SelectedBox is { } one ? [one] : [];

    /// <summary>What the canvas shows while recording: the flow's steps so far, and the step being picked lit.</summary>
    internal static Playing RecordingShown(Model model, string view, Recording rec)
    {
        var done = (model.Flows.TryGetValue(rec.Id, out var flow) ? flow.Steps : []).Select(s => Views.PlaceStep(model, view, s.From, s.To)).ToList();
        if (rec.From is null || rec.To is null) return new Playing(done);
        done.Add(Views.PlaceStep(model, view, rec.From, rec.To == rec.From ? null : rec.To));
        return new Playing(done, done.Count - 1);
    }

    internal void OpenAdd()
    {
        if (!_edit.Editing) return;
        _edit.DidSomethingElse();
        _reader.Pick = new ReaderView.Side.Add();
        _reader.Refresh();
    }

    internal void NewFlow()
    {
        if (!_edit.Editing) return;
        _edit.DidSomethingElse();
        _reader.Pick = new ReaderView.Side.Flow(new Recording("", ""));
        _reader.Refresh();
    }

    internal void EditFlow(string id)
    {
        if (_reader.Folder is null) return;
        _reader.Pick = new ReaderView.Side.Flow(new Recording(id, _reader.Folder.Model.Flows.TryGetValue(id, out var f) ? f.Name ?? "" : ""));
        _reader.Refresh();
        _reader.FitNow(); // every box has to stay reachable beside the panel: they are what is clicked
    }

    internal void SetRecording(Recording rec)
    {
        var starting = _reader.Pick is ReaderView.Side.Flow { Rec.Id: "" };
        _reader.Pick = new ReaderView.Side.Flow(rec);
        _reader.Refresh();
        if (starting) _reader.FitNow();
    }

    /// <summary>A box clicked while recording: the first starts the step, the second ends it (the same box again: a step it does on its own), a third starts over.</summary>
    internal void PickBox(Recording rec, string id)
    {
        if (string.IsNullOrEmpty(rec.Id)) return; // still being named
        _reader.Pick = new ReaderView.Side.Flow(rec.From is null || rec.To is not null ? rec with { From = id, To = null } : rec with { To = id });
        _reader.Refresh();
    }

    /// <summary>Escape while a step is half picked clears the pick, before it closes the panel.</summary>
    internal bool ResetPick()
    {
        if (Recording is not { From: not null } rec) return false;
        _reader.Pick = new ReaderView.Side.Flow(rec with { From = null, To = null });
        _reader.Refresh();
        return true;
    }

    /// <summary>Boxes were dragged: the places of every box in the view go to layout.yaml, to whole pixels, as the browser saves them.</summary>
    private async Task MoveBoxesAsync(IReadOnlyList<(string Id, double X, double Y)> moved)
    {
        var view = _reader.CurrentView;
        // JavaScript's Math.round: halves go up.
        static double Round(double v) => Math.Floor(v + 0.5);
        var saved = await _edit.RunAsync(d => EditOps.PlaceBoxes(d, view, moved.Select(m => (m.Id, Round(m.X), Round(m.Y)))));
        _canvas.ClearMoved();
        _edit.Moved(saved);
    }

    /// <summary>Ctrl, Cmd or Shift+click on a box: it joins the boxes picked, or leaves them. A box clicked a moment ago, whose panel is still waiting out the double-click, counts as picked.</summary>
    private void ToggleBox(string id)
    {
        if (!_edit.Editing || Recording is not null || _reader.Folder?.Model.GetObject(id) is null) return;
        var waiting = _reader.WaitingBox;
        _reader.Interacted();
        var now = _reader.Pick is null && waiting is not null ? [waiting] : PickedBoxes();
        SetPicked(now.Contains(id) ? now.Where(b => b != id).ToList() : [.. now, id]);
    }

    /// <summary>Shows these boxes as picked: one opens its panel as a click would, several open the many-boxes panel, none closes the panel.</summary>
    private void SetPicked(IReadOnlyList<string> ids)
    {
        if (!_edit.Editing) return;
        _reader.Interacted();
        if (ids.Count == 1)
        {
            _reader.OpenObject(ids[0]);
            return;
        }
        _reader.Pick = SideOf(ids);
        _reader.Refresh();
    }

    /// <summary>Lets the boxes picked go: Esc, or the bar's clear button.</summary>
    internal void ClearPicked()
    {
        _reader.Pick = null;
        _reader.Refresh();
    }

    /// <summary>A box drawn round boxes (Shift and drag): they are the boxes picked.</summary>
    private void PickBoxes(IReadOnlyList<string> ids) => SetPicked(ids);

    /// <summary>Ctrl+A: every box that belongs to this view. The boxes around it that only show who it talks to are left out.</summary>
    internal void PickAll()
    {
        if (Recording is not null || _canvas.Scene is not { } scene) return;
        SetPicked(scene.Members.ToList());
    }

    /// <summary>A line drawn from one box to another: a connection with no label, and its panel opens to type one. Only lines this view can show.</summary>
    private async Task ConnectAsync(string from, string to)
    {
        if (_reader.Folder is not { } folder || !_edit.Editing || Views.PlaceEnds(folder.Model, _reader.CurrentView, from, to) is null) return;
        if (await _edit.RunAsync(d => EditOps.Connect(d, new ConnectionInput(from, to)))) _reader.OpenLine(from, to);
    }

    /// <summary>
    /// Deletes shapes or lines. With nothing depending on them they go at once, and the notice says what went along and has an Undo button. Otherwise the Used by
    /// panel opens to settle what does (see <see cref="UsedByPanel"/>). <paramref name="then"/> runs once they are gone.
    /// </summary>
    internal void AskDelete(IReadOnlyList<Target> targets, Action? then = null) => _ = AskDeleteAsync(targets, then);

    internal async Task AskDeleteAsync(IReadOnlyList<Target> targets, Action? then = null)
    {
        if (_reader.Folder is not { } folder || !_edit.Editing) return;
        if (Dependents.Of(folder.Model, targets).Any(r => r.NeedsDecision))
        {
            _reader.Pick = new ReaderView.Side.UsedBy(targets, _reader.Pick);
            _reader.Refresh();
            return;
        }
        var none = new Dictionary<string, Choice>();
        var text = UsedBy.DoneText(folder.Model, UsedBy.PlanOf(folder.Model, targets, none), none, targets);
        if (!await _edit.RunAsync(d => EditOps.DeleteWith(d, targets, []))) return;
        then?.Invoke();
        _reader.ShowNotice(text, 0, () => _ = _edit.UndoAsync());
    }

    /// <summary>Delete: the open box, or the open line when it stands for just one connection.</summary>
    internal async Task DeleteSelectedAsync()
    {
        if (_reader.Folder is not { } folder || !_edit.Editing) return;
        if (_reader.Pick is ReaderView.Side.Box { Id: var id })
        {
            await AskDeleteAsync([new Target(Object: id)], _reader.CloseDetails);
            return;
        }
        if (_reader.Pick is ReaderView.Side.Boxes { Ids: var picked })
        {
            // One edit for the lot, so one undo brings them all back, and what depends on any of them is settled in one panel.
            await AskDeleteAsync(picked.Select(p => new Target(Object: p)).ToList(), _reader.CloseDetails);
            return;
        }
        if (_reader.Pick is not ReaderView.Side.Line { From: var from, To: var to }) return;
        var merged = Navigation.ConnectionsOf(folder.Model, _reader.CurrentView, from, to);
        if (merged.Count > 1)
        {
            _reader.ShowNotice($"This line stands for {merged.Count} connections. Delete them one at a time in the panel.");
            return;
        }
        if (merged.Count == 1)
        {
            var c = merged[0].Connection;
            await AskDeleteAsync([new Target(Line: new LineTarget(c.From ?? "", c.To ?? "", c.Label ?? ""))], _reader.CloseDetails);
        }
    }
}
