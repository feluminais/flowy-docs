namespace Flowy.Core;

/// <summary>An SVG matrix <c>a b c d e f</c>: x' = a x + c y + e, y' = b x + d y + f.</summary>
public readonly record struct HeadMatrix(double A, double B, double C, double D, double E, double F);

/// <summary>
/// The arrowhead of a line, drawn by both readers from one shape so it is the same size in each and takes the line's colour. A port of src/core/heads.ts.
/// The shape is drawn in a frame of its own: tip at the origin, pointing along +x, body towards -x.
/// </summary>
public static class Heads
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
}
