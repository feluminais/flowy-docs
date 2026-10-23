using System.Globalization;
using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>Who takes an intercepted request: a shape of the model (<c>Shape</c>, an id) or a party that is not in it (<c>Name</c>). Exactly one is set.</summary>
public sealed record Interceptor(string? Shape = null, string? Name = null);

/// <summary>
/// A step's animation, read: the kind, who sets a callback off (inside unless the file says outside), the word the blob carries, and how it ends
/// (an entry of <see cref="Animations.Outcomes"/>, or null). <c>Share</c> is the whole percent of the requests that meet the outcome (a burst plays when it is
/// set), <c>Reason</c> says why in a few words, <c>By</c> is who takes an intercepted request and <c>At</c> how far along its line a lost one vanishes.
/// <c>Effect</c> is what the blob does on its way besides travelling (an entry of <see cref="Animations.Effects"/>, or null for nothing).
/// <c>Opens</c> is the kind of channel the step leaves open (an entry of <see cref="Animations.ChannelKinds"/>), <c>Name</c> its name, <c>Towards</c> the end it points at
/// (from or to) and <c>Closes</c> the name of a channel the step closes.
/// </summary>
public sealed record StepAnimation(string Kind, string Trigger, string? Carries, string? Outcome = null, int? Share = null, string? Reason = null, Interceptor? By = null, double? At = null, string? Effect = null,
    string? Opens = null, string? Name = null, string? Towards = null, string? Closes = null);

/// <summary>
/// One thing to draw, in the order beats are listed. <c>Do</c> is pipe, blob, ring, flash, gulp, wait, drop or fade (the lit line dims and stays dim), or one of
/// the five the outcomes added: pop (a puff where a request is lost), bar (a bar at the receiver's door), clock, note (a few words beside where something happens)
/// and marker (the dashed marker of whoever takes a request). <c>On</c> is from, to, line or by (the one who takes a request);
/// times are milliseconds from the start of the step. Dir, Glyph, Tone (reply, or fail for a blob or flash in the danger colour) and Label are set only where
/// they mean something. <c>Start</c> and <c>End</c> are the fractions of the route a blob runs between, <c>Tint</c> a slot of <see cref="Animations.Tints"/>,
/// <c>Ring</c> a ring around a blob, <c>Along</c> where along the route a pop, bar, clock, note or marker sits, and <c>Text</c> a note's reason or a marker's name.
/// </summary>
public sealed record Beat(
    string Do, string On, int At, int Dur, string? Dir = null, string? Glyph = null, string? Tone = null, string? Label = null,
    double? Start = null, double? End = null, int? Tint = null, bool? Ring = null, double? Along = null, string? Text = null);

/// <summary>A port of src/core/animation.ts, with the same wording and the same numbers. desktop/fixtures/beats.ts keeps the two equal.</summary>
public static class Animations
{
    /// <summary>What a blob can do on its way, for the fun of it, each keeping its shape whole. An extra key, so messages that list the options list only <c>Options</c>.</summary>
    public static readonly string[] Effects = ["squish", "bounce", "pulse", "wiggle"];

    public static readonly string[] Kinds = ["send", "call", "callback", "event"];

    public static readonly string[] Triggers = ["inside", "outside"];

    /// <summary>How the exchange a step draws ends: refused, never answered, gone halfway, turned away at the door, taken by a third party, handled twice or held up.</summary>
    public static readonly string[] Outcomes = ["fail", "timeout", "lost", "rejected", "intercepted", "duplicated", "delayed"];

    /// <summary>The outcomes that came after fail and timeout. They are valid on a send, a call and an event, never on a callback.</summary>
    private static readonly string[] TravelOutcomes = ["lost", "rejected", "intercepted", "duplicated", "delayed"];

    private static readonly string[] Options = ["kind", "trigger", "carries", "outcome", "share", "reason", "by", "at", "opens", "name", "towards", "closes"];

    /// <summary>What a step can leave open once its request has arrived, so the story's later steps still show it: a stream, a listener or a job.</summary>
    public static readonly string[] ChannelKinds = ["stream", "listener", "job"];

    public static bool IsChannelKind(object? v) => v is string s && ChannelKinds.Contains(s);

    /// <summary>The end a channel sits at when the step does not say: a stream heads to the step's <c>to</c>, a job runs there, and a listener is the shape that asked (<c>from</c>).</summary>
    public static readonly IReadOnlyDictionary<string, string> DefaultEnd = new Dictionary<string, string> { ["stream"] = "to", ["listener"] = "from", ["job"] = "to" };

    /// <summary>The options that leave a channel open, name it, point it, or close one.</summary>
    private static readonly string[] ChannelOptions = ["opens", "name", "towards", "closes"];

