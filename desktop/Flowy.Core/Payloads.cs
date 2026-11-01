namespace Flowy.Core;

/// <summary>
/// The data a line carries and a flow step sends: a name, and any mix of a few words about it, its whole shape and a filled-in example. A model describes each
/// once under <c>payloads:</c> in model.yaml, by id, and a connection's <c>payloads:</c> list or a step's <c>payload:</c> and <c>reply:</c> name it; either can also
/// hold one written out in place. The twin of src/core/payloads.ts, word for word in its problems.
/// </summary>
public static class Payloads
{
    public const int MaxLines = 400;
    public const int MaxChars = 40000;
    public const int MaxPerLine = 12;
    public const int MaxInModel = 200;

    /// <summary>A payload's shape or example: some code, in a language if you like.</summary>
    public sealed record CodeBlock(string Text, string? Language);

    /// <summary>A payload as a reader shows it: <c>Id</c> only for one under <c>payloads:</c>, <c>Name</c> always filled in, and only the code blocks that hold code.</summary>
    public sealed record Shown(string? Id, string Name, string? About, CodeBlock? Shape, CodeBlock? Example);

    /// <summary>The animation kinds that send something back, so a step of one of them may say what its reply carries.</summary>
    public static readonly string[] ReplyKinds = ["call", "callback", "recurse"];

    private static bool HasText(object? v) => !JsCompat.Blank(v);

    private static OrderedDictionary<string, object?>? All(Model m) => m.Meta.TryGetValue("payloads", out var all) ? all as OrderedDictionary<string, object?> : null;

    /// <summary>The entries of <c>payloads:</c> that are mappings, in the order the browser reads them.</summary>
    public static OrderedDictionary<string, OrderedDictionary<string, object?>> Of(Model m)
    {
        var shown = new OrderedDictionary<string, OrderedDictionary<string, object?>>();
        if (All(m) is not { } all) return shown;
        foreach (var id in JsCompat.OrderKeys(all.Keys))
            if (all[id] is OrderedDictionary<string, object?> p) shown[id] = p;
        return shown;
    }

    private static CodeBlock? BlockOf(object? v) =>
        v is OrderedDictionary<string, object?> map && map.TryGetValue("text", out var text) && text is string code && !Snippets.IsBlank(code)
        && (!map.TryGetValue("language", out var language) || language is null or string)
            ? new CodeBlock(code, map.TryGetValue("language", out var l) ? l as string : null)
            : null;

    private static Shown ShownOf(OrderedDictionary<string, object?> p, string name, string? id) =>
        new(id, name, p.TryGetValue("about", out var about) && HasText(about) ? (string)about! : null, BlockOf(p.GetValueOrDefault("shape")), BlockOf(p.GetValueOrDefault("example")));

    /// <summary>The payload a connection or a step names: an id finds the entry (named after the id when it has none), a mapping with a name is itself; anything else finds nothing.</summary>
    public static Shown? Resolve(Model m, object? reference)
    {
        if (reference is string id)
            return All(m) is { } all && all.TryGetValue(id, out var entry) && entry is OrderedDictionary<string, object?> p
                ? ShownOf(p, p.TryGetValue("name", out var name) && HasText(name) ? (string)name! : id, id)
                : null;
        return reference is OrderedDictionary<string, object?> inline && inline.TryGetValue("name", out var own) && HasText(own) ? ShownOf(inline, (string)own!, null) : null;
    }

    /// <summary>The payloads a connection carries that resolve, in its order.</summary>
    public static List<Shown> OfConnection(Model m, Connection c) =>
        c.Payloads is List<object?> list ? [.. list.Select(r => Resolve(m, r)).OfType<Shown>()] : [];

    /// <summary>What a step sends.</summary>
    public static Shown? OfStep(Model m, Step s) => Resolve(m, s.Payload);

    /// <summary>What comes back to a step.</summary>
    public static Shown? ReplyOf(Model m, Step s) => Resolve(m, s.Reply);

