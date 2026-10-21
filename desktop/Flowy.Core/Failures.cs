using System.Globalization;
using System.Text;

namespace Flowy.Core;

/// <summary>How a failure mode ranks, worst first. The names a reader sees are in <see cref="Failures.BandName"/>.</summary>
public enum RiskBand { High, Medium, Low, Unrated }

/// <summary>A mode's three ratings as numbers. One that is missing, or not a whole number from 1 to 10, is null.</summary>
public readonly record struct Rated(int? Severity, int? Occurrence, int? Detection);

/// <summary>A mode with its place in the ranking: its id, the risk number (null when a rating is missing) and its band.</summary>
public sealed record RankedMode(string Id, FailureMode Mode, int? Risk, RiskBand Band);

/// <summary>What a shape or a line wears on the canvas: the worst band of the modes it carries, and how many.</summary>
public sealed record FailureMark(RiskBand Band, int Count);

/// <summary>The marks of one view: by box id, and by line key (<see cref="Failures.LineKey"/>), in the order they were first met.</summary>
public sealed record FailureMarks(OrderedDictionary<string, FailureMark> Boxes, OrderedDictionary<string, FailureMark> Lines);

/// <summary>A shape or a line as the canvas draws it in one view.</summary>
public abstract record FailurePart
{
    public sealed record Box(string Id) : FailurePart;

    public sealed record Line(string From, string To) : FailurePart;
}

/// <summary>What to light for a mode: the drawn boxes of its part (and the line's key), and the drawn boxes of what it hurts that are not already failing.</summary>
public sealed record Reach(IReadOnlyList<string> Fails, string? FailsLine, IReadOnlyList<string> Affects);

/// <summary>
/// Failure analyses: a port of src/core/failures.ts with the same words and the same numbers, held equal by desktop/fixtures/failures.ts.
/// An analysis is a file of failure modes: for a part (a shape or a line), how it fails, what that does, three ratings, and what is done about it.
/// </summary>
public static class Failures
{
    public static readonly string[] Statuses = ["open", "planned", "done", "accepted"];

    /// <summary>The keys a file keeps the ratings under. Detection runs the standard way: 10 means nobody would notice.</summary>
    public static readonly string[] RatingKeys = ["severity", "occurrence", "detection"];

    /// <summary>The names a reader sees for the bands.</summary>
    public static string BandName(RiskBand band) => band switch { RiskBand.High => "High", RiskBand.Medium => "Medium", RiskBand.Low => "Low", _ => "Not rated" };

    /// <summary>The key the TypeScript and the fixtures call a band by.</summary>
    public static string BandKey(RiskBand band) => band switch { RiskBand.High => "high", RiskBand.Medium => "medium", RiskBand.Low => "low", _ => "unrated" };

    /// <summary>Text with something in it. A blank value in a file is as good as none, by what JavaScript's <c>trim()</c> calls blank, as the TypeScript does.</summary>
    public static bool Has(string? v) => !JsCompat.Blank(v);

    /// <summary>A rating written in a file: exactly the text 1 to 10. Anything else (5.5, 07, 0, 11, 1e1, a space) is not a rating.</summary>
    public static int? RatingOf(string? text) =>
        text is "10" ? 10 : text is { Length: 1 } && text[0] is >= '1' and <= '9' ? text[0] - '0' : null;

    /// <summary>The mode's current ratings.</summary>
    public static Rated RatingsOf(FailureMode m) => new(RatingOf(m.Severity), RatingOf(m.Occurrence), RatingOf(m.Detection));

    /// <summary>The ratings once the next action is done: each from <c>after</c> when it holds a rating, else the current one.</summary>
    public static Rated RatingsAfter(FailureMode m) =>
        new(RatingOf(m.After?.Severity) ?? RatingOf(m.Severity), RatingOf(m.After?.Occurrence) ?? RatingOf(m.Occurrence), RatingOf(m.After?.Detection) ?? RatingOf(m.Detection));

    /// <summary>Severity times occurrence times detection, 1 to 1000, or null when a rating is missing.</summary>
    public static int? Risk(Rated r) => r.Severity is { } s && r.Occurrence is { } o && r.Detection is { } d ? s * o * d : null;

    /// <summary>The ratings that count: the after ratings once the mode is done, the current ones otherwise.</summary>
    private static Rated Effective(FailureMode m) => m.Status == "done" ? RatingsAfter(m) : RatingsOf(m);

    /// <summary>The risk of the ratings that count, or null when one is missing.</summary>
    public static int? RiskOf(FailureMode m) => Risk(Effective(m));

