using System.Globalization;

namespace Flowy.Core;

/// <summary>
/// What the Failures tab works out before it draws: which analysis shows, the rows of its list, the cells of a rating, the words for a status, and where along
/// a run a failure first shows. A port of ui/src/failuresview.ts, held equal by desktop/fixtures/failures.ts. Pure, so the panel only draws.
/// </summary>
public static class FailuresView
{
    /// <summary>What a reader sees for each status a file can hold.</summary>
    public static readonly IReadOnlyDictionary<string, string> StatusNames = new Dictionary<string, string>
    {
        ["open"] = "Open", ["planned"] = "Planned", ["done"] = "Done", ["accepted"] = "Accepted",
    };

    /// <summary>The analysis on show: the one asked for if it is there, else the first, else none.</summary>
    public static string? ActiveAnalysis(IdMap<FailureAnalysis> analyses, string id) => analyses.Contains(id) ? id : analyses.Keys.FirstOrDefault();

    /// <summary>The mode an address or a click names, or none.</summary>
    public static FailureMode? ModeIn(Model model, string? analysis, string? mode) =>
        analysis is not null && mode is not null && model.Failures.TryGetValue(analysis, out var a) && a.Modes.TryGetValue(mode, out var m) ? m : null;

    /// <summary>How many modes the folder holds, all analyses together: the count on the rail.</summary>
    public static int ModeCount(Model model) => model.Failures.Sum(kv => kv.Value.Modes.Count);

    /// <summary>
    /// The rows of the list, worst first: those the view holds, then the others. With a <paramref name="part"/> (a shape or line picked on the canvas) only what
    /// that part carries in this view, all under Here. A band keeps only that band.
    /// </summary>
    public static (List<RankedMode> Here, List<RankedMode> Elsewhere) RowsFor(Model model, FailureAnalysis a, string view, RiskBand? band = null, FailurePart? part = null)
    {
        var ranked = Failures.Rank(a).Where(r => band is null || r.Band == band).ToList();
        if (part is not null)
        {
            var ids = Failures.Carried(model, a, view, part).ToHashSet();
            return (ranked.Where(r => ids.Contains(r.Id)).ToList(), []);
        }
        return (ranked.Where(r => Failures.InView(model, view, r.Mode)).ToList(), ranked.Where(r => !Failures.InView(model, view, r.Mode)).ToList());
    }

    /// <summary>How many modes each band holds.</summary>
    public static Dictionary<RiskBand, int> BandCounts(FailureAnalysis a)
    {
        var counts = new Dictionary<RiskBand, int> { [RiskBand.High] = 0, [RiskBand.Medium] = 0, [RiskBand.Low] = 0, [RiskBand.Unrated] = 0 };
        foreach (var (_, m) in a.Modes) counts[Failures.BandOf(m)]++;
        return counts;
    }

    /// <summary>Ten cells, the first <paramref name="rating"/> of them filled.</summary>
    public static bool[] RatingCells(int? rating) => Enumerable.Range(0, 10).Select(i => rating is { } r && i < r).ToArray();

    /// <summary>"150 to 30": the risk now and once the next action is done. Null without an <c>after</c>, or when either risk can't be worked out.</summary>
    public static string? AfterText(FailureMode m)
    {
        if (m.After is null) return null;
        if (Failures.Risk(Failures.RatingsOf(m)) is not { } before || Failures.Risk(Failures.RatingsAfter(m)) is not { } after) return null;
        return $"{before.ToString(CultureInfo.InvariantCulture)} to {after.ToString(CultureInfo.InvariantCulture)}";
    }

    /// <summary>
    /// The step a mode names, as Show it reads it: the browser takes <c>Number(step)</c>, so " 5", "+5", "5.0" and "1e1" are steps too (the checker flags
    /// them, but the button still goes to the step they say). Null when it is not a number, and a fraction is cut off.
    /// </summary>
    public static int? StepOf(string? step) =>
        step is not null && double.TryParse(JsCompat.JsTrim(step), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) && Math.Abs(n) < int.MaxValue ? (int)Math.Truncate(n) : null;

    /// <summary>The changes that put a shape's mode on a line that starts at that shape (the first it has), or none when no line does: a line mode needs one that exists.</summary>
    public static ModeChanges? ToLine(Model model, FailureMode m)
    {
        var on = !string.IsNullOrEmpty(m.On) && model.GetObject(m.On) is not null ? m.On : null;
        var to = on is null ? null : model.Connections.FirstOrDefault(c => c.From == on && c.To is not null && model.GetObject(c.To) is not null)?.To;
        return on is null || to is null ? null : new ModeChanges().Text("on", "").Text("from", on).Text("to", to);
    }

    /// <summary>The changes that put a line's mode on the shape it starts at.</summary>
    public static ModeChanges ToShape(FailureMode m) => new ModeChanges().Text("on", m.From ?? "").Text("from", "").Text("to", "");

    /// <summary>What a reader calls the shape or line picked on the canvas: as <see cref="Failures.PartName"/> names a mode's part.</summary>
    public static string PartText(Model model, FailurePart part) => part switch
    {
        FailurePart.Box b => Failures.ShapeName(model, b.Id),
        FailurePart.Line l => $"{Views.NameOf(model, l.From)} to {Views.NameOf(model, l.To)}",
        _ => "",
    };

    /// <summary>The id after or before <paramref name="current"/> in a list, staying at the ends; the first when nothing is current.</summary>
    public static string? Neighbour(IReadOnlyList<string> ids, string? current, int delta)
    {
        if (ids.Count == 0) return null;
        var at = current is null ? -1 : ids.ToList().IndexOf(current);
        return at == -1 ? ids[0] : ids[Math.Max(0, Math.Min(ids.Count - 1, at + delta))];
    }

    /// <summary>
    /// The first tested level of a run, from 0, where the mode's part has errors above 0, measured in the view that draws it. Null when it never does, or was
    /// never measured.
    /// </summary>
    public static int? FirstErrorAt(Model model, LoadRun run, FailureMode m)
    {
        if (run.Adds is not null || run.Sources is not null) return null; // a run with several sources has no one level to go to
        var view = Failures.HomeView(model, m);
        IReadOnlyList<double?> series = [];
        if (m.On is { Length: > 0 } on)
        {
            if (Views.PlaceStep(model, view, on, null)?.From is { } box) series = PerfView.BoxSeries(model, run, view, box, "errors");
        }
        else if (m.From is not null && m.To is not null)
        {
            if (Views.PlaceEnds(model, view, m.From, m.To) is { } ends) series = PerfView.LineSeries(model, run, view, ends.From, ends.To, "errors");
        }
        for (var i = 0; i < series.Count; i++) if (series[i] is > 0) return i;
        return null;
    }
}