    /// <summary>The longest a reason and an interceptor's name may be, in characters.</summary>
    public const int ReasonMax = 40;
    public const int NameMax = 24;

    /// <summary>Where a lost request vanishes along its line, as a fraction of the way, when the step does not say.</summary>
    public const double LostAt = 0.55;

    /// <summary>The colours a request that meets an outcome in a burst can have, as shape colour names.</summary>
    public static readonly string[] Tints = ["teal", "pink", "purple", "orange"];

    /// <summary>The most characters of a name a blob shows. A longer word is cut with an ellipsis.</summary>
    public const int LabelMax = 16;

    public static string ShortLabel(string label) => label.Length > LabelMax ? label[..(LabelMax - 1)] + "…" : label;

    /// <summary>After the request lands, how long the sender's waiting dots run when nobody answers, and then how long the line takes to fade.</summary>
    private const int TimeoutWait = 1800;
    private const int TimeoutFade = 600;

    /// <summary>How long a reason stays up, and how long a puff, a bar and the wait of a delayed request last.</summary>
    private const int NoteMs = 1600;
    private const int PopMs = 500;
    private const int BarMs = 900;
    private const int DelayHold = 1500;

    /// <summary>Where along the route a rejected request stops, where the bar is, where a delayed one waits and an intercepted one leaves, and where a reason sits for the others.</summary>
    private const double RejectStop = 0.92;
    private const double BarAt = 0.97;
    private const double WaitAt = 0.4;
    private const double LandingNoteAt = 0.88;

    /// <summary>
    /// A burst starts a request every BurstStagger ms, or further apart on a short line so the blobs stay about BlobSpacing px from each other,
    /// and never spreads its starts over more than BurstSpread ms.
    /// </summary>
    private const int BurstStagger = 300;
    private const int BlobSpacing = 36;
    private const int BurstSpread = 4000;

    private static readonly string KindsHint = "use " + string.Join(", ", Kinds);

    private const string ByHint = "animation by must be a shape id or { name: ... }";

    /// <summary>"a, b or c".</summary>
    private static string OrList(string[] words) => words.Length < 2 ? string.Concat(words) : $"{string.Join(", ", words[..^1])} or {words[^1]}";

    /// <summary>A line of plain text for a label: not blank, with no line break and no control character in it.</summary>
    private static bool PlainLine(object? v) =>
        v is string s && !JsCompat.Blank(s)
        && !s.Any(c => char.IsControl(c) || CharUnicodeInfo.GetUnicodeCategory(c) is UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator);

    /// <summary>The share of requests, 1 to 100 whole percent, or null. A file holds every value as text.</summary>
    public static int? ShareOf(object? v)
    {
        if (v is not string s || s.Length is 0 or > 3 || !s.All(c => c is >= '0' and <= '9')) return null;
        var n = int.Parse(s, CultureInfo.InvariantCulture);
        return n is >= 1 and <= 100 ? n : null;
    }

    private static readonly Regex DecimalText = new(@"^[0-9]*\.?[0-9]+\z", RegexOptions.CultureInvariant);

    /// <summary>How far along its line a lost request vanishes, 0.1 to 0.9, from the text of a number; null when it is anything else.</summary>
    public static double? LostAtOf(object? v)
    {
        if (v is not string s || !DecimalText.IsMatch(s)) return null;
        var n = double.Parse(s, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture);
        return n >= 0.1 && n <= 0.9 ? n : null;
    }

    /// <summary>What is wrong with the shape of <c>by</c>, or null. Whether a shape id exists is <see cref="InterceptorProblem"/>'s to say.</summary>
    private static string? ByProblem(object? by)
    {
        if (by is string s) return PlainLine(s) ? null : ByHint;
        if (by is not OrderedDictionary<string, object?> map || map.Keys.Any(k => k != "name")) return ByHint;
        map.TryGetValue("name", out var name);
        if (!PlainLine(name)) return "animation by name must be plain text on one line";
        return JsCompat.JsTrim((string)name!).Length > NameMax ? $"animation by name can be at most {NameMax} characters" : null;
    }

