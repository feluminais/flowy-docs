using System.Globalization;
using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>An SVG matrix <c>a b c d e f</c>: x' = a x + c y + e, y' = b x + d y + f.</summary>
public readonly record struct HeadMatrix(double A, double B, double C, double D, double E, double F);

/// <summary>
/// The arrowhead of a line, drawn by both readers from one shape so it is the same size in each and takes the line's colour. A port of src/core/heads.ts.
/// The shape is drawn in a frame of its own: tip at the origin, pointing along +x, body towards -x.
/// </summary>
public static partial class Heads
{
    /// <summary>The head's path at scale 1: a closed triangle 10 long and 9 wide, filled and not stroked.</summary>
    public const string Path = "M0 0L-10 -4.5L-10 4.5Z";

    public const double Length = 10;

    public const double HalfWidth = 4.5;

    /// <summary>Lines up to this thick (a quiet line is 1.5, a picked one 2, a lit one 2.5) wear the head at scale 1.</summary>
    private const double BaseWidth = 2.5;

    /// <summary>How much bigger the head is drawn on a line <paramref name="width"/> thick: 1 up to 2.5, then growing with the square root of the width. Rounded to 3 decimals.</summary>
    public static double Scale(double width) => Math.Round(Math.Sqrt(Math.Max(1, width / BaseWidth)), 3, MidpointRounding.AwayFromZero);

    /// <summary>
    /// The matrix that puts a head with its tip at <paramref name="end"/>, pointing along <paramref name="dir"/> (a unit vector out of the line). For the head at the
    /// start of a line, <paramref name="end"/> is the line's start and <paramref name="dir"/> points back out of the line.
    /// </summary>
    public static HeadMatrix Matrix(Pt end, Pt dir, double scale = 1) => new(dir.X * scale, dir.Y * scale, -dir.Y * scale, dir.X * scale, end.X, end.Y);

    /// <summary>Where a line starts and ends, and the unit direction out of the line at each end (where its heads point).</summary>
    public readonly record struct PathEnds(Pt Start, Pt StartDir, Pt End, Pt EndDir);

    // A number (with an exponent, as JavaScript prints very small or very large ones) or a lone letter, which is a command. The number is tried first, so its `e` is never a command.
    [GeneratedRegex(@"(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)|([A-Za-z])", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Token();

    private static int Takes(string command) => command switch { "M" or "L" => 2, "C" => 6, "Q" => 4, _ => -1 };

    private static Pt Unit(Pt a, Pt b)
    {
        var dx = b.X - a.X;
        var dy = b.Y - a.Y;
        var length = Math.Sqrt(dx * dx + dy * dy);
        return length == 0 ? new Pt(0, 1) : new Pt(dx / length, dy / length);
    }

    /// <summary>
    /// Where a line drawn as an SVG path (absolute <c>M</c>, <c>L</c>, <c>C</c> and <c>Q</c> only, as the canvas draws lines) starts and ends, and which way it points there: the tangent, from the
    /// control point next to the end (or the point before it, when the control point is the end itself). Null for a path that is not made of those. A port of endsOfPath.
    /// </summary>
    public static PathEnds? EndsOfPath(string d)
    {
        var parts = new List<(string Command, List<double> Numbers)>();
        foreach (Match m in Token().Matches(d))
        {
            if (m.Groups[2].Success) parts.Add((m.Groups[2].Value, []));
            else if (parts.Count > 0) parts[^1].Numbers.Add(double.Parse(m.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture));
            else return null;
        }
        var segments = new List<(string Command, List<Pt> At)>();
        foreach (var (command, numbers) in parts)
        {
            if (Takes(command) != numbers.Count) return null;
            var at = new List<Pt>();
            for (var i = 0; i < numbers.Count; i += 2) at.Add(new Pt(numbers[i], numbers[i + 1]));
            segments.Add((command, at));
        }
        if (segments.Count < 2 || segments[0].Command != "M") return null;
        var start = segments[0].At[0];
        var first = segments[1];
        var last = segments[^1];
        var end = last.At[^1];
        var before = segments[^2].At[^1];
        // A curve whose control point sits on its own end has no tangent there: it is the chord that points.
        var towardsStart = first.At[0];
        var towardsEnd = last.At.Count > 1 ? last.At[^2] : before;
        return new PathEnds(start, Unit(first.Command == "C" && towardsStart == start ? first.At[2] : towardsStart, start), end, Unit(towardsEnd == end && last.At.Count > 1 ? before : towardsEnd, end));
    }
}
