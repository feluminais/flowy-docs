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

/// <summary>
/// One box. Every known field is plain text when present; <c>null</c> means the key isn't there and
/// <c>""</c> means it's there with nothing after it. <c>Code</c> and <c>Links</c> are what the file held: a list if it is
/// well formed, which the checks report when it isn't.
/// </summary>
public sealed record FlowyObject(string? Type, string? Name, string? In, string? External, string? Tech, string? Description, object? Code, object? Links = null);

public sealed record Connection(string? From, string? To, string? Label);

/// <summary>One step of a flow. Without <c>To</c>, the <c>From</c> box does something on its own.</summary>
public sealed record Step(string? From, string? To, string? Text, string? Description);

public sealed record Flow(string? Name, string? View, IReadOnlyList<Step> Steps);

public readonly record struct LayoutPoint(double X, double Y);

public sealed class Model
{
    public IdMap<FlowyObject> Objects { get; init; } = new();

    public IReadOnlyList<Connection> Connections { get; init; } = [];

    public IdMap<Flow> Flows { get; init; } = new();

    /// <summary>View id → object id → where the box was dragged to.</summary>
    public IReadOnlyDictionary<string, IReadOnlyDictionary<string, LayoutPoint>> Layout { get; init; } =
        new Dictionary<string, IReadOnlyDictionary<string, LayoutPoint>>();

    /// <summary>The other top-level keys of model.yaml, as the file held them.</summary>
    public IReadOnlyDictionary<string, object?> Meta { get; init; } = new Dictionary<string, object?>();

    /// <summary>The project's line style. Anything unknown draws straight; the checks report it.</summary>
    public string LineStyle => Meta.TryGetValue("lines", out var v) && v is string s && Names.LineStyles.Contains(s) ? s : "straight";

    /// <summary>The object with this id, or null (also for "root", which is no object).</summary>
    public FlowyObject? GetObject(string? id) => id is not null && id != Names.Root && Objects.TryGetValue(id, out var o) ? o : null;

    /// <summary>Whether a box is an outside service: <c>external: true</c>.</summary>
    public static bool IsExternal(FlowyObject o) => o.External == "true";
}