    /// <summary>Whether a payload says something: a few words about it, a shape or an example.</summary>
    private static bool SaysSomething(OrderedDictionary<string, object?> p) =>
        HasText(p.GetValueOrDefault("about")) || p.GetValueOrDefault("shape") is not null || p.GetValueOrDefault("example") is not null;

    private static IEnumerable<string> BlockProblems(string at, string key, object? v)
    {
        if (v is null) yield break;
        if (v is not OrderedDictionary<string, object?> map)
        {
            yield return $"{at}: {key} must be a mapping with text and, if you like, a language";
            yield break;
        }
        var text = map.GetValueOrDefault("text");
        if (text is null || (text is string blank && Snippets.IsBlank(blank))) yield return $"{at}: {key} has no text";
        else if (text is not string code) yield return $"{at}: {key} must be a mapping with text and, if you like, a language";
        else
        {
            var lines = Snippets.CodeLines(code);
            if (lines.Count > MaxLines) yield return $"{at}: {key} is {lines.Count} lines, at most {MaxLines}";
            var chars = string.Join('\n', lines).Length;
            if (chars > MaxChars) yield return $"{at}: {key} is {chars} characters, at most {MaxChars}";
        }
        var language = map.GetValueOrDefault("language");
        if (language is not (null or ""))
        {
            if (language is not string named) yield return $"{at}: {key}: language must be plain text";
            else if (Snippets.LanguageOf(named) is null)
                yield return $"{at}: {key}: unknown language \"{named}\" (use {string.Join(", ", Snippets.Languages.Select(l => l.Id))}, or leave it out to have it worked out)";
        }
    }

    private static List<string> EntryProblems(string at, object? entry, bool inline)
    {
        if (entry is not OrderedDictionary<string, object?> p) return [$"{at} must be a mapping"];
        var out_ = new List<string>();
        var name = p.GetValueOrDefault("name");
        if (name is not (null or string)) out_.Add($"{at}: name must be plain text");
        else if (inline && !HasText(name)) out_.Add($"{at} has no name");
        if (p.GetValueOrDefault("about") is not (null or string)) out_.Add($"{at}: about must be plain text");
        if (!SaysSomething(p)) out_.Add($"{at} says nothing: give it an about, a shape or an example");
        out_.AddRange(BlockProblems(at, "shape", p.GetValueOrDefault("shape")));
        out_.AddRange(BlockProblems(at, "example", p.GetValueOrDefault("example")));
        return out_;
    }

    /// <summary>What is wrong with the top-level <c>payloads:</c> of model.yaml, each message whole.</summary>
    public static List<string> ModelProblems(IReadOnlyDictionary<string, object?> meta)
    {
        if (!meta.TryGetValue("payloads", out var all) || all is null or "") return [];
        if (all is not OrderedDictionary<string, object?> map) return ["payloads must map ids to payloads"];
        var found = new List<string>();
        foreach (var id in JsCompat.OrderKeys(map.Keys))
        {
            if (!Names.IsValidId(id)) found.Add($"payload {id}: ids {Names.IdRule}");
            found.AddRange(EntryProblems($"payload {id}", map[id], false));
        }
        if (map.Count > MaxInModel) found.Add($"{map.Count} payloads, at most {MaxInModel}");
        return found;
    }

    private static IEnumerable<string> ReferenceProblems(Model m, string at, string word, object? reference) =>
        reference is string id ? (All(m)?.ContainsKey(id) == true ? [] : [$"unknown {word} \"{id}\""]) : EntryProblems(at, reference, true);