    /// <summary>What is wrong with the channel options of an animation (opens, name, towards, closes), or null. A channel is left open or closed by a request that arrives.</summary>
    private static string? ChannelProblem(IReadOnlyDictionary<string, object?> map, object? outcome)
    {
        map.TryGetValue("opens", out var opens);
        map.TryGetValue("towards", out var towards);
        if (opens is not null && !IsChannelKind(opens)) return $"animation opens must be {OrList(ChannelKinds)}";
        if (towards is not null && towards is not ("from" or "to")) return "animation towards must be from or to";
        foreach (var option in new[] { "name", "closes" })
        {
            if (!map.TryGetValue(option, out var value) || value is null) continue;
            if (!PlainLine(value)) return $"animation {option} must be plain text on one line";
            if (JsCompat.JsTrim((string)value).Length > NameMax) return $"animation {option} can be at most {NameMax} characters";
        }
        var closes = map.TryGetValue("closes", out var c) ? c : null;
        if (opens is null)
        {
            foreach (var option in new[] { "name", "towards" }) if (map.TryGetValue(option, out var value) && value is not null) return $"animation {option} needs opens";
        }
        if (opens is not null && closes is not null) return "animation opens and closes cannot be on one step";
        if ((opens is not null || closes is not null) && outcome is not null) return $"animation {(opens is null ? "closes" : "opens")} only applies to a request that arrives, not to outcome {outcome}";
        return null;
    }

    /// <summary>What is wrong with a step's <c>animation</c>, worded to follow "step N: ", or null. A blank tag is no tag; <paramref name="hasTo"/> is whether the step has a "to".</summary>
    public static string? Problem(object? raw, bool hasTo)
    {
        if (raw is null or "") return null;
        var map = raw as OrderedDictionary<string, object?>;
        if (raw is not string && map is null) return "animation must be a kind or a mapping with a kind";
        object? kind = raw;
        if (map is not null) map.TryGetValue("kind", out kind);
        if (kind is null or "") return $"animation needs a kind ({KindsHint})";
        if (kind is not string name) return "animation kind must be text";
        if (!Kinds.Contains(name)) return $"unknown animation \"{name}\" ({KindsHint})";
        if (map is not null)
        {
            var extra = map.Keys.FirstOrDefault(k => k != "effect" && !Options.Contains(k));
            if (extra is not null) return $"unknown animation option \"{extra}\" (use {string.Join(", ", Options)})";
            map.TryGetValue("trigger", out var trigger);
            map.TryGetValue("carries", out var carries);
            map.TryGetValue("outcome", out var outcome);
            if (trigger is not null && !(trigger is string t && Triggers.Contains(t))) return $"animation trigger must be {string.Join(" or ", Triggers)}";
            if (trigger is not null && name != "callback") return "animation trigger only applies to callback";
            if (carries is not null && (carries is not string word || JsCompat.Blank(word))) return "animation carries must be a word";
            if (map.TryGetValue("effect", out var effect) && !(effect is string named && Effects.Contains(named))) return $"animation effect must be {OrList(Effects)}";
            if (outcome is not null && !(outcome is string given && Outcomes.Contains(given))) return $"animation outcome must be {OrList(Outcomes)}";
            if (outcome is "timeout" && name != "call") return "animation outcome timeout only applies to call";
            if (outcome is "fail" && name is not ("send" or "call")) return "animation outcome fail only applies to send and call";
            if (outcome is string travel && TravelOutcomes.Contains(travel) && name == "callback") return $"animation outcome {travel} only applies to send, call and event";
            if (map.TryGetValue("share", out var share))
            {
                if (ShareOf(share) is null) return "animation share must be a whole number from 1 to 100";
                if (outcome is null) return "animation share needs an outcome";
            }
            if (map.TryGetValue("reason", out var reason))
            {
                if (!PlainLine(reason)) return "animation reason must be plain text on one line";
                if (JsCompat.JsTrim((string)reason!).Length > ReasonMax) return $"animation reason can be at most {ReasonMax} characters";
                if (outcome is null) return "animation reason needs an outcome";
            }
            if (outcome is "intercepted")
            {
                if (!map.TryGetValue("by", out var by)) return "animation outcome intercepted needs a \"by\" (a shape id, or { name: ... })";
                if (ByProblem(by) is { } why) return why;
            }
            else if (map.ContainsKey("by")) return "animation by only applies to outcome intercepted";
            if (map.TryGetValue("at", out var at))
            {
                if (LostAtOf(at) is null) return "animation at must be a number from 0.1 to 0.9";
                if (outcome is not "lost") return "animation at only applies to outcome lost";
            }
            if (ChannelProblem(map, outcome) is { } channel) return channel;
        }
        return hasTo ? null : $"animation \"{name}\" needs a \"to\"";
    }

