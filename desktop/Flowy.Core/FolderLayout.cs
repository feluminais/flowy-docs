namespace Flowy.Core;

/// <summary>
/// What a model folder looks like: <c>model.yaml</c>, <c>layout.yaml</c>, and a file for each id in <c>flows/</c>, <c>failures/</c> and <c>perf/</c>. Names and the way a path
/// turns into a kind and an id, as constants and pure functions, so the loader, the editor, the watcher and the problem list agree on one spelling.
/// </summary>
public static class FolderLayout
{
    public const string ModelFile = "model.yaml";

    public const string LayoutFile = "layout.yaml";

    public const string FlowsDir = "flows";

    public const string FailuresDir = "failures";

    public const string PerfDir = "perf";

    /// <summary>The extension Flowy reads.</summary>
    public const string Extension = ".yaml";

    /// <summary>The spelling Flowy does not read: a file that ends in it is reported and ignored.</summary>
    public const string IgnoredExtension = ".yml";

    /// <summary>Where a flow with this id lives, relative to the folder: <c>flows/&lt;id&gt;.yaml</c>.</summary>
    public static string FlowFile(string id) => $"{FlowsDir}/{id}{Extension}";

    /// <summary>Where a failure analysis lives: <c>failures/&lt;id&gt;.yaml</c>.</summary>
    public static string FailureFile(string id) => $"{FailuresDir}/{id}{Extension}";

    /// <summary>Where a run lives: <c>perf/&lt;id&gt;.yaml</c>.</summary>
    public static string PerfFile(string id) => $"{PerfDir}/{id}{Extension}";

    /// <summary>The id in <c>flows/&lt;id&gt;.yaml</c>, or null for any other path (or an empty id). Whether the id is a valid one is for <see cref="Names.IsValidId"/>.</summary>
    public static string? FlowIdOf(string rel) => IdIn(FlowsDir, rel);

    /// <summary>The id in <c>failures/&lt;id&gt;.yaml</c>, or null for any other path.</summary>
    public static string? FailureIdOf(string rel) => IdIn(FailuresDir, rel);

    /// <summary>The id of a file name that ends in <c>.yaml</c> (<c>order.yaml</c> is <c>order</c>).</summary>
    public static string IdOfName(string name) => name[..^Extension.Length];

    /// <summary>Whether a file name is one Flowy reads (<c>.yaml</c>).</summary>
    public static bool IsRead(string name) => name.EndsWith(Extension, StringComparison.Ordinal);

    /// <summary>Whether a file name is the ignored spelling (<c>.yml</c>).</summary>
    public static bool IsIgnored(string name) => name.EndsWith(IgnoredExtension, StringComparison.Ordinal);

    /// <summary>The name a <c>.yml</c> file should have: <c>order.yml</c> becomes <c>order.yaml</c>.</summary>
    public static string RenamedFromIgnored(string name) => name[..^IgnoredExtension.Length] + Extension;

    /// <summary>Whether a change at this path (relative to the folder) can alter the model: the two files, or anything inside the three folders.</summary>
    public static bool IsPartOfModel(string rel) => rel.Split('\\', '/')[0] is ModelFile or LayoutFile or FlowsDir or PerfDir or FailuresDir;

    private static string? IdIn(string dir, string rel)
    {
        var start = dir.Length + 1;
        return rel.Length > start + Extension.Length && rel.StartsWith(dir, StringComparison.Ordinal) && rel[dir.Length] == '/' && rel.EndsWith(Extension, StringComparison.Ordinal)
            ? rel[start..^Extension.Length]
            : null;
    }
}