    /// <summary>What is wrong with a connection's <c>payloads:</c>, without the "connection a → b: " the checks put before it.</summary>
    public static List<string> ConnectionProblems(Model m, Connection c)
    {
        if (c.Payloads is null) return [];
        if (c.Payloads is not List<object?> list) return ["payloads must be a list of payload ids or payloads"];
        var found = list.SelectMany((r, i) => ReferenceProblems(m, $"payload {i + 1}", "payload", r)).ToList();
        if (list.Count > MaxPerLine) found.Add($"{list.Count} payloads, at most {MaxPerLine}");
        return found;
    }

    /// <summary>What is wrong with a step's <c>payload:</c> and <c>reply:</c>, without the "step N: " the checks put before it.</summary>
    public static List<string> StepProblems(Model m, Step s)
    {
        var found = new List<string>();
        var kind = Animations.Read(s)?.Kind;
        if (s.Payload is not null)
        {
            found.AddRange(ReferenceProblems(m, "payload", "payload", s.Payload));
            if (s.To is null && kind != "recurse") found.Add("a payload needs a \"to\": nothing is sent");
        }
        if (s.Reply is not null)
        {
            found.AddRange(ReferenceProblems(m, "reply", "reply", s.Reply));
            if (!ReplyKinds.Contains(kind)) found.Add("a reply needs a call, a callback or a recurse animation");
        }
        return found;
    }

    /// <summary>One payload a drawn line carries: <c>Back</c> when it runs from the line's <c>to</c> to its <c>from</c>, <c>Own</c> when a connection the line draws lists it, and the flow steps that send it (<c>Step</c> from 0; <c>Reply</c> when it is what comes back).</summary>
    public sealed record Carried(Shown Payload, bool Back, bool Own, List<(string Flow, int Step, bool Reply)> Steps);

    /// <summary>What the line from <paramref name="from"/> to <paramref name="to"/> in <paramref name="view"/> carries, as lineCarries in src/core/payloads.ts says it.</summary>
    public static List<Carried> OnLine(Model m, string view, string from, string to)
    {
        var line = Views.LineKey(from, to);
        var rows = new List<Carried>();
        var byId = new Dictionary<string, Carried>();
        Carried? Add(object? reference, bool back, bool own)
        {
            var id = reference as string;
            if (id is not null && byId.TryGetValue(id, out var known)) return known;
            if (Resolve(m, reference) is not { } payload) return null;
            var row = new Carried(payload, back, own, []);
            rows.Add(row);
            if (id is not null) byId[id] = row;
            return row;
        }
        foreach (var c in m.Connections)
        {
            if (Views.PlaceEnds(m, view, c.From, c.To) is not { } ends || Views.LineKey(ends.From, ends.To) != line || c.Payloads is not List<object?> list) continue;
            foreach (var reference in list) Add(reference, ends.From != from, true);
        }
        foreach (var (flow, f) in m.Flows)
        {
            for (var i = 0; i < f.Steps.Count; i++)
            {
                var s = f.Steps[i];
                if (s.To is null || s.From is null) continue;
                if (Views.PlaceStep(m, view, s.From, s.To) is not { } ends || ends.From == ends.To || Views.LineKey(ends.From, ends.To) != line) continue;
                var back = ends.From != from;
                if (s.Payload is not null) Add(s.Payload, back, false)?.Steps.Add((flow, i, false));
                if (s.Reply is not null) Add(s.Reply, !back, false)?.Steps.Add((flow, i, true));
            }
        }
        return rows;
    }

    /// <summary>How a step's motion plays, with the words its payloads give it, as motionOf in src/core/payloads.ts says.</summary>
    public static StepAnimation? MotionOf(Model m, Step s)
    {
        if (Animations.Read(s) is not { } a) return null;
        var sends = OfStep(m, s)?.Name;
        var answer = ReplyOf(m, s)?.Name;
        return a with
        {
            Carries = a.Carries is null && a.Share is null && sends is not null ? sends : a.Carries,
            Replies = a.Kind == "call" && answer is not null ? answer : a.Replies,
            Returns = a.Kind == "recurse" && a.Returns is null && answer is not null ? answer : a.Returns,
        };
    }
}

