namespace Flowy.Core;

/// <summary>
/// What a model folder looks like: <c>model.yaml</c>, <c>layout.yaml</c>, and a file for each id in <c>flows/</c> (in folders under it too), <c>failures/</c> and <c>perf/</c>. Names and the way a path
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

    /// <summary>
    /// Where a flow with this id lives, relative to the folder: <c>flows/&lt;id&gt;.yaml</c>, or <c>flows/&lt;folder&gt;/&lt;id&gt;.yaml</c> for a flow filed in a folder ("" is the top).
    /// A port of <c>pathOf</c> in src/core/filekinds.ts.
    /// </summary>
    public static string FlowFile(string id, string folder = "") => $"{FlowsDir}/{(folder == "" ? "" : folder + "/")}{id}{Extension}";

    /// <summary>Where a failure analysis lives: <c>failures/&lt;id&gt;.yaml</c>.</summary>
    public static string FailureFile(string id) => $"{FailuresDir}/{id}{Extension}";

    /// <summary>Where a run lives: <c>perf/&lt;id&gt;.yaml</c>.</summary>
    public static string PerfFile(string id) => $"{PerfDir}/{id}{Extension}";

    /// <summary>
    /// The id of a flow file, or null for any other path (or an empty id): the file's name alone, in <c>flows/&lt;id&gt;.yaml</c> or in a folder of flows. Whether the id is a valid one is for <see cref="Names.IsValidId"/>.
    /// A port of <c>idOfPath</c> in src/core/filekinds.ts.
    /// </summary>
    public static string? FlowIdOf(string rel)
    {
        if (IdIn(FlowsDir, rel) is not { } inside) return null;
        var id = inside[(inside.LastIndexOf('/') + 1)..];
        return id == "" ? null : id;
    }

    /// <summary>
    /// The folder a path is in under <c>flows/</c>: "" at the top. Whatever follows <c>flows/</c> is taken as the folder and the file name, so this is not checked to be a flow file;
    /// <see cref="Names.IsValidFolder"/> says whether the folder can be used. A port of <c>folderUnder</c> in src/core/filekinds.ts.
    /// </summary>
    public static string FlowFolderOf(string rel)
    {
        var inside = rel.Length > FlowsDir.Length + 1 ? rel[(FlowsDir.Length + 1)..] : "";
        return inside.Contains('/') ? inside[..inside.LastIndexOf('/')] : "";
    }

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

    /// <summary>
    /// Whether a change at this path (relative to the folder) can alter the model: the two files, or anything inside the three folders. A draft's folder, and the model.yaml in it, change the list of
    /// drafts but not the model, so they count as well; what else is in a draft does not.
    /// </summary>
    public static bool IsPartOfModel(string rel)
    {
        var parts = rel.Split('\\', '/');
        return parts[0] is ModelFile or LayoutFile or FlowsDir or PerfDir or FailuresDir || (parts[0] == Drafts.Folder && (parts.Length == 2 || (parts.Length == 3 && parts[2] == ModelFile)));
    }

    private static string? IdIn(string dir, string rel)
    {
        var start = dir.Length + 1;
        return rel.Length > start + Extension.Length && rel.StartsWith(dir, StringComparison.Ordinal) && rel[dir.Length] == '/' && rel.EndsWith(Extension, StringComparison.Ordinal)
            ? rel[start..^Extension.Length]
            : null;
    }
}
