namespace Flowy.Core;

/// <summary>One draft as a list of them shows it: its folder name and the <c>name:</c> of its model.yaml (the id when it has none).</summary>
public sealed record DraftInfo(string Id, string Name);

/// <summary>
/// A draft is a model of its own in <c>drafts/&lt;id&gt;/</c> of the model folder: the same files, read and written the same way. The model never reads it. A shape's <c>code</c> and
/// <c>links</c> paths in a draft start from the repo (the folder that holds the model folder), as in the model. The twin of src/core/drafts.ts and src/node/drafts.ts.
/// </summary>
public static class Drafts
{
    public const string Folder = "drafts";

    /// <summary>The folder of draft <paramref name="id"/> of the model folder <paramref name="modelDir"/>.</summary>
    public static string DirOf(string modelDir, string id) => Path.Combine(Path.GetFullPath(modelDir), Folder, id);

    /// <summary>The model folder a draft folder belongs to: <paramref name="dir"/> is <c>&lt;model&gt;/drafts/&lt;id&gt;</c> with a valid id, and the model holds a model.yaml. Null when <paramref name="dir"/> is no draft.</summary>
    public static string? ModelOf(string dir)
    {
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(dir));
        var drafts = Path.GetDirectoryName(full);
        if (drafts is null || Path.GetFileName(drafts) != Folder || !Names.IsValidId(Path.GetFileName(full))) return null;
        var model = Path.GetDirectoryName(drafts);
        return model is not null && File.Exists(Path.Combine(model, FolderLayout.ModelFile)) ? model : null;
    }

    /// <summary>The folder a shape's <c>code</c> and <c>links</c> paths start from: the one that holds the model folder, which for a draft is the one that holds its model's.</summary>
    public static string RepoOf(string dir)
    {
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(dir));
        var model = ModelOf(full) ?? full;
        return Path.GetDirectoryName(model) ?? model;
    }

    /// <summary>Whether the model folder <paramref name="modelDir"/> has draft <paramref name="id"/>: its folder holds a model.yaml.</summary>
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

    /// <summary>The drafts of the model folder <paramref name="modelDir"/>, by id: each folder in <c>drafts/</c> whose name is an id and that holds a model.yaml. None when there is no <c>drafts/</c>.</summary>
    public static IReadOnlyList<DraftInfo> List(string modelDir)
    {
        string[] names;
        try
        {
            names = Directory.EnumerateDirectories(Path.Combine(Path.GetFullPath(modelDir), Folder)).Select(Path.GetFileName).OfType<string>().ToArray();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return [];
        }
        Array.Sort(names, StringComparer.Ordinal);
        return names.Where(id => Has(modelDir, id)).Select(id => new DraftInfo(id, NameOfModel(DirOf(modelDir, id)) is { Length: > 0 } name ? name : id)).ToList();
    }

    /// <summary>
    /// Makes an empty draft called <paramref name="name"/> in the model folder <paramref name="modelDir"/>: <c>drafts/&lt;id&gt;/model.yaml</c> with the name, no shapes and no lines. The id is made from the name
    /// (see <see cref="Navigation.NewId"/>) and is never one that has a folder already. Returns the draft's folder. Throws <see cref="OpError"/> with the reason when it can't be made.
    /// </summary>
    public static string Create(string modelDir, string name)
    {
        name = name.Trim();
        if (name == "") throw new OpError("Give the draft a name.");
        var drafts = Path.Combine(Path.GetFullPath(modelDir), Folder);
        var taken = Directory.Exists(drafts) ? Directory.EnumerateDirectories(drafts).Select(Path.GetFileName).OfType<string>().ToList() : [];
        var dir = DirOf(modelDir, Navigation.NewId(name, taken, "draft"));
        var text = YamlWriter.Write(new OrderedDictionary<string, object?> { ["name"] = name, ["objects"] = new OrderedDictionary<string, object?>(), ["connections"] = new List<object?>() });
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
