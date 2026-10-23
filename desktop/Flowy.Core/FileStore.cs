using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace Flowy.Core;

/// <summary>The file changed since the caller read it. <see cref="Version"/> is what it holds now (null: it is gone).</summary>
public sealed class VersionConflict(string rel, string? version) : Exception($"{rel} changed since it was read")
{
    public string? Version { get; } = version;
}

/// <summary>A file found under <c>flows/</c>: the folder it is in ("" at the top of <c>flows/</c>) and its file name.</summary>
public readonly record struct FlowLocation(string Folder, string Name)
{
    /// <summary>The path relative to the model folder.</summary>
    public string Rel => $"{FolderLayout.FlowsDir}/{(Folder == "" ? "" : Folder + "/")}{Name}";

    /// <summary>The flow's id: the file name without its extension, whatever folder it is in. Only for a file that is read (<c>.yaml</c>).</summary>
    public string Id => FolderLayout.IdOfName(Name);
}

/// <summary>What <see cref="FileStore.ListFlows"/> found: the flow files that are read, the <c>.yml</c> files that are ignored (as paths), and what keeps a file or folder out (a name that is taken, a folder name that can't be used).</summary>
public sealed record FlowListing(List<FlowLocation> Files, List<string> Ignored, List<Problem> Unusable);

/// <summary>
/// Reads and writes the files of a model folder the way src/node/files.ts does. A file's version is the first 16 hex digits of the SHA-256 of
/// its text, and a write is made only if the file still has the version the caller read (null: it must not exist yet), so an edit never
/// overwrites a change made elsewhere. The text goes to <c>&lt;file&gt;.&lt;guid&gt;.tmp</c> and is moved over the file, so a crash leaves the old
/// file or the new one, never half of one; the folder watcher ignores <c>.tmp</c> files.
/// </summary>
public static class FileStore
{
    private static readonly UTF8Encoding NoBom = new(false);
    private static readonly ConcurrentDictionary<string, object> Locks = new();

    /// <summary>
    /// The files an edit may write: model.yaml, layout.yaml, flows/&lt;id&gt;.yaml (in a valid folder of flows too) and failures/&lt;id&gt;.yaml with a valid id.
    /// A port of <c>isAllowedPath</c> in src/core/filekinds.ts.
    /// </summary>
    public static bool IsAllowed(string rel) =>
        rel is FolderLayout.ModelFile or FolderLayout.LayoutFile
        || (FolderLayout.FlowIdOf(rel) is { } flow && Names.IsValidId(flow) && Names.IsValidFolder(FolderLayout.FlowFolderOf(rel)))
        || (FolderLayout.FailureIdOf(rel) is { } id && Names.IsValidId(id));

