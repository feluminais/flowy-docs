using System.Collections.Concurrent;

namespace Flowy.Core;

/// <summary>
/// A model folder as the reader shows it: the model and everything wrong with it, the load-test runs in <c>perf/</c> with what is wrong with those, and what is
/// wrong with <c>failures/</c> beyond what the checks say (a file that was skipped, a run link that points at nothing). Kept apart, as in the TypeScript State:
/// a file of numbers or an analysis never stops the model loading.
/// </summary>
public sealed record Folder(Model Model, IReadOnlyList<Problem> Problems, IdMap<LoadRun>? Runs = null, IReadOnlyList<Problem>? RunProblems = null, IReadOnlyList<Problem>? FailureProblems = null);

/// <summary>Whether two reads of a folder say the same thing.</summary>
public static class FolderSame
{
    private static bool Same<T>(IReadOnlyDictionary<string, T> a, IReadOnlyDictionary<string, T> b) => ReferenceEquals(a, b) || (a.Count == 0 && b.Count == 0);

    private static bool Same<T>(IdMap<T> a, IdMap<T> b) where T : class
    {
        if (ReferenceEquals(a, b)) return true;
        if (a.Count != b.Count) return false;
        foreach (var (id, value) in a)
            if (!b.TryGetValue(id, out var other) || !ReferenceEquals(value, other)) return false;
        return true;
    }

    /// <summary>
    /// Whether <paramref name="then"/> and <paramref name="now"/> are the same folder: every file was read to the same parsed object (a file that did not change is not parsed again, see
    /// <see cref="FolderLoader"/>), and what the checks and the runs say is the same. A folder read again after the app's own save is this, because the save has been shown already.
    /// </summary>
    public static bool Is(Folder then, Folder now)
    {
        var (a, b) = (then.Model, now.Model);
        if (!ReferenceEquals(a.Objects, b.Objects) || !ReferenceEquals(a.Connections, b.Connections) || !Same(a.Meta, b.Meta) || !Same(a.Layout, b.Layout)) return false;
        if (!Same(a.Flows, b.Flows) || !Same(a.Failures, b.Failures)) return false;
        if (a.Folders.Count != b.Folders.Count || a.Folders.Any(kv => !b.Folders.TryGetValue(kv.Key, out var f) || f != kv.Value)) return false;
        if (!then.Problems.SequenceEqual(now.Problems)) return false;
        if ((then.RunProblems ?? []).Count != (now.RunProblems ?? []).Count || !(then.RunProblems ?? []).SequenceEqual(now.RunProblems ?? [])) return false;
        if (!(then.FailureProblems ?? []).SequenceEqual(now.FailureProblems ?? [])) return false;
        if (then.Runs is null || now.Runs is null) return then.Runs is null && now.Runs is null;
        return Same(then.Runs, now.Runs);
    }
}

/// <summary>Reads a flowy/ folder. A port of loadDir and loadState in src/node/files.ts, without the parts that write.</summary>
public static class FolderLoader
{
    /// <summary>The file's text, or null when it doesn't exist. A folder where the file should be is a <see cref="ParseError"/>.</summary>
    private static string? ReadText(string dir, string rel)
    {
        try
        {
            return FileText.Read(dir, rel);
        }
        catch (UnauthorizedAccessException) when (Directory.Exists(Path.Combine(dir, rel)))
        {
            throw new ParseError(rel, "is a folder, not a file.");
        }
    }

    private static readonly ConcurrentDictionary<(string Dir, string Rel), (string Text, object Parsed)> Parsed = new();

    /// <summary>
    /// What <paramref name="parse"/> makes of a file, kept until the file's text changes: reading a folder again after one save then parses only the file that was saved, not all of them. What
    /// is parsed is not changed afterwards (an edit builds new records), so the next load can be handed the same.
    /// </summary>
    private static T ParsedOnce<T>(string dir, string rel, string text, Func<T> parse) where T : notnull
    {
        var key = (Path.GetFullPath(dir), rel);
        if (Parsed.TryGetValue(key, out var hit) && hit.Text == text) return (T)hit.Parsed;
        var value = parse();
        Parsed[key] = (text, value);
        return value;
    }

