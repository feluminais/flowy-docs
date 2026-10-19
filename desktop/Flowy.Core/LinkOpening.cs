namespace Flowy.Core;

public enum LinkKind
{
    /// <summary>Open the address in the default browser.</summary>
    Web,
    /// <summary>Open the folder in the file explorer.</summary>
    Folder,
    /// <summary>Open the file in the app the system uses for its type. Only for the allow-listed document types.</summary>
    DefaultApp,
    /// <summary>Open the file in the app the person chose, passing the path as one argument.</summary>
    CustomApp,
    /// <summary>Select the file in its folder and run nothing.</summary>
    ShowInFolder,
    /// <summary>Open nothing: not a web address, not a real path inside the repo.</summary>
    Refused,
}

/// <summary>What a click on a link does. <c>Target</c> is the address or the real path (the link's own text when refused); <c>App</c> is the chosen app for <see cref="LinkKind.CustomApp"/>.</summary>
public sealed record LinkAction(LinkKind Kind, string Target, string? App = null);

/// <summary>
/// What a click on a box's link may open. The files come from a repo nobody here wrote, so a path is opened only if it is a real file or
/// folder inside the repo, and the system's default handler runs only for document types. A script or a program is shown in its folder
/// instead. An app the person chose is their own decision, so it may open any file inside the repo.
/// </summary>
public static class LinkOpening
{
    /// <summary>The types the default app may open. A repo can't change this list.</summary>
    public static readonly IReadOnlySet<string> DocumentTypes =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".md", ".markdown", ".txt", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp" };

    private static readonly StringComparison PathComparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;

    /// <param name="url">The link's <c>url</c>: a web address or a path in the repo.</param>
    /// <param name="repoRoot">The folder that holds <c>flowy/</c>.</param>
    /// <param name="customApp">The executable the person chose to open files with, or null for the system's default.</param>
    public static LinkAction Decide(string url, string repoRoot, string? customApp)
    {
        if (Checks.IsWebAddress(url)) return WebAddress.IsSafe(url) ? new(LinkKind.Web, url) : new(LinkKind.Refused, url);
        var real = Locate(repoRoot, url);
        if (real is null) return new(LinkKind.Refused, url);
        if (Directory.Exists(real)) return new(LinkKind.Folder, real);
        if (customApp is not null && File.Exists(customApp)) return new(LinkKind.CustomApp, real, customApp);
        // The type is the real file's, so a link called notes.md that points at a script is a script.
        return DocumentTypes.Contains(Path.GetExtension(real)) ? new(LinkKind.DefaultApp, real) : new(LinkKind.ShowInFolder, real);
    }

    /// <summary>
    /// The real path of a repo path: each folder and link on the way followed, so a junction in the middle counts as much as the last part.
    /// Null if it isn't a repo path, doesn't exist, or ends up outside the repo.
    /// Known limit: a link whose target is stored in another spelling of the same folder (8.3 short names, a different case on a
    /// case-sensitive disk) is refused rather than followed.
    /// </summary>
    public static string? Locate(string repoRoot, string repoPath)
    {
        if (!Checks.IsRepoPath(repoPath)) return null;
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(repoRoot));
        var current = root;
        foreach (var part in repoPath.TrimEnd('/').Split('/'))
        {
            var next = Path.Combine(current, part);
            FileSystemInfo info = Directory.Exists(next) ? new DirectoryInfo(next) : new FileInfo(next);
            if (!info.Exists) return null;
            if (info.LinkTarget is not null)
            {
                var target = info.ResolveLinkTarget(returnFinalTarget: true);
                if (target is null || !target.Exists) return null;
                next = Path.TrimEndingDirectorySeparator(target.FullName);
            }
            if (!IsInside(root, next)) return null;
            current = next;
        }
        return current;
    }

    private static bool IsInside(string root, string path)
    {
        var prefix = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;
        return path.Equals(root, PathComparison) || path.StartsWith(prefix, PathComparison);
    }
}
