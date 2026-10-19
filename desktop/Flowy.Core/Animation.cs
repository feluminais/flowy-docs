namespace Flowy.Core;

/// <summary>
/// A step's animation, read: the kind, who sets a callback off (inside unless the file says outside), and the word the blob carries.
/// For recurse, <c>Depth</c> is how tall the call stack gets and <c>Returns</c> the word on the answers coming back; both are null for every other kind.
/// </summary>
public sealed record StepAnimation(string Kind, string Trigger, string? Carries, int? Depth = null, string? Returns = null);

/// <summary>
/// One thing to draw, in the order beats start. <c>Do</c> is pipe, blob, ring, flash, gulp, wait, drop or stack; <c>On</c> is from, to or line;
/// times are milliseconds from the start of the step. Dir, Glyph, Tone, Label and Level are set only where they mean something
/// (Level: how many ghost cards a stack beat shows from then on).
/// </summary>
public sealed record Beat(string Do, string On, int At, int Dur, string? Dir = null, string? Glyph = null, string? Tone = null, string? Label = null, int? Level = null);

/// <summary>A port of src/core/animation.ts, with the same wording and the same numbers. desktop/fixtures/beats.ts keeps the two equal.</summary>
public static class Animations
{
    public static readonly string[] Kinds = ["send", "call", "callback", "event", "recurse"];

    public static readonly string[] Triggers = ["inside", "outside"];

    private static readonly string[] Options = ["kind", "trigger", "carries", "depth", "returns"];

    private static string[] OptionsFor(string kind) => kind == "recurse" ? ["kind", "carries", "depth", "returns"] : ["kind", "trigger", "carries"];

    private static readonly string KindsHint = "use " + string.Join(", ", Kinds);

    /// <summary>What the checks say about a recurse step that has a "to". A step whose "to" is its own "from" already gets a message for that, so the checks leave this one out.</summary>
    public const string RecurseHasTo = "animation \"recurse\" is a shape calling itself: leave out \"to\"";

    private const int DepthMin = 2;
    private const int DepthMax = 5;
    private const int DepthDefault = 3;

