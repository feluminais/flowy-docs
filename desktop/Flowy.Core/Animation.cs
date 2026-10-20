namespace Flowy.Core;

/// <summary>A step's animation, read: the kind, who sets a callback off (inside unless the file says outside), and the word the blob carries.</summary>
public sealed record StepAnimation(string Kind, string Trigger, string? Carries);

/// <summary>
/// One thing to draw, in the order beats start. <c>Do</c> is pipe, blob, ring, flash, gulp, wait or drop; <c>On</c> is from, to or line;
/// times are milliseconds from the start of the step. Dir, Glyph, Tone and Label are set only where they mean something.
/// </summary>
public sealed record Beat(string Do, string On, int At, int Dur, string? Dir = null, string? Glyph = null, string? Tone = null, string? Label = null);

/// <summary>A port of src/core/animation.ts, with the same wording and the same numbers. desktop/fixtures/beats.ts keeps the two equal.</summary>
public static class Animations
{
    public static readonly string[] Kinds = ["send", "call", "callback", "event"];

    public static readonly string[] Triggers = ["inside", "outside"];

    private static readonly string[] Options = ["kind", "trigger", "carries"];

    private static readonly string KindsHint = "use " + string.Join(", ", Kinds);

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
            if (extra is not null) return $"unknown animation option \"{extra}\" (use {string.Join(", ", Options)})";
            map.TryGetValue("trigger", out var trigger);
            map.TryGetValue("carries", out var carries);
            if (trigger is not null && !(trigger is string t && Triggers.Contains(t))) return $"animation trigger must be {string.Join(" or ", Triggers)}";
            if (trigger is not null && name != "callback") return "animation trigger only applies to callback";
            if (carries is not null && (carries is not string word || string.IsNullOrWhiteSpace(word))) return "animation carries must be a word";
        }
        return hasTo ? null : $"animation \"{name}\" needs a \"to\"";
    }

    /// <summary>The step's animation, or null when it has none or the tag is wrong (the checks report that) or nothing would travel.</summary>
    public static StepAnimation? Read(Step step)
    {
        if (step.Animation is null or "" || Problem(step.Animation, step.To is not null) is not null) return null;
        var map = step.Animation as OrderedDictionary<string, object?>;
        var kind = map is null ? (string)step.Animation : (string)map["kind"]!;
        string? carries = null;
        var trigger = "inside";
        if (map is not null)
        {
            if (map.TryGetValue("carries", out var word) && word is string text) carries = text;
            if (map.TryGetValue("trigger", out var t) && t is "outside") trigger = "outside";
        }
        return new StepAnimation(kind, trigger, carries);
    }

    /// <summary>How long something takes to run the length of a line: at least 1.2 seconds, so the eye can follow it, and at most 2.2.</summary>
    public static int Travel(double length) =>
        double.IsFinite(length) ? (int)Math.Min(2200, Math.Max(1200, Math.Floor(length * 3 + 0.5))) : 1200;

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
                body = [Effect("gulp", "from", 0, 250), Blob(250, "envelope"), Effect("gulp", "to", 250 + t, 300)];
                break;
            case "call":
            {
                var landed = 250 + t;
                var back = landed + 600;
                body =
                [
                    Effect("gulp", "from", 0, 250), Blob(250, "envelope"), Effect("gulp", "to", landed, 300), Effect("wait", "from", landed, 600),
                    new Beat("blob", "line", back, t, "back", "envelope", "reply"),
                    Effect("gulp", "from", back + t, 300),
                ];
                break;
            }
            case "event":
                body = [Effect("gulp", "from", 0, 250), Blob(250, "bolt"), Effect("flash", "to", 250 + t, 450)];
                break;
            case "callback" when a.Trigger == "inside":
                body = [Effect("ring", "from", 0, 600), Blob(450, "bell"), Effect("ring", "to", 450 + t, 600)];
                break;
            case "callback" when afterLanding:
                body = [Effect("flash", "from", 0, 450), Blob(300, "bell"), Effect("ring", "to", 300 + t, 600)];
                break;
            case "callback":
                body = [new Beat("drop", "from", 0, 600, Glyph: "bolt"), Effect("flash", "from", 600, 450), Blob(850, "bell"), Effect("ring", "to", 850 + t, 600)];
                break;
            default:
                throw new ArgumentException($"unknown animation kind \"{a.Kind}\"");
        }
        var total = body.Max(b => b.At + b.Dur);
        body.Insert(0, new Beat("pipe", "line", 0, total));
        return (body, total);
    }
}
