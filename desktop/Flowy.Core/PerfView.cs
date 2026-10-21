using System.Globalization;

namespace Flowy.Core;

/// <summary>What a curve is drawn on: the lowest and highest value, and whether the way up is a power of ten each step.</summary>
public sealed record Scale(double Lo, double Hi, bool Log);

/// <summary>Where a curve is drawn: the rectangle of its plot.</summary>
public sealed record Area(double X, double Y, double Width, double Height);

/// <summary>How a number of the panel is named and written, and how its curve is drawn: against zero or on a scale of powers of ten. A <see cref="Max"/> fixes the top of the scale.</summary>
public sealed record MetricInfo(string Label, Func<double, string> Show, bool Log = false, double? Max = null);

/// <summary>
/// The maths and the words of the Performance panel, kept apart from the drawing so the tests can run them: a port of ui/src/perfview.ts, kept equal
/// to it by the fixtures in desktop/fixtures/perf.ts. A <em>position</em> is a place along the tested levels: 0 is the first, 1.5 halfway from the second
/// to the third.
/// </summary>
public static class PerfView
{
    /// <summary>How long Ramp takes to sweep from the first tested level to the last, whatever the number of levels.</summary>
    public const double RampMs = 30_000;

    /// <summary>How often a ramp gives the screen a new position, in ms: the panel and the shapes are drawn again that often, while the dots move on every frame.</summary>
    public const double RampStepMs = 50;

    /// <summary>The top of the slider: the position of the last level.</summary>
    public static int Top(LoadRun run) => run.Levels.Count - 1;

    public static double ClampPos(LoadRun run, double pos) => Math.Min(Top(run), Math.Max(0, double.IsFinite(pos) ? pos : 0));

    /// <summary>The load at a position: a tested level's own load exactly, and a straight line between two.</summary>
    public static double LoadAt(LoadRun run, double pos)
    {
        var p = ClampPos(run, pos);
        var i = Math.Min(Top(run) - 1, (int)Math.Floor(p));
        var (a, b) = (run.Levels[i].Load, run.Levels[i + 1].Load);
        return a + (b - a) * (p - i);
    }

    /// <summary>Whether a position is a tested level, not somewhere between two.</summary>
    public static bool IsTested(double pos) => Math.Abs(pos - Perf.JsRound(pos)) < 1e-6;

    /// <summary>The position <paramref name="ms"/> further on in a ramp (it stops at the last level).</summary>
    public static double RampPos(LoadRun run, double pos, double ms) => ClampPos(run, pos + ms * Top(run) / RampMs);

    /// <summary>Where a ramp starts: from the bottom when it is at the top already, else from where it is.</summary>
    public static double RampFrom(LoadRun run, double pos) => pos >= Top(run) ? 0 : pos;

    /// <summary>The run the panel shows: the one asked for if there is such a run, else the first, else none (a run can come and go while the panel is open).</summary>
    public static string ActiveRun(IdMap<LoadRun> runs, string id) => runs.Contains(id) ? id : runs.Keys.FirstOrDefault() ?? "";

    /// <summary>A position as the slider can hold it, snapped to a tested level.</summary>
    public static double Snap(LoadRun run, double pos) => Perf.JsRound(ClampPos(run, pos));

    // ---- numbers in words ---------------------------------------------------------------------------------------

    /// <summary>
    /// JavaScript's <c>n.toFixed(places)</c>: the exact value of the number rounded to that many places, a tie going to the larger. (.NET's "F" format
    /// sends a tie to the even digit, so 4.25 would read 4.2 here and 4.3 in the browser.)
    /// </summary>
    internal static string ToFixed(double n, int places)
    {
        var exact = Math.Abs(n).ToString("F" + (places + 25), CultureInfo.InvariantCulture);
        var dot = exact.IndexOf('.');
        var kept = System.Numerics.BigInteger.Parse(exact[..dot] + exact.Substring(dot + 1, places));
        if (exact[dot + 1 + places] >= '5') kept += 1;
        var digits = kept.ToString(CultureInfo.InvariantCulture).PadLeft(places + 1, '0');
        var text = places == 0 ? digits : $"{digits[..^places]}.{digits[^places..]}";
        return n < 0 && kept != 0 ? "-" + text : text;
    }

