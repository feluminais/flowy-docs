using System.Globalization;
using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>One lane of a branch or parallel run: its label ("" for steps before the first <c>lane</c>) and the file steps in it.</summary>
public sealed record Lane(string Label, IReadOnlyList<int> Steps);

/// <summary>A stretch of neighbouring steps in one declared group: file step numbers from <c>Start</c> to <c>End</c> (inclusive). A repeat has no lanes.</summary>
public sealed record GroupRun(string Group, string Kind, int Start, int End, IReadOnlyList<Lane> Lanes);

/// <summary>What a reader sees at once: see <c>Stop</c> in src/core/structure.ts. Group, Kind, LaneLabels and Lanes are set only where they mean something.</summary>
public sealed record Stop(IReadOnlyList<int> Steps, string? Group, string? Kind, IReadOnlyList<string>? LaneLabels, IReadOnlyList<int>? Lanes, IReadOnlyList<int> Before);

/// <summary>A port of src/core/structure.ts, with the same wording and the same order. desktop/fixtures/structure.ts keeps the two equal.</summary>
public static partial class Structure
{
    public static readonly string[] Kinds = ["repeat", "branch", "parallel"];

    private static readonly string[] Options = ["kind", "text", "times", "until"];

    public const int TimesMin = 2;
    public const int TimesMax = 99;

    [GeneratedRegex(@"^[0-9]+\z")]
    private static partial Regex Digits();

