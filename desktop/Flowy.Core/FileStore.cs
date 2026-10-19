using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace Flowy.Core;

/// <summary>The file changed since the caller read it. <see cref="Version"/> is what it holds now (null: it is gone).</summary>
public sealed class VersionConflict(string rel, string? version) : Exception($"{rel} changed since it was read")
{
    public string? Version { get; } = version;
}

/// <summary>
/// Reads and writes the files of a model folder the way src/node/files.ts does. A file's version is the first 16 hex digits of the SHA-256 of
/// its text, and a write is made only if the file still has the version the caller read (null: it must not exist yet), so an edit never
/// overwrites a change made elsewhere. The text goes to <c>&lt;file&gt;.&lt;guid&gt;.tmp</c> and is moved over the file, so a crash leaves the old
/// file or the new one, never half of one; the folder watcher ignores <c>.tmp</c> files.
/// </summary>
public static class FileStore
{
    // Strict, so a file that isn't UTF-8 fails to load instead of being rewritten with replacement characters.
    private static readonly UTF8Encoding Strict = new(false, true);
    private static readonly UTF8Encoding NoBom = new(false);
    private static readonly ConcurrentDictionary<string, object> Locks = new();

    /// <summary>The files an edit may write: model.yaml, layout.yaml and flows/&lt;id&gt;.yaml with a valid id.</summary>
    public static bool IsAllowed(string rel) =>
        rel is "model.yaml" or "layout.yaml"
        || (rel.StartsWith("flows/", StringComparison.Ordinal) && rel.EndsWith(".yaml", StringComparison.Ordinal) && rel.Length > "flows/.yaml".Length
            && Names.IsValidId(rel["flows/".Length..^".yaml".Length]));

    public static string Hash(string text) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text)))[..16];

    /// <summary>The file's text and version, or (null, null) when it isn't there. Throws <see cref="ParseError"/> for text that isn't UTF-8.</summary>
    public static (string? Text, string? Version) Read(string dir, string rel)
    {
        byte[] bytes;
        try
        {
            using var stream = new FileStream(Path.Combine(dir, rel), FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var copy = new MemoryStream();
            stream.CopyTo(copy);
            bytes = copy.ToArray();
        }
        catch (Exception e) when (e is FileNotFoundException or DirectoryNotFoundException)
        {
            return (null, null);
        }
        string text;
        try
        {
            text = Strict.GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            throw new ParseError(rel, "is not UTF-8 text. Save it as UTF-8 and try again.");
        }
        return (text, Hash(text));
    }

    /// <summary>The folder's flow files, by name, in the order the loader reads them. The .yml ones are not flows.</summary>
    public static List<string> FlowFiles(string dir)
    {
        var flows = Path.Combine(dir, "flows");
        if (!Directory.Exists(flows)) return [];
        var names = Directory.EnumerateFiles(flows).Select(Path.GetFileName).OfType<string>().Where(n => n.EndsWith(".yaml", StringComparison.Ordinal)).ToList();
        names.Sort(StringComparer.Ordinal);
        return names;
    }

    /// <summary>
    /// Writes one file (text null deletes it), but only if it still has version <paramref name="expected"/>. Returns the new version.
    /// Saves to one file run one at a time. Throws <see cref="VersionConflict"/>.
    /// </summary>
    public static string? Save(string dir, string rel, string? text, string? expected)
    {
        if (!IsAllowed(rel)) throw new InvalidOperationException($"refusing to write \"{rel}\"");
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
            return Hash(text);
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