    public static string Hash(string text) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text)))[..16];

    /// <summary>The file's text and version, or (null, null) when it isn't there. Throws <see cref="ParseError"/> for text that isn't UTF-8.</summary>
    public static (string? Text, string? Version) Read(string dir, string rel)
    {
        var text = FileText.Read(dir, rel);
        return text is null ? (null, null) : (text, Hash(text));
    }

    /// <summary>The folder's flow files that are read, in the order the loader reads them. The .yml ones are not flows, and neither is a file the loader leaves out (see <see cref="ListFlows"/>).</summary>
    public static List<FlowLocation> FlowFiles(string dir) => ListFlows(dir).Files;

    /// <summary>
    /// The files of <c>flows/</c> and of the folders in it, a port of <c>listFiles</c> and the plan in <c>loadFolder</c> in src/node/files.ts. A folder that starts with a dot is left alone, and one whose
    /// name can't be used, or that can't be listed, is skipped and becomes a problem. The files are ordered by file name and then by folder, so moving a flow into a folder does not change where it
    /// comes in the model; of two files with one name the first in that order is the one that is kept, and the other is a problem. A <c>.yml</c> file is listed in <see cref="FlowListing.Ignored"/>.
    /// </summary>
    public static FlowListing ListFlows(string dir)
    {
        var found = new List<FlowLocation>();
        var unusable = new List<Problem>();
        var flows = Path.Combine(dir, FolderLayout.FlowsDir);
        if (!Directory.Exists(flows)) return new FlowListing([], [], unusable);

        void Walk(string sub)
        {
            var at = sub == "" ? FolderLayout.FlowsDir : $"{FolderLayout.FlowsDir}/{sub}";
            List<string> files;
            List<string> folders;
            try
            {
                files = Directory.EnumerateFiles(Path.Combine(dir, at)).Select(Path.GetFileName).OfType<string>().ToList();
                folders = Directory.EnumerateDirectories(Path.Combine(dir, at)).Select(Path.GetFileName).OfType<string>().Where(n => !n.StartsWith('.')).ToList();
            }
            catch (Exception e) when (sub != "" && e is IOException or UnauthorizedAccessException)
            {
                unusable.Add(new Problem(at, null, $"Flowy skips this folder: it can't be read ({e.Message})."));
                return;
            }
            found.AddRange(files.Select(name => new FlowLocation(sub, name)));
            folders.Sort(StringComparer.Ordinal);
            foreach (var name in folders)
            {
                var next = sub == "" ? name : $"{sub}/{name}";
                if (Names.IsValidFolder(next)) Walk(next);
                else unusable.Add(new Problem($"{FolderLayout.FlowsDir}/{next}", null, $"Flowy skips this folder, since its name can't be used: {Names.FolderRule}."));
            }
        }
        Walk("");

        found.Sort((a, b) => string.CompareOrdinal(a.Name, b.Name) is var byName and not 0 ? byName : string.CompareOrdinal(a.Rel, b.Rel));
        var read = new List<FlowLocation>();
        var ignored = new List<string>();
        var taken = new Dictionary<string, string>();
        foreach (var file in found)
        {
            if (FolderLayout.IsIgnored(file.Name))
            {
                ignored.Add(file.Rel);
                continue;
            }
            if (!FolderLayout.IsRead(file.Name)) continue;
            if (taken.TryGetValue(file.Id, out var first))
            {
                unusable.Add(new Problem(file.Rel, null, $"Flowy reads one flow for each name, and {first} already has \"{file.Id}\", so this one is ignored. Rename it."));
                continue;
            }
            taken[file.Id] = file.Rel;
            read.Add(file);
        }
        return new FlowListing(read, ignored, unusable);
    }

    /// <summary>The folder's failure analysis files that have a valid id, by name, in the order the loader reads them. A file that can't be read is the loader's to report.</summary>
    public static List<string> FailureFiles(string dir)
    {
        var failures = Path.Combine(dir, FolderLayout.FailuresDir);
        if (!Directory.Exists(failures)) return [];
        var names = Directory.EnumerateFiles(failures).Select(Path.GetFileName).OfType<string>().Where(n => FolderLayout.IsRead(n) && Names.IsValidId(FolderLayout.IdOfName(n))).ToList();
        names.Sort(StringComparer.Ordinal);
        return names;
    }

    /// <summary>
    /// Writes one file (text null deletes it), but only if it still has version <paramref name="expected"/>. Returns the new version.
    /// Saves to one file run one at a time. Throws <see cref="VersionConflict"/>, and <see cref="OpError"/> for a file that a link sends outside the folder.
    /// </summary>
    public static string? Save(string dir, string rel, string? text, string? expected)
    {
        if (!IsAllowed(rel)) throw new InvalidOperationException($"refusing to write \"{rel}\"");
        if (!FolderContainment.IsInside(dir, rel)) throw new OpError($"\"{rel}\" {FolderContainment.Outside}");
        var path = Path.Combine(dir, rel);
        lock (Locks.GetOrAdd(Path.GetFullPath(path), _ => new object()))
        {
            var (_, version) = Read(dir, rel);
            if (version != expected) throw new VersionConflict(rel, version);
            if (text is null)
            {
                Retry(() => File.Delete(path));
                return null;
            }
            Replace(path, text);
            return Hash(text);
        }
    }

    /// <summary>
    /// Sets (or, with a null <paramref name="tag"/>, takes out) the <c>compare</c> tag of the run <paramref name="id"/>, only if its file still has version <paramref name="expected"/>. It is
    /// the one write a run takes (see <see cref="RunCompareText"/>): the rest of the file stays as it is, and what would no longer play is never written. Returns the new version. Saves to
    /// one file run one at a time, with those of <see cref="Save"/>. Throws <see cref="VersionConflict"/> when the file moved on or is gone, and <see cref="ParseError"/> when the run (or the
    /// run with the tag) can't be read.
    /// </summary>
    public static string SaveRunCompare(string dir, string id, CompareTag? tag, string? expected)
    {
        var rel = FolderLayout.PerfFile(id);
        if (!Names.IsValidId(id)) throw new InvalidOperationException($"refusing to write \"{rel}\"");
        var path = Path.Combine(dir, rel);
        lock (Locks.GetOrAdd(Path.GetFullPath(path), _ => new object()))
        {
            var (current, version) = Read(dir, rel);
            if (current is null || version != expected) throw new VersionConflict(rel, version);
            var text = RunCompareText.Set(current, tag);
            Perf.ParseRun(id, text); // never write what can't be played
            if (text == current) return version!;
            Replace(path, text);
            return Hash(text);
        }
    }

    /// <summary>Puts the text in the file through a temporary one beside it, so a crash leaves the old file or the new one, never half of one.</summary>
    private static void Replace(string path, string text)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = $"{path}.{Guid.NewGuid()}.tmp";
        try
        {
            File.WriteAllText(temp, text, NoBom);
            Retry(() => File.Move(temp, path, true));
        }
        catch
        {
            try
            {
                File.Delete(temp);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                // keep the real error, not a cleanup one
            }
            throw;
        }
    }

    /// <summary>Windows briefly locks files that editors, watchers or antivirus have open.</summary>
    private static void Retry(Action action)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                action();
                return;
            }
            catch (Exception e) when (attempt < 5 && e is IOException or UnauthorizedAccessException)
            {
                Thread.Sleep(50 * attempt);
            }
        }
    }
}
