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

    /// <summary>The lowest position of a run: -1, where there is no load at all, for a load run that can be idle (see <see cref="Perf.IdleOf"/>), else 0.</summary>
    public static int FloorPos(LoadRun run) => Perf.IdleOf(run) is null ? 0 : -1;

    public static double ClampPos(LoadRun run, double pos) => Math.Min(Top(run), Math.Max(FloorPos(run), double.IsFinite(pos) ? pos : 0));

    /// <summary>The load at a position: a tested level's own load exactly, and a straight line between two. Below the first level it runs down to 0 at -1.</summary>
    public static double LoadAt(LoadRun run, double pos)
    {
        var p = ClampPos(run, pos);
        if (p < 0) return run.Levels[0].Load * (1 + p);
        var i = Math.Min(Top(run) - 1, (int)Math.Floor(p));
        var (a, b) = (run.Levels[i].Load, run.Levels[i + 1].Load);
        return a + (b - a) * (p - i);
    }

    /// <summary>Whether a position is a tested level, not somewhere between two (or below the first, where no load is tested).</summary>
    public static bool IsTested(double pos) => pos > -1e-6 && Math.Abs(pos - Perf.JsRound(pos)) < 1e-6;

    /// <summary>
    /// The position of a time or load <paramref name="x"/>, the other way round from <see cref="LoadAt"/>: a tested level's own number is its whole position, and between two it is a
    /// straight line. Outside the run it is the nearest end; a time that is not finite is the start, as for <see cref="ClampPos"/>.
    /// </summary>
    public static double PosAt(LoadRun run, double x)
    {
        var levels = run.Levels;
        if (!double.IsFinite(x) || x <= levels[0].Load) return 0;
        if (x >= levels[Top(run)].Load) return Top(run);
        for (var i = 0; i < Top(run); i++)
            if (x < levels[i + 1].Load) return i + (x - levels[i].Load) / (levels[i + 1].Load - levels[i].Load);
        return Top(run);
    }

    /// <summary>The time or load at a position (the same as <see cref="LoadAt"/>, named for the way round that goes with <see cref="PosAt"/>).</summary>
    public static double XOfPos(LoadRun run, double pos) => LoadAt(run, pos);

    /// <summary>How wide a run is: from its first level's time or load to its last's.</summary>
    private static double Span(LoadRun run) => run.Levels[Top(run)].Load - run.Levels[0].Load;

    /// <summary>Where a time or load sits along the run, 0 to 1, by time or load itself and not by level.</summary>
    private static double Along(LoadRun run, double x) => (x - run.Levels[0].Load) / Span(run);

    /// <summary>
    /// Where the slider's thumb is, 0 to 1 along it. A time run's slider is linear in time, so a level sits where its time is and an event on its own time. A load run's is even,
    /// a step to each level, whatever the loads are.
    /// </summary>
    public static double SliderFraction(LoadRun run, double pos) =>
        run.IsTime ? Math.Min(1, Math.Max(0, Along(run, XOfPos(run, pos)))) : Top(run) == FloorPos(run) ? 0 : (ClampPos(run, pos) - FloorPos(run)) / (Top(run) - FloorPos(run));

    /// <summary>The events of a time run with where each sits along the slider, 0 to 1, in time order. Nothing for a load run.</summary>
    public static IReadOnlyList<(double Fraction, RunEvent Event)> EventFractions(LoadRun run) =>
        run.IsTime ? [.. run.Events.Select(e => (Math.Min(1, Math.Max(0, Along(run, e.At))), e))] : [];

    /// <summary>The events of a time run as the panel lists them, in time order: whether each has happened by <paramref name="x"/>, and which is the latest that has.</summary>
    public static IReadOnlyList<(RunEvent Event, bool Passed, bool Current)> EventRows(LoadRun run, double x)
    {
        var done = run.Events.Count(e => e.At <= x); // in time order, so the ones that have happened come first
        return [.. run.Events.Select((e, i) => (e, i < done, i == done - 1))];
    }

    /// <summary>What the slider's own numbers run between: a time run's are times, a load run's are positions.</summary>
    public static (double Min, double Max) SliderRange(LoadRun run) => run.IsTime ? (run.Levels[0].Load, run.Levels[Top(run)].Load) : (FloorPos(run), Top(run));

    /// <summary>The number the slider holds at a position (see <see cref="SliderRange"/>).</summary>
    public static double SliderValue(LoadRun run, double pos) => run.IsTime ? XOfPos(run, pos) : ClampPos(run, pos);

    /// <summary>How many stops a gap between two levels has on a dragged load slider: the load changes in steps of a fiftieth of the gap, so a drag draws at most that many times and no finer.</summary>
    public const int SlideSteps = 50;

    /// <summary>How close to a tested level (in gaps) a dragged slider is pulled onto it, so the tested level can be stood on exactly.</summary>
    public const double SlideMagnet = 0.04;

    /// <summary>A dragged position put on the slider's stops, and on a tested level when it is that close to one.</summary>
    public static double Settle(double pos)
    {
        var stop = Perf.JsRound(pos * SlideSteps) / SlideSteps;
        var level = Perf.JsRound(stop);
        return (Math.Abs(stop - level) <= SlideMagnet ? level : stop) + 0;
    }

    /// <summary>The position a dragged slider stands for. A time run goes where it is put, so an event can be stood on; a load run goes where it is put too, on the stops of <see cref="Settle"/>.</summary>
    public static double SlidePos(LoadRun run, double value) => run.IsTime ? PosAt(run, value) : Settle(ClampPos(run, value));

    /// <summary>The position <paramref name="ms"/> further on in a ramp (it stops at the last level). A time run goes on evenly in time, a load run evenly from level to level.</summary>
    public static double RampPos(LoadRun run, double pos, double ms) =>
        run.IsTime ? PosAt(run, XOfPos(run, pos) + ms * Span(run) / RampMs) : ClampPos(run, pos + ms * Top(run) / RampMs);

    /// <summary>Where a ramp starts: from no load (or the first level) when it is at the top already, else from where it is.</summary>
    public static double RampFrom(LoadRun run, double pos) => pos >= Top(run) ? FloorPos(run) : pos;

    /// <summary>The run the panel shows: the one asked for if there is such a run, else the first, else none (a run can come and go while the panel is open).</summary>
    public static string ActiveRun(IdMap<LoadRun> runs, string id) => runs.Contains(id) ? id : runs.Keys.FirstOrDefault() ?? "";

    /// <summary>A position snapped to a tested level (or to no load, at the bottom of a run that can be idle).</summary>
    public static double Snap(LoadRun run, double pos) => Perf.JsRound(ClampPos(run, pos)) + 0;

    // ---- numbers in words ---------------------------------------------------------------------------------------

    /// <summary>
    /// JavaScript's <c>n.toFixed(places)</c>: the exact value of the number rounded to that many places, a tie going to the larger. (.NET's "F" format
    /// sends a tie to the even digit, so 4.25 would read 4.2 here and 4.3 in the browser.)
    /// </summary>
    internal static string ToFixed(double n, int places)
    {
        var exact = Math.Abs(n).ToString("F" + (places + 25), CultureInfo.InvariantCulture);
        var dot = exact.IndexOf('.');
        var kept = System.Numerics.BigInteger.Parse(exact[..dot] + exact.Substring(dot + 1, places), CultureInfo.InvariantCulture);
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
        >= 999_500 => $"{Trim(bytes / 1_000_000, bytes < 10_000_000 ? 1 : 0)} MB", // the unit changes where the value rounds up to the next one
        >= 999.5 => $"{Trim(bytes / 1000, bytes < 10_000 ? 1 : 0)} KB",
        _ => $"{Trim(bytes, bytes < 10 ? 1 : 0)} B",
    };

    /// <summary>A run's note is shown as it is until it is longer than this many characters, then it folds. The same number as `ABOUT_FOLDS_OVER` in ui/src/perfview.ts.</summary>
    public const int AboutFoldsOver = 400;

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

    /// <summary>Where level <paramref name="i"/> of a run sits across an area: evenly for a load run, as <see cref="XAt"/> has it, and by its time for a time run.</summary>
    public static double LevelX(LoadRun run, Area box, int i) => run.IsTime ? box.X + box.Width * Along(run, run.Levels[i].Load) : XAt(box, i, run.Levels.Count);

    /// <summary>Where a position sits across an area, for the cursor of a curve.</summary>
    public static double CursorX(LoadRun run, Area box, double pos) => run.IsTime ? box.X + box.Width * SliderFraction(run, pos) : XAt(box, Math.Max(0, pos), run.Levels.Count);

    public static double YAt(Area box, Scale scale, double v) => box.Y + box.Height * (1 - Place(scale, v));

    private static double Round1(double n) => Perf.JsRound(n * 10) / 10;


    /// <summary>A curve through the values as SVG path data, one point to each level, broken where a level has no number. Given a time run, the points sit at their times, not evenly.</summary>
    public static string PathOf(IReadOnlyList<double?> values, Scale scale, Area box, LoadRun? run = null)
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
            d.Append(pen ? 'L' : 'M').Append(JsCompat.Raw(Round1(run is { IsTime: true } ? LevelX(run, box, i) : XAt(box, i, values.Count)))).Append(' ').Append(JsCompat.Raw(Round1(YAt(box, scale, v))));
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

    /// <summary>How near two labels may be along a time run's slider (a fraction of its width) before the later one is left out.</summary>
    private const double LabelGap = 0.08;

    /// <summary>
    /// The levels that get a label: every one, or every few when there would be too many to read. The last is always named. In a time run levels can sit close together, so one that
    /// would land on the label before it is left out, and the last takes the place of those it would cover.
    /// </summary>
    private static List<int> Labelled(LoadRun run, int most)
    {
        var n = run.Levels.Count;
        var every = (int)Math.Ceiling(n / (double)most);
        var wanted = new List<int>();
        for (var i = 0; i < n; i++)
            if (i % every == 0 || i == n - 1) wanted.Add(i);
        if (!run.IsTime) return wanted;
        double At(int i) => Along(run, run.Levels[i].Load);
        var shown = new List<int>();
        foreach (var i in wanted)
        {
            if (shown.Count > 0 && At(i) - At(shown[^1]) < LabelGap)
            {
                if (i != n - 1) continue;
                while (shown.Count > 1 && At(i) - At(shown[^1]) < LabelGap) shown.RemoveAt(shown.Count - 1);
            }
            shown.Add(i);
        }
        return shown;
    }

    /// <summary>The labels under the levels: every level's load, or every few when there would be too many to read.</summary>
    public static IReadOnlyList<(double X, string Label)> LevelLabels(LoadRun run, Area box, int most = 8) =>
        [.. Labelled(run, most).Select(i => (Round1(LevelX(run, box, i)), JsCompat.Raw(run.Levels[i].Load)))];

    /// <summary>The labels under the slider: a level's time or load at its place along it (0 to 1), thinned the way <see cref="LevelLabels"/> is.</summary>
    public static IReadOnlyList<(double Fraction, string Label)> TickLabels(LoadRun run, int most = 8)
    {
        var floor = run.IsTime ? 0 : FloorPos(run);
        var ticks = Labelled(run, most).Select(i => (run.IsTime ? Along(run, run.Levels[i].Load) : Top(run) == floor ? 0 : (double)(i - floor) / (Top(run) - floor), JsCompat.Raw(run.Levels[i].Load))).ToList();
        return floor < 0 ? [(0, "0"), .. ticks] : ticks;
    }

    // ---- readings -----------------------------------------------------------------------------------------------

    /// <summary>What each tested level says about an object, key by key, as the view draws it (a shape that holds others takes the worst of what is inside).</summary>
    public static IReadOnlyList<double?> BoxSeries(Model model, LoadRun run, string view, string id, string key) => BoxSeriesIn(model, run.Levels, view, id, key);

    /// <summary>The same for the line a view draws between two shapes.</summary>
    public static IReadOnlyList<double?> LineSeries(Model model, LoadRun run, string view, string from, string to, string key) => LineSeriesIn(model, run.Levels, view, from, to, key);

    /// <summary>An object's number at each of these levels (the levels of a run, or of a run with several sources along one dial: see <see cref="ActiveSeries"/>).</summary>
    public static IReadOnlyList<double?> BoxSeriesIn(Model model, IEnumerable<Level> levels, string view, string id, string key) =>
        levels.Select(l => Perf.RollUp(model, l, view).Objects is var o && o.TryGetValue(id, out var m) ? m[key] : null).ToList();

    /// <summary>The same for the line a view draws between two shapes.</summary>
    public static IReadOnlyList<double?> LineSeriesIn(Model model, IEnumerable<Level> levels, string view, string from, string to, string key) =>
        levels.Select(l => Perf.RollUp(model, l, view).Lines.FirstOrDefault(p => p.From == from && p.To == to)?[key]).ToList();

    /// <summary>An object's numbers at a load, or null when nothing was measured on it.</summary>
    public static Metrics? BoxAt(Model model, LoadRun run, string view, string id, double load) => BoxAtLevel(model, Perf.Interpolate(run, load), view, id);

    /// <summary>A line's numbers at a load.</summary>
    public static Metrics? LineAt(Model model, LoadRun run, string view, string from, string to, double load) => LineAtLevel(model, Perf.Interpolate(run, load), view, from, to);

    /// <summary>An object's numbers in a level (what a run says at a load, or what runs with several sources say at a setting: see <see cref="Perf.LevelAt"/>).</summary>
    public static Metrics? BoxAtLevel(Model model, Level level, string view, string id) =>
        Perf.RollUp(model, level, view).Objects is var o && o.TryGetValue(id, out var m) ? m : null;

    /// <summary>A line's numbers in a level.</summary>
    public static Pair? LineAtLevel(Model model, Level level, string view, string from, string to) =>
        Perf.RollUp(model, level, view).Lines.FirstOrDefault(p => p.From == from && p.To == to);

    // ---- colour and key -----------------------------------------------------------------------------------------

    /// <summary>Which kinds of failing call are on the lines now, for the key to draw (see <see cref="FailureMarksOf"/>).</summary>
    public readonly record struct FailureMarks(bool Fade, bool Lost, bool Rejected);

    /// <summary>
    /// Which kinds of failing call are on the lines now, for the key to draw: the usual fade (for a line that fails without saying how, and also while no line
    /// fails, so the key of a run that sets nothing is as it was), a lost call, a rejected one.
    /// </summary>
    public static FailureMarks FailureMarksOf(IEnumerable<LineTraffic> lines)
    {
        var failing = lines.Where(l => l.Failed > 0).ToList();
        return new FailureMarks(
            failing.Count == 0 || failing.Any(l => l.Failure is null),
            failing.Any(l => l.Failure == "lost"),
            failing.Any(l => l.Failure == "rejected"));
    }

    /// <summary>A source's colour for the theme that is showing, as <c>#rrggbb</c>: a named colour has one for each theme, a hex is the same in both. Null for text that is neither.</summary>
    public static string? SourceHex(string? color, bool dark) => Look.ColorPair(color) is { } pair ? (dark ? pair.Dark : pair.Light) : null;

    // ---- several dials ------------------------------------------------------------------------------------------

    /// <summary>The top of a dial's slider: the position of its last tested load.</summary>
    public static int DialTop(Dial d) => d.Values.Count - 1;

    /// <summary>The lowest position of a dial: -1, where there is no load at all, for one that can be idle (see <see cref="Dial.Idle"/>), else 0.</summary>
    public static int FloorOf(Dial d) => d.Idle ? -1 : 0;

    public static double ClampDial(Dial d, double pos) => Math.Min(DialTop(d), Math.Max(FloorOf(d), double.IsFinite(pos) ? pos : 0));

    /// <summary>The setting that puts every dial at its position (see <see cref="Perf.SettingAt"/>).</summary>
    public static IdMap<double> SettingOf(IReadOnlyList<Dial> dials, IReadOnlyList<double> positions) => Perf.SettingAt(dials, positions);

    /// <summary>The position of a load along a dial, the other way round from <see cref="Perf.LoadOfPosition"/>: a tested load is its whole position, and between two it is a straight line. Outside the loads it is the nearest end.</summary>
    public static double PositionOf(Dial d, double x)
    {
        var top = DialTop(d);
        if (!double.IsFinite(x)) return 0;
        if (x <= d.Values[0]) return d.Idle ? Math.Max(-1, -1 + x / d.Values[0]) : 0;
        if (x >= d.Values[top]) return top;
        for (var i = 0; i < top; i++)
            if (x < d.Values[i + 1]) return i + (x - d.Values[i]) / (d.Values[i + 1] - d.Values[i]);
        return top;
    }

    /// <summary>The positions of a setting, one for each dial; a dial it doesn't name is at its lowest load.</summary>
    public static List<double> PositionsOf(IReadOnlyList<Dial> dials, IdMap<double> setting) =>
        [.. dials.Select(d => PositionOf(d, setting.TryGetValue(d.Id, out var x) ? x : double.NaN))];

    /// <summary>
    /// Where the panel opens: at the first struggle when every dial rises together (the knee's step, each dial along its own loads), else every dial at its top, as a single run opens.
    /// <paramref name="knee"/> is what <see cref="Perf.KneeOf"/> found for the run, if anything.
    /// </summary>
    public static List<double> OpeningPositions(IReadOnlyList<Dial> dials, Knee? knee) =>
        knee is null ? [.. dials.Select(d => (double)DialTop(d))] : Perf.LockstepPositions(dials, knee.Index);

    /// <summary>The position a dragged slider of a dial stands for: on the stops of <see cref="Settle"/>, as a single load run's is.</summary>
    public static double SlideDial(Dial d, double value) => Settle(ClampDial(d, value));

    /// <summary>The positions with the dial <paramref name="active"/> at <paramref name="pos"/> (kept inside the dial); the others stay where they are.</summary>
    public static List<double> PlaceActive(IReadOnlyList<Dial> dials, IReadOnlyList<double> positions, int active, double pos) =>
        [.. positions.Select((p, i) => i == active ? ClampDial(dials[i], pos) : p)];

    /// <summary>The whole-number position one step on from <paramref name="pos"/> in <paramref name="direction"/> (1 or -1): the next tested load, or the one before, even when <paramref name="pos"/> is between two.</summary>
    public static double StepFrom(double pos, int direction) => direction == 1 ? Math.Floor(pos + 1e-6) + 1 : Math.Ceiling(pos - 1e-6) - 1;

    /// <summary>The positions with the dial <paramref name="active"/> one tested load further on (it stops at either end). Arrow keys.</summary>
    public static List<double> StepActive(IReadOnlyList<Dial> dials, IReadOnlyList<double> positions, int active, int direction) =>
        PlaceActive(dials, positions, active, Perf.JsRound(ClampDial(dials[active], StepFrom(positions[active], direction))) + 0);

    /// <summary>The positions with the dial <paramref name="active"/> at its first or last tested load. Home and End.</summary>
    public static List<double> EdgeActive(IReadOnlyList<Dial> dials, IReadOnlyList<double> positions, int active, bool end) =>
        PlaceActive(dials, positions, active, end ? DialTop(dials[active]) : 0);

    /// <summary>The positions with the dial <paramref name="active"/> <paramref name="ms"/> further on in a ramp (it stops at its last tested load). The others are held.</summary>
    public static List<double> RampActive(IReadOnlyList<Dial> dials, IReadOnlyList<double> positions, int active, double ms) =>
        PlaceActive(dials, positions, active, positions[active] + ms * DialTop(dials[active]) / RampMs);

    /// <summary>Where a ramp of the dial <paramref name="active"/> starts: from its bottom when it is at the top already, else from where it is.</summary>
    public static List<double> RampFromActive(IReadOnlyList<Dial> dials, IReadOnlyList<double> positions, int active) =>
        positions[active] >= DialTop(dials[active]) ? PlaceActive(dials, positions, active, FloorOf(dials[active])) : [.. positions];

    /// <summary>
    /// The level at each tested load of the dial <paramref name="active"/>, with the others held where they stand: what the Strip and the small curves plot, as a single run plots the levels it
    /// was tested at. One level for each load of the dial, in order.
    /// </summary>
    public static List<Level> ActiveSeries(IdMap<LoadRun> runs, string id, IReadOnlyList<Dial> dials, IReadOnlyList<double> positions, int active)
    {
        var held = SettingOf(dials, positions);
        var dial = dials[Math.Min(dials.Count - 1, Math.Max(0, active))];
        return [.. dial.Values.Select(v =>
        {
            var setting = new IdMap<double>();
            foreach (var d in dials) setting.Add(d.Id, d.Id == dial.Id ? v : held[d.Id]);
            return Perf.LevelAt(runs, id, setting);
        })];
    }

    /// <summary>The dials that are held while the Strip and the curves follow <paramref name="active"/>, each with its name and where it stands in words: "Courier pings held at 100 pings/s".</summary>
    public static List<string> HeldText(IReadOnlyList<Dial> dials, IReadOnlyList<double> positions, int active)
    {
        var output = new List<string>();
        for (var i = 0; i < dials.Count; i++)
            if (i != active) output.Add($"{dials[i].Name} held at {FmtLoad(Perf.LoadOfPosition(dials[i].Values, positions[i]), dials[i].Unit)}");
        return output;
    }

    /// <summary>The labels under a dial's slider: its tested loads at their places along it (0 to 1), every one, or every few when there would be too many to read. The last is always named.</summary>
    public static IReadOnlyList<(double Fraction, string Label)> DialTicks(Dial d, int most = 8)
    {
        var n = d.Values.Count;
        var every = (int)Math.Ceiling(n / (double)most);
        var floor = FloorOf(d);
        var output = new List<(double, string)>();
        if (floor < 0) output.Add((0, "0"));
        for (var i = 0; i < n; i++)
            if (i % every == 0 || i == n - 1) output.Add((n - 1 == floor ? 0 : (double)(i - floor) / (n - 1 - floor), JsCompat.Raw(d.Values[i])));
        return output;
    }

    /// <summary>The tested loads either side of a position (the same when it is on one), for "Between 600 and 900, estimated".</summary>
    public static (double Lower, double Upper, bool Tested) BracketOf(Dial d, double pos)
    {
        var top = DialTop(d);
        var p = ClampDial(d, pos);
        if (p < 0) return (0, d.Values[0], false);
        return (d.Values[Math.Min(top - 1, (int)Math.Floor(p))], d.Values[Math.Min(top, (int)Math.Floor(p) + 1)], IsTested(p));
    }

    /// <summary>The note beside a load number: "Tested" on one of the tested levels, otherwise "Between 600 and 900, estimated".</summary>
    public static string LoadNote(LoadRun run, double pos)
    {
        var p = ClampPos(run, pos);
        if (IsTested(p)) return "Tested";
        if (p < 0) return Between(0, run.Levels[0].Load);
        var i = Math.Min(Top(run) - 1, (int)Math.Floor(p));
        return Between(run.Levels[i].Load, run.Levels[i + 1].Load);
    }

    /// <summary>The same note for one dial of a run with several sources.</summary>
    public static string LoadNote(Dial d, double pos)
    {
        var (lower, upper, tested) = BracketOf(d, pos);
        return tested ? "Tested" : Between(lower, upper);
    }

    private static string Between(double lower, double upper) =>
        $"Between {lower.ToString("R", CultureInfo.InvariantCulture)} and {upper.ToString("R", CultureInfo.InvariantCulture)}, estimated";

    /// <summary>What the panel says once, near the top, about how the sources were measured: nothing for a single run.</summary>
    public static string? ModeLabel(string mode) => mode switch { Perf.ModeAdded => "Added from separate runs", Perf.ModeTested => "Tested together", _ => null };

    /// <summary>What a shape's readout says when runs that were added made it pass its capacity, which one run never does: nothing for a share that is 1 or under, or for runs tested together.</summary>
    public static string? OverText(string mode, double? util) => mode == Perf.ModeAdded && util > 1 ? "Added use is over 100%" : null;
}
