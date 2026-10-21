namespace Flowy.Core;

/// <summary>How a view looks at a load: dots on lines, strain on shapes. Twin of src/core/perf/traffic.ts.</summary>
public static partial class Perf
{
    /// <summary>
    /// Most dots a source puts on a line at once. A screen line is a hundred to three hundred pixels long and a dot is a few pixels across, so past about
    /// this many they run together and stop being countable. Past it a line is scaled down and says so (see <see cref="CapCounts"/>).
    /// </summary>
    public const int AtOnce = 24;

    /// <summary>The radius of a dot, as a multiple of the usual one, is the square root of the <c>size</c> formula's area, kept between these.</summary>
    public const double RadiusMin = 0.5;

    public const double RadiusMax = 2.5;

    /// <summary>
    /// The dot counts of the sources on one line, scaled down by one common factor when the busiest passes <see cref="AtOnce"/>, so their ratio stays true.
    /// Part 3a has one source on a line; the list is here for the several of Part 3b.
    /// </summary>
    public static (double[] Counts, bool Capped) CapCounts(IReadOnlyList<double> counts)
    {
        var most = counts.Count == 0 ? 0 : Math.Max(0, counts.Max());
        return most <= AtOnce ? (counts.ToArray(), false) : (counts.Select(c => { var v = c * AtOnce / most; return double.IsFinite(v) ? v : c / most * AtOnce; }).ToArray(), true);
    }

    /// <summary>The crossing time of a line in ms: what its expected call says, in steps from half a second to four. A line with no p50 is a middling trip.</summary>
    private static int TravelOf(double? p50) => p50 is null ? 1000 : (int)JsRound(Clamp(500 + 1000 * Math.Log10(1 + p50.Value / 10), 500, 4000));

    /// <summary>A line that carried <paramref name="rate"/> calls a second: logarithmic and capped, because a screen can't draw 1000 particles a second, unless the run's source says how many dots to show.</summary>
    private static LineTraffic LineTrafficOf(Pair l, double rate, Source? source, double? wide = null, (double Dots, bool Capped)? counted = null)
    {
        var errors = Round2(l.Errors ?? 0);
        var travelMs = TravelOf(l.P50);
        var perSecond = rate > 0 ? Round2(Clamp(1.5 + 4 * Math.Log10(1 + rate), 1.5, 14)) : 0;
        double? dots = null;
        var capped = false;
        double? radius = null;
        // How many dots: the formula's count when it has a value (a missing number or a negative result leaves today's curve for this line).
        // When several sources share the line the count arrives already scaled, with the cap's verdict.
        var count = counted is { } given ? given.Dots : DotsFor(l, rate, source);
        if (count is { } c)
        {
            var (counts, wasCapped) = counted is { } scaled ? ([c], scaled.Capped) : CapCounts([c]);
            // The count is dots on the line at once; the speed stays with p50, so dots start as often as they take to cross.
            perSecond = Round2(counts[0] / (travelMs / 1000.0));
            dots = Round2(counts[0]);
            capped = wasCapped;
        }
        if (source?.Size is { } size && Formulas.Eval(size.Formula, new FormulaVars(rate, l.Bytes, l.P50)) is { } area && area >= 0) radius = Round2(Clamp(Math.Sqrt(area), RadiusMin, RadiusMax));
        return new LineTraffic(l.From, l.To, Round2(Clamp(1.5 + 1.5 * Math.Log10(1 + (wide ?? rate)), 1.5, 6)), perSecond, travelMs, errors >= 0.01 ? Math.Max(errors, 0.05) : errors)
        {
            Color = source?.Color,
            Radius = radius,
            Capped = capped,
            Failure = l.Failure,
            Dots = dots,
        };
    }

    /// <summary>How many dots a source's <c>dot</c> formula puts on a line that carried <paramref name="rate"/> calls a second, or null when it puts none (no formula, a missing number, a negative result).</summary>
    private static double? DotsFor(Pair l, double rate, Source? source)
    {
        if (source?.Dot is not { } dot) return null;
        return Formulas.Eval(dot.Formula, new FormulaVars(rate, l.Bytes, l.P50)) is { } count && count >= 0 ? count : null;
    }

    /// <summary>
    /// The pieces the Performance key draws for a run's source, from the lines on screen now: its name and the colour of its dots; the scale in words when the
    /// formula is a plain ratio of the rate and a line follows it; whether any dot is bigger or smaller than usual; whether any line is scaled down to fit.
    /// Null when the run sets no source or no line is on screen, so the key shows only what the picture shows.
    /// </summary>
    public static SourceKey? SourceKeyOf(LoadRun run, IReadOnlyList<LineTraffic> lines)
    {
        if (run.Source is not { } source || lines.Count == 0) return null;
        var scale = lines.Any(l => l.Dots is not null) ? ScaleText(run) : null;
        return new SourceKey(run.Name, source.Color, scale, lines.Any(l => l.Radius is not null), lines.Any(l => l.Capped));
    }

    /// <summary>
    /// Everything the Performance panel draws for one view at one load, as plain numbers so a renderer needs no logic: the strain (0 green to 1 red,
    /// null when nothing was measured) and queue of each shape that was measured or holds something that was, and the traffic on each line that has
    /// a rate. Shapes and lines with nothing measured are left out: they stay neutral, never drawn as zero.
    /// </summary>
    public static Traffic TrafficFor(Model model, LoadRun run, double load, string view) => FrameAt(model, run, load, view).Traffic;

    /// <summary>The run at a load as a view draws it, interpolated and rolled up once: <see cref="TrafficFor"/> and the panel's readouts are both made from it.</summary>
    public static LoadFrame FrameAt(Model model, LoadRun run, double load, string view)
    {
        var (objects, lines) = RollUp(model, Interpolate(run, load), view);
        return new LoadFrame(objects, lines, new Traffic(BoxesOf(objects), lines.Where(l => l.Rate is not null).Select(l => LineTrafficOf(l, l.Rate!.Value, run.Source)).ToList()));
    }

    /// <summary>
    /// What each shape looks like: its strain (0 green to 1 red, null when nothing was measured) and its queue. A shape that is added past capacity (0.7 and 0.6 make 1.3) is as strained as
    /// one that is full: the colour stops at 1, and the readout says the rest.
    /// </summary>
    private static IdMap<BoxTraffic> BoxesOf(IdMap<Metrics> objects)
    {
        var boxes = new IdMap<BoxTraffic>();
        foreach (var (id, m) in objects)
        {
            var s = StrainOf(m)?.Value;
            if (s is null && m.Queue is null) continue;
            boxes.Add(id, new BoxTraffic(s is null ? null : Round2(Math.Min(1, s.Value)), (int)JsRound(m.Queue ?? 0)));
        }
        return boxes;
    }
}