    /// <summary>
    /// What is wrong with the shape an interception names, or null. It needs the model, so <see cref="Problem"/> leaves it: an unknown shape, or one of the step's
    /// own ends. A <c>{ name: ... }</c> is never checked against the model.
    /// </summary>
    public static string? InterceptorProblem(object? raw, string? from, string? to, Func<string, bool> exists)
    {
        if (raw is not OrderedDictionary<string, object?> map || !map.TryGetValue("outcome", out var outcome) || outcome is not "intercepted") return null;
        if (!map.TryGetValue("by", out var by) || by is not string shape || JsCompat.Blank(shape)) return null;
        var id = JsCompat.JsTrim(shape);
        if (!exists(id)) return $"animation by: unknown object \"{id}\"";
        if (id == from || id == to) return $"animation by \"{id}\" is an end of the step (name another shape, or use {{ name: ... }})";
        return null;
    }

    /// <summary>The step's animation, or null when it has none or the tag is wrong (the checks report that) or nothing would travel.</summary>
    public static StepAnimation? Read(Step step)
    {
        if (step.Animation is null or "" || Problem(step.Animation, step.To is not null) is not null) return null;
        var map = step.Animation as OrderedDictionary<string, object?>;
        var kind = map is null ? (string)step.Animation : (string)map["kind"]!;
        string? carries = null;
        string? outcome = null;
        string? reason = null;
        Interceptor? by = null;
        int? share = null;
        double? at = null;
        string? effect = null;
        string? opens = null;
        string? channelName = null;
        string? towards = null;
        string? closes = null;
        var trigger = "inside";
        if (map is not null)
        {
            if (map.TryGetValue("carries", out var word) && word is string text) carries = text;
            if (map.TryGetValue("trigger", out var t) && t is "outside") trigger = "outside";
            if (map.TryGetValue("outcome", out var o) && o is string given && Outcomes.Contains(given)) outcome = given;
            if (map.TryGetValue("share", out var s)) share = ShareOf(s);
            if (map.TryGetValue("reason", out var r) && r is string why) reason = JsCompat.JsTrim(why);
            if (map.TryGetValue("by", out var b))
            {
                if (b is string shape) by = new Interceptor(Shape: JsCompat.JsTrim(shape));
                else if (b is OrderedDictionary<string, object?> named && named.TryGetValue("name", out var n) && n is string name) by = new Interceptor(Name: JsCompat.JsTrim(name));
            }
            if (map.TryGetValue("at", out var a)) at = LostAtOf(a);
            if (map.TryGetValue("effect", out var e) && e is string chosen && Effects.Contains(chosen)) effect = chosen;
            if (map.TryGetValue("opens", out var op) && op is string opened && ChannelKinds.Contains(opened))
            {
                opens = opened;
                if (map.TryGetValue("name", out var called) && called is string callName) channelName = JsCompat.JsTrim(callName);
                if (map.TryGetValue("towards", out var end) && end is "from" or "to") towards = (string)end!;
            }
            if (map.TryGetValue("closes", out var cl) && cl is string closed) closes = JsCompat.JsTrim(closed);
        }
        return new StepAnimation(kind, trigger, carries, outcome, share, reason, by, at, effect, opens, channelName, towards, closes);
    }

    /// <summary>How long something takes to run the length of a line: at least 1.2 seconds, so the eye can follow it, and at most 2.2.</summary>
    public static int Travel(double length) =>
        double.IsFinite(length) ? (int)Math.Min(2200, Math.Max(1200, Math.Floor(length * 3 + 0.5))) : 1200;

    /// <summary>Whether the step before ended at the box this one starts from, so a callback "triggered outside" was just kicked by it.</summary>
    public static bool Follows((string From, string To)? previous, (string From, string To)? current) =>
        previous is { } p && current is { } c && p.To == c.From;

    /// <summary>
    /// How many requests a share plays, and which of them meet the outcome: 10 when the share is a multiple of 10, 20 for a multiple of 5, otherwise 100.
    /// Request <c>i</c> is hit when the running total of <c>share</c> percent crosses a whole request, which spreads the hits evenly. Fixed by the numbers, never random.
    /// </summary>
    public static (int Count, bool[] Hit) BurstOf(int share)
    {
        var count = share % 10 == 0 ? 10 : share % 5 == 0 ? 20 : 100;
        return (count, Enumerable.Range(0, count).Select(i => (i + 1) * share / 100 > i * share / 100).ToArray());
    }

    /// <summary>The beats, or none when the condition is false.</summary>
    private static Beat[] When(bool condition, params Beat[] beats) => condition ? beats : [];

