namespace Flowy.Core;

/// <summary>
/// Edits to one model folder. Each edit is done the way MCP does it: read the files fresh, apply the change to their YAML, refuse it if it
/// would add a problem, then write each file that changed, only if it still has the version just read. What happened is an <see cref="EditResult"/>: a message
/// for the reader, or none once it is saved. Undo and Redo put back what was written, but only where nothing has changed since. One edit runs at a
/// time. Desktop twin of saveEdit and undoEdit in ui/src/save.ts.
/// </summary>
public sealed class EditSession(string dir)
{
    public const string ChangedOutside = "This file changed outside Flowy. Reloaded.";

    /// <summary>One file one edit wrote: what to put back, what it holds now, and the version it has now (null: the file is gone).</summary>
    private sealed record Written(string Rel, string? Before, string? After, string? Version);

    private readonly object _gate = new();
    private readonly List<List<Written>> _undo = [];
    private readonly List<List<Written>> _redo = [];

    public string Dir => dir;

    public bool CanUndo
    {
        get
        {
            lock (_gate) return _undo.Count > 0;
        }
    }

    public bool CanRedo
    {
        get
        {
            lock (_gate) return _redo.Count > 0;
        }
    }

    /// <summary>Raised on the thread that did it, after files were written and the session is free for the next edit.</summary>
    public event Action? Saved;

    private sealed record Disk(EditDoc Doc, Dictionary<string, string?> Versions);

    private static string Unreadable(ParseError e) =>
        $"Can't read {e.File}{(e.Line is { } line ? $" (line {line})" : "")}: {e.Reason}. Fix the file and the view updates.";

    /// <summary>The folder's files as trees, with each file's version. Throws <see cref="ParseError"/>: nothing is written while a file can't be read.</summary>
    private Disk ReadDisk()
    {
        var versions = new Dictionary<string, string?>();
        string? Read(string rel)
        {
            var (text, version) = FileStore.Read(dir, rel);
            versions[rel] = version;
            return text;
        }
        var model = Read(FolderLayout.ModelFile);
        var layout = Read(FolderLayout.LayoutFile);
        var flows = FileStore.FlowFiles(dir).Select(name => KeyValuePair.Create(FolderLayout.IdOfName(name), Read(FolderLayout.FlowFile(FolderLayout.IdOfName(name))))).Where(f => f.Value is not null)
            .Select(f => KeyValuePair.Create(f.Key, f.Value!)).ToList();
        return new Disk(EditDoc.Parse(model, layout, flows), versions);
    }

    /// <summary>Does one edit. Says what to tell the reader (a refusal, or that a file changed under it), or that it is saved.</summary>
    public EditResult Apply(Func<EditDoc, EditDoc> op)
    {
        var saved = false;
        EditResult result;
        lock (_gate)
        {
            try
            {
                var disk = ReadDisk();
                var next = op(disk.Doc);
                EditOps.RefuseNewProblems(disk.Doc.ToModel(), next.ToModel());
                var before = disk.Doc.ToFiles();
                var after = next.ToFiles();
                var written = new List<Written>();
                foreach (var rel in before.Keys.Union(after.Keys).Where(r => before.GetValueOrDefault(r) != after.GetValueOrDefault(r)))
                {
                    // layout.yaml and model.yaml always have a canonical text, so "not there" is told by the version.
                    var existed = disk.Versions.GetValueOrDefault(rel) is not null;
                    var text = after.GetValueOrDefault(rel);
                    var version = FileStore.Save(dir, rel, text, disk.Versions.GetValueOrDefault(rel));
                    // A file the edit created goes away again; one that was there goes back to its text before.
                    written.Add(new Written(rel, existed ? before.GetValueOrDefault(rel) : null, text, version));
                }
                if (written.Count > 0)
                {
                    _undo.Add(written);
                    _redo.Clear();
                    saved = true;
                }
                result = EditResult.Ok;
            }
            catch (ParseError e)
            {
                result = EditResult.Refused(Unreadable(e));
            }
            catch (OpError e)
            {
                result = EditResult.Refused(e.Message);
            }
            catch (VersionConflict)
            {
                result = EditResult.FileChanged;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                result = EditResult.Refused($"Couldn't save: {e.Message}");
            }
        }
        if (saved) Saved?.Invoke();
        return result;
    }

    public EditResult Undo() => Back(_undo, _redo, "undo");

    public EditResult Redo() => Back(_redo, _undo, "redo");

    private EditResult Back(List<List<Written>> from, List<List<Written>> to, string word)
    {
        var saved = false;
        EditResult result;
        lock (_gate)
        {
            if (from.Count == 0) return EditResult.Refused($"Nothing to {word}.");
            var entry = from[^1];
            var stale = $"Can't {word}: this changed since, outside Flowy. Nothing was {(word == "undo" ? "undone" : "redone")}.";
            try
            {
                ReadDisk(); // nothing is written while a file can't be read
                // Every file must still be as that edit left it, before any is touched.
                if (entry.Any(w => FileStore.Read(dir, w.Rel).Version != w.Version)) return EditResult.Refused(stale);
                var back = new List<Written>();
                foreach (var w in Enumerable.Reverse(entry))
                    back.Add(new Written(w.Rel, w.After, w.Before, FileStore.Save(dir, w.Rel, w.Before, w.Version)));
                from.RemoveAt(from.Count - 1);
                to.Add(back);
                saved = true;
                result = EditResult.Ok;
            }
            catch (ParseError e)
            {
                result = EditResult.Refused($"Can't {word} while a file can't be read: {Unreadable(e)}");
            }
            catch (VersionConflict)
            {
                result = EditResult.Refused(stale);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                result = EditResult.Refused($"Couldn't {word}: {e.Message}");
            }
        }
        if (saved) Saved?.Invoke();
        return result;
    }
}
