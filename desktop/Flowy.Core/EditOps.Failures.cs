using static Flowy.Core.YamlTree;

namespace Flowy.Core;

/// <summary>
/// What the failure forms change on a mode, in the order they are given (a new key goes after the nearest earlier one, so the order is part of the edit): a text field set to
/// its text (blank removes it), <c>after</c> as a map of rating to text, and <c>affects</c> as a list of shape ids (empty removes it).
/// </summary>
public sealed class ModeChanges
{
    private readonly List<KeyValuePair<string, object?>> _changes = [];

    public IReadOnlyList<KeyValuePair<string, object?>> Changes => _changes;

    /// <summary>Sets a text field: <c>mode</c>, <c>on</c>, <c>from</c>, <c>to</c>, <c>effect</c>, <c>cause</c>, a rating, <c>controls</c>, <c>action</c>, <c>owner</c>, <c>status</c>, <c>flow</c>, <c>step</c>, <c>run</c> or <c>description</c>.</summary>
    public ModeChanges Text(string key, string value)
    {
        _changes.Add(new(key, value));
        return this;
    }

    /// <summary>Sets some of the "after" ratings (a blank one removes it); the ones not named stay.</summary>
    public ModeChanges After(params (string Key, string Value)[] ratings)
    {
        var map = new OrderedDictionary<string, object?>();
        foreach (var (key, value) in ratings) map[key] = value;
        _changes.Add(new("after", map));
        return this;
    }

    /// <summary>Sets the shapes the mode affects; an empty list removes the key.</summary>
    public ModeChanges Affects(IEnumerable<string> ids)
    {
        _changes.Add(new("affects", ids.ToList()));
        return this;
    }

    /// <summary>The changes of a script, as the trees the ops take: a map of key to text, <c>after</c> a map and <c>affects</c> a list.</summary>
    public static ModeChanges Of(OrderedDictionary<string, object?> tree)
    {
        var changes = new ModeChanges();
        foreach (var (key, value) in tree) changes._changes.Add(new(key, value));
        return changes;
    }
}

public static partial class EditOps
{
    private static readonly string[] ModeOrder = ["mode", "on", "from", "to", "effect", "cause", "severity", "occurrence", "detection", "controls", "action", "owner", "status", "after", "affects", "flow", "step", "run", "description"];
    private static readonly string[] AnalysisOrder = ["name", "about", "scope", "scale", "modes"];
    private static readonly string[] RatingOrder = ["severity", "occurrence", "detection"];

    private static OrderedDictionary<string, object?> ExistingAnalysis(EditDoc doc, string id)
    {
        if (!doc.Failures.TryGetValue(id, out var analysis)) throw new OpError($"unknown analysis \"{id}\"");
        if (!Names.IsValidId(id)) throw new OpError($"{FolderLayout.FailureFile(id)} has an invalid file name, so it can't be changed here. Rename or delete it by hand.");
        return Entry(analysis);
    }

    /// <summary>Change a copy of an existing analysis: refuses an unknown one, then runs <paramref name="edit"/> on the copy of the document and the analysis in it.</summary>
    private static EditDoc OnAnalysis(EditDoc doc, string id, Action<OrderedDictionary<string, object?>> edit)
    {
        ExistingAnalysis(doc, id);
        var d = doc.Clone();
        edit(Entry(d.Failures[id]));
        return d;
    }

    private static OrderedDictionary<string, object?> ModesIn(OrderedDictionary<string, object?> analysis)
    {
        if (analysis.GetValueOrDefault("modes") is not OrderedDictionary<string, object?> modes) analysis["modes"] = modes = [];
        return modes;
    }

    /// <summary>Create or replace an analysis with no modes yet. Replacing drops everything the old one had, hand-written extra keys included. A port of putAnalysis in src/core/ops.ts for what the forms write.</summary>
    public static EditDoc PutAnalysis(EditDoc doc, string id, string name)
    {
        if (!Names.IsValidId(id)) throw new OpError($"\"{id}\" is not a valid analysis id: {Names.IdRule}");
        // Analysis ids are file names, and Windows and macOS don't tell Ordering.yaml from ordering.yaml.
        string? clash = doc.Failures.Keys.Cast<string?>().FirstOrDefault(other => other != id && string.Equals(other, id, StringComparison.OrdinalIgnoreCase));
        if (clash is not null) throw new OpError($"{FolderLayout.FailureFile(clash)} already exists and differs only in case. Rename or delete that file by hand.");
        var d = doc.Clone();
        d.Failures[id] = new OrderedDictionary<string, object?> { ["name"] = name, ["modes"] = new OrderedDictionary<string, object?>() };
        return d;
    }

    public static EditDoc DeleteAnalysis(EditDoc doc, string id)
    {
        ExistingAnalysis(doc, id);
        var d = doc.Clone();
        d.Failures.Remove(id);
        return d;
    }

