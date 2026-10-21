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
}