    /// <summary>The folder that holds <paramref name="dir"/>: <c>code</c> paths are relative to it. For a draft it is the one that holds the draft's model folder (see <see cref="Drafts.RepoOf"/>).</summary>
    public static string RepoRoot(string dir) => Drafts.RepoOf(dir);

    /// <summary>The <c>code</c> and <c>links</c> paths in this model that don't exist. A missing folder or file counts as empty.</summary>
    public static HashSet<string> MissingPaths(string dir, Model model)
    {
        var root = RepoRoot(dir);
        return model.Objects
            .SelectMany(o => (o.Value.Code is List<object?> list ? list.OfType<string>() : []).Concat(Links.Of(o.Value).Select(l => l.Url)))
            .Where(p => Checks.IsRepoPath(p) && !File.Exists(Path.Combine(root, p)) && !Directory.Exists(Path.Combine(root, p)))
            .ToHashSet();
    }

    /// <summary>Reads the whole folder. Throws <see cref="ParseError"/> for a file that can't be read.</summary>
    public static Folder Load(string dir)
    {
        var modelText = ReadText(dir, FolderLayout.ModelFile);
        var layoutText = ReadText(dir, FolderLayout.LayoutFile);
        var parsed = modelText is null ? null : ParsedOnce(dir, FolderLayout.ModelFile, modelText, () => ModelFiles.ParseModel(modelText));
        var layout = layoutText is null ? [] : ParsedOnce(dir, FolderLayout.LayoutFile, layoutText, () => ModelFiles.ParseLayout(layoutText));

        // Flows may sit in folders under flows/; the id is the file's name alone, and where the file is goes in `folders`.
        var flows = new IdMap<Flow>();
        var folders = new Dictionary<string, string>();
        var listing = FileStore.ListFlows(dir);
        foreach (var file in listing.Files)
        {
            var id = file.Id;
            var text = ReadText(dir, file.Rel);
            if (text is null) continue;
            flows.Add(id, ParsedOnce(dir, file.Rel, text, () => ModelFiles.ParseFlow(id, text, file.Folder)));
            if (file.Folder != "") folders[id] = file.Folder;
        }

        var (analyses, unread) = LoadFailures(dir);
        var model = Model.FromParts(parsed, flows, layout, analyses, folders);
        // A flow file that isn't read is no part of the model, so the checks can't see it.
        var skipped = listing.Ignored.Select(file => new Problem(file, null,
            $"Flowy reads flow files that end in .yaml, so this one is ignored. Rename it to {FolderLayout.RenamedFromIgnored(file)}."));
        var (runs, runProblems) = LoadRuns(dir, model);
        // A mode's run link needs the runs, which are not in the model, so it is checked here. The rest of an analysis is checked in Checks.Run.
        var failureProblems = unread.Concat(model.Failures.SelectMany(kv => Failures.RunLinkProblems(kv.Key, kv.Value, runs))).ToList();
        return new Folder(model, [.. Checks.Run(model, MissingPaths(dir, model)), .. skipped, .. listing.Unusable], runs, runProblems, failureProblems);
    }