    /// <summary>
    /// The drawings the pickers of edit mode offer, one for each way a step can travel and one for each way its request can end, as stroke-only path data on a
    /// 44 by 24 grid: the same strings the browser draws (src/core/animation.ts). "none" is no animation, and a request that arrives.
    /// </summary>
    public static readonly (string Id, string Path)[] KindSketches =
    [
        ("none", "M6 12H38"),
        ("send", "M6 12H36M30 6l6 6l-6 6"),
        ("call", "M6 8H38M32 3l6 5l-6 5M38 17H6M12 12l-6 5l6 5"),
        ("callback", "M22 3a5 5 0 0 0 -5 5v4l-2 4h14l-2 -4v-4a5 5 0 0 0 -5 -5zM20 19a2 2 0 0 0 4 0"),
        ("event", "M24 2l-9 12h7l-2 8l9 -12h-7z"),
    ];

    public static readonly (string Id, string Path)[] OutcomeSketches =
    [
        ("none", "M6 12H36M30 6l6 6l-6 6"),
        ("fail", "M6 12H26M31 6l9 12M40 6l-9 12"),
        ("timeout", "M6 12H22M29 12h.01M34 12h.01M39 12h.01"),
        ("lost", "M6 12H16M22 6l10 12M32 6l-10 12"),
        ("rejected", "M6 9H31M37 3v18M31 16H12M18 11l-6 5l6 5"),
        ("intercepted", "M6 8H18l7 8M27 14h12v8h-12z"),
        ("duplicated", "M6 7H36M30 2l6 5l-6 5M6 18H36M30 13l6 5l-6 5"),
        ("delayed", "M6 12H15M29 12H38M22 6a6 6 0 1 0 .01 0M22 9v3l2 2"),
    ];

    /// <summary>The drawings the edit pickers offer for what a step leaves open ("none" for nothing), on the same 44 by 24 grid as the sketches above.</summary>
    public static readonly (string Id, string Path)[] ChannelSketches =
    [
        ("none", "M6 12H38"),
        ("stream", "M5 12h.01M12 12h.01M19 12h.01M26 12h.01M33 12h.01M36 6l6 6l-6 6"),
        ("listener", "M16 4a4 4 0 0 0 -4 4v3l-2 3h12l-2 -3v-3a4 4 0 0 0 -4 -4zM14 17a2 2 0 0 0 4 0M26 7a7 7 0 0 1 0 10M31 4a11 11 0 0 1 0 16"),
        ("job", "M22 4a8 8 0 1 0 8 8M24 1l-3 3l3 3"),
    ];

    /// <summary>The drawings for which end of its line a channel points at ("none" is the usual end).</summary>
    public static readonly (string Id, string Path)[] EndSketches =
    [
        ("none", "M6 12H38"),
        ("from", "M6 12H38M6 5v14"),
        ("to", "M6 12H38M38 5v14"),
    ];

    /// <summary>
    /// Why an outcome cannot be picked for a step that travels as <paramref name="kind"/>, in a few words for a tooltip, or null when it can. The picker greys the choice
    /// out with this beside it, and the checks refuse the same pairs. An outcome of "" (the request arrives) always fits.
    /// </summary>
    public static string? OutcomeBlock(string? kind, string outcome)
    {
        if (outcome == "") return null;
        if (string.IsNullOrEmpty(kind)) return "Pick how it travels first";
        if (kind == "callback") return "Not for a callback";
        if (outcome == "timeout" && kind != "call") return "Needs a call";
        if (outcome == "fail" && kind is not ("send" or "call")) return "Needs a send or a call";
        return null;
    }

    /// <summary>Who takes an intercepted request until the reader names one: an interception needs a taker, so picking it never leaves the step without.</summary>
    public const string DefaultTaker = "Third party";

    /// <summary>The keys that mean something only while the step has an outcome.</summary>
    private static readonly string[] NeedsOutcome = ["share", "reason", "by", "at"];

