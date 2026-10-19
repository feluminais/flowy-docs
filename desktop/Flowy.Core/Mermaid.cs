using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>A view as a Mermaid flowchart, a flow as a sequence diagram: the text a README or pull request draws. A port of src/core/mermaid.ts.</summary>
public static partial class Mermaid
{
    // A backtick after " starts Mermaid markdown, so it is escaped too.
    private static readonly Dictionary<char, string> Entities = new() { ['#'] = "35", [';'] = "59", ['"'] = "quot", ['<'] = "lt", ['>'] = "gt", ['`'] = "96" };

    [GeneratedRegex(@"\s*\n\s*")]
    private static partial Regex LineBreaks();

    [GeneratedRegex("[#;\"<>`]")]
    private static partial Regex Special();

    /// <summary>Text as Mermaid shows it, never as its syntax: quotes, brackets, backticks, # and ; become #code; entities, and new lines become spaces.</summary>
    public static string Text(string text) => Special().Replace(LineBreaks().Replace(text, " "), m => $"#{Entities[m.Value[0]]};");

    private static string NameOf(Model model, string id) => Text(model.GetObject(id) is { Name: { Length: > 0 } name } ? name : id);

    /// <summary>Mermaid ids are made up (n0, n1, …): Flowy ids like "end" or "a-b" would read as Mermaid syntax.</summary>
    private static Dictionary<string, string> Ids(IEnumerable<string> boxes)
    {
        var map = new Dictionary<string, string>();
        foreach (var id in boxes) map.TryAdd(id, $"n{map.Count}");
        return map;
    }

    /// <summary>
    /// A shape as the closest Mermaid node. The newer ones (queue, document, note, cloud) use the <c>@{ shape: }</c> form, which Mermaid 11.3 and
    /// later draw, as GitHub and GitLab do; a folder has no Mermaid shape and stays a rectangle.
    /// </summary>
    private static string Node(string shape, string id, string label) => shape switch
    {
        "pill" => $"{id}([\"{label}\"])",
        "ellipse" => $"{id}((\"{label}\"))",
        "diamond" => $"{id}{{\"{label}\"}}",
        "hexagon" => $"{id}{{{{\"{label}\"}}}}",
        "parallelogram" => $"{id}[/\"{label}\"/]",
        "cylinder" => $"{id}[(\"{label}\")]",
        "arrow" => $"{id}>\"{label}\"]",
        "queue" => $"{id}@{{ shape: h-cyl, label: \"{label}\" }}",
        "document" => $"{id}@{{ shape: doc, label: \"{label}\" }}",
        "note" => $"{id}@{{ shape: fold-rect, label: \"{label}\" }}",
        "cloud" => $"{id}@{{ shape: cloud, label: \"{label}\" }}",
        _ => $"{id}[\"{label}\"]",
    };

    /// <summary>A <c>style</c> line for an object that sets a colour or an opacity: its fill at that opacity, and its outline in the colour when one is set.</summary>
    private static IEnumerable<string> StyleLine(Model model, string id, string node)
    {
        var o = model.GetObject(id)!;
        if (!Look.IsColor(o.Color) && !Look.IsOpacity(o.Opacity)) yield break;
        var hex = Look.ColorPair(Look.IsColor(o.Color) ? o.Color : Look.TypeColor(o))!.Value.Light;
        yield return $"  style {node} fill:{hex},fill-opacity:{(Look.FillOpacity(o) / 100.0).ToString(System.Globalization.CultureInfo.InvariantCulture)}{(Look.IsColor(o.Color) ? $",stroke:{hex}" : "")}";
    }

    /// <summary>A view as a flowchart: its boxes, the boxes around it drawn dashed, and its merged lines.</summary>
    public static string View(Model model, string view)
    {
        if (view != Names.Root && model.GetObject(view) is null) throw new ArgumentException($"unknown view \"{view}\"");
        var v = Views.Compute(model, view);
        var n = Ids([.. v.Members, .. v.Outsiders]);
        string Box(string id)
        {
            var o = model.GetObject(id)!;
            // A box with no type (the checker reports it) reads "undefined" in the browser's diagram too, which is kept so the two agree.
            var label = $"{NameOf(model, id)}<br/>{Text(o.Type ?? "undefined")}{(string.IsNullOrEmpty(o.Tech) ? "" : $" · {Text(o.Tech)}")}";
            return $"  {Node(Look.ShapeOf(o), n[id], label)}";
        }
        var lines = new List<string> { "flowchart TB" };
        lines.AddRange(n.Keys.Select(Box));
        lines.AddRange(v.Edges.Select(e => $"  {n[e.From]} {(e.Label == "" ? "" : $"-- \"{Text(e.Label)}\" ")}--> {n[e.To]}"));
        lines.AddRange(n.SelectMany(kv => StyleLine(model, kv.Key, kv.Value)));
        if (v.Outsiders.Count > 0) lines.AddRange(["  classDef outsider stroke-dasharray: 4 3", $"  class {string.Join(',', v.Outsiders.Select(id => n[id]))} outsider"]);
        return string.Join('\n', lines) + "\n";
    }

    /// <summary>A flow as a sequence diagram, with each step's ends as the boxes its view shows.</summary>
    public static string Flow(Model model, string flowId)
    {
        if (!model.Flows.TryGetValue(flowId, out var flow)) throw new ArgumentException($"unknown flow \"{flowId}\"");
        // A step the view can't show (the checker reports it) keeps its own ends.
        var steps = flow.Steps.Select(s =>
        {
            var (a, b) = Views.PlaceStep(model, flow.View, s.From, s.To) ?? (s.From ?? "", string.IsNullOrEmpty(s.To) ? s.From ?? "" : s.To);
            // A good recursion tag on a step with no "to"; anything else that looks like one is not.
            return (A: a, B: b, Text: Text(s.Text ?? ""), Recursion: Animations.Read(s) is { Kind: "recurse" });
        }).ToList();
        var n = Ids(steps.SelectMany(s => new[] { s.A, s.B }));
        var lines = new List<string> { "sequenceDiagram" };
        lines.AddRange(n.Select(kv => $"  {(model.GetObject(kv.Key)?.Type == "actor" ? "actor" : "participant")} {kv.Value} as {NameOf(model, kv.Key)}"));
        // A step one box does on its own is a note over it, unless it is a recursion: that is an arrow back to the same box.
        lines.AddRange(steps.Select(s => s.A != s.B ? $"  {n[s.A]}->>{n[s.B]}: {s.Text}" : s.Recursion ? $"  {n[s.A]}->>{n[s.A]}: {s.Text}" : $"  Note over {n[s.A]}: {s.Text}"));
        return string.Join('\n', lines) + "\n";
    }
}
