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

    /// <summary>flow id → the folder its file sits in under flows/ ("payments/refunds"). A flow at the top of flows/ has no entry, and an id with no flow is never here. Where the file is, never written into a flow.</summary>
    public OrderedDictionary<string, string> Folders { get; init; } = [];

    /// <summary>analysis id → the analysis's map (name, scope, modes: a map of mode maps, and anything else). Only analyses that can be read are here; one that can't is left alone.</summary>
    public OrderedDictionary<string, object?> Failures { get; init; } = [];

    /// <summary>view → box id → [x, y] as text.</summary>
    public OrderedDictionary<string, object?> Layout { get; init; } = [];

    // ---- reading -------------------------------------------------------------------------------------------------

    /// <summary>For sections: an empty value, <c>~</c> or <c>null</c> means empty (the same rule as <see cref="ModelFiles"/>).</summary>

    /// <summary>
    /// The trees of a folder's files. A null text is a file that isn't there. Throws <see cref="ParseError"/> for a file whose shape is wrong, as loading does.
    /// <paramref name="flowFolders"/> is the folder of each flow whose file is in one (flow id → folder); none puts every flow at the top of flows/.
    /// </summary>
    public static EditDoc Parse(string? modelText, string? layoutText, IEnumerable<KeyValuePair<string, string>> flowTexts, IEnumerable<KeyValuePair<string, string>>? failureTexts = null,
        IReadOnlyDictionary<string, string>? flowFolders = null)
    {
        var doc = new EditDoc();
        if (modelText is not null)
        {
            ModelFiles.ParseModel(modelText); // the shape check, with its messages
            if (YamlText.Parse(FolderLayout.ModelFile, modelText) is OrderedDictionary<string, object?> top)
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
            var folder = flowFolders is not null && flowFolders.TryGetValue(id, out var where) ? where : "";
            ModelFiles.ParseFlow(id, text, folder);
            var flow = YamlText.Parse(FolderLayout.FlowFile(id, folder), text) as OrderedDictionary<string, object?> ?? [];
            // Like parseFlowFile: a missing or empty steps is an empty list, in the key's own place, else last.
            flow["steps"] = flow.TryGetValue("steps", out var steps) && !JsCompat.IsEmpty(steps) ? steps : new List<object?>();
            // Like parseFlowFile: a blank `groups:` is no section.
            if (flow.TryGetValue("groups", out var groups) && JsCompat.IsEmpty(groups)) flow.Remove("groups");
            doc.Flows[id] = flow;
            if (folder != "") doc.Folders[id] = folder;
        }
        foreach (var (id, text) in failureTexts ?? [])
        {
            ModelFiles.ParseAnalysis(id, text);
            var analysis = YamlText.Parse(FolderLayout.FailureFile(id), text) as OrderedDictionary<string, object?> ?? [];
            // Like parseAnalysisFile: a name that isn't text reads as "", `modes` is always a map, and a blank `after`, `affects` or `scale` is no section.
            if (analysis.GetValueOrDefault("name") is not string) analysis["name"] = "";
            var modes = JsCompat.IsEmpty(analysis.GetValueOrDefault("modes")) ? [] : (OrderedDictionary<string, object?>)analysis["modes"]!;
            foreach (var (_, raw) in modes)
            {
                var mode = (OrderedDictionary<string, object?>)raw!;
                foreach (var key in new[] { "after", "affects" })
                    if (mode.TryGetValue(key, out var section) && JsCompat.IsEmpty(section)) mode.Remove(key);
            }
            analysis["modes"] = modes;
            if (analysis.TryGetValue("scale", out var scale) && JsCompat.IsEmpty(scale)) analysis.Remove("scale");
            doc.Failures[id] = analysis;
        }
        if (layoutText is not null)
        {
            ModelFiles.ParseLayout(layoutText);
            if (YamlText.Parse(FolderLayout.LayoutFile, layoutText) is OrderedDictionary<string, object?> views)
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
        Folders = new OrderedDictionary<string, string>(Folders),
        Failures = CopyMap(Failures),
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

    /// <summary>Every file as path → text: model.yaml, each flow and each failure analysis (in JavaScript's key order), and layout.yaml. Layout is last, as a separate write.</summary>
    public Dictionary<string, string> ToFiles()
    {
        var files = new Dictionary<string, string> { [FolderLayout.ModelFile] = YamlWriter.Write(ModelTree()) };
        foreach (var id in JsCompat.OrderKeys(Flows.Keys)) files[FolderLayout.FlowFile(id, Folders.GetValueOrDefault(id, ""))] = YamlWriter.Write(Flows[id]);
        foreach (var id in JsCompat.OrderKeys(Failures.Keys)) files[FolderLayout.FailureFile(id)] = YamlWriter.Write(Failures[id]);
        files[FolderLayout.LayoutFile] = YamlWriter.WriteLayout(Layout);
        return files;
    }

    /// <summary>The typed model the checks read: this doc written out and read back, so it is exactly what a reader of the saved files would see.</summary>
    public Model ToModel() => FromFiles(ToFiles());

    public static Model FromFiles(IReadOnlyDictionary<string, string> files)
    {
        var parsed = files.TryGetValue(FolderLayout.ModelFile, out var modelText) ? ModelFiles.ParseModel(modelText) : null;
        var flows = new IdMap<Flow>();
        var folders = new Dictionary<string, string>();
        foreach (var (rel, text) in files)
        {
            if (!rel.StartsWith(FolderLayout.FlowsDir + "/", StringComparison.Ordinal)) continue;
            // The id is the file's name alone, and the folder is what lies between flows/ and it.
            var id = FolderLayout.FlowIdOf(rel) ?? "";
            var folder = FolderLayout.FlowFolderOf(rel);
            flows.Add(id, ModelFiles.ParseFlow(id, text, folder));
            if (folder != "") folders[id] = folder;
        }
        var failures = new IdMap<FailureAnalysis>();
        foreach (var (rel, text) in files)
            if (FolderLayout.FailureIdOf(rel) is { } aid) failures.Add(aid, ModelFiles.ParseAnalysis(aid, text));
        var layout = files.TryGetValue(FolderLayout.LayoutFile, out var layoutText) ? ModelFiles.ParseLayout(layoutText) : [];
        return Model.FromParts(parsed, flows, layout, failures, folders);
    }
}