    /// <summary>
    /// A step's <c>animation</c> with one key set, as the pickers of edit mode make it: a port of animationWith in src/core/animation.ts. The keys are kind, outcome,
    /// share, reason, at, carries, by (the id of a shape that takes the request) and byName (the name of a party that is not in the model). Null is no animation, a
    /// string is the bare kind, and a mapping keeps the order of the keys that were there. The channel keys are opens, name, towards and closes.
    /// </summary>
    public static object? With(object? current, string key, string value)
    {
        var map = new OrderedDictionary<string, object?>();
        if (current is OrderedDictionary<string, object?> given) foreach (var (k, v) in given) map[k] = v;
        else if (current is string kind0 && kind0 != "") map["kind"] = kind0;
        void Drop(params string[] keys)
        {
            foreach (var k in keys) map.Remove(k);
        }
        var text = JsCompat.JsTrim(value);
        switch (key)
        {
            case "kind":
                if (text == "") return null;
                map["kind"] = text;
                if (text != "callback") Drop("trigger");
                if (map.TryGetValue("outcome", out var had) && had is string outcome && OutcomeBlock(text, outcome) is not null) Drop(["outcome", .. NeedsOutcome]);
                break;
            case "outcome":
                if (text == "") Drop(["outcome", .. NeedsOutcome]);
                else
                {
                    map["outcome"] = text;
                    if (text != "intercepted") Drop("by");
                    if (text != "lost") Drop("at");
                    // A request that does not arrive leaves nothing open and closes nothing.
                    Drop(ChannelOptions);
                }
                break;
            case "opens":
                if (text == "") Drop("opens", "name", "towards");
                else
                {
                    map["opens"] = text;
                    Drop(["closes", "outcome", .. NeedsOutcome]);
                }
                break;
            case "closes":
                if (text == "") Drop("closes");
                else
                {
                    map["closes"] = text;
                    Drop([.. ChannelOptions.Where(o => o != "closes"), "outcome", .. NeedsOutcome]);
                }
                break;
            case "byName":
                if (text == "") Drop("by");
                else map["by"] = new OrderedDictionary<string, object?> { ["name"] = text };
                break;
            default:
                if (text == "") Drop(key);
                else map[key] = text;
                break;
        }
        if (map.TryGetValue("outcome", out var now) && now is "intercepted" && !map.ContainsKey("by")) map["by"] = new OrderedDictionary<string, object?> { ["name"] = DefaultTaker };
        if (map.Count == 0) return null;
        return map.Count == 1 && map.TryGetValue("kind", out var only) && only is string name ? name : map;
    }

    /// <summary>
    /// Whether the step leaves marks where its outcome happened (a cross, a bar, a clock, a marker, a reason). A still picture needs them too, and the label of its line
    /// moves aside so they never sit on it.
    /// </summary>
    public static bool LeavesMarks(StepAnimation a) => BeatsFor(a, 0, false).Beats.Any(b => b.Do is "pop" or "bar" or "clock" or "note" or "marker");

    /// <summary>What each kind of channel is said to do when a step opens one, as the start of a line.</summary>
    private static readonly IReadOnlyDictionary<string, string> OpensWords = new Dictionary<string, string> { ["stream"] = "Opens a stream", ["listener"] = "Starts listening", ["job"] = "Starts a job" };

    /// <summary>
    /// How the step's channel reads on the step card and in the Mermaid note, as a fragment: "Opens a stream: Orders", "Starts listening", "Closes Orders".
    /// Null when the step neither opens nor closes one. A step that opens or closes has no outcome, so this and <see cref="OutcomeLine"/> never both say something.
    /// </summary>
    public static string? ChannelLine(StepAnimation a)
    {
        if (a.Opens is { } kind) return a.Name is null ? OpensWords[kind] : $"{OpensWords[kind]}: {a.Name}";
        return a.Closes is null ? null : $"Closes {a.Closes}";
    }

    private static string LowerFirst(string s) => s.Length == 0 ? s : char.ToLowerInvariant(s[0]) + s[1..];

    /// <summary>
    /// How the step's outcome reads on the step card and in the Mermaid note, as a fragment: "Lost", "30% lost", "Rejected: Rate limit", "Taken by Café wifi proxy",
    /// "Sent twice", "Delayed: Cold start". <paramref name="nameOf"/> turns the id of an intercepting shape into its name. Null when the step has no outcome.
    /// </summary>
    public static string? OutcomeLine(StepAnimation a, Func<string, string>? nameOf = null)
    {
        if (a.Outcome is null) return null;
        var who = a.By is null ? "" : a.By.Name ?? (nameOf is null ? a.By.Shape! : nameOf(a.By.Shape!));
        var withShare = a.Share is not null;
        var verb = a.Outcome switch
        {
            "fail" => withShare ? "fail" : "Fails",
            "timeout" => withShare ? "time out" : "Times out",
            "lost" => "Lost",
            "rejected" => "Rejected",
            "intercepted" => $"Taken by {who}",
            "duplicated" => "Sent twice",
            _ => "Delayed",
        };
        var line = a.Share is { } percent ? $"{percent}% {LowerFirst(verb)}" : verb;
        return a.Reason is null ? line : $"{line}: {a.Reason}";
    }

    /// <summary>One request of the step: whether it meets the outcome, the word it carries, and, in a burst, the colour and ring of one that does. <c>Fade</c> is whether a timeout dims the line after it.</summary>
    private sealed record Req(bool Hit, string? Label = null, int? Tint = null, bool? Ring = null, bool Fade = true);

