using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>Names the files agree on, from src/core/model.ts.</summary>
public static partial class Names
{
    public const string Root = "root";

    public static readonly string[] ObjectTypes = ["actor", "system", "app", "store", "component"];

    public static readonly string[] LineStyles = ["straight", "curved", "angled"];

    /// <summary>What an id (an object's, or a flow's file name) may be, worded to follow "ids".</summary>
    public const string IdRule = "use lowercase letters, digits and dashes, not starting with a dash (\"root\" is reserved)";

    public static bool IsValidId(string id) => IdPattern().IsMatch(id) && id != Root;

    // \z, not $: .NET's $ also matches before a final newline, which the TypeScript test does not.
    [GeneratedRegex(@"^[a-z0-9][a-z0-9-]*\z", RegexOptions.CultureInvariant)]
    private static partial Regex IdPattern();

    /// <summary>What a folder of flows may be called: each name between the slashes of its path. <see cref="IsValidFolder"/> is the test.</summary>
    public const string FolderRule = "use names with no \\ / : * ? \" < > | # % and no control characters, not starting with a dot or a space, not ending in a dot or a space, 64 characters at most, and nest no deeper than 6 folders";

    private const int MaxFolderDepth = 6;
    private const int MaxFolderNameLength = 64;
    private const string NotInFolderName = "\\/:*?\"<>|#%";

    // The Windows device names, in either case, alone or with an extension. Written out in ASCII so the case rule is the TypeScript /i, not .NET's.
    [GeneratedRegex(@"^(?:[Cc][Oo][Nn]|[Pp][Rr][Nn]|[Aa][Uu][Xx]|[Nn][Uu][Ll]|[Cc][Oo][Mm][1-9]|[Ll][Pp][Tt][1-9])(?:\.[^\n\r  ]*)?\z", RegexOptions.CultureInvariant)]
    private static partial Regex ReservedName();

    private static bool IsValidFolderName(string name)
    {
        if (name.Length == 0 || name.Length > MaxFolderNameLength) return false;
        // The first character may not be white space or a dot either; the last may not be a dot or a space.
        if (JsCompat.IsSpace(name[0]) || name[0] == '.' || name[^1] is '.' or ' ') return false;
        foreach (var c in name)
            if (c <= 0x1f || NotInFolderName.Contains(c)) return false;
        return !ReservedName().IsMatch(name);
    }

    /// <summary>Whether <paramref name="folder"/> is a path Flowy writes flows into: "" (the top of flows/), or names joined by "/".</summary>
    public static bool IsValidFolder(string folder) => folder == "" || (folder.Split('/') is var names && names.Length <= MaxFolderDepth && names.All(IsValidFolderName));

    /// <summary>The longest a tag on a flow may be.</summary>
    public const int MaxTagLength = 32;

    /// <summary>The tags a flow's form offers before any flow has them, in this order: what kind of walkthrough it is. Any other word is a tag too.</summary>
    public static readonly string[] SuggestedTags = ["happy path", "error path", "edge case", "recovery", "background"];

    /// <summary>Whether a value is a tag: a short piece of text with no space at either end and no control character (see <see cref="TagsOf"/>). The checks report one that is not.</summary>
    public static bool IsValidTag(object? tag) =>
        tag is string s && s == JsCompat.JsTrim(s) && s.Length is > 0 and <= MaxTagLength && !s.Any(c => c <= 0x1f);

    /// <summary>A tag as the filter compares it: whatever the case.</summary>
    public static string TagKey(string tag) => tag.ToLowerInvariant();

    /// <summary>The tags a flow's <c>tags:</c> holds: the ones that are well formed, each once whatever its case, in the order written. Anything but a list has none. The checks report the rest.</summary>
    public static List<string> TagsOf(object? raw)
    {
        var seen = new HashSet<string>();
        var tags = new List<string>();
        if (raw is not List<object?> list) return tags;
        foreach (var item in list)
            if (IsValidTag(item) && seen.Add(TagKey((string)item!))) tags.Add((string)item!);
        return tags;
    }
}
