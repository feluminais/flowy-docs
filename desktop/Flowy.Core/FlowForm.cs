namespace Flowy.Core;

/// <summary>What a step's animation says, read for the edit form: its kind, outcome, share, reason, the shape that takes it and the name that does. All text, "" when not there.</summary>
public readonly record struct AnimationFields(string Kind, string Outcome, string Share, string Reason, string By, string ByName, string Opens = "", string Name = "", string Towards = "", string Closes = "");

/// <summary>
/// The rules behind the flow edit form that need no controls: what text stands for a step, which fields an outcome switches on, and how a pick
/// changes a step's data. The recorder draws the result. Each "block" is the reason in a tooltip, or null when the choice is open.
/// </summary>
public static class FlowForm
{
    /// <summary>What the form refuses when the steps in the files are no longer the ones it shows.</summary>
    public const string StepsChanged = "The steps just changed. Check them and try again.";

    private static string? Field(OrderedDictionary<string, object?> map, string key) => map.TryGetValue(key, out var v) ? v as string : null;

    // ---- telling whether the steps on screen are still the steps in the files ------------------------------------

    /// <summary>The text the step list shows for a step, to tell whether what an edit will change is still what is on screen.</summary>
    public static string Signature(Step step) => string.Join('\u0001', step.From, step.To, step.Text, step.Description);

    public static string Signature(OrderedDictionary<string, object?> step) =>
        string.Join('\u0001', Field(step, "from"), Field(step, "to"), Field(step, "text"), Field(step, "description"));

    /// <summary>Whether <paramref name="steps"/> (as the files hold them now) are the steps whose <paramref name="shown"/> signatures the form drew.</summary>
    public static bool StepsAreShown(IEnumerable<OrderedDictionary<string, object?>> steps, IReadOnlyList<string> shown) =>
        steps.Select(Signature).SequenceEqual(shown);

    /// <summary>Refuses an edit, in the form's words, when the steps are no longer the ones shown.</summary>
    public static void RequireShown(IEnumerable<OrderedDictionary<string, object?>> steps, IReadOnlyList<string> shown)
    {
        if (!StepsAreShown(steps, shown)) throw new OpError(StepsChanged);
    }

    // ---- groups --------------------------------------------------------------------------------------------------

    /// <summary>The <c>kind</c> of the group <paramref name="id"/> in a flow's <c>groups</c>, or null when it has none.</summary>
    public static string? KindOf(OrderedDictionary<string, object?> groups, string id) =>
        groups.TryGetValue(id, out var g) && g is OrderedDictionary<string, object?> map ? Field(map, "kind") : null;

    /// <summary>Whether steps of a group of this kind are split into lanes.</summary>
    public static bool HasLanes(string? kind) => kind is "branch" or "parallel";

    // ---- states --------------------------------------------------------------------------------------------------

    /// <summary>The state a step sets a shape to, or "" when it does not say (or says something that is not a state).</summary>
    public static string StateWord(object? states, string shape) =>
        states is OrderedDictionary<string, object?> map && map.TryGetValue(shape, out var v) && v is string word && States.Names.Contains(word) ? word : "";

    /// <summary>
    /// A step's <c>states</c> with <paramref name="shape"/> set to <paramref name="word"/> ("" takes it out). Every other entry is kept as it is, so a pick changes
    /// only what it was asked to; an entry that is not text can't be kept in a map of text, and is left out. Twin of <c>pickStepState</c> in ui/src/edit.ts.
    /// </summary>
    public static OrderedDictionary<string, string> StatesWith(OrderedDictionary<string, object?> step, string shape, string word)
    {
        var next = new OrderedDictionary<string, string>();
        if (step.TryGetValue("states", out var own) && own is OrderedDictionary<string, object?> map)
            foreach (var id in JsCompat.OrderKeys(map.Keys))
                if (id != shape && map[id] is string text) next[id] = text;
        if (word != "") next[shape] = word;
        return next;
    }

    // ---- animation -----------------------------------------------------------------------------------------------

    /// <summary>What a step's <c>animation</c> says: a kind alone, or a mapping with a kind and more.</summary>
    public static AnimationFields ReadAnimation(object? raw)
    {
        var map = raw as OrderedDictionary<string, object?> ?? (raw is string bare && bare != "" ? new OrderedDictionary<string, object?> { ["kind"] = bare } : []);
        string Text(string key) => map.TryGetValue(key, out var v) && v is string s ? s : "";
        var by = map.TryGetValue("by", out var taker) ? taker : null;
        return new(Text("kind"), Text("outcome"), Text("share"), Text("reason"), by as string ?? "", by is OrderedDictionary<string, object?> named && named.TryGetValue("name", out var n) && n is string name ? name : "",
            Text("opens"), Text("name"), Text("towards"), Text("closes"));
    }

    /// <summary>Whether the step moves a request between two shapes. A step on one shape travels nowhere.</summary>
    public static bool Travels(Step step) => !string.IsNullOrEmpty(step.To) && step.To != step.From;

    /// <summary>Why a way of travelling (the "none" choice is the empty id) can't be picked, or null. Only a step between two shapes can travel.</summary>
    public static string? KindBlock(string kind, bool travels) => kind == "" || travels ? null : "Needs two shapes";

    /// <summary>Why the share and the reason are off, or null: they say how a request ended, so there must be an outcome first.</summary>
    public static string? OutcomeFieldsBlock(string outcome) => outcome != "" ? null : "Pick an outcome first";

    /// <summary>Why <paramref name="shape"/> can't take the request, or null. Only an intercepted request has a taker, and not either end of the step.</summary>
    public static string? TakerBlock(string outcome, string shape, Step step) =>
        outcome != "intercepted" ? "Only for Intercepted" : shape == step.From || shape == step.To ? "An end of the step" : null;

    /// <summary>Why the taker's own name can't be typed, or null.</summary>
    public static string? TakerNameBlock(string outcome) => outcome == "intercepted" ? null : "Only for Intercepted";
}
