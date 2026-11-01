using static Flowy.Core.YamlTree;

namespace Flowy.Core;

/// <summary>The payload edits: the twins of putPayload, deletePayload, setLinePayloads and setStepPayload in src/core/ops.ts, with the same words in what they refuse.</summary>
public static partial class EditOps
{
    private static OrderedDictionary<string, object?>? PayloadsOf(EditDoc doc) => doc.Meta.TryGetValue("payloads", out var all) ? all as OrderedDictionary<string, object?> : null;

    /// <summary>
    /// Create or update a payload under <c>payloads:</c>. <paramref name="fields"/> holds what changes: a name or an about ("" removes it), a shape or an example
    /// (null removes it); anything else is left out, as put_payload takes no other key. Refused when the payload would say nothing.
    /// </summary>
    public static EditDoc PutPayload(EditDoc doc, string id, IReadOnlyDictionary<string, object?> fields)
    {
        if (!Names.IsValidId(id)) throw new OpError($"\"{id}\" is not a valid id: {Names.IdRule}");
        if (doc.Meta.TryGetValue("payloads", out var held) && held is not (null or "") && held is not OrderedDictionary<string, object?>)
            throw new OpError("payloads in model.yaml is not a mapping of ids to payloads: fix it in the file first");
        var d = doc.Clone();
        var all = PayloadsOf(d) ?? [];
        var next = all.TryGetValue(id, out var prev) && prev is OrderedDictionary<string, object?> was ? Clone(was) : [];
        foreach (var key in new[] { "name", "about" })
            if (fields.TryGetValue(key, out var text) && text is not null) next[key] = text;
        foreach (var key in new[] { "shape", "example" })
            if (fields.TryGetValue(key, out var block))
            {
                if (block is null) next.Remove(key);
                else next[key] = block;
            }
        var tidy = (OrderedDictionary<string, object?>)Payloads.Tidy(next)!;
        if (!Payloads.SaysSomething(tidy)) throw new OpError($"payload {id} says nothing: give it an about, a shape or an example");
        all[id] = tidy;
        d.Meta["payloads"] = all;
        return d;
    }

    /// <summary>Remove a payload. Refused while a connection or a flow step names it.</summary>
    public static EditDoc DeletePayload(EditDoc doc, string id)
    {
        if (PayloadsOf(doc) is not { } all || !all.ContainsKey(id)) throw new OpError($"unknown payload \"{id}\"");
        var users = PayloadUsers(doc, id);
        if (users.Count > 0) throw new OpError($"payload \"{id}\" is used by {string.Join(", ", users)}. Change those first.");
        var d = doc.Clone();
        var rest = PayloadsOf(d)!;
        rest.Remove(id);
        if (rest.Count == 0) d.Meta.Remove("payloads");
        return d;
    }

    /// <summary>Who names the payload: each connection whose list holds its id, then each flow step whose payload or reply is it.</summary>
    private static List<string> PayloadUsers(EditDoc doc, string id)
    {
        var users = new List<string>();
        foreach (var c in doc.Connections)
            if (c is OrderedDictionary<string, object?> map && map.GetValueOrDefault("payloads") is List<object?> list && list.Contains(id))
                users.Add($"connection {map.GetValueOrDefault("from")} → {map.GetValueOrDefault("to")}");
        foreach (var fid in JsCompat.OrderKeys(doc.Flows.Keys))
        {
            if (doc.Flows[fid] is not OrderedDictionary<string, object?> flow || flow.GetValueOrDefault("steps") is not List<object?> steps) continue;
            for (var i = 0; i < steps.Count; i++)
                if (steps[i] is OrderedDictionary<string, object?> s && (Equals(s.GetValueOrDefault("payload"), id) || Equals(s.GetValueOrDefault("reply"), id)))
                    users.Add($"flow {fid} step {i + 1}");
        }
        return users;
    }

    /// <summary>What a line's <c>payloads:</c> holds: each id as it is (it must be under <c>payloads:</c>), each payload written in place tidied.</summary>
    private static List<object?> LineList(EditDoc doc, IEnumerable<object?> list)
    {
        var all = PayloadsOf(doc);
        return [.. list.Select(reference =>
        {
            if (reference is not string id) return Payloads.Tidy(reference);
            if (all is null || !all.TryGetValue(id, out var entry) || entry is not OrderedDictionary<string, object?>) throw new OpError($"unknown payload \"{id}\"");
            return (object?)id;
        })];
    }

    /// <summary>Set what one connection (the first that matches) carries. Replaces the list; none removes it.</summary>
    public static EditDoc SetLinePayloads(EditDoc doc, ConnectionInput which, IReadOnlyList<object?> payloads)
    {
        var i = FindConnection(doc, which);
        var written = payloads.Count == 0 ? null : LineList(doc, payloads);
        var d = doc.Clone();
        var c = Entry(d.Connections[i]);
        if (written is null) c.Remove("payloads");
        else c["payloads"] = written;
        return d;
    }

    /// <summary>
    /// Set what step <paramref name="index"/> sends (<paramref name="key"/> "payload") or gets back ("reply"): an id, or a payload written in place (tidied); null
    /// removes it. An unknown id is refused, and so is a reply on a step that gets no answer.
    /// </summary>
    public static EditDoc SetStepPayload(EditDoc doc, string id, int index, string key, object? value) =>
        OnStep(doc, id, index, (d, _, steps) =>
        {
            var step = Entry(steps[index]);
            if (value is null)
            {
                step.Remove(key);
                return d;
            }
            if (key == "reply")
            {
                var probe = new Step(step.GetValueOrDefault("from") as string, step.GetValueOrDefault("to") as string, null, null, step.GetValueOrDefault("animation"));
                if (!Payloads.ReplyKinds.Contains(Animations.Read(probe)?.Kind)) throw new OpError("a reply needs a call, a callback or a recurse animation");
            }
            step[key] = LineList(doc, [value])[0];
            return d;
        });
}
