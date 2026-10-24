namespace Flowy.Core;

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

    /// <summary>The paths to the keys the file left with no value (see <see cref="EmptyKeys"/>), which the checks report. Any key counts, known or not.</summary>
    public IReadOnlyList<string[]> NoValue { get; init; } = EmptyKeys.Of(null);
}

public sealed record Connection(string? From, string? To, string? Label)
{
    /// <summary>The paths to the keys the file left with no value (see <see cref="EmptyKeys"/>).</summary>
    public IReadOnlyList<string[]> NoValue { get; init; } = EmptyKeys.Of(null);
}

/// <summary>
/// One step of a flow. Without <c>To</c>, the <c>From</c> box does something on its own. <c>Animation</c> is what the file
/// held under <c>animation</c>: text, a mapping or a list, which <see cref="Animations"/> reads and the checks report on.
/// <c>Group</c>, <c>Lane</c> and <c>FlowId</c> are the step's <c>group</c>, <c>lane</c> and <c>flow</c> keys, text when present (see Structure.cs).
/// <c>States</c> is what the file held under <c>states</c>: a mapping of shape id to state word if it is well formed, which <see cref="States"/> reads and the checks report on; null when the key is not there.
/// </summary>
public sealed record Step(string? From, string? To, string? Text, string? Description, object? Animation = null, string? Group = null, string? Lane = null, string? FlowId = null, object? States = null)
{
    /// <summary>The paths to the keys the file left with no value (see <see cref="EmptyKeys"/>), this step's own, down into its animation and states.</summary>
    public IReadOnlyList<string[]> NoValue { get; init; } = EmptyKeys.Of(null);
}

/// <summary>
/// A flow. <c>Groups</c> is the flow's <c>groups:</c> as the file held it: each id's mapping, whose known options
/// (<c>kind</c>, <c>text</c>, <c>times</c>, <c>until</c>) are text and whose other keys may hold anything; null when there is none.
/// <c>States</c> is the flow's <c>states:</c> as the file held it (where shapes stand before step 1), read by <see cref="States"/>; null when there is none.
/// </summary>
public sealed record Flow(string? Name, string? View, IReadOnlyList<Step> Steps, OrderedDictionary<string, object?>? Groups = null, object? States = null)
{
    /// <summary>The paths to the keys the file left with no value in everything but the steps (the name, the groups, the states and any other key), which say their own.</summary>
    public IReadOnlyList<string[]> NoValue { get; init; } = EmptyKeys.Of(null);

    /// <summary>The flow's <c>compare:</c> as the file held it: text, a mapping, or anything else a file can hold (the check says what is wrong with it); null when there is none.</summary>
    public object? CompareRaw { get; init; }

    /// <summary>The flow this one compares with, when <see cref="CompareRaw"/> reads as a tag.</summary>
    public CompareTag? Compare => Compares.Of(CompareRaw);

    /// <summary>The flow's <c>tags:</c> as the file held it: a list of text if it is well formed (the checks report a word that is not a valid tag), else the blank it was; null when there is none.</summary>
    public object? TagsRaw { get; init; }

    /// <summary>The tags that are well formed, each once whatever its case, in the order written (see <see cref="Names.TagsOf"/>).</summary>
    public IReadOnlyList<string> Tags => Names.TagsOf(TagsRaw);
}

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

    /// <summary>
    /// The folder each flow's file sits in under <c>flows/</c>, as a path of names ("payments/refunds"), by flow id. A flow at the top of <c>flows/</c> has no entry. It is where the file is, not
    /// something the file says, so it is never written into a flow. Twin of <c>Model.folders</c> in src/core/model.ts.
    /// </summary>
    public IReadOnlyDictionary<string, string> Folders { get; init; } = new Dictionary<string, string>();

    /// <summary>The folder a flow's file is in ("" at the top of <c>flows/</c>).</summary>
    public string FolderOf(string id) => Folders.TryGetValue(id, out var folder) ? folder : "";

    /// <summary>Every folder that has a flow in it or in a folder inside it, as paths, in path order. A folder with nothing in it is not here: it is no part of the model.</summary>
    public List<string> FolderPaths()
    {
        var paths = new HashSet<string>();
        foreach (var folder in Folders.Values)
        {
            var names = folder.Split('/');
            for (var i = 1; i <= names.Length; i++) paths.Add(string.Join('/', names.Take(i)));
        }
        return [.. paths.Order(StringComparer.Ordinal)];
    }

    /// <summary>The failure analyses of <c>failures/</c>, by file name. A file that couldn't be read is not here (see <see cref="Folder.FailureProblems"/>).</summary>
    public IdMap<FailureAnalysis> Failures { get; init; } = new();

    /// <summary>View id → object id → where the box was dragged to.</summary>
    public IReadOnlyDictionary<string, IReadOnlyDictionary<string, LayoutPoint>> Layout { get; init; } =
        new Dictionary<string, IReadOnlyDictionary<string, LayoutPoint>>();

    /// <summary>The other top-level keys of model.yaml, as the file held them.</summary>
    public IReadOnlyDictionary<string, object?> Meta { get; init; } = new Dictionary<string, object?>();

    /// <summary>The project's line style. Anything unknown draws straight; the checks report it.</summary>
    public string LineStyle => Meta.TryGetValue("lines", out var v) && v is string s && Names.LineStyles.Contains(s) ? s : "straight";

    /// <summary>The project's name: the top-level <c>name:</c> in model.yaml. Empty when there is none (the checks report a value that isn't text).</summary>
    public string ProjectName => Meta.TryGetValue("name", out var v) && v is string s ? s.Trim() : "";

    /// <summary>What the project is, in Markdown: the top-level <c>about:</c> in model.yaml. Empty when there is none.</summary>
    public string ProjectAbout => Meta.TryGetValue("about", out var v) && v is string s ? s.Trim() : "";

    /// <summary>The object with this id, or null (also for "root", which is no object).</summary>
    public FlowyObject? GetObject(string? id) => id is not null && id != Names.Root && Objects.TryGetValue(id, out var o) ? o : null;

    /// <summary>
    /// A model put together from what the files of a folder gave: model.yaml (null: there is none), the flows, the layout, and the failure analyses (none by default).
    /// The folder loader and the editor both build their model here, so they agree on what a missing part is. <paramref name="folders"/> is the folder of each flow that is in one (none: all at the top).
    /// </summary>
    public static Model FromParts(ModelFiles.ParsedModel? parsed, IdMap<Flow> flows, IReadOnlyDictionary<string, IReadOnlyDictionary<string, LayoutPoint>> layout, IdMap<FailureAnalysis>? failures = null,
        IReadOnlyDictionary<string, string>? folders = null) => new()
    {
        Objects = parsed?.Objects ?? new IdMap<FlowyObject>(),
        Connections = parsed?.Connections ?? [],
        Meta = parsed?.Meta ?? new Dictionary<string, object?>(),
        Flows = flows,
        Folders = folders ?? new Dictionary<string, string>(),
        Failures = failures ?? new IdMap<FailureAnalysis>(),
        Layout = layout,
    };

    /// <summary>Whether a box is an outside service: <c>external: true</c>.</summary>
    public static bool IsExternal(FlowyObject o) => o.External == "true";
}
