using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// Edit mode: whether it is on, and the files behind it. Every change is one <see cref="EditSession"/> edit on the files, which refuses what would add a problem; the reader then shows the folder as it is on disk, so what
/// is on screen is what was saved. The folder is read-only to the reader (and so editing is off) while a file can't be read.
/// </summary>
internal sealed class EditMode(IReader reader) : IDisposable
{
    private EditSession? _session;
    private FolderSession? _disk; // the folder on disk, read again after each edit

    /// <summary>The reader switched edit mode on. It is in effect only while the folder can be written (see <see cref="Editing"/>).</summary>
    internal bool On { get; set; }

    /// <summary>The last thing done was dragging a box, and nothing has been done since.</summary>
    internal bool UndoMove { get; private set; }

    /// <summary>For a test: called between reading a run file and writing its tag, so a change made in that moment is felt as the file changing under the write.</summary>
    internal Action? BeforeRunWrite { get; set; }

    /// <summary>False for a model that must not be written, such as the sample that ships inside the app.</summary>
    internal bool CanEdit { get; set; } = true;

    /// <summary>Whether edit mode is on. It is off whenever the folder can't be changed: nothing loaded, a file that can't be read, or a model that is only for reading.</summary>
    internal bool Editing => On && !ReadOnly;

    internal bool ReadOnly => _session is null || !CanEdit || reader.HasBanner;

    internal bool CanUndo => _session?.CanUndo == true;

    internal bool CanRedo => _session?.CanRedo == true;

    /// <summary>Why a tag can't be written: the folder is open and can be written (not a sample inside the install, and no file that can't be read). Null when it can.</summary>
    internal string? SaveOff => CompareUi.NoteOff(_session is not null, !CanEdit || reader.HasBanner);

    /// <summary>Starts on a folder: it is read again after each edit, and <paramref name="loaded"/> gets it (or <paramref name="failed"/> what is wrong with a file).</summary>
    internal void Open(string dir, Action<Folder> loaded, Action<string?> failed)
    {
        _session = new EditSession(dir);
        _disk?.Dispose();
        _disk = new FolderSession(dir);
        _disk.Loaded += loaded;
        _disk.Failed += failed;
        On = false;
    }

    /// <summary>Lets go of the folder's watcher. The window calls this when it closes; without it the watcher outlives the window.</summary>
    public void Dispose()
    {
        _disk?.Dispose();
        _disk = null;
    }

    /// <summary>Anything done but dragging a box ends the chance to take that drag back with Esc.</summary>
    internal void DidSomethingElse() => UndoMove = false;

    /// <summary>A box was dragged and saved: Esc can take it back.</summary>
    internal void Moved(bool saved) => UndoMove = saved;

    /// <summary>
    /// One edit. Resolves to true once it is saved and on screen. A refusal (it would add a problem, a file changed outside, a file can't be
    /// written) is said in a notice and changes nothing.
    /// </summary>
    internal async Task<bool> RunAsync(Func<EditDoc, EditDoc> op)
    {
        if (_session is not { } session || reader.Folder is null) return false;
        reader.DismissNotice();
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
        reader.ShowNotice(result.Message!);
        if (result.ChangedOutside) await ReloadFromDiskAsync(session.Dir);
        return false;
    }

    private async Task ReloadFromDiskAsync(string dir)
    {
        if (_disk is { } disk && disk.Dir == dir) await disk.LoadAsync();
    }

    internal Task UndoAsync() => BackAsync(s => s.Undo(), "Undone.");

    internal Task RedoAsync() => BackAsync(s => s.Redo(), "Redone.");

    private async Task BackAsync(Func<EditSession, EditResult> step, string done)
    {
        if (_session is not { } session) return;
        reader.DismissNotice();
        DidSomethingElse();
        var result = await Task.Run(() => step(session));
        if (result.IsOk) reader.ShowNotice(done, 3);
        else reader.ShowNotice(result.Message!);
        await ReloadFromDiskAsync(session.Dir);
    }

    /// <summary>
    /// Writes the tag of run <paramref name="id"/> (null takes it out) into the run's own file, in place: the one thing Flowy writes into a run. The file is read just before, and written only if it
    /// is still as it was read, through a temporary file; one that changed under the write, or can't be read, writes nothing and says so. The history does not keep it (a run is not a file Flowy
    /// writes whole). True once it is saved and the folder is read again.
    /// </summary>
    internal async Task<bool> WriteRunTagAsync(string id, CompareTag? tag)
    {
        if (_session is not { } session || reader.Folder is null) return false;
        reader.DismissNotice();
        DidSomethingElse();
        var runs = RunDrawing.MapOf(reader.Folder.Runs);
        // The same refusals as a flow's, in the same words.
        string? refusal = null;
        if (!runs.ContainsKey(id)) refusal = $"unknown run \"{id}\"";
        else if (tag is not null && tag.With == id) refusal = $"run \"{id}\" cannot compare with itself";
        else if (tag is not null && !runs.ContainsKey(tag.With)) refusal = $"unknown run \"{tag.With}\"";
        if (refusal is not null)
        {
            reader.ShowNotice(refusal);
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
            reader.ShowNotice(problem);
            if (changedUnder) await ReloadFromDiskAsync(session.Dir);
            return false;
        }
        await ReloadFromDiskAsync(session.Dir);
        return true;
    }
}