    /// <summary>
    /// The step as beats, with the tube first and how long the whole thing lasts. They are listed request by request, and each request in the order its beats start.
    /// A step with a share plays a burst (see <see cref="BurstOf"/>): the hits are named r1, r2, ... or by carries, coloured and ringed; the rest are ordinary deliveries.
    /// </summary>
    public static (List<Beat> Beats, int Total) BeatsFor(StepAnimation a, double length, bool afterLanding)
    {
        var t = Travel(length);
        int Ms(double fraction) => (int)Math.Floor(t * fraction + 0.5);
        Beat Effect(string kind, string on, int at, int dur) => new(kind, on, at, dur);
        List<Beat> Note(int at, int dur, double? along = null, bool onBy = false) =>
            a.Reason is null ? [] : [new Beat("note", onBy ? "by" : "line", at, dur, Along: along, Text: a.Reason)];

        // A request that runs into one of the five outcomes after fail and timeout.
        List<Beat> Travelling(int o, Req r, string outcome)
        {
            var glyph = a.Kind == "event" ? "bolt" : "envelope";
            var call = a.Kind == "call";
            var s = o + 250;
            var squeeze = Effect("gulp", "from", o, 250);
            Beat Blob(int at, int dur, string on = "line", string dir = "fwd", string? tone = null, double? start = null, double? end = null) =>
                new("blob", on, at, dur, dir, glyph, tone, r.Label, start, end, r.Tint, r.Ring == true ? true : null);
            // Where a request lands: a squash, or a flash for an event.
            List<Beat> Taken(int at) => a.Kind == "event" ? [Effect("flash", "to", at, 450)] : [Effect("gulp", "to", at, 300)];
            // A call still gets its answer once the request has landed.
            List<Beat> Reply(int landed) => call
                ? [Effect("wait", "from", landed, 600), new Beat("blob", "line", landed + 600, t, "back", "envelope", "reply"), Effect("gulp", "from", landed + 600 + t, 300)]
                : [];
            switch (outcome)
            {
                case "lost":
                {
                    // It runs partway, pops, and nothing arrives: no squash at the receiver, and a caller keeps waiting.
                    var at = a.At ?? LostAt;
                    var gone = s + Ms(at);
                    return
                    [
                        squeeze, Blob(s, Ms(at), end: at),
                        new Beat("pop", "line", gone, PopMs, Tint: r.Tint, Along: at),
                        .. Note(gone, NoteMs, along: at),
                        .. When(call, Effect("wait", "from", gone, TimeoutWait)),
                    ];
                }
                case "rejected":
                {
                    // It stops at the bar by the door, which flashes, and comes back in the danger tone to the sender, who takes it in.
                    var door = s + Ms(RejectStop);
                    var back = door + 450;
                    return
                    [
                        squeeze, Blob(s, Ms(RejectStop), end: RejectStop),
                        new Beat("bar", "line", door, BarMs, Along: BarAt),
                        .. Note(door, NoteMs, along: RejectStop),
                        .. When(call, Effect("wait", "from", door, 450)),
                        Blob(back, Ms(RejectStop), dir: "back", tone: "fail", end: RejectStop),
                        Effect("gulp", "from", back + Ms(RejectStop), 300),
                    ];
                }
                case "intercepted":
                {
                    // It leaves the line for whoever takes it, which flashes. Nothing goes on to the receiver.
                    var leaves = s + Ms(WaitAt);
                    var there = leaves + 700;
                    return
                    [
                        squeeze, Blob(s, Ms(WaitAt), end: WaitAt),
                        Blob(leaves, 700, on: "by", start: WaitAt),
                        new Beat("flash", "by", there, 450),
                        .. Note(there, NoteMs, onBy: true),
                        .. When(call, Effect("wait", "from", there, TimeoutWait)),
                    ];
                }
                case "duplicated":
                {
                    // A second copy leaves the first where it passes the split and arrives later, so the receiver takes it in twice.
                    var second = s + Ms(0.45);
                    var again = second + Ms(0.9);
                    return
                    [
                        squeeze, Blob(s, t), Blob(second, Ms(0.9), start: WaitAt),
                        .. Taken(s + t), .. Taken(again),
                        .. Note(second, NoteMs, along: WaitAt),
                        .. Reply(again),
                    ];
                }
                default: // delayed
                {
                    // It runs to the clock, waits there while it turns, and goes on.
                    var run = Ms(WaitAt);
                    var resume = s + run + DelayHold;
                    var landed = resume + (t - run);
                    return
                    [
                        squeeze, Blob(s, run, end: WaitAt),
                        Blob(s + run, DelayHold, start: WaitAt, end: WaitAt),
                        new Beat("clock", "line", s + run, DelayHold, Along: WaitAt),
                        .. Note(s + run, DelayHold, along: WaitAt),
                        Blob(resume, t - run, start: WaitAt),
                        .. Taken(landed),
                        .. Reply(landed),
                    ];
                }
            }
        }

        // A request that works, or fails or never gets an answer (the two outcomes there were first).
        List<Beat> Request(int o, Req r)
        {
            var outcome = r.Hit ? a.Outcome : null;
            if (outcome is not null && TravelOutcomes.Contains(outcome)) return Travelling(o, r, outcome);
            var failed = outcome == "fail";
            // A refusal is the news, so everything that runs is the danger tone and the receiver flashes in it when it lands.
            Beat Blob(int at, string glyph) => new("blob", "line", at, t, "fwd", glyph, failed ? "fail" : null, r.Label, Tint: r.Tint, Ring: r.Ring == true ? true : null);
            Beat[] Refused(int at) => failed ? [new Beat("flash", "to", at, 450, Tone: "fail")] : [];
            switch (a.Kind)
            {
                case "send":
                    return [Effect("gulp", "from", o, 250), Blob(o + 250, "envelope"), Effect("gulp", "to", o + 250 + t, 300), .. Refused(o + 250 + t), .. failed ? Note(o + 250 + t, NoteMs, along: LandingNoteAt) : []];
                case "call":
                {
                    var landed = o + 250 + t;
                    if (outcome == "timeout")
                    {
                        // Nobody answers: the sender keeps waiting, nothing comes back, and the line dims.
                        return
                        [
                            Effect("gulp", "from", o, 250), Blob(o + 250, "envelope"), Effect("gulp", "to", landed, 300), Effect("wait", "from", landed, TimeoutWait),
                            .. When(r.Fade, new Beat("fade", "line", landed + TimeoutWait, TimeoutFade)),
                            .. Note(landed, NoteMs, along: LandingNoteAt),
                        ];
                    }
                    var back = landed + 600;
                    return
                    [
                        Effect("gulp", "from", o, 250), Blob(o + 250, "envelope"), Effect("gulp", "to", landed, 300), .. Refused(landed), Effect("wait", "from", landed, 600),
                        new Beat("blob", "line", back, t, "back", "envelope", failed ? "fail" : "reply"),
                        Effect("gulp", "from", back + t, 300),
                        .. failed ? Note(landed, NoteMs, along: LandingNoteAt) : [],
                    ];
                }
                case "event":
                    return [Effect("gulp", "from", o, 250), Blob(o + 250, "bolt"), Effect("flash", "to", o + 250 + t, 450)];
                case "callback" when a.Trigger == "inside":
                    return [Effect("ring", "from", 0, 600), Blob(450, "bell"), Effect("ring", "to", 450 + t, 600)];
                case "callback" when afterLanding:
                    return [Effect("flash", "from", 0, 450), Blob(300, "bell"), Effect("ring", "to", 300 + t, 600)];
                case "callback":
                    return [new Beat("drop", "from", 0, 600, Glyph: "bolt"), Effect("flash", "from", 600, 450), Blob(850, "bell"), Effect("ring", "to", 850 + t, 600)];
                default:
                    throw new ArgumentException($"unknown animation kind \"{a.Kind}\"");
            }
        }

        // One request, or a burst of them: the share's hits get a name, a colour and a ring, the rest are ordinary.
        List<Beat> body;
        if (a.Share is { } share && a.Outcome is not null && a.Kind != "callback")
        {
            var (count, hit) = BurstOf(share);
            var spacing = double.IsFinite(length) && length > 0 ? (int)Math.Ceiling(BlobSpacing * t / length) : 0;
            var stagger = Math.Min(BurstSpread / (count - 1), Math.Max(BurstStagger, spacing));
            var last = Array.LastIndexOf(hit, true);
            var nth = 0;
            body = [];
            for (var i = 0; i < count; i++)
            {
                if (!hit[i])
                {
                    body.AddRange(Request(i * stagger, new Req(false)));
                    continue;
                }
                nth++;
                body.AddRange(Request(i * stagger, new Req(true, a.Carries ?? $"r{nth}", (nth - 1) % Tints.Length, true, i == last)));
            }
        }
        else body = Request(0, new Req(true, a.Carries));
        var total = body.Max(b => b.At + b.Dur);
        // Whoever takes an intercepted request is drawn for the whole step, a shape by a dashed outline and a party that is not in the model by a dashed marker with its name.
        List<Beat> marker = a.Outcome == "intercepted" && a.By is not null ? [new Beat("marker", "by", 0, total, Along: WaitAt, Text: a.By.Name)] : [];
        List<Beat> all = [new Beat("pipe", "line", 0, total), .. marker, .. body];
        return (all, total);
    }
}