    /// <summary>JavaScript's <c>String(Number(n.toFixed(places)))</c>: rounded to that many places, without the zeros that don't matter.</summary>
    private static string Trim(double n, int places) =>
        double.Parse(ToFixed(n, places), CultureInfo.InvariantCulture).ToString("R", CultureInfo.InvariantCulture);

    /// <summary>A latency: "4.2 ms", "180 ms", "2.4 s".</summary>
    public static string FmtMs(double ms) => ms >= 1000 ? $"{Trim(ms / 1000, 1)} s" : $"{Trim(ms, ms < 10 ? 1 : 0)} ms";

    public static string FmtPct(double share) => $"{Trim(share * 100, share < 0.1 ? 1 : 0)}%";

    public static string FmtRate(double rate) => $"{Trim(rate, rate < 10 ? 1 : 0)} calls a second";

    /// <summary>The size of a call: "400 B", "1.5 KB", "2.4 MB" (a thousand to the step, like the numbers a formula is written in).</summary>
    public static string FmtBytes(double bytes) => bytes switch
    {
        >= 1_000_000 => $"{Trim(bytes / 1_000_000, bytes < 10_000_000 ? 1 : 0)} MB",
        >= 1000 => $"{Trim(bytes / 1000, bytes < 10_000 ? 1 : 0)} KB",
        _ => $"{Trim(bytes, bytes < 10 ? 1 : 0)} B",
    };

    /// <summary>A load with its unit: "200 req/s".</summary>
    public static string FmtLoad(double load, string unit) => $"{Trim(load, load < 10 ? 1 : 0)} {unit}";

    /// <summary>How each number is named and written in the panel, by the key it has in a run file.</summary>
    public static IReadOnlyDictionary<string, MetricInfo> Metrics { get; } = new Dictionary<string, MetricInfo>
    {
        ["util"] = new("Busy", FmtPct, Max: 1),
        ["queue"] = new("Waiting", v => Trim(Perf.JsRound(v), 0)),
        ["errors"] = new("Failing", FmtPct),
        ["rate"] = new("Calls", FmtRate),
        ["bytes"] = new("Size of a call", FmtBytes),
        ["p50"] = new("Expected call", FmtMs, Log: true),
        ["p95"] = new("Slowest 5%", FmtMs, Log: true),
    };

    /// <summary>The numbers a shape can have, and a line, in the order the panel lists them.</summary>
    public static readonly string[] BoxKeys = ["util", "queue", "errors"];

    public static readonly string[] LineKeys = ["rate", "bytes", "p50", "p95", "errors"];

    // ---- curves -------------------------------------------------------------------------------------------------

    /// <summary>A scale that holds every number in <paramref name="values"/>. A log one runs from a power of ten below the smallest to one above the largest.</summary>
    public static Scale ScaleOf(IEnumerable<double?> values, bool log = false, double? from = null, double? to = null)
    {
        var seen = values.Where(v => v is { } n && double.IsFinite(n) && (!log || n > 0)).Select(v => v!.Value).ToList();
        if (log)
        {
            var lo = Math.Floor(Math.Log10(seen.Count > 0 ? seen.Min() : 1));
            var hi = Math.Ceiling(Math.Log10(seen.Count > 0 ? seen.Max() : 10));
            return new Scale(lo, hi == lo ? lo + 1 : hi, true);
        }
        var low = from ?? 0;
        var high = to ?? (seen.Count > 0 ? seen.Max() : 1);
        return new Scale(low, high == low ? low + 1 : high, false);
    }

