using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>One file of the model as the YAML tab shows it: its text, or why there is none to show (<see cref="Note"/>).</summary>
public sealed record YamlFile(string Path, string? Text, string? Note = null);

/// <summary>
/// The model's files as text, for the YAML tab: which files there are, the order they are listed in, which one opens first, and where a shape
/// sits in model.yaml. A port of <c>readSnapshot</c> in src/node/history.ts and of <c>fileOrder</c>, <c>defaultFile</c> and <c>blockOf</c> in
/// ui/src/yamlview.ts; desktop/fixtures/expected/yaml-view.json holds what those say.
/// </summary>
public static partial class YamlFiles
{
    /// <summary>How deep the folders of flows are walked, as MAX_WALK in src/node/history.ts.</summary>
    private const int MaxWalk = 8;

    /// <summary>The folders that hold one file per thing and that Flowy writes, as WRITTEN_FOLDERS in src/core/filekinds.ts.</summary>
    private static readonly string[] Written = [FolderLayout.FlowsDir, FolderLayout.FailuresDir];

    /// <summary>
    /// The model's files in <paramref name="dir"/>, in the order the tab lists them: model.yaml and layout.yaml where they are, and every file Flowy may write
    /// in its folders. A file that can't be shown says why. A folder that can't be listed is left out (the loader reports it). Reads every file, so it is
    /// called once per load of the folder, not per redraw.
    /// </summary>
    public static List<YamlFile> Read(string dir)
    {
        var paths = new List<string>();
        foreach (var rel in new[] { FolderLayout.ModelFile, FolderLayout.LayoutFile })
            if (File.Exists(System.IO.Path.Combine(dir, rel))) paths.Add(rel);
        void Walk(string at, int depth)
        {
            List<string> files, folders;
            try
            {
                files = Directory.EnumerateFiles(System.IO.Path.Combine(dir, at)).Select(System.IO.Path.GetFileName).OfType<string>().ToList();
                folders = Directory.EnumerateDirectories(System.IO.Path.Combine(dir, at)).Select(System.IO.Path.GetFileName).OfType<string>().Where(n => !n.StartsWith('.')).ToList();
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                return;
            }
            foreach (var name in files) if (FileStore.IsAllowed($"{at}/{name}")) paths.Add($"{at}/{name}");
            if (depth < MaxWalk) foreach (var name in folders) Walk($"{at}/{name}", depth + 1);
        }
        foreach (var folder in Written) Walk(folder, 0);
        // A link out of the folder is not part of the model, so it is not shown.
        return FileOrder(paths.Where(rel => FolderContainment.IsInside(dir, rel))).Select(rel => ReadOne(dir, rel)).ToList();
    }

    private static YamlFile ReadOne(string dir, string rel)
    {
        try
        {
            return FileText.Read(dir, rel) is { } text ? new YamlFile(rel, text) : new YamlFile(rel, null, "Not in the folder any more");
        }
        catch (ParseError e)
        {
            return new YamlFile(rel, null, e.Message.Contains("UTF-8", StringComparison.Ordinal) ? "Not UTF-8 text" : e.Message);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return new YamlFile(rel, null, $"Can't read it: {e.Message}");
        }
    }

    /// <summary>The files in the order the tab lists them: the model, then the flows and the rest by name, then the layout.</summary>
    public static List<string> FileOrder(IEnumerable<string> paths)
    {
        static int Rank(string path) => path == FolderLayout.ModelFile ? 0 : path == FolderLayout.LayoutFile ? 2 : 1;
        return paths.Order(Comparer<string>.Create((a, b) => Rank(a) - Rank(b) is var r and not 0 ? r : string.CompareOrdinal(a, b))).ToList();
    }

    /// <summary>The file to show first: the open flow's, else the model, else the first there is.</summary>
    public static string DefaultFile(IReadOnlyList<string> paths, string? flow)
    {
        if (flow is not null && paths.FirstOrDefault(p => FolderLayout.FlowIdOf(p) == flow) is { } found) return found;
        if (paths.Contains(FolderLayout.ModelFile)) return FolderLayout.ModelFile;
        return FileOrder(paths).FirstOrDefault() ?? FolderLayout.ModelFile;
    }

    /// <summary>What a file is called on its tab: the flows by their path inside flows/, unless that would read like the model or the layout.</summary>
    public static string TabName(string path)
    {
        var prefix = FolderLayout.FlowsDir + "/";
        if (!path.StartsWith(prefix, StringComparison.Ordinal)) return path;
        var inside = path[prefix.Length..];
        return inside is FolderLayout.ModelFile or FolderLayout.LayoutFile ? path : inside;
    }

    /// <summary>The lines of a text; a final newline adds no empty line.</summary>
    public static List<string> LinesOf(string text)
    {
        var lines = LineBreak().Split(text).ToList();
        if (lines[^1] == "") lines.RemoveAt(lines.Count - 1);
        return lines;
    }

    private static bool IsBlankOrComment(string line) => line.Trim() == "" || line.Trim().StartsWith('#');

    private static int IndentOf(string line) => line.Length - line.TrimStart().Length;

    /// <summary>The key a mapping line starts with: plain, or in single or double quotes.</summary>
    private static string? KeyOf(string line)
    {
        var found = Key().Match(line.Trim());
        if (!found.Success) return null;
        return found.Groups[1].Success ? found.Groups[1].Value : found.Groups[2].Success ? found.Groups[2].Value : found.Groups[3].Value;
    }

    /// <summary>
    /// Where a shape sits in a model.yaml text: the 1-based, inclusive lines from its key to the last line indented under it. Found from the
    /// indentation of the first entry under <c>objects:</c>, so it holds for block style, for an entry on one line, and for quoted ids.
    /// </summary>
    public static (int Start, int End)? BlockOf(string text, string id)
    {
        var lines = LineBreak().Split(text);
        var root = Array.FindIndex(lines, line => Objects().IsMatch(line));
        if (root < 0) return null;
        var entryIndent = -1;
        var found = -1;
        for (var i = root + 1; i < lines.Length && found < 0; i++)
        {
            if (IsBlankOrComment(lines[i])) continue;
            var indent = IndentOf(lines[i]);
            if (indent == 0) break; // the next top-level key: the objects are over
            if (entryIndent < 0) entryIndent = indent;
            if (indent == entryIndent && KeyOf(lines[i]) == id) found = i;
        }
        if (found < 0) return null;
        var end = found;
        for (var i = found + 1; i < lines.Length; i++)
        {
            if (IsBlankOrComment(lines[i])) continue;
            if (IndentOf(lines[i]) <= entryIndent) break;
            end = i;
        }
        return (found + 1, end + 1);
    }

    [GeneratedRegex(@"\r?\n")]
    private static partial Regex LineBreak();

    [GeneratedRegex(@"^objects:\s*(#.*)?$")]
    private static partial Regex Objects();

    [GeneratedRegex(@"^(?:""([^""]*)""|'([^']*)'|([^:#\s][^:]*?))\s*:(?:\s|$)")]
    private static partial Regex Key();
}
