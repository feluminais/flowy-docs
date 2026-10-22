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

    /// <summary>The folder as read: its files as trees, each file's version, and each file's text as it was (what an edit puts back, byte for byte, to take itself back).</summary>
    private sealed record Disk(EditDoc Doc, Dictionary<string, string?> Versions, Dictionary<string, string?> Texts);

    private static string Unreadable(ParseError e) =>
        $"Can't read {e.File}{(e.Line is { } line ? $" (line {line})" : "")}: {e.Reason}. Fix the file and the view updates.";

    /// <summary>The folder's files as trees, with each file's version. Throws <see cref="ParseError"/>: nothing is written while a file can't be read.</summary>
    private Disk ReadDisk()
    {
        var versions = new Dictionary<string, string?>();
        var texts = new Dictionary<string, string?>();
        string? Read(string rel)
        {
            var (text, version) = FileStore.Read(dir, rel);
            versions[rel] = version;
            texts[rel] = text;
            return text;
        }
        var model = Read(FolderLayout.ModelFile);
        var layout = Read(FolderLayout.LayoutFile);
        var flows = FileStore.FlowFiles(dir).Select(name => KeyValuePair.Create(FolderLayout.IdOfName(name), Read(FolderLayout.FlowFile(FolderLayout.IdOfName(name))))).Where(f => f.Value is not null)
            .Select(f => KeyValuePair.Create(f.Key, f.Value!)).ToList();
        // An analysis that can't be read is not part of the edit, so it is never replaced or deleted, as in the browser and MCP.
        var failures = new List<KeyValuePair<string, string>>();
        foreach (var name in FileStore.FailureFiles(dir))
        {
            var id = FolderLayout.IdOfName(name);
            try
            {
                var text = Read(FolderLayout.FailureFile(id));
                if (text is not null)
                {
                    ModelFiles.ParseAnalysis(id, text);
                    failures.Add(KeyValuePair.Create(id, text));
                }
            }
            catch (ParseError)
            {
                versions.Remove(FolderLayout.FailureFile(id));
                texts.Remove(FolderLayout.FailureFile(id));
            }
        }
        return new Disk(EditDoc.Parse(model, layout, flows, failures), versions, texts);
    }

    /// <summary>For tests: called with each file's path just before it is written, a file put back included, so a write can be made to fail.</summary>
    internal Action<string>? BeforeWrite { get; set; }

    /// <summary>Puts back the files of <paramref name="written"/>, newest first. Returns the ones that could not be put back, in the order they were written.</summary>
    private List<Written> PutBack(List<Written> written)
    {
        var stuck = new List<Written>();
        foreach (var w in Enumerable.Reverse(written))
        {
            try
            {
                BeforeWrite?.Invoke(w.Rel);
                FileStore.Save(dir, w.Rel, w.Before, w.Version);
            }
            catch (Exception e) when (e is VersionConflict or IOException or UnauthorizedAccessException)
            {
                stuck.Insert(0, w);
            }
        }
        return stuck;
    }

    /// <summary>What to tell the reader when a write failed and some files could not be put back: why it failed, and which files hold the new text.</summary>
    private static EditResult Stuck(Exception why, List<Written> stuck)
    {
        var reason = why is VersionConflict ? ChangedOutside : $"Couldn't save: {why.Message}";
        return new EditResult($"{(reason.EndsWith('.') ? reason : reason + ".")} {string.Join(", ", stuck.Select(w => w.Rel))} was saved first and could not be put back.", why is VersionConflict);
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
                var changed = before.Keys.Union(after.Keys).Where(r => before.GetValueOrDefault(r) != after.GetValueOrDefault(r)).ToList();
                // Every file must still be as it was read, before any is touched, so a file that moved on writes nothing.
                foreach (var rel in changed)
                    if (FileStore.Read(dir, rel).Version != disk.Versions.GetValueOrDefault(rel)) throw new VersionConflict(rel, null);
                var written = new List<Written>();
                EditResult? halfDone = null;
                try
                {
                    foreach (var rel in changed)
                    {
                        // layout.yaml and model.yaml always have a canonical text, so "not there" is told by the version.
                        var existed = disk.Versions.GetValueOrDefault(rel) is not null;
                        var text = after.GetValueOrDefault(rel);
                        BeforeWrite?.Invoke(rel);
                        var version = FileStore.Save(dir, rel, text, disk.Versions.GetValueOrDefault(rel));
                        // A file the edit created goes away again; one that was there goes back to the text it had, hand-written style and all.
                        written.Add(new Written(rel, existed ? disk.Texts[rel] : null, text, version));
                    }
                }
                catch (Exception e) when (e is VersionConflict or IOException or UnauthorizedAccessException)
                {
                    // Put back what was written, so the edit is never half done. A file that can't be put back holds the new text: it is the one thing left to undo.
                    var stuck = PutBack(written);
                    if (stuck.Count == 0) throw;
                    written = stuck;
                    halfDone = Stuck(e, stuck);
                }
                if (written.Count > 0)
                {
                    _undo.Add(written);
                    _redo.Clear();
                    saved = true;
                }
                result = halfDone ?? EditResult.Ok;
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
                EditResult? halfDone = null;
                try
                {
                    foreach (var w in Enumerable.Reverse(entry))
                    {
                        BeforeWrite?.Invoke(w.Rel);
                        back.Add(new Written(w.Rel, w.After, w.Before, FileStore.Save(dir, w.Rel, w.Before, w.Version)));
                    }
                }
                catch (Exception e) when (e is VersionConflict or IOException or UnauthorizedAccessException)
                {
                    // Put back what was already taken back, so the edit stays one step. A file that can't be put back stays as the failed attempt left it.
                    var stuck = PutBack(back);
                    if (stuck.Count == 0) throw;
                    saved = true;
                    var reason = e is VersionConflict ? stale : $"Couldn't {word}: {e.Message}";
                    halfDone = new EditResult($"{(reason.EndsWith('.') ? reason : reason + ".")} {string.Join(", ", stuck.Select(w => w.Rel))} was {(word == "undo" ? "undone" : "redone")} first and could not be put back.", e is VersionConflict);
                }
                if (halfDone is null)
                {
                    from.RemoveAt(from.Count - 1);
                    to.Add(back);
                    saved = true;
                }
                result = halfDone ?? EditResult.Ok;
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