    /// <summary>
    /// High when severity is 9 or 10, even with the other ratings missing. Otherwise Not rated when a rating is missing, then High from a risk of 150,
    /// Medium from 60, Low below.
    /// </summary>
    public static RiskBand BandOf(FailureMode m)
    {
        var r = Effective(m);
        if (r.Severity is >= 9) return RiskBand.High;
        if (Risk(r) is not { } n) return RiskBand.Unrated;
        return n >= 150 ? RiskBand.High : n >= 60 ? RiskBand.Medium : RiskBand.Low;
    }

    /// <summary>
    /// The modes worst first: by band, then by risk, highest first. Inside a band a mode with a risk number comes before one without, and those go by
    /// severity. Ties keep the order of the file, so the list holds still while it is edited.
    /// </summary>
    public static List<RankedMode> Rank(FailureAnalysis a) =>
        a.Modes.Select(kv => new RankedMode(kv.Key, kv.Value, Risk(Effective(kv.Value)), BandOf(kv.Value)))
            .OrderBy(r => (int)r.Band)
            .ThenBy(r => r.Risk is null ? 1 : 0)
            .ThenByDescending(r => r.Risk ?? 0)
            .ThenByDescending(r => Effective(r.Mode).Severity ?? 0)
            .ToList();

    /// <summary>
    /// Which shapes the analysis covers: those with nothing inside, inside <c>scope</c> ("root" when it has none), and not actors. One is analysed when a mode
    /// names it, as <c>on</c> or as an end of a line. A scope that is not a view counts nothing.
    /// </summary>
    public static (List<string> Analysed, List<string> Left) Coverage(Model model, FailureAnalysis a)
    {
        var scope = Has(a.Scope) ? a.Scope! : Names.Root;
        if (!Views.IsView(model, scope)) return ([], []);
        var named = new HashSet<string>();
        foreach (var m in a.Modes.Select(kv => kv.Value))
            foreach (var id in new[] { m.On, m.From, m.To })
                if (id is not null) named.Add(id);
        var children = Views.ChildCounts(model);
        var shapes = model.Objects.Keys.Where(id =>
            model.GetObject(id) is { } o && o.Type != "actor" && !children.ContainsKey(id) && (scope == Names.Root || Views.Chain(model, id).Contains(scope))).ToList();
        return (shapes.Where(named.Contains).ToList(), shapes.Where(id => !named.Contains(id)).ToList());
    }

    /// <summary>What a reader calls a shape: the names from the outermost box down ("Shop > API > Auth").</summary>
    public static string ShapeName(Model model, string id) =>
        string.Join(" > ", Enumerable.Reverse(Views.Chain(model, id).Where(x => x != Names.Root)).Select(x => Views.NameOf(model, x)));

    /// <summary>What a reader calls the part: a shape by the names from the outermost box down, a line by its two ends ("Orders to Mail service").</summary>
    public static string PartName(Model model, FailureMode m)
    {
        if (m.On is { Length: > 0 } on) return ShapeName(model, on);
        if (m.From is not null && m.To is not null) return $"{Views.NameOf(model, m.From)} to {Views.NameOf(model, m.To)}";
        return "";
    }

    private static readonly string[] Columns = ["Risk band", "Part", "Mode", "Effect", "Cause", "Severity", "Likelihood", "Hard to spot", "Risk", "Controls", "Next action", "Owner", "Status"];
    private static readonly string[] AfterColumns = ["Severity after", "Likelihood after", "Hard to spot after"];

    /// <summary>A cell for a spreadsheet that opens a CSV: one that starts with = + - @ or a tab or return would run as a formula, so it gets a leading quote mark.</summary>
    private static string Guarded(string cell) => cell.Length > 0 && "=+-@\t\r".Contains(cell[0]) ? "'" + cell : cell;

    private static string CsvCell(string cell)
    {
        var safe = Guarded(cell);
        return safe.IndexOfAny(['"', ',', '\r', '\n']) >= 0 ? "\"" + safe.Replace("\"", "\"\"") + "\"" : safe;
    }

    private static string MarkdownCell(string cell) => cell.Replace("|", "\\|").Replace("\r\n", "<br>").Replace("\r", "<br>").Replace("\n", "<br>");

