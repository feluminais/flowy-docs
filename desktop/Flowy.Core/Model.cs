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
public sealed record FlowyObject(string? Type, string? Name, string? In, string? External, string? Tech, string? Description, object? Code, object? Links = null)
{
    /// <summary>How the object is drawn (see <see cref="Look"/>): <c>shape:</c>, <c>color:</c>, <c>opacity:</c> and <c>icon:</c>, plain text when present.</summary>
    public string? Shape { get; init; }

    public string? Color { get; init; }

    public string? Opacity { get; init; }

    public string? Icon { get; init; }

    /// <summary>A store's <c>data</c> as the file held it: a list if it is well formed, which <see cref="StoreData"/> reads and the checks report on.</summary>
    public object? Data { get; init; }

    /// <summary>The <c>snippets</c> as the file held them: a list if it is well formed, which <see cref="Snippets"/> reads and the checks report on.</summary>
    public object? Snippets { get; init; }
}

public sealed record Connection(string? From, string? To, string? Label);

/// <summary>
/// One step of a flow. Without <c>To</c>, the <c>From</c> box does something on its own. <c>Animation</c> is what the file
/// held under <c>animation</c>: text, a mapping or a list, which <see cref="Animations"/> reads and the checks report on.
/// <c>Group</c>, <c>Lane</c> and <c>FlowId</c> are the step's <c>group</c>, <c>lane</c> and <c>flow</c> keys, text when present (see Structure.cs).
/// <c>States</c> is what the file held under <c>states</c>: a mapping of shape id to state word if it is well formed, which <see cref="States"/> reads and the checks report on; null when the key is not there.
/// </summary>
public sealed record Step(string? From, string? To, string? Text, string? Description, object? Animation = null, string? Group = null, string? Lane = null, string? FlowId = null, object? States = null);

/// <summary>
/// A flow. <c>Groups</c> is the flow's <c>groups:</c> as the file held it: each id's mapping, whose known options
/// (<c>kind</c>, <c>text</c>, <c>times</c>, <c>until</c>) are text and whose other keys may hold anything; null when there is none.
/// <c>States</c> is the flow's <c>states:</c> as the file held it (where shapes stand before step 1), read by <see cref="States"/>; null when there is none.
/// </summary>
public sealed record Flow(string? Name, string? View, IReadOnlyList<Step> Steps, OrderedDictionary<string, object?>? Groups = null, object? States = null);

/// <summary>The three ratings a failure mode keeps under <c>after</c>, as the text of a whole number from 1 to 10 (every file value is text).</summary>
public sealed record FailureRatings(string? Severity, string? Occurrence, string? Detection);

/// <summary>
/// One way a part can fail, in a failure analysis. <c>On</c> names a shape, or <c>From</c> and <c>To</c> a line. Every known field is text when present
/// (the ratings too: Failures reads them as numbers), <c>After</c> holds the ratings once the next action is done and <c>Affects</c> lists the shapes it hurts.
/// </summary>
public sealed record FailureMode(
    string? Mode, string? On, string? From, string? To, string? Effect, string? Cause, string? Severity, string? Occurrence, string? Detection,
    string? Controls, string? Action, string? Owner, string? Status, string? Flow, string? Step, string? Run, string? Description,
    FailureRatings? After, IReadOnlyList<string>? Affects);

/// <summary>What the two ends of a rating mean, for the picked mode's detail.</summary>
public sealed record RatingEnds(string? Low, string? High);

/// <summary>A failure analysis: <c>failures/&lt;id&gt;.yaml</c>. <c>Scope</c> is "root" or a shape with children; a missing name reads as "".</summary>
public sealed record FailureAnalysis(string Name, string? About, string? Scope, OrderedDictionary<string, RatingEnds>? Scale, IdMap<FailureMode> Modes);

public readonly record struct LayoutPoint(double X, double Y);

public sealed class Model
{
    public IdMap<FlowyObject> Objects { get; init; } = new();

    public IReadOnlyList<Connection> Connections { get; init; } = [];

    public IdMap<Flow> Flows { get; init; } = new();

    /// <summary>The failure analyses of <c>failures/</c>, by file name. A file that couldn't be read is not here (see <see cref="Folder.FailureProblems"/>).</summary>
    public IdMap<FailureAnalysis> Failures { get; init; } = new();

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
