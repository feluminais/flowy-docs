namespace Flowy.Core;

/// <summary>One sketch as a list of them shows it: its folder name and the <c>name:</c> of its model.yaml (the id when it has none).</summary>
public sealed record SketchInfo(string Id, string Name);

/// <summary>
/// A sketch is a model of its own in <c>sketches/&lt;id&gt;/</c> of the model folder: the same files, read and written the same way. The model never reads it. A shape's <c>code</c> and
/// <c>links</c> paths in a sketch start from the repo (the folder that holds the model folder), as in the model. Sketches used to be called drafts and lived in <c>drafts/&lt;id&gt;/</c>:
/// that folder is still read and a sketch found there is a sketch like any other, but new ones are written to <c>sketches/</c>, and when both folders hold an id the one in
/// <c>sketches/</c> is the sketch. The twin of src/core/sketches.ts and src/node/sketches.ts.
/// </summary>
public static class Sketches
{
    public const string Folder = "sketches";

    /// <summary>The folder sketches had before the rename. Read, never written to.</summary>
    public const string LegacyFolder = "drafts";

    private static readonly string[] Folders = [Folder, LegacyFolder];

    /// <summary>Whether a folder name is one a sketch can be in: <c>sketches</c>, or the old <c>drafts</c>.</summary>
    public static bool IsFolderName(string? name) => name is Folder or LegacyFolder;

    /// <summary>Where sketch <paramref name="id"/> of the model folder <paramref name="modelDir"/> is: in <c>sketches/</c>, else in the old <c>drafts/</c>. A sketch that is nowhere yet is where it would be made, in <c>sketches/</c>.</summary>
    public static string DirOf(string modelDir, string id)
    {
        var full = Path.GetFullPath(modelDir);
        foreach (var folder in Folders)
        {
            var dir = Path.Combine(full, folder, id);
            if (File.Exists(Path.Combine(dir, FolderLayout.ModelFile))) return dir;
        }
        return Path.Combine(full, Folder, id);
    }

    /// <summary>The model folder a sketch folder belongs to: <paramref name="dir"/> is <c>&lt;model&gt;/sketches/&lt;id&gt;</c> (or the old <c>&lt;model&gt;/drafts/&lt;id&gt;</c>) with a valid id, and the model holds a model.yaml. Null when <paramref name="dir"/> is no sketch.</summary>
    public static string? ModelOf(string dir)
    {
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(dir));
        var sketches = Path.GetDirectoryName(full);
        if (sketches is null || !IsFolderName(Path.GetFileName(sketches)) || !Names.IsValidId(Path.GetFileName(full))) return null;
        var model = Path.GetDirectoryName(sketches);
        return model is not null && File.Exists(Path.Combine(model, FolderLayout.ModelFile)) ? model : null;
    }

    /// <summary>The folder a shape's <c>code</c> and <c>links</c> paths start from: the one that holds the model folder, which for a sketch is the one that holds its model's.</summary>
    public static string RepoOf(string dir)
    {
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(dir));
        var model = ModelOf(full) ?? full;
        return Path.GetDirectoryName(model) ?? model;
    }

    /// <summary>Whether the model folder <paramref name="modelDir"/> has sketch <paramref name="id"/>: its folder, in <c>sketches/</c> or the old <c>drafts/</c>, holds a model.yaml.</summary>
    public static bool Has(string modelDir, string id) => Names.IsValidId(id) && File.Exists(Path.Combine(DirOf(modelDir, id), FolderLayout.ModelFile));

    /// <summary>The <c>name:</c> of the model.yaml in <paramref name="dir"/>: "" when it has none or the file can't be read.</summary>
    public static string NameOfModel(string dir)
    {
        try
        {
            return FileText.Read(dir, FolderLayout.ModelFile) is { } text && ModelFiles.ParseModel(text).Meta.TryGetValue("name", out var name) && name is string s ? s.Trim() : "";
        }
        catch (Exception e) when (e is ParseError or IOException or UnauthorizedAccessException)
        {
            return "";
        }
    }

    /// <summary>The names of the folders in <c>sketches/</c> and the old <c>drafts/</c> of <paramref name="modelDir"/>, each once. None when there is neither folder.</summary>
    private static SortedSet<string> FolderNames(string modelDir)
    {
        var found = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var folder in Folders)
        {
            try
            {
                foreach (var name in Directory.EnumerateDirectories(Path.Combine(Path.GetFullPath(modelDir), folder)).Select(Path.GetFileName).OfType<string>()) found.Add(name);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                // no such folder, or one that can't be read: it holds no sketches
            }
        }
        return found;
    }

    /// <summary>The sketches of the model folder <paramref name="modelDir"/>, by id: each folder in <c>sketches/</c> or the old <c>drafts/</c> whose name is an id and that holds a model.yaml. None when there is neither folder.</summary>
    public static IReadOnlyList<SketchInfo> List(string modelDir) =>
        FolderNames(modelDir).Where(id => Has(modelDir, id)).Select(id => new SketchInfo(id, NameOfModel(DirOf(modelDir, id)) is { Length: > 0 } name ? name : id)).ToList();

    /// <summary>
    /// Makes an empty sketch called <paramref name="name"/> in the model folder <paramref name="modelDir"/>: <c>sketches/&lt;id&gt;/model.yaml</c> with the name, <c>pairs: separate</c> (a line for each connection, as in src/core/sketches.ts <c>newSketch</c>), no shapes and no lines. The id is made from the name
    /// (see <see cref="Navigation.NewId"/>) and is never one that has a folder already, in <c>sketches/</c> or the old <c>drafts/</c>. Returns the sketch's folder. Throws <see cref="OpError"/> with the reason when it can't be made.
    /// </summary>
    public static string Create(string modelDir, string name)
    {
        name = name.Trim();
        if (name == "") throw new OpError("Give the sketch a name.");
        var dir = Path.Combine(Path.GetFullPath(modelDir), Folder, Navigation.NewId(name, FolderNames(modelDir), "sketch"));
        var text = YamlWriter.Write(new OrderedDictionary<string, object?> { ["name"] = name, ["pairs"] = "separate", ["objects"] = new OrderedDictionary<string, object?>(), ["connections"] = new List<object?>() });
        try
        {
            Directory.CreateDirectory(dir);
            FileStore.Save(dir, FolderLayout.ModelFile, text, null);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or VersionConflict)
        {
            try
            {
                Directory.Delete(dir, true);
            }
            catch (Exception cleanup) when (cleanup is IOException or UnauthorizedAccessException)
            {
                // keep the real error, not a cleanup one
            }
            throw new OpError(e.Message);
        }
        return dir;
    }
}