    /// <summary>
    /// The modes as a table, worst first, with the words the screen uses. The After columns appear only when some mode has an <c>after</c>. A Markdown cell
    /// escapes | and line breaks; a CSV cell is quoted when it needs it and guarded against running as a formula.
    /// </summary>
    public static string Table(Model model, FailureAnalysis a, string format)
    {
        var ranked = Rank(a);
        var withAfter = ranked.Any(r => r.Mode.After is not null);
        string[] head = withAfter ? [.. Columns, .. AfterColumns] : Columns;
        var rows = ranked.Select(r =>
        {
            var m = r.Mode;
            var cells = new List<string>
            {
                BandName(r.Band), PartName(model, m), m.Mode ?? "", m.Effect ?? "", m.Cause ?? "", m.Severity ?? "", m.Occurrence ?? "", m.Detection ?? "",
                r.Risk is { } n ? n.ToString(CultureInfo.InvariantCulture) : "", m.Controls ?? "", m.Action ?? "", m.Owner ?? "",
                Has(m.Status) ? m.Status! : "open",
            };
            if (withAfter) cells.AddRange([m.After?.Severity ?? "", m.After?.Occurrence ?? "", m.After?.Detection ?? ""]);
            return cells;
        }).ToList();
        if (format == "csv") return string.Join("\n", new[] { head.ToList() }.Concat(rows).Select(cells => string.Join(",", cells.Select(CsvCell))));
        string Line(IEnumerable<string> cells) => $"| {string.Join(" | ", cells.Select(MarkdownCell))} |";
        return string.Join("\n", new[] { Line(head), Line(head.Select(_ => "---")) }.Concat(rows.Select(Line)));
    }

    /// <summary>"Analysed 3 of 4", and when some are left a second line naming them by their path.</summary>
    public static string CoverageText(Model model, FailureAnalysis a)
    {
        var (analysed, left) = Coverage(model, a);
        var first = $"Analysed {analysed.Count} of {analysed.Count + left.Count}";
        return left.Count == 0 ? first : $"{first}\nNot analysed: {string.Join(", ", left.Select(id => ShapeName(model, id)))}";
    }

    /// <summary>One analysis for a reader: in Markdown a heading, the coverage and the table; in CSV the table alone, since anything else would break the file.</summary>
    public static string AnalysisText(Model model, string id, FailureAnalysis a, string format) =>
        format == "csv" ? Table(model, a, "csv") : $"## {(JsCompat.JsTrim(a.Name) == "" ? id : $"{a.Name} ({id})")}\n\n{CoverageText(model, a)}\n\n{Table(model, a, "markdown")}";

    /// <summary>The text a drawn line is known by: the same as <c>lineId</c> in ui/src/graph.ts.</summary>
    public static string LineKey(string from, string to) => $"{from} {to}";

    /// <summary>The box in <paramref name="view"/> that stands for a shape: itself, or the box it is inside. Null when the view does not draw it (and for the view's own frame).</summary>
    private static string? Drawn(Model model, string view, string id) => Views.PlaceStep(model, view, id, null)?.From;

    /// <summary>
    /// The view that draws a mode's part: a shape's parent; for a line, the lowest view up from its start in which both ends are drawn (one may stand beside
    /// the view as an outsider). The overview when nothing resolves.
    /// </summary>
    public static string HomeView(Model model, FailureMode m)
    {
        if (Has(m.On)) return model.GetObject(m.On) is not null ? Views.ParentOf(model, m.On!) : Names.Root;
        if (Has(m.From) && Has(m.To) && model.GetObject(m.From) is not null)
            foreach (var view in Views.Chain(model, m.From!))
                if (Views.PlaceEnds(model, view, m.From, m.To) is not null) return view;
        return Names.Root;
    }

    /// <summary>
    /// Whether a view is where a mode belongs: its shape is the view or inside it at any depth, or for a line one of its ends is. Every mode is in the overview.
    /// </summary>
    public static bool InView(Model model, string view, FailureMode m)
    {
        if (view == Names.Root) return true;
        bool Inside(string? id) => id is not null && model.GetObject(id) is not null && Views.Chain(model, id).Contains(view);
        return Has(m.On) ? Inside(m.On) : Inside(m.From) || Inside(m.To);
    }

    /// <summary>What carries a mode in a view: a box, or a drawn line (by its key). A line whose two ends sit in one drawn box is carried by that box.</summary>
    private static (string? Box, string? Line)? CarrierOf(Model model, string view, FailureMode m)
    {
        if (Has(m.On)) return Drawn(model, view, m.On!) is { } box ? (box, null) : null;
        if (Has(m.From) && Has(m.To))
        {
            if (Views.PlaceEnds(model, view, m.From, m.To) is { } ends) return (null, LineKey(ends.From, ends.To));
            var a = Drawn(model, view, m.From!);
            if (a is not null && a == Drawn(model, view, m.To!)) return (a, null);
        }
        return null;
    }