    /// <summary>
    /// Create or replace one mode of an analysis, keeping its place: its sentence and the part it names, a shape (<paramref name="on"/>) or a line (<paramref name="from"/> and <paramref name="to"/>).
    /// Replacing drops everything the old mode had. Blank text is left out.
    /// </summary>
    public static EditDoc PutMode(EditDoc doc, string analysisId, string id, string mode, string? on = null, string? from = null, string? to = null) =>
        OnAnalysis(doc, analysisId, analysis =>
        {
            var written = new OrderedDictionary<string, object?>();
            foreach (var (key, value) in new[] { ("mode", mode), ("on", on), ("from", from), ("to", to) })
                if (value is not null && !JsCompat.Blank(value)) written[key] = value;
            ModesIn(analysis)[id] = written;
        });

    public static EditDoc DeleteMode(EditDoc doc, string analysisId, string id) =>
        OnAnalysis(doc, analysisId, analysis =>
        {
            var modes = ModesIn(analysis);
            if (!modes.ContainsKey(id)) throw new OpError($"unknown failure mode \"{id}\" in \"{analysisId}\"");
            modes.Remove(id);
        });

    /// <summary>
    /// <paramref name="fields"/> with <paramref name="changes"/> applied; a null value removes the key. A key that is already there keeps its place, a new one goes just after the nearest
    /// earlier key of <paramref name="order"/> that is present (at the front when none is), and a key <paramref name="order"/> does not know stays where it was.
    /// A port of withChanges in src/core/ops.ts.
    /// </summary>
    private static OrderedDictionary<string, object?> WithChanges(OrderedDictionary<string, object?> fields, IEnumerable<KeyValuePair<string, object?>> changes, string[] order)
    {
        var entries = fields.ToList();
        foreach (var (key, value) in changes)
        {
            var at = entries.FindIndex(e => e.Key == key);
            if (value is null)
            {
                if (at != -1) entries.RemoveAt(at);
            }
            else if (at != -1) entries[at] = new(key, value);
            else
            {
                var after = -1;
                var nearest = -1;
                for (var i = 0; i < entries.Count; i++)
                {
                    var rank = Array.IndexOf(order, entries[i].Key);
                    if (rank != -1 && rank < Array.IndexOf(order, key) && rank > nearest) (nearest, after) = (rank, i);
                }
                entries.Insert(after + 1, new(key, value));
            }
        }
        var result = new OrderedDictionary<string, object?>();
        foreach (var (key, value) in entries) result[key] = value;
        return result;
    }

    /// <summary>Change some fields of one mode and nothing else: unlike <see cref="PutMode"/>, what a hand wrote there is kept, and a field stays where it is in the file.</summary>
    public static EditDoc UpdateMode(EditDoc doc, string analysisId, string id, ModeChanges changes) =>
        OnAnalysis(doc, analysisId, analysis =>
        {
            var modes = ModesIn(analysis);
            if (!modes.TryGetValue(id, out var raw)) throw new OpError($"unknown failure mode \"{id}\" in \"{analysisId}\"");
            var old = Entry(raw);
            var next = new List<KeyValuePair<string, object?>>();
            foreach (var (key, value) in changes.Changes)
            {
                if (key == "after")
                {
                    var set = Entry(value).Select(r => new KeyValuePair<string, object?>(r.Key, JsCompat.Blank(r.Value) ? null : r.Value)).ToList();
                    var ratings = WithChanges(Entry(old.GetValueOrDefault("after")), set, RatingOrder);
                    next.Add(new(key, ratings.Count > 0 ? ratings : null));
                }
                else if (key == "affects")
                {
                    var ids = value switch { List<string> text => text.Cast<object?>().ToList(), List<object?> list => [.. list], _ => [] };
                    next.Add(new(key, ids.Count > 0 ? ids : null));
                }
                else next.Add(new(key, value is string text && JsCompat.Blank(text) ? null : value));
            }
            modes[id] = WithChanges(old, next, ModeOrder);
        });

    /// <summary>Rename an analysis, or set its about and scope (blank removes those two). A blank name is kept, so the checker can refuse it.</summary>
    public static EditDoc UpdateAnalysis(EditDoc doc, string id, string? name = null, string? about = null, string? scope = null)
    {
        var d = doc.Clone();
        ExistingAnalysis(doc, id);
        var next = new List<KeyValuePair<string, object?>>();
        if (name is not null) next.Add(new("name", name));
        if (about is not null) next.Add(new("about", JsCompat.Blank(about) ? null : about));
        if (scope is not null) next.Add(new("scope", JsCompat.Blank(scope) ? null : scope));
        d.Failures[id] = WithChanges(Entry(d.Failures[id]), next, AnalysisOrder);
        return d;
    }
}
