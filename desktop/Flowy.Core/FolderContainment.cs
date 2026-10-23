namespace Flowy.Core;

/// <summary>
/// Whether a path in a model folder stays in it once links are followed. A cloned repo can make <c>flows/</c> or <c>flows/x.yaml</c> a symbolic link or a junction to
/// somewhere else, and reading or writing through it would show or change files that are not part of the model. The same rule as src/node/files.ts: the real path of
/// the file (of its nearest existing parent when it isn't there yet) must be inside the real path of the folder. A link that points elsewhere inside the folder is fine,
/// and so is a folder that was itself opened through a link.
/// </summary>
public static class FolderContainment
{
    /// <summary>What a problem or a refusal says about a file that resolves outside, after the file's name.</summary>
    public const string Outside = "points outside the folder";

    // Windows and macOS file systems ignore case by default, Linux ones don't.
    private static StringComparison Comparison => OperatingSystem.IsWindows() || OperatingSystem.IsMacOS() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;

    // Windows stops at 63 links in a path, Linux at 40. A longer chain is a loop or an attack, and either way not inside.
    private const int MaxLinks = 40;

    /// <summary>Whether <paramref name="rel"/> (relative to <paramref name="dir"/>, which need not exist) resolves to a place inside the real <paramref name="dir"/>.</summary>
    public static bool IsInside(string dir, string rel)
    {
        if (RealPath(dir) is not { } root) return false;
        // The folder is resolved, so the file only needs its own parts followed from there (the same place as following the whole path, which starts with the folder's).
        if ((Path.IsPathRooted(rel) || rel.Contains("..") ? RealPath(Path.Combine(dir, rel)) : RealPath(root, rel)) is not { } real) return false;
        var prefix = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;
        return real.Equals(root, Comparison) || real.StartsWith(prefix, Comparison);
    }

    /// <summary>
    /// The path with every link in it followed, including the ones above the last part. The parts after the first one that doesn't exist are kept as written. Null when the
    /// links go round in a circle.
    /// </summary>
    private static string? RealPath(string path)
    {
        var full = Path.GetFullPath(path);
        var current = Path.GetPathRoot(full)!;
        return RealPath(current, Split(full[current.Length..]));
    }

    /// <summary>The place <paramref name="rel"/> leads to from <paramref name="start"/>, which is a real path already: only the parts of <paramref name="rel"/> are followed.</summary>
    private static string? RealPath(string start, string rel) => RealPath(start, Split(rel));

    private static string? RealPath(string current, string[] start)
    {
        var parts = new Queue<string>(start);
        var followed = 0;
        while (parts.Count > 0)
        {
            var part = parts.Dequeue();
            if (part == ".") continue;
            if (part == "..")
            {
                current = Path.GetDirectoryName(current) ?? current;
                continue;
            }
            var next = Path.Combine(current, part);
            if (TargetOf(next) is not { } target)
            {
                current = next;
                continue;
            }
            if (++followed > MaxLinks) return null;
            // What the link points at is read from where the link is: a relative target starts at the folder that holds it.
            var rest = parts.ToArray();
            if (Path.IsPathRooted(target))
            {
                target = Path.GetFullPath(target, current);
                current = Path.GetPathRoot(target)!;
                target = target[current.Length..];
            }
            parts = new Queue<string>(Split(target).Concat(rest));
        }
        return current;
    }

    private static string[] Split(string path) => path.Split([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar], StringSplitOptions.RemoveEmptyEntries);

    /// <summary>Where <paramref name="path"/> points when it is a link (also one that points at nothing), or null.</summary>
    private static string? TargetOf(string path)
    {
        FileAttributes attributes;
        try
        {
            attributes = File.GetAttributes(path);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            return null; // not there, or not ours to look at: not a link we can follow
        }
        if (!attributes.HasFlag(FileAttributes.ReparsePoint)) return null;
        try
        {
            FileSystemInfo info = attributes.HasFlag(FileAttributes.Directory) ? new DirectoryInfo(path) : new FileInfo(path);
            return info.LinkTarget;
        }
        catch (IOException)
        {
            return null;
        }
    }
}