    private static string CarrierKey((string? Box, string? Line) c) => c.Box is not null ? $"box {c.Box}" : $"line {c.Line}";

    private static void Put(OrderedDictionary<string, FailureMark> table, string key, RiskBand band)
    {
        if (table.TryGetValue(key, out var old)) table[key] = new FailureMark(old.Band <= band ? old.Band : band, old.Count + 1);
        else table.Add(key, new FailureMark(band, 1));
    }

    /// <summary>The marks for one view, so the overview shows the red system and the reader zooms in to find it. A mode the view cannot draw marks nothing.</summary>
    public static FailureMarks RollUp(Model model, FailureAnalysis a, string view)
    {
        var marks = new FailureMarks([], []);
        foreach (var (_, m) in a.Modes)
        {
            if (CarrierOf(model, view, m) is not { } carrier) continue;
            if (carrier.Box is { } box) Put(marks.Boxes, box, BandOf(m));
            else Put(marks.Lines, carrier.Line!, BandOf(m));
        }
        return marks;
    }

    /// <summary>Whether a view draws a mode anywhere: as a box, as a line, or as the box that holds both ends of its line. Not the frame the reader is inside.</summary>
    public static bool DrawnIn(Model model, string view, FailureMode m) => CarrierOf(model, view, m) is not null;

    /// <summary>The ids of the modes a drawn shape or line carries in a view, worst first.</summary>
    public static List<string> Carried(Model model, FailureAnalysis a, string view, FailurePart part)
    {
        var wanted = CarrierKey(part is FailurePart.Box b ? (b.Id, null) : (null, LineKey(((FailurePart.Line)part).From, ((FailurePart.Line)part).To)));
        return Rank(a).Where(r => CarrierOf(model, view, r.Mode) is { } c && CarrierKey(c) == wanted).Select(r => r.Id).ToList();
    }

    /// <summary>What to light for a selected mode in a view: the drawn boxes (and line) of its part, and the drawn boxes of the shapes it hurts that are not already failing.</summary>
    public static Reach ReachOf(Model model, string view, FailureMode m)
    {
        List<string> fails = [];
        string? failsLine = null;
        if (Has(m.On))
        {
            if (Drawn(model, view, m.On!) is { } box) fails.Add(box);
        }
        else if (Has(m.From) && Has(m.To))
        {
            if (Views.PlaceEnds(model, view, m.From, m.To) is { } ends)
            {
                fails.AddRange(new[] { ends.From, ends.To }.Distinct());
                failsLine = LineKey(ends.From, ends.To);
            }
            else if (Drawn(model, view, m.From!) is { } a && a == Drawn(model, view, m.To!)) fails.Add(a);
        }
        var affects = (m.Affects ?? []).Select(id => Drawn(model, view, id)).OfType<string>().Distinct().Where(box => !fails.Contains(box)).ToList();
        return new Reach(fails, failsLine, affects);
    }

    /// <summary>What to light for a picked mode: <see cref="ReachOf"/>, but only when the view draws a part of it that fails. Otherwise lighting would fade everything and outline nothing.</summary>
    public static Reach? LightFor(Model model, string view, FailureMode m)
    {
        var r = ReachOf(model, view, m);
        return r.Fails.Count > 0 || r.FailsLine is not null ? r : null;
    }

