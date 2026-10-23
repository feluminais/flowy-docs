using System.Collections.Concurrent;

namespace Flowy.Core;

/// <summary>
/// A model folder as the reader shows it: the model and everything wrong with it, the load-test runs in <c>perf/</c> with what is wrong with those, and what is
/// wrong with <c>failures/</c> beyond what the checks say (a file that was skipped, a run link that points at nothing). Kept apart, as in the TypeScript State:
/// a file of numbers or an analysis never stops the model loading.
/// </summary>
public sealed record Folder(Model Model, IReadOnlyList<Problem> Problems, IdMap<LoadRun>? Runs = null, IReadOnlyList<Problem>? RunProblems = null, IReadOnlyList<Problem>? FailureProblems = null);

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

    /// <summary>The folder that holds <paramref name="dir"/>: <c>code</c> paths are relative to it.</summary>
    public static string RepoRoot(string dir)
    {
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(dir));
        return Path.GetDirectoryName(full) ?? full;
    }

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

        var flows = new IdMap<Flow>();
        var ignored = new List<string>();
        var flowsDir = Path.Combine(dir, FolderLayout.FlowsDir);
        if (Directory.Exists(flowsDir))
        {
            var names = Directory.EnumerateFiles(flowsDir).Select(Path.GetFileName).OfType<string>().ToList();
            names.Sort(StringComparer.Ordinal);
            foreach (var name in names.Where(FolderLayout.IsRead))
            {
                var id = FolderLayout.IdOfName(name);
                var text = ReadText(dir, FolderLayout.FlowFile(id));
                if (text is not null) flows.Add(id, ParsedOnce(dir, FolderLayout.FlowFile(id), text, () => ModelFiles.ParseFlow(id, text)));
            }
            ignored.AddRange(names.Where(FolderLayout.IsIgnored).Select(n => $"{FolderLayout.FlowsDir}/{n}"));
        }

        var (analyses, unread) = LoadFailures(dir);
        var model = Model.FromParts(parsed, flows, layout, analyses);
        // A flow file that isn't read is no part of the model, so the checks can't see it.
        var skipped = ignored.Select(file => new Problem(file, null,
            $"Flowy reads flow files that end in .yaml, so this one is ignored. Rename it to {FolderLayout.RenamedFromIgnored(file)}."));
        var (runs, runProblems) = LoadRuns(dir, model);
        // A mode's run link needs the runs, which are not in the model, so it is checked here. The rest of an analysis is checked in Checks.Run.
        var failureProblems = unread.Concat(model.Failures.SelectMany(kv => Failures.RunLinkProblems(kv.Key, kv.Value, runs))).ToList();
        return new Folder(model, [.. Checks.Run(model, MissingPaths(dir, model)), .. skipped], runs, runProblems, failureProblems);
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
