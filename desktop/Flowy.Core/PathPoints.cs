using System.Globalization;
using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>A line as points, and the length up to each point.</summary>
public sealed record FlatLine(double[] Xs, double[] Ys, double[] At, double Total);

/// <summary>
/// A line as points. The SVG path <see cref="LinePaths"/> writes for a line (M, L, C and Q only) is flattened once into a polyline with the length up
/// to each point, so a particle's place at any fraction of the way is a lookup and a blend. A port of ui/src/pathpoints.ts. No drawing in here.
/// </summary>
public static partial class PathPoints
{
    private const int CurveSteps = 16;

    [GeneratedRegex(@"[MLCQ]|-?\d*\.?\d+(?:e-?\d+)?", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Token();

    /// <summary>The SVG path as a polyline. Anything it doesn't understand is skipped, and an empty path is a point at the origin.</summary>
    public static FlatLine Flatten(string d)
    {
        var tokens = Token().Matches(d).Select(m => m.Value).ToList();
        var xs = new List<double>();
        var ys = new List<double>();
        void Push(double x, double y)
        {
            xs.Add(x);
            ys.Add(y);
        }
        var i = 0;
        double Num() => i < tokens.Count && double.TryParse(tokens[i++], NumberStyles.Float, CultureInfo.InvariantCulture, out var n) ? n : double.NaN;
        while (i < tokens.Count)
        {
            var command = tokens[i++].ToUpperInvariant();
            if (command is "M" or "L") Push(Num(), Num());
            else if (command is "C" or "Q")
            {
                var control = command == "C" ? 2 : 1;
                var (x0, y0) = (xs.Count > 0 ? xs[^1] : 0, ys.Count > 0 ? ys[^1] : 0);
                var points = Enumerable.Range(0, control + 1).Select(_ => (X: Num(), Y: Num())).ToArray();
                var (x3, y3) = points[control];
                for (var k = 1; k <= CurveSteps; k++)
                {
                    double t = (double)k / CurveSteps, u = 1 - t;
                    if (command == "C")
                    {
                        var ((x1, y1), (x2, y2)) = (points[0], points[1]);
                        Push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3);
                    }
                    else
                    {
                        var (x1, y1) = points[0];
                        Push(u * u * x0 + 2 * u * t * x1 + t * t * x3, u * u * y0 + 2 * u * t * y1 + t * t * y3);
                    }
                }
            }
        }
        if (xs.Count == 0) Push(0, 0);
        var at = new double[xs.Count];
        for (var k = 1; k < xs.Count; k++) at[k] = at[k - 1] + Math.Sqrt(Math.Pow(xs[k] - xs[k - 1], 2) + Math.Pow(ys[k] - ys[k - 1], 2));
        return new FlatLine([.. xs], [.. ys], at, at[^1]);
    }

    /// <summary>The point <paramref name="s"/> of the way along (0 at the start, 1 at the end; outside that it stops at the ends).</summary>
    public static (double X, double Y) PointAt(FlatLine line, double s)
    {
        var last = line.Xs.Length - 1;
        if (last == 0 || line.Total == 0) return (line.Xs[0], line.Ys[0]);
        var length = Math.Min(1, Math.Max(0, s)) * line.Total;
        int lo = 0, hi = last;
        while (hi - lo > 1)
        {
            var mid = (lo + hi) >> 1;
            if (line.At[mid] <= length) lo = mid;
            else hi = mid;
        }
        var span = line.At[hi] - line.At[lo];
        var f = span == 0 ? 0 : (length - line.At[lo]) / span;
        return (line.Xs[lo] + (line.Xs[hi] - line.Xs[lo]) * f, line.Ys[lo] + (line.Ys[hi] - line.Ys[lo]) * f);
    }
}