    /// <summary>
    /// What is wrong with one analysis, given the model it points into: a part that isn't there, a rating that isn't one, a flow or step that doesn't exist.
    /// A mode's problems start with its id. Whether a run exists needs the runs: see <see cref="RunLinkProblems"/>.
    /// </summary>
    public static List<Problem> AnalysisProblems(Model model, string aid, FailureAnalysis a)
    {
        var file = FolderLayout.FailureFile(aid);
        var problems = new List<Problem>();
        void Add(string message) => problems.Add(new Problem(file, null, message));
        if (!Names.IsValidId(aid)) Add($"\"{aid}\" is not a valid analysis id: the file name must {Names.IdRule}");
        if (!Has(a.Name)) Add("name is missing");
        if (Has(a.Scope) && !Views.IsView(model, a.Scope)) Add($"scope \"{a.Scope}\" must be \"root\" or an object with children");
        foreach (var (mid, m) in a.Modes)
        {
            void P(string message) => Add($"{mid}: {message}");
            if (!Names.IsValidId(mid)) P($"the id must {Names.IdRule}");
            if (!Has(m.Mode)) P("\"mode\" is missing");

            var line = Has(m.From) || Has(m.To);
            if (Has(m.On) && line) P("has \"on\" and also \"from\" or \"to\"; use one or the other");
            else if (Has(m.On))
            {
                if (model.GetObject(m.On) is null) P($"unknown object \"{m.On}\"");
            }
            else if (line)
            {
                if (!Has(m.From) || !Has(m.To)) P("\"from\" and \"to\" go together");
                else
                {
                    var unknown = new[] { m.From!, m.To! }.Distinct().Where(end => model.GetObject(end) is null).ToList();
                    foreach (var end in unknown) P($"unknown object \"{end}\"");
                    if (unknown.Count == 0 && !model.Connections.Any(c => c.From == m.From && c.To == m.To)) P($"{m.From} → {m.To} is not a connection in the model");
                }
            }
            else P("needs \"on\" (a shape) or \"from\" and \"to\" (a line)");

            foreach (var id in m.Affects ?? []) if (model.GetObject(id) is null) P($"affects: unknown object \"{id}\"");

            string?[] ratings = [m.Severity, m.Occurrence, m.Detection];
            for (var i = 0; i < RatingKeys.Length; i++) if (Has(ratings[i]) && RatingOf(ratings[i]) is null) P($"{RatingKeys[i]} must be a whole number from 1 to 10");
            string?[] after = [m.After?.Severity, m.After?.Occurrence, m.After?.Detection];
            for (var i = 0; i < RatingKeys.Length; i++) if (Has(after[i]) && RatingOf(after[i]) is null) P($"after {RatingKeys[i]} must be a whole number from 1 to 10");

            if (Has(m.Status) && !Statuses.Contains(m.Status)) P($"status \"{m.Status}\" must be open, planned, done or accepted");

            var flow = Has(m.Flow) ? m.Flow : null;
            var known = flow is not null && model.Flows.Contains(flow);
            if (flow is not null && !known) P($"flow \"{flow}\" doesn't exist");
            if (Has(m.Step))
            {
                if (flow is null) P("step needs a flow");
                else if (!IsWholeFrom1(m.Step!)) P("step must be a whole number from 1");
                else if (known && double.Parse(m.Step!, CultureInfo.InvariantCulture) > model.Flows[flow].Steps.Count)
                {
                    var count = model.Flows[flow].Steps.Count;
                    P($"step {m.Step} is outside flow \"{flow}\", which has {(count == 1 ? "1 step" : $"{count} steps")}");
                }
            }
        }
        return problems;
    }

    /// <summary>/^[1-9]\d*$/ with ASCII digits only.</summary>
    private static bool IsWholeFrom1(string s) => s.Length > 0 && s[0] is >= '1' and <= '9' && s.All(c => c is >= '0' and <= '9');

    /// <summary>The analyses that name a shape: as a mode's part or the end of its line, in its <c>affects</c>, or as the scope.</summary>
    public static List<string> UsersOfObject(Model model, string id) =>
        model.Failures.Where(kv => kv.Value.Scope == id || kv.Value.Modes.Any(mm => mm.Value.On == id || mm.Value.From == id || mm.Value.To == id || (mm.Value.Affects ?? []).Contains(id)))
            .Select(kv => kv.Key).ToList();

    /// <summary>The analyses with a line mode on from → to.</summary>
    public static List<string> UsersOfConnection(Model model, string from, string to) =>
        model.Failures.Where(kv => kv.Value.Modes.Any(mm => mm.Value.From == from && mm.Value.To == to)).Select(kv => kv.Key).ToList();

    /// <summary>How a refusal names the analyses in the way: "failure analysis ordering", "failure analyses a, b".</summary>
    public static string AnalysesText(IReadOnlyList<string> ids) => $"{(ids.Count == 1 ? "failure analysis" : "failure analyses")} {string.Join(", ", ids)}";

    /// <summary>The modes of an analysis whose <c>run</c> names a run that isn't in perf/. Kept apart because the model doesn't hold runs: the folder loader calls this.</summary>
    public static List<Problem> RunLinkProblems(string aid, FailureAnalysis a, IdMap<LoadRun> runs) =>
        a.Modes.Where(kv => Has(kv.Value.Run) && !runs.Contains(kv.Value.Run!))
            .Select(kv => new Problem(FolderLayout.FailureFile(aid), null, $"{kv.Key}: run \"{kv.Value.Run}\" doesn't exist")).ToList();
}
