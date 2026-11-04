using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>What a line looks like: its pattern (<c>solid</c> or <c>dashdot</c>), the mark at its receiving end (<c>filled</c> or <c>open</c>) and the one at its sending end (<c>none</c>, <c>open</c>, <c>double</c>, <c>ring</c> or <c>diamond</c>).</summary>
public sealed record LineLook(string Pattern, string Head, string Tail);

/// <summary>One of the six kinds: its word in the file, the name a person reads, and the look of its line.</summary>
public sealed record KindInfo(string Id, string Name, LineLook Look);

/// <summary>How a mark is drawn: its path in a frame of its own, how it is painted (<c>fill</c>, <c>stroke</c> or <c>hollow</c>), and its stroke width at scale 1 (0 for a filled mark).</summary>
public sealed record KindMark(string Path, string Paint, double Width);

/// <summary>
/// What a connection is, drawn as a line: a port of src/core/kinds.ts. A connection says <c>kind:</c> with one of six words and the line takes a pattern and a
/// mark at each end to match. A kind is shape only (colour is state, width is traffic), and the six are fixed. A connection with no kind, or with a word
/// that is none of the six, is the plain line: solid, a filled head, no tail.
/// </summary>
public static partial class Kinds
{
    /// <summary>The look of a connection with no kind: today's line.</summary>
    public static readonly LineLook PlainLook = new("solid", "filled", "none");

    /// <summary>What the plain line is called in a key.</summary>
    public const string PlainName = "Plain line";

    /// <summary>The six kinds in the order a key and a picker list them.</summary>
    public static readonly IReadOnlyList<KindInfo> All =
    [
        new("request", "Request and reply", new("solid", "filled", "open")),
        new("stream", "Request then stream", new("solid", "filled", "double")),
        new("publish", "Publish and subscribe", new("solid", "open", "none")),
        new("cached", "Cached publish", new("solid", "open", "ring")),
        new("object", "Object updates", new("solid", "open", "diamond")),
        new("extension", "Extension point", new("dashdot", "filled", "none")),
    ];

    /// <summary>The six kind words as a check message lists them.</summary>
    public static readonly string List = string.Join(", ", All.Select(k => k.Id));

    /// <summary>How each pattern is dashed on a line, in px as SVG's <c>stroke-dasharray</c> takes it (the desktop divides by the pen's thickness). Butt caps.</summary>
    public static IReadOnlyList<double> Dashes(string pattern) => pattern == "dashdot" ? [11, 3, 2, 3] : [];

    /// <summary>A ring: four cubics (not arcs, so the reader that flattens paths made of M, L, C and Q still works), radius 3.5, its edge on the line's end.</summary>
    private const string RingPath = "M0 0C0 1.933 -1.567 3.5 -3.5 3.5C-5.433 3.5 -7 1.933 -7 0C-7 -1.933 -5.433 -3.5 -3.5 -3.5C-1.567 -3.5 0 -1.933 0 0Z";

    /// <summary>
    /// The marks, each in a frame of its own like the head in <see cref="Heads"/>: tip at the origin, pointing along +x, body towards -x. Every mark fits a 10 px band
    /// across the line. In the order the TypeScript lists them.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, KindMark> Marks = new Dictionary<string, KindMark>
    {
        ["filled"] = new(Heads.Path, "fill", 0),
        ["open"] = new("M-9.5 -4L-1.5 0L-9.5 4", "stroke", 1.75),
        ["double"] = new("M-9.5 -4L-1.5 0L-9.5 4M-15.5 -4L-7.5 0L-15.5 4", "stroke", 1.75),
        ["ring"] = new(RingPath, "hollow", 1.5),
        ["diamond"] = new("M0 0L-6 -3.5L-12 0L-6 3.5Z", "hollow", 1.5),
    };

    [GeneratedRegex(@"-?\d*\.?\d+")]
    private static partial Regex Numbers();

    /// <summary>Rounded to 3 decimals the way JavaScript's <c>Math.round(x * 1000) / 1000</c> does: halves go up.</summary>
    private static double Round3(double x) => Math.Floor(x * 1000 + 0.5) / 1000;

    /// <summary>Whether a value read from a file is one of the six kind words, written exactly.</summary>
    public static bool IsKind(string? word) => word is not null && All.Any(k => k.Id == word);

    /// <summary>The kind a connection has, or null for none, a blank one, or a word that is not a kind (it draws plain).</summary>
    public static string? KindOf(Connection c) => IsKind(c.Kind) ? c.Kind : null;

    /// <summary>The name of a kind as the UI says it.</summary>
    public static string NameOf(string id) => All.First(k => k.Id == id).Name;

    /// <summary>The look of a kind, or the plain look for none.</summary>
    public static LineLook LookOfKind(string? id) => id is null ? PlainLook : All.First(k => k.Id == id).Look;

    /// <summary>The look a connection draws on its own.</summary>
    public static LineLook LookOf(Connection c) => LookOfKind(KindOf(c));

    public static bool SameLook(LineLook a, LineLook b) => a == b;

    public static bool IsPlain(LineLook look) => SameLook(look, PlainLook);

    /// <summary>
    /// The look of one drawn line that stands for several connections, or null when it is the plain line (so a model with no kinds is unchanged).
    /// <paramref name="looks"/> has one entry for each connection; <paramref name="both"/> is whether they run both ways.
    /// All the same look, one way: that look, tail included. All the same, both ways: the head at both ends and no tails. The same pattern with different marks:
    /// the pattern stays and the head is plain. Otherwise the plain line.
    /// </summary>
    public static LineLook? MergedLook(IReadOnlyList<LineLook> looks, bool both)
    {
        if (looks.Count == 0) return null;
        var first = looks[0];
        LineLook merged;
        if (looks.All(l => SameLook(l, first))) merged = both ? first with { Tail = "none" } : first;
        else if (looks.All(l => l.Pattern == first.Pattern)) merged = new(first.Pattern, PlainLook.Head, "none");
        else return null;
        return IsPlain(merged) ? null : merged;
    }

    /// <summary>The kind that all of these connections share, or null when one has none, one has a word that is no kind, or they differ.</summary>
    public static string? SharedKind(IReadOnlyList<Connection> connections)
    {
        var first = connections.Count == 0 ? null : KindOf(connections[0]);
        return first is not null && connections.All(c => KindOf(c) == first) ? first : null;
    }

    /// <summary>A mark's path with every coordinate multiplied by <paramref name="scale"/> and rounded to 3 decimals. Marks are drawn in absolute M, L, C and Z, so every number is a coordinate.</summary>
    public static string MarkPath(string shape, double scale = 1) =>
        Numbers().Replace(Marks[shape].Path, m => JsCompat.Number(Round3(double.Parse(m.Value, System.Globalization.CultureInfo.InvariantCulture) * scale)));

    /// <summary>A mark's stroke width at <paramref name="scale"/> (<see cref="Heads.Scale"/> gives the scale for a line's width), rounded to 3 decimals (0 for a filled mark).</summary>
    public static double MarkStroke(string shape, double scale = 1) => Round3(Marks[shape].Width * scale);
}
