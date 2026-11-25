using static Flowy.Core.YamlTree;

namespace Flowy.Core;

/// <summary>
/// A part of the model that takes a <c>code</c> list, as <c>CodeHolder</c> in src/core/ops.ts: a shape (<c>Object</c>), a connection (<c>Line</c>, the first
/// from → to with that label), a flow or one of its steps (<c>Flow</c>, with <c>Step</c> counting from 0), a failure mode (<c>Analysis</c> and <c>Mode</c>),
/// or a payload under <c>payloads:</c> in model.yaml. Give one of them.
/// </summary>
public sealed record CodeHolder(string? Object = null, ConnectionInput? Line = null, string? Flow = null, int? Step = null, string? Analysis = null, string? Mode = null, string? Payload = null);

public static partial class EditOps
{
    /// <summary><paramref name="holder"/> with its <c>code</c> set, in place when it has one (a new one goes last); an empty list removes it.</summary>
    private static void WithCode(OrderedDictionary<string, object?> holder, IReadOnlyList<string> code)
    {
        if (code.Count == 0) holder.Remove("code");
        else holder["code"] = code.Select(c => (object?)c).ToList();
    }

    /// <summary>
    /// Set the files and lines one part of the model is in (see <see cref="CodeHolder"/>). Replaces the list; an empty one removes it. Each entry is <c>path</c>
    /// or <c>path:line</c>, and the paths are checked when the edit is saved, as a shape's are. The twin of <c>setCode</c> in src/core/ops.ts.
    /// </summary>
    public static EditDoc SetCode(EditDoc doc, CodeHolder holder, IEnumerable<string> code)
    {
        var list = code.Select(c => JsCompat.JsTrim(c)).Where(c => c != "").ToList();
        if (holder.Object is { } id)
        {
            if (ObjectOf(doc, id) is null) throw new OpError($"unknown object \"{id}\"");
            var d = doc.Clone();
            WithCode(Entry(d.Objects[id]), list);
            return d;
        }
        if (holder.Line is { } line)
        {
            var i = FindConnection(doc, line);
            var d = doc.Clone();
            WithCode(Entry(d.Connections[i]), list);
            return d;
        }
        if (holder.Flow is { } flowId)
        {
            if (holder.Step is { } index)
                return OnStep(doc, flowId, index, (d, _, steps) =>
                {
                    WithCode(Entry(steps[index]), list);
                    return d;
                });
            return OnFlow(doc, flowId, (d, flow) =>
            {
                WithCode(flow, list);
                return d;
            });
        }
        if (holder.Analysis is { } aid)
        {
            var mode = holder.Mode ?? "";
            if (ExistingAnalysis(doc, aid).GetValueOrDefault("modes") is not OrderedDictionary<string, object?> modes || !modes.ContainsKey(mode)) throw new OpError($"unknown failure mode \"{mode}\" in \"{aid}\"");
            return OnAnalysis(doc, aid, analysis => WithCode(Entry(ModesIn(analysis)[mode]), list));
        }
        var payload = holder.Payload ?? "";
        if (PayloadsOf(doc) is not { } all || all.GetValueOrDefault(payload) is not OrderedDictionary<string, object?>) throw new OpError($"unknown payload \"{payload}\"");
        var copy = doc.Clone();
        WithCode(Entry(PayloadsOf(copy)![payload]), list);
        return copy;
    }
}