    public static bool TimesOk(object? v) =>
        v is string s && Digits().IsMatch(s) && int.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out var n) && n is >= TimesMin and <= TimesMax;

    private static string StepGroup(Flow flow, int i) => flow.Steps[i].Group is { } g ? JsCompat.JsTrim(g) : "";

    private static string LaneOf(Flow flow, int i) => JsCompat.Blank(flow.Steps[i].Lane) ? "" : JsCompat.JsTrim(flow.Steps[i].Lane!);

    /// <summary>The kind of a declared group, or null when <paramref name="id"/> is blank, not declared or of no known kind.</summary>
    private static string? KindOf(Flow flow, string id) =>
        id != "" && flow.Groups is { } groups && groups.TryGetValue(id, out var g) && g is OrderedDictionary<string, object?> body
        && body.TryGetValue("kind", out var kind) && kind is string k && Kinds.Contains(k) ? k : null;

    /// <summary>Every run of a flow, in order. A step in no group, or in one that is not declared or has no known kind, is in no run. A group split by another step is two runs.</summary>
    public static List<GroupRun> Runs(Flow flow)
    {
        var runs = new List<GroupRun>();
        var n = flow.Steps.Count;
        for (var i = 0; i < n;)
        {
            var id = StepGroup(flow, i);
            var kind = KindOf(flow, id);
            if (kind is null)
            {
                i++;
                continue;
            }
            var end = i;
            while (end + 1 < n && StepGroup(flow, end + 1) == id) end++;
            var lanes = new List<(string Label, List<int> Steps)>();
            if (kind != "repeat")
            {
                for (var j = i; j <= end; j++)
                {
                    if (!JsCompat.Blank(flow.Steps[j].Lane)) lanes.Add((JsCompat.JsTrim(flow.Steps[j].Lane!), [j]));
                    else if (lanes.Count == 0) lanes.Add(("", [j]));
                    else lanes[^1].Steps.Add(j);
                }
            }
            runs.Add(new GroupRun(id, kind, i, end, lanes.Select(l => new Lane(l.Label, l.Steps)).ToList()));
            i = end + 1;
        }
        return runs;
    }

    /// <summary>The stops of a flow, in the order a player visits them. Total: a flow with problems still has stops, and every step is in exactly one.</summary>
    public static List<Stop> Stops(Flow flow)
    {
        var stops = new List<Stop>();
        List<int> Prior() => stops.Count == 0 ? [] : [.. stops[^1].Steps];
        var runs = Runs(flow);
        var r = 0;
        for (var i = 0; i < flow.Steps.Count;)
        {
            var run = r < runs.Count ? runs[r] : null;
            if (run is null || i < run.Start)
            {
                stops.Add(new Stop([i], null, null, null, null, Prior()));
                i++;
                continue;
            }
            var entry = Prior();
            var labels = run.Lanes.Select(l => l.Label).ToList();
            if (run.Kind == "repeat")
            {
                for (var j = run.Start; j <= run.End; j++) stops.Add(new Stop([j], run.Group, run.Kind, null, null, Prior()));
            }
            else if (run.Kind == "branch")
            {
                for (var k = 0; k < run.Lanes.Count; k++)
                    for (var m = 0; m < run.Lanes[k].Steps.Count; m++)
                        stops.Add(new Stop([run.Lanes[k].Steps[m]], run.Group, run.Kind, labels, [k], m == 0 ? [.. entry] : Prior()));
            }
            else
            {
                var longest = run.Lanes.Max(l => l.Steps.Count);
                for (var k = 0; k < longest; k++)
                {
                    var live = run.Lanes.Select((lane, li) => (Lane: li, Has: k < lane.Steps.Count, Step: k < lane.Steps.Count ? lane.Steps[k] : -1)).Where(x => x.Has).ToList();
                    stops.Add(new Stop(live.Select(x => x.Step).ToList(), run.Group, run.Kind, labels, live.Select(x => x.Lane).ToList(), k == 0 ? [.. entry] : Prior()));
                }
            }
            i = run.End + 1;
            r++;
        }
        return stops;
    }

    /// <summary>
    /// The stop that stop <paramref name="k"/> follows: the one its <c>Before</c> points at, which is the stop whose first step is <c>Before[0]</c>. Null for a first
    /// stop (nothing came before), and for a <paramref name="k"/> that is not a stop. A stop only ever follows an earlier one, so this is found by looking back from <paramref name="k"/>.
    /// </summary>
    public static int? StopBefore(IReadOnlyList<Stop> stops, int k)
    {
        if (k < 0 || k >= stops.Count || stops[k].Before.Count == 0) return null;
        var first = stops[k].Before[0];
        for (var i = k - 1; i >= 0; i--)
            if (stops[i].Steps.Count > 0 && stops[i].Steps[0] == first) return i;
        return null;
    }

    /// <summary>The stop that holds file step <paramref name="step"/>, or the first stop when none does (a stale step number never leaves the player nowhere).</summary>
    public static int StopIndexOf(IReadOnlyList<Stop> stops, int step)
    {
        for (var i = 0; i < stops.Count; i++)
            if (stops[i].Steps.Contains(step)) return i;
        return 0;
    }

    /// <summary>For stop <paramref name="k"/> of a branch: the file steps of the lanes it is not in, the ones a player draws faint. Nothing for a stop that is not in a branch.</summary>
    public static List<int> OtherLaneSteps(IReadOnlyList<Stop> stops, int k)
    {
        if (k < 0 || k >= stops.Count || stops[k].Kind != "branch" || stops[k].Group is null) return [];
        var s = stops[k];
        var from = k;
        var to = k;
        while (from > 0 && stops[from - 1].Group == s.Group) from--;
        while (to + 1 < stops.Count && stops[to + 1].Group == s.Group) to++;
        int? mine = s.Lanes is { Count: > 0 } own ? own[0] : null;
        return stops.Skip(from).Take(to - from + 1).Where(t => (t.Lanes is { Count: > 0 } lanes ? lanes[0] : (int?)null) != mine).SelectMany(t => t.Steps).ToList();
    }

    /// <summary>
    /// What is wrong with a flow's groups, lanes and flow links, in this order: each declared group's own problems (in JavaScript's key order),
    /// then each step's, then each declared group that no step uses (or that has too few lanes). A step's problem has its 0-based step number
    /// and is worded to follow "step N: "; the others stand alone. <paramref name="hasFlow"/> says whether a flow id exists.
    /// </summary>
    public static List<Finding> Problems(Flow flow, Func<string, bool> hasFlow)
    {
        var output = new List<Finding>();
        var groups = flow.Groups;
        List<string> ids = groups is null ? [] : JsCompat.OrderKeys(groups.Keys);
        var kinds = string.Join(", ", Kinds);

        foreach (var id in ids)
        {
            void Add(string message) => output.Add(new Finding(null, $"group \"{id}\": {message}"));
            var body = groups![id] as OrderedDictionary<string, object?> ?? [];
            body.TryGetValue("kind", out var kind);
            if (!Names.IsValidId(id)) Add($"ids {Names.IdRule}");
            if (JsCompat.Blank(kind)) Add($"kind is missing (use {kinds})");
            else if (kind is not string known || !Kinds.Contains(known)) Add($"unknown kind \"{kind}\" (use {kinds})");
            var extra = JsCompat.OrderKeys(body.Keys).FirstOrDefault(k => !Options.Contains(k));
            if (extra is not null) Add($"unknown option \"{extra}\" (use {string.Join(", ", Options)})");
            if (kind is not string name || !Kinds.Contains(name)) continue;
            body.TryGetValue("times", out var times);
            body.TryGetValue("until", out var until);
            if (name != "repeat")
            {
                if (!JsCompat.Blank(times)) Add("times only applies to repeat");
                if (!JsCompat.Blank(until)) Add("until only applies to repeat");
            }
            else
            {
                if (!JsCompat.Blank(times) && !TimesOk(times)) Add($"times must be a whole number from {TimesMin} to {TimesMax}");
                if (JsCompat.Blank(times) && JsCompat.Blank(until)) Add("a repeat needs times or until");
            }
        }

        var members = new Dictionary<string, List<int>>();
        for (var i = 0; i < flow.Steps.Count; i++)
        {
            var g = StepGroup(flow, i);
            if (g == "") continue;
            if (!members.TryGetValue(g, out var list)) members[g] = list = [];
            list.Add(i);
        }

        for (var i = 0; i < flow.Steps.Count; i++)
        {
            var index = i;
            void At(string message) => output.Add(new Finding(index, message));
            var gid = StepGroup(flow, i);
            var declared = gid != "" && groups is not null && groups.ContainsKey(gid);
            var kind = declared ? KindOf(flow, gid) : null;
            var lane = LaneOf(flow, i);
            if (gid != "" && !declared) At($"group \"{gid}\" is not declared under groups");
            if (lane != "" && gid == "") At("lane needs a group");
            if (declared && kind == "repeat" && lane != "") At("lane only applies to branch and parallel");
            if (declared && kind is "branch" or "parallel")
            {
                var mine = members.GetValueOrDefault(gid) ?? [];
                if (mine[0] == i && lane == "") At($"the first step of group \"{gid}\" needs a lane");
                if (lane != "" && mine.Any(j => j < index && LaneOf(flow, j) == lane)) At($"lane \"{lane}\" is already used in group \"{gid}\"");
            }
            foreach (var id in ids)
            {
                var m = members.GetValueOrDefault(id) ?? [];
                if (m.Count >= 2 && i > m[0] && i < m[^1] && gid != id) At($"sits inside the stretch of group \"{id}\" without belonging to it");
            }
            if (!JsCompat.Blank(flow.Steps[i].FlowId))
            {
                var to = JsCompat.JsTrim(flow.Steps[i].FlowId!);
                if (!hasFlow(to)) At($"unknown flow \"{to}\"");
            }
        }

        foreach (var id in ids)
        {
            var m = members.GetValueOrDefault(id) ?? [];
            if (m.Count == 0) output.Add(new Finding(null, $"group \"{id}\": no step belongs to it"));
            else if (KindOf(flow, id) == "parallel" && m.Count(j => LaneOf(flow, j) != "") < 2) output.Add(new Finding(null, $"group \"{id}\": a parallel group needs at least two lanes"));
        }
        return output;
    }
}