    /// <summary>A <c>depth</c> as a number when it is the text of a whole number from 2 to 5. Files hold text, so nothing else can arrive.</summary>
    private static int? DepthOf(object? value) =>
        value is string text && text.Length > 0 && text.All(char.IsAsciiDigit) && int.TryParse(text, out var n) && n is >= DepthMin and <= DepthMax ? n : null;

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
            var extra = map.Keys.FirstOrDefault(k => !Options.Contains(k));
            if (extra is not null) return $"unknown animation option \"{extra}\" (use {string.Join(", ", OptionsFor(name))})";
            map.TryGetValue("trigger", out var trigger);
            map.TryGetValue("carries", out var carries);
            var hasDepth = map.TryGetValue("depth", out var depth); // a key that is there counts, whatever it holds
            var hasReturns = map.TryGetValue("returns", out var returns);
            if (trigger is not null && !(trigger is string t && Triggers.Contains(t))) return $"animation trigger must be {string.Join(" or ", Triggers)}";
            if (trigger is not null && name != "callback") return "animation trigger only applies to callback";
            if (carries is not null && (carries is not string word || string.IsNullOrWhiteSpace(word))) return "animation carries must be a word";
            if (hasDepth && name != "recurse") return "animation depth only applies to recurse";
            if (hasReturns && name != "recurse") return "animation returns only applies to recurse";
            if (hasDepth && DepthOf(depth) is null) return $"animation depth must be a whole number from {DepthMin} to {DepthMax}";
            if (hasReturns && (returns is not string answer || string.IsNullOrWhiteSpace(answer))) return "animation returns must be a word";
        }
        if (name == "recurse") return hasTo ? RecurseHasTo : null;
        return hasTo ? null : $"animation \"{name}\" needs a \"to\"";
    }

    /// <summary>The step's animation, or null when it has none or the tag is wrong (the checks report that) or nothing would travel.</summary>
    public static StepAnimation? Read(Step step)
    {
        if (step.Animation is null or "" || Problem(step.Animation, step.To is not null) is not null) return null;
        var map = step.Animation as OrderedDictionary<string, object?>;
        var kind = map is null ? (string)step.Animation : (string)map["kind"]!;
        string? carries = null;
        string? returns = null;
        var trigger = "inside";
        var recursion = kind == "recurse";
        int? depth = recursion ? DepthDefault : null;
        if (map is not null)
        {
            if (map.TryGetValue("carries", out var word) && word is string text) carries = text;
            if (map.TryGetValue("trigger", out var t) && t is "outside") trigger = "outside";
            if (recursion && map.TryGetValue("depth", out var d)) depth = DepthOf(d) ?? DepthDefault;
            if (recursion && map.TryGetValue("returns", out var r) && r is string answer) returns = answer;
        }
        return new StepAnimation(kind, trigger, carries, depth, returns);
    }

    /// <summary>How long something takes to run the length of a line: half a second to a bit over one.</summary>
    public static int Travel(double length) =>
        double.IsFinite(length) ? (int)Math.Min(1100, Math.Max(500, Math.Floor(length * 2 + 0.5))) : 500;

    /// <summary>Whether the step before ended at the box this one starts from, so a callback "triggered outside" was just kicked by it.</summary>
    public static bool Follows((string From, string To)? previous, (string From, string To)? current) =>
        previous is { } p && current is { } c && p.To == c.From;

    /// <summary>The step as beats, in the order they start, with the tube first and how long the whole thing lasts.</summary>
    public static (List<Beat> Beats, int Total) BeatsFor(StepAnimation a, double length, bool afterLanding)
    {
        var t = Travel(length);
        Beat Effect(string kind, string on, int at, int dur) => new(kind, on, at, dur);
        Beat Blob(int at, string glyph) => new("blob", "line", at, t, "fwd", glyph, Label: a.Carries);
        List<Beat> body;
        switch (a.Kind)
        {
            case "send":
                body = [Effect("gulp", "from", 0, 150), Blob(150, "envelope"), Effect("gulp", "to", 150 + t, 200)];
                break;
            case "call":
            {
                var landed = 150 + t;
                var back = landed + 300;
                body =
                [
                    Effect("gulp", "from", 0, 150), Blob(150, "envelope"), Effect("gulp", "to", landed, 200), Effect("wait", "from", landed, 300),
                    new Beat("blob", "line", back, t, "back", "envelope", "reply"),
                    Effect("gulp", "from", back + t, 200),
                ];
                break;
            }
            case "event":
                body = [Effect("gulp", "from", 0, 150), Blob(150, "bolt"), Effect("flash", "to", 150 + t, 250)];
                break;
            case "callback" when a.Trigger == "inside":
                body = [Effect("ring", "from", 0, 400), Blob(300, "bell"), Effect("ring", "to", 300 + t, 400)];
                break;
            case "callback" when afterLanding:
                body = [Effect("flash", "from", 0, 250), Blob(200, "bell"), Effect("ring", "to", 200 + t, 400)];
                break;
            case "callback":
                body = [new Beat("drop", "from", 0, 350, Glyph: "bolt"), Effect("flash", "from", 350, 250), Blob(550, "bell"), Effect("ring", "to", 550 + t, 400)];
                break;
            case "recurse":
                body = RecurseBeats(a, t);
                break;
            default:
                throw new ArgumentException($"unknown animation kind \"{a.Kind}\"");
        }
        var total = body.Max(b => b.At + b.Dur);
        body.Insert(0, new Beat("pipe", "line", 0, total));
        return (body, total);
    }

    /// <summary>
    /// A recursion: the shape calls itself <c>depth - 1</c> times, each call piling a card onto the stack under it. A flag marks the base case,
    /// then the answers come back one level at a time and the cards leave. <paramref name="t"/> is how long the loop pipe takes to run.
    /// </summary>
    private static List<Beat> RecurseBeats(StepAnimation a, int t)
    {
        var n = a.Depth ?? DepthDefault;
        const int gulp = 120;
        var level = gulp + t; // one call down, or one answer back
        Beat Stack(int at, int cards) => new("stack", "from", at, 150, Level: cards);
        var body = new List<Beat>();
        for (var j = 1; j < n; j++)
        {
            var start = (j - 1) * level;
            body.Add(new Beat("gulp", "from", start, gulp));
            body.Add(new Beat("blob", "line", start + gulp, t, "fwd", "envelope", Label: a.Carries));
            body.Add(Stack(start + level, j));
        }
        var bottom = (n - 1) * level;
        body.Add(new Beat("drop", "from", bottom, 350, Glyph: "flag"));
        body.Add(new Beat("flash", "from", bottom + 200, 250));
        for (var k = 1; k < n; k++)
        {
            var start = bottom + 450 + (k - 1) * level;
            body.Add(new Beat("blob", "line", start, t, "back", "envelope", "reply", a.Returns));
            body.Add(new Beat("gulp", "from", start + t, gulp));
            body.Add(Stack(start + t, n - 1 - k));
        }
        body.Add(new Beat("ring", "from", bottom + 450 + (n - 1) * level, 300));
        return body;
    }
}