    /// <summary>
    /// Reads <c>failures/*.yaml</c>, a port of loadFailures in src/node/files.ts. Unlike a flow, an analysis that can't be read never stops the model loading:
    /// it is skipped and becomes a problem, because the architecture is worth more than the analysis.
    /// </summary>
    public static (IdMap<FailureAnalysis> Analyses, List<Problem> Problems) LoadFailures(string dir)
    {
        var analyses = new IdMap<FailureAnalysis>();
        var problems = new List<Problem>();
        var failures = Path.Combine(dir, FolderLayout.FailuresDir);
        if (!Directory.Exists(failures)) return (analyses, problems);
        List<string> names;
        try
        {
            names = Directory.EnumerateFiles(failures).Select(Path.GetFileName).OfType<string>().ToList();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            problems.Add(new Problem(FolderLayout.FailuresDir, null, $"can't be read: {e.Message}"));
            return (analyses, problems);
        }
        names.Sort(StringComparer.Ordinal);
        foreach (var name in names)
        {
            var file = $"{FolderLayout.FailuresDir}/{name}";
            if (FolderLayout.IsIgnored(name))
            {
                problems.Add(new Problem(file, null, $"Flowy reads analysis files that end in .yaml, so this one is ignored. Rename it to {FolderLayout.RenamedFromIgnored(name)}."));
                continue;
            }
            if (!FolderLayout.IsRead(name)) continue;
            var id = FolderLayout.IdOfName(name);
            if (!Names.IsValidId(id))
            {
                problems.Add(new Problem(file, null, $"\"{id}\" is not a valid analysis id: the file name must {Names.IdRule}"));
                continue;
            }
            try
            {
                if (ReadText(dir, file) is { } text) analyses.Add(id, ParsedOnce(dir, file, text, () => ModelFiles.ParseAnalysis(id, text)));
            }
            catch (ParseError e)
            {
                problems.Add(new Problem(file, null, e.Line is null ? e.Reason : $"line {e.Line}: {e.Reason}"));
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                problems.Add(new Problem(file, null, $"can't be read: {e.Message}"));
            }
        }
        return (analyses, problems);
    }

    /// <summary>
    /// Reads <c>perf/*.yaml</c>, a port of loadRuns in src/node/files.ts. A file that can't be played, or whose name isn't an id, becomes a problem
    /// and is skipped: the architecture view is worth more than the numbers, so a file here never stops a model loading.
    /// </summary>
    public static (IdMap<LoadRun> Runs, List<Problem> Problems) LoadRuns(string dir, Model model)
    {
        var runs = new IdMap<LoadRun>();
        var problems = new List<Problem>();
        var perf = Path.Combine(dir, FolderLayout.PerfDir);
        if (!Directory.Exists(perf)) return (runs, problems);
        List<string> names;
        try
        {
            names = Directory.EnumerateFiles(perf).Select(Path.GetFileName).OfType<string>().ToList();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            problems.Add(new Problem(FolderLayout.PerfDir, null, $"can't be read: {e.Message}"));
            return (runs, problems);
        }
        names.Sort(StringComparer.Ordinal);
        foreach (var name in names)
        {
            var file = $"{FolderLayout.PerfDir}/{name}";
            if (FolderLayout.IsIgnored(name))
            {
                problems.Add(new Problem(file, null, $"Flowy reads run files that end in .yaml, so this one is ignored. Rename it to {FolderLayout.RenamedFromIgnored(name)}."));
                continue;
            }
            if (!FolderLayout.IsRead(name)) continue;
            var id = FolderLayout.IdOfName(name);
            if (!Names.IsValidId(id))
            {
                problems.Add(new Problem(file, null, $"\"{id}\" is not a valid run id: the file name must {Names.IdRule}"));
                continue;
            }
            try
            {
                if (ReadText(dir, file) is not { } text) continue;
                var (run, found) = ParsedOnce(dir, file, text, () => Perf.ParseRun(id, text));
                runs.Add(id, run);
                problems.AddRange(found);
                problems.AddRange(Perf.CheckRun(id, run, model));
            }
            catch (ParseError e)
            {
                problems.Add(new Problem(file, null, e.Line is null ? e.Reason : $"line {e.Line}: {e.Reason}"));
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                problems.Add(new Problem(file, null, $"can't be read: {e.Message}"));
            }
        }
        // A run that adds others needs the other runs. One with fewer than two it can add can't be played, so it is left out, as a file that can't be read is.
        problems.AddRange(Perf.CheckRuns(runs));
        if (runs.Any(kv => kv.Value.Adds is not null && Perf.DialsOf(runs, kv.Key) is null))
        {
            var playable = new IdMap<LoadRun>();
            foreach (var (id, run) in runs)
                if (run.Adds is null || Perf.DialsOf(runs, id) is not null) playable.Add(id, run);
            runs = playable;
        }
        return (runs, problems);
    }
}
