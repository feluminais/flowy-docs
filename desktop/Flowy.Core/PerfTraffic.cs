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

    /// <summary>
    /// What a line shows: the calls a second it carries (its stripes) and its data a second in units of a typical call (its blobs, see <see cref="AmountOf"/>). Either may be missing.
    /// <c>Rate</c> is the calls a second the line says, whichever is shown: it is what a source's <c>dot</c> and <c>size</c> formulas read as <c>rate</c>.
    /// </summary>
    private sealed record Shown(double? Calls, double? Blobs, double? Rate);

    /// <summary>How busy the stripes are, 0 to 1, for <paramref name="calls"/> a second: logarithmic, so a thousand a second is as busy as they get.</summary>
    private static double StripeLevel(double calls) => Round2(Clamp(Math.Log10(1 + Math.Max(0, calls)) / 3, 0, 1));

    /// <summary>How busy the stripes of a line the run gives nothing to count are: a middling pace.</summary>
    public const double BareStripes = 0.2;

    /// <summary>What a line shows under a measure, or null when the run gives it nothing to show (then it is a bare line).</summary>
    private static Shown? ShownOf(Metrics m, LoadMeasure measure, double? size)
    {
        double? calls = measure == LoadMeasure.Data ? null : m.Rate;
        double? blobs = measure == LoadMeasure.Calls ? null : AmountOf(m, LoadMeasure.Data, size);
        return calls is null && blobs is null ? null : new Shown(calls, blobs, m.Rate);
    }

    /// <summary>
    /// A line that carried what <paramref name="shown"/> says: logarithmic and capped, because a screen can't draw 1000 particles a second, unless the run's source says how many dots to show.
    /// <paramref name="wide"/> sets its thickness, the calls a second where it has them and else its blobs.
    /// </summary>
    private static LineTraffic LineTrafficOf(Pair l, Shown shown, Source? source, double? wide = null, (double Dots, bool Capped)? counted = null)
    {
        var errors = Round2(l.Errors ?? 0);
        var travelMs = TravelOf(l.P50);
        double perSecond = 0;
        double? dots = null;
        var capped = false;
        double? radius = null;
        if (shown.Blobs is { } blobs)
        {
            perSecond = blobs > 0 ? Round2(Clamp(1.5 + 4 * Math.Log10(1 + blobs), 1.5, 14)) : 0;
            // How many blobs: the formula's count when it has a value (a missing number or a negative result leaves today's curve for this line).
            // When several sources share the line the count arrives already scaled, with the cap's verdict.
            var count = counted is { } given ? given.Dots : DotsFor(l, shown.Rate, source);
            if (count is { } c)
            {
                var (counts, wasCapped) = counted is { } scaled ? ([c], scaled.Capped) : CapCounts([c]);
                // The count is blobs on the line at once; the speed stays with p50, so they start as often as they take to cross.
                perSecond = Round2(counts[0] / (travelMs / 1000.0));
                dots = Round2(counts[0]);
                capped = wasCapped;
            }
            // How big a blob is: the source's size formula says, and without one they are the usual size.
            if (source?.Size is { } size && shown.Rate is { } sizeRate && Formulas.Eval(size.Formula, new FormulaVars(sizeRate, l.Bytes, l.P50)) is { } area && area >= 0) radius = Round2(Clamp(Math.Sqrt(area), RadiusMin, RadiusMax));
        }
        return new LineTraffic(l.From, l.To, Round2(Clamp(1.5 + 1.5 * Math.Log10(1 + (wide ?? shown.Calls ?? shown.Blobs ?? 0)), 1.5, 6)), perSecond, travelMs, errors >= 0.01 ? Math.Max(errors, 0.05) : errors)
        {
            Color = source?.Color,
            Radius = radius,
            Capped = capped,
            Failure = l.Failure,
            Dots = dots,
            Stripes = shown.Calls is { } calls ? StripeLevel(calls) : null,
        };
    }

    /// <summary>How many blobs a source's <c>dot</c> formula puts on a line that said <paramref name="rate"/> calls a second, or null when it puts none (no formula, a missing number, a negative result).</summary>
    private static double? DotsFor(Pair l, double? rate, Source? source)
    {
        if (source?.Dot is not { } dot || rate is not { } r) return null;
        return Formulas.Eval(dot.Formula, new FormulaVars(r, l.Bytes, l.P50)) is { } count && count >= 0 ? count : null;
    }

    private static readonly System.Runtime.CompilerServices.ConditionalWeakTable<Model, Dictionary<string, List<(string From, string To)>>> ViewEnds = new();

    /// <summary>The ends of each line a view draws, as the model has them, kept for as long as the model is.</summary>
    private static List<(string From, string To)> EndsOfView(Model model, string view)
    {
        var byView = ViewEnds.GetOrCreateValue(model);
        lock (byView)
        {
            if (byView.TryGetValue(view, out var found)) return found;
            var seen = new HashSet<(string, string)>();
            found = [];
            foreach (var c in model.Connections)
                if (Views.PlaceEnds(model, view, c.From, c.To) is { } ends && seen.Add(ends)) found.Add(ends);
            byView[view] = found;
            return found;
        }
    }

    /// <summary>
    /// The lines of a view that the run gives nothing to show under the measure (no rate, or no size of a call where it asks for one): each is drawn with plain stripes at a middling pace, so a line with
    /// no numbers still shows that something runs on it. <paramref name="drawn"/> are the lines that have numbers; a view of a run with no numbers at all is all bare lines.
    /// </summary>
    private static List<LineTraffic> BareLines(Model model, string view, IReadOnlyList<LineTraffic> drawn)
    {
        var seen = drawn.Select(l => (l.From, l.To)).ToHashSet();
        return [.. EndsOfView(model, view).Where(e => !seen.Contains(e)).Select(e => new LineTraffic(e.From, e.To, 1.5, 0, 1000, 0) { Stripes = BareStripes, Bare = true })];
    }

    /// <summary>
    /// The pieces the Performance key draws for a run's source, from the lines on screen now: its name and the colour of its dots; the scale in words when the
    /// formula is a plain ratio of the rate and a line follows it; whether any dot is bigger or smaller than usual; whether any line is scaled down to fit.
    /// Null when the run sets no source or no line is on screen, so the key shows only what the picture shows.
    /// </summary>
    public static SourceKey? SourceKeyOf(LoadRun run, IReadOnlyList<LineTraffic> shown, LoadMeasure measure = LoadMeasure.Calls, double? size = null)
    {
        var lines = shown.Where(l => !l.Bare).ToList(); // a line with no numbers belongs to no source
        if (run.Source is not { } source || lines.Count == 0) return null;
        var scale = lines.Any(l => l.Dots is not null) ? ScaleText(run, measure, size) : null;
        return new SourceKey(run.Name, source.Color, scale, lines.Any(l => l.Radius is not null), lines.Any(l => l.Capped));
    }

    /// <summary>
    /// Everything the Performance panel draws for one view at one load, as plain numbers so a renderer needs no logic: the strain (0 green to 1 red,
    /// null when nothing was measured) and queue of each shape that was measured or holds something that was, and the traffic on each line that has
    /// a rate. Shapes and lines with nothing measured are left out: they stay neutral, never drawn as zero.
    /// </summary>
    public static Traffic TrafficFor(Model model, LoadRun run, double load, string view, LoadMeasure measure = LoadMeasure.Calls, double? size = null) => FrameAt(model, run, load, view, measure, size).Traffic;

    /// <summary>The run at a load as a view draws it, interpolated and rolled up once: <see cref="TrafficFor"/> and the panel's readouts are both made from it.</summary>
    public static LoadFrame FrameAt(Model model, LoadRun run, double load, string view, LoadMeasure measure = LoadMeasure.Calls, double? size = null)
    {
        var (objects, lines) = RollUp(model, Interpolate(run, load), view);
        List<LineTraffic> drawn = [.. lines.Select(l => (Line: l, Shown: ShownOf(l, measure, size))).Where(x => x.Shown is not null).Select(x => LineTrafficOf(x.Line, x.Shown!, run.Source))];
        return new LoadFrame(objects, lines, new Traffic(BoxesOf(objects), [.. drawn, .. BareLines(model, view, drawn)]));
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
