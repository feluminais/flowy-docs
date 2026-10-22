using System.Text;

namespace Flowy.Core;

/// <summary>Reads the text of a model file.</summary>
internal static class FileText
{
    // Strict: a file that isn't UTF-8 must fail to load, not show replacement characters. GetString keeps a BOM, which the YAML parse strips.
    private static readonly UTF8Encoding Strict = new(false, true);

    /// <summary>
    /// The text of <paramref name="rel"/> in <paramref name="dir"/>, or null when it isn't there. It is read shared with an editor that is saving it, which
    /// <c>File.ReadAllBytes</c> would refuse. Throws <see cref="ParseError"/> for text that isn't UTF-8 or that a link sends outside the folder; any other failure to read (a folder
    /// where a file should be, no access) is the caller's to word.
    /// </summary>
    public static string? Read(string dir, string rel)
    {
        if (!FolderContainment.IsInside(dir, rel)) throw new ParseError(rel, FolderContainment.Outside);
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
            return null;
        }
        try
        {
            return Strict.GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            throw new ParseError(rel, "is not UTF-8 text. Save it as UTF-8 and try again.");
        }
    }
}
