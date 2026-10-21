using System.Globalization;

namespace Flowy.Core;

/// <summary>
/// A model folder as editable YAML trees, not as the typed <see cref="Model"/>: the typed model keeps only the fields Flowy knows, and an edit
/// must not drop a hand-written <c>owner:</c> on a box or a <c>note:</c> on a step. Text values stay text, lists stay lists and maps keep their
/// order; <see cref="ToFiles"/> writes them out as the browser does, and <see cref="ToModel"/> reads that back into the typed model so the
/// checks can look at it. This is the twin of <c>Model</c> in src/core/model.ts, which also holds the other top-level keys of model.yaml in
/// <see cref="Meta"/> and writes them before <c>objects</c> and <c>connections</c>.
/// </summary>
public sealed class EditDoc
{
    /// <summary>The top-level keys of model.yaml other than objects and connections (<c>lines:</c>, anything hand-written).</summary>
    public OrderedDictionary<string, object?> Meta { get; init; } = [];

    /// <summary>id → the object's map.</summary>
    public OrderedDictionary<string, object?> Objects { get; init; } = [];

    /// <summary>Each a map: from, to, label and anything else.</summary>
    public List<object?> Connections { get; init; } = [];

    /// <summary>flow id → the flow's map (name, view, steps: a list of maps, and anything else).</summary>
    public OrderedDictionary<string, object?> Flows { get; init; } = [];

    /// <summary>view → box id → [x, y] as text.</summary>
    public OrderedDictionary<string, object?> Layout { get; init; } = [];

    // ---- reading -------------------------------------------------------------------------------------------------

    /// <summary>For sections: an empty value, <c>~</c> or <c>null</c> means empty (the same rule as <see cref="ModelFiles"/>).</summary>

    /// <summary>The trees of a folder's files. A null text is a file that isn't there. Throws <see cref="ParseError"/> for a file whose shape is wrong, as loading does.</summary>
    public static EditDoc Parse(string? modelText, string? layoutText, IEnumerable<KeyValuePair<string, string>> flowTexts)
    {
        var doc = new EditDoc();
        if (modelText is not null)
        {
            ModelFiles.ParseModel(modelText); // the shape check, with its messages
            if (YamlText.Parse("model.yaml", modelText) is OrderedDictionary<string, object?> top)
            {
                foreach (var (key, value) in top)
                {
                    if (key == "objects") { if (!JsCompat.IsEmpty(value)) foreach (var (id, o) in (OrderedDictionary<string, object?>)value!) doc.Objects[id] = o; }
                    else if (key == "connections") { if (!JsCompat.IsEmpty(value)) doc.Connections.AddRange((List<object?>)value!); }
                    else doc.Meta[key] = value;
                }
            }
        }
        foreach (var (id, text) in flowTexts)
        {
            ModelFiles.ParseFlow(id, text);
            var flow = YamlText.Parse($"flows/{id}.yaml", text) as OrderedDictionary<string, object?> ?? [];
            // Like parseFlowFile: a missing or empty steps is an empty list, in the key's own place, else last.
            flow["steps"] = flow.TryGetValue("steps", out var steps) && !JsCompat.IsEmpty(steps) ? steps : new List<object?>();
            // Like parseFlowFile: a blank `groups:` is no section.
            if (flow.TryGetValue("groups", out var groups) && JsCompat.IsEmpty(groups)) flow.Remove("groups");
            doc.Flows[id] = flow;
        }
        if (layoutText is not null)
        {
            ModelFiles.ParseLayout(layoutText);
            if (YamlText.Parse("layout.yaml", layoutText) is OrderedDictionary<string, object?> views)
            {
                foreach (var (view, boxes) in views)
                {
                    var saved = new OrderedDictionary<string, object?>();
                    if (!JsCompat.IsEmpty(boxes))
                        foreach (var (id, p) in (OrderedDictionary<string, object?>)boxes!)
                        {
                            var pair = (List<object?>)p!;
                            saved[id] = new List<object?> { JsCompat.Number(Parse(pair[0])), JsCompat.Number(Parse(pair[1])) };
                        }
                    doc.Layout[view] = saved;
                }
            }
        }
        return doc;
    }

    private static double Parse(object? text) => double.Parse((string)text!, NumberStyles.Float, CultureInfo.InvariantCulture);

    // ---- copying -------------------------------------------------------------------------------------------------

    private static object? Copy(object? node) => node switch
    {
        OrderedDictionary<string, object?> map => CopyMap(map),
        List<object?> list => list.Select(Copy).ToList(),
        _ => node,
    };

    private static OrderedDictionary<string, object?> CopyMap(OrderedDictionary<string, object?> map)
    {
        var copy = new OrderedDictionary<string, object?>();
        foreach (var (key, value) in map) copy[key] = Copy(value);
        return copy;
    }

    /// <summary>A copy that shares nothing with this one, so an edit that is refused leaves the original as it was.</summary>
    public EditDoc Clone() => new()
    {
        Meta = CopyMap(Meta),
        Objects = CopyMap(Objects),
        Connections = Connections.Select(Copy).ToList(),
        Flows = CopyMap(Flows),
        Layout = CopyMap(Layout),
    };

    // ---- writing -------------------------------------------------------------------------------------------------

    /// <summary>model.yaml's content as the TypeScript writes it: the other keys first, then objects, then connections, which are always there.</summary>
    private OrderedDictionary<string, object?> ModelTree()
    {
        var tree = new OrderedDictionary<string, object?>();
        foreach (var (key, value) in Meta) tree[key] = value;
        tree["objects"] = StoreData.Compact(Objects);
        tree["connections"] = Connections;
        return tree;
    }

    /// <summary>Every file as path → text: model.yaml, each flow (in JavaScript's key order), and layout.yaml. Layout is last, as a separate write.</summary>
    public Dictionary<string, string> ToFiles()
    {
        var files = new Dictionary<string, string> { ["model.yaml"] = YamlWriter.Write(ModelTree()) };
        foreach (var id in JsCompat.OrderKeys(Flows.Keys)) files[$"flows/{id}.yaml"] = YamlWriter.Write(Flows[id]);
        files["layout.yaml"] = YamlWriter.WriteLayout(Layout);
        return files;
    }

    /// <summary>The typed model the checks read: this doc written out and read back, so it is exactly what a reader of the saved files would see.</summary>
    public Model ToModel() => FromFiles(ToFiles());

    public static Model FromFiles(IReadOnlyDictionary<string, string> files)
    {
        var parsed = files.TryGetValue("model.yaml", out var modelText) ? ModelFiles.ParseModel(modelText) : null;
        var flows = new IdMap<Flow>();
        foreach (var (rel, text) in files)
            if (rel.StartsWith("flows/", StringComparison.Ordinal)) flows.Add(rel["flows/".Length..^".yaml".Length], ModelFiles.ParseFlow(rel["flows/".Length..^".yaml".Length], text));
        var layout = files.TryGetValue("layout.yaml", out var layoutText) ? ModelFiles.ParseLayout(layoutText) : [];
        return new Model
        {
            Objects = parsed?.Objects ?? new IdMap<FlowyObject>(),
            Connections = parsed?.Connections ?? [],
            Meta = parsed?.Meta ?? new Dictionary<string, object?>(),
            Flows = flows,
            Layout = layout,
        };
    }
}