    private static double Place(Scale scale, double v)
    {
        var f = scale.Log ? (Math.Log10(Math.Max(v, Math.Pow(10, scale.Lo))) - scale.Lo) / (scale.Hi - scale.Lo) : (v - scale.Lo) / (scale.Hi - scale.Lo);
        return Math.Min(1, Math.Max(0, f));
    }

    /// <summary>Where level <paramref name="i"/> of <paramref name="n"/> sits across an area: evenly spaced, so a run that goes 10, 25, 50, 100, 200, 400 reads as steps.</summary>
    public static double XAt(Area box, double i, int n) => box.X + (n <= 1 ? 0 : box.Width * i / (n - 1));

    public static double YAt(Area box, Scale scale, double v) => box.Y + box.Height * (1 - Place(scale, v));

    private static double Round1(double n) => Perf.JsRound(n * 10) / 10;

    private static string Num(double n) => n.ToString("R", CultureInfo.InvariantCulture);

    /// <summary>A curve through the values as SVG path data, one point to each level, broken where a level has no number.</summary>
    public static string PathOf(IReadOnlyList<double?> values, Scale scale, Area box)
    {
        var d = new System.Text.StringBuilder();
        var pen = false;
        for (var i = 0; i < values.Count; i++)
        {
            if (values[i] is not { } v || !double.IsFinite(v))
            {
                pen = false;
                continue;
            }
            d.Append(pen ? 'L' : 'M').Append(Num(Round1(XAt(box, i, values.Count)))).Append(' ').Append(Num(Round1(YAt(box, scale, v))));
            pen = true;
        }
        return d.ToString();
    }

    /// <summary>The power-of-ten gridlines of a log scale, with their words: "10 ms", "1 s".</summary>
    public static IReadOnlyList<(double Y, string Label)> GridOf(Scale scale, Area box)
    {
        var lines = new List<(double, string)>();
        for (var e = scale.Lo; e <= scale.Hi; e++) lines.Add((Round1(YAt(box, scale, Math.Pow(10, e))), FmtMs(Math.Pow(10, e))));
        return lines;
    }

    /// <summary>The labels under the levels: every level's load, or every few when there would be too many to read.</summary>
    public static IReadOnlyList<(double X, string Label)> LevelLabels(LoadRun run, Area box, int most = 8)
    {
        var n = run.Levels.Count;
        var every = (int)Math.Ceiling(n / (double)most);
        var labels = new List<(double, string)>();
        for (var i = 0; i < n; i++)
            if (i % every == 0 || i == n - 1) labels.Add((Round1(XAt(box, i, n)), Num(run.Levels[i].Load)));
        return labels;
    }

    // ---- readings -----------------------------------------------------------------------------------------------

    /// <summary>What each tested level says about an object, key by key, as the view draws it (a shape that holds others takes the worst of what is inside).</summary>
    public static IReadOnlyList<double?> BoxSeries(Model model, LoadRun run, string view, string id, string key) =>
        run.Levels.Select(l => Perf.RollUp(model, l, view).Objects is var o && o.TryGetValue(id, out var m) ? m[key] : null).ToList();

    /// <summary>The same for the line a view draws between two shapes.</summary>
    public static IReadOnlyList<double?> LineSeries(Model model, LoadRun run, string view, string from, string to, string key) =>
        run.Levels.Select(l => Perf.RollUp(model, l, view).Lines.FirstOrDefault(p => p.From == from && p.To == to)?[key]).ToList();

    /// <summary>An object's numbers at a load, or null when nothing was measured on it.</summary>
    public static Metrics? BoxAt(Model model, LoadRun run, string view, string id, double load) =>
        Perf.RollUp(model, Perf.Interpolate(run, load), view).Objects is var o && o.TryGetValue(id, out var m) ? m : null;

    /// <summary>A line's numbers at a load.</summary>
    public static Metrics? LineAt(Model model, LoadRun run, string view, string from, string to, double load) =>
        Perf.RollUp(model, Perf.Interpolate(run, load), view).Lines.FirstOrDefault(p => p.From == from && p.To == to);
}
