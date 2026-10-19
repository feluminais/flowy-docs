using System.Text;

namespace Flowy.Core;

/// <summary>A model folder as the reader shows it: the model and everything wrong with it.</summary>
public sealed record Folder(Model Model, IReadOnlyList<Problem> Problems);

/// <summary>Reads a flowy/ folder. A port of loadDir and loadState in src/node/files.ts, without the parts that write.</summary>
public static class FolderLoader
{
    // Strict: a file that isn't UTF-8 must fail to load, not show replacement characters. GetString keeps a BOM, which Parse strips.
    private static readonly UTF8Encoding Utf8 = new(false, true);

    /// <summary>The file's text, or null when it doesn't exist.</summary>
    private static string? ReadText(string dir, string rel)
    {
        byte[] bytes;
        try
        {
            // Shared with an editor that is saving it, which is what File.ReadAllBytes would refuse.
            using var stream = new FileStream(Path.Combine(dir, rel), FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var copy = new MemoryStream();
            stream.CopyTo(copy);
            bytes = copy.ToArray();
        }
        catch (Exception e) when (e is FileNotFoundException or DirectoryNotFoundException)
        {
            return null;
        }
        catch (UnauthorizedAccessException) when (Directory.Exists(Path.Combine(dir, rel)))
        {
            throw new ParseError(rel, "is a folder, not a file.");
        }
        try
        {
            return Utf8.GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            throw new ParseError(rel, "is not UTF-8 text. Save it as UTF-8 and try again.");
        }
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
        var modelText = ReadText(dir, "model.yaml");
        var layoutText = ReadText(dir, "layout.yaml");
        var parsed = modelText is null ? null : ModelFiles.ParseModel(modelText);
        var layout = layoutText is null ? [] : ModelFiles.ParseLayout(layoutText);

        var flows = new IdMap<Flow>();
        var ignored = new List<string>();
        var flowsDir = Path.Combine(dir, "flows");
        if (Directory.Exists(flowsDir))
        {
            var names = Directory.EnumerateFiles(flowsDir).Select(Path.GetFileName).OfType<string>().ToList();
            names.Sort(StringComparer.Ordinal);
            foreach (var name in names.Where(n => n.EndsWith(".yaml", StringComparison.Ordinal)))
            {
                var id = name[..^".yaml".Length];
                var text = ReadText(dir, $"flows/{name}");
                if (text is not null) flows.Add(id, ModelFiles.ParseFlow(id, text));
            }
            ignored.AddRange(names.Where(n => n.EndsWith(".yml", StringComparison.Ordinal)).Select(n => $"flows/{n}"));
        }

        var model = new Model
        {
            Objects = parsed?.Objects ?? new IdMap<FlowyObject>(),
            Connections = parsed?.Connections ?? [],
            Meta = parsed?.Meta ?? new Dictionary<string, object?>(),
            Flows = flows,
            Layout = layout,
        };
        // A flow file that isn't read is no part of the model, so the checks can't see it.
        var skipped = ignored.Select(file => new Problem(file, null,
            $"Flowy reads flow files that end in .yaml, so this one is ignored. Rename it to {file[..^".yml".Length]}.yaml."));
        return new Folder(model, [.. Checks.Run(model, MissingPaths(dir, model)), .. skipped]);
    }
}
