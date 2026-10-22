using System.Text.Json;

namespace Flowy.Core;

/// <summary>What one step, shape or line shows when two flows are compared (see <see cref="FlowDiffs"/>).</summary>
public enum Change { New, Removed, Changed }

/// <summary>The marks on one flow of a comparison: steps by file step number from 0, shapes by object id, lines by <see cref="Failures.LineKey"/>.</summary>
public sealed record SideMarks(IReadOnlyDictionary<int, Change> Steps, IReadOnlyDictionary<string, Change> Shapes, IReadOnlyDictionary<string, Change> Lines);

/// <summary>What changed between an older flow and a newer one. <c>Related</c> is whether they share a shape; when they share none every record is empty.</summary>
public sealed record FlowDiff(bool Related, SideMarks Older, SideMarks Newer);

/// <summary>
/// What changed between two flows: an older one and a newer one. A port of src/core/flowdiff.ts, which says every choice in its header; this follows it word for word
/// and desktop/fixtures/compare.ts keeps the two equal. In short: steps are matched in order by their <c>from</c>, <c>to</c> and <c>text</c> with a longest common
/// subsequence (a tie skips the older step); a matched pair is changed when its animation or description differ, compared in a canonical form (a bare text animation is
/// <c>{kind: text}</c>, keys sorted at every level); leftover steps with the same ends pair up as changed, the rest are removed or new; a shape or line only one flow uses
/// is removed or new, and one both use is changed when a step on it is marked.
/// </summary>
public static class FlowDiffs
{
    public static FlowDiff Diff(Flow older, Flow newer)
    {
        var use = (Older: Usage(older.Steps), Newer: Usage(newer.Steps));
        var related = use.Older.Shapes.Keys.Any(use.Newer.Shapes.ContainsKey);
        var result = (Older: new Marks(), Newer: new Marks());
        if (!related) return new FlowDiff(false, result.Older.Done(), result.Newer.Done());

        var matchedOlder = new HashSet<int>();
        var matchedNewer = new HashSet<int>();
        foreach (var (i, j) in MatchSteps(older.Steps, newer.Steps))
        {
            matchedOlder.Add(i);
            matchedNewer.Add(j);
            var o = older.Steps[i];
            var n = newer.Steps[j];
            if (AnimationText(o.Animation) != AnimationText(n.Animation) || Canon(o.Description) != Canon(n.Description))
            {
                result.Older.Steps[i] = Change.Changed;
                result.Newer.Steps[j] = Change.Changed;
            }
        }

        var leftNewer = Enumerable.Range(0, newer.Steps.Count).Where(j => !matchedNewer.Contains(j)).ToList();
        var paired = new HashSet<int>();
        for (var i = 0; i < older.Steps.Count; i++)
        {
            if (matchedOlder.Contains(i)) continue;
            var at = leftNewer.FirstOrDefault(j => !paired.Contains(j) && EndsOf(newer.Steps[j]) == EndsOf(older.Steps[i]), -1);
            if (at < 0)
            {
                result.Older.Steps[i] = Change.Removed;
                continue;
            }
            paired.Add(at);
            result.Older.Steps[i] = Change.Changed;
            result.Newer.Steps[at] = Change.Changed;
        }
        foreach (var j in leftNewer) if (!paired.Contains(j)) result.Newer.Steps[j] = Change.New;

        bool Marked(Marks side, List<int> steps) => steps.Any(side.Steps.ContainsKey);
        void Mark(Dictionary<string, List<int>> o, Dictionary<string, List<int>> n, Dictionary<string, Change> older_, Dictionary<string, Change> newer_)
        {
            foreach (var (id, steps) in o)
            {
                if (!n.TryGetValue(id, out var other)) older_[id] = Change.Removed;
                else if (Marked(result.Older, steps) || Marked(result.Newer, other))
                {
                    older_[id] = Change.Changed;
                    newer_[id] = Change.Changed;
                }
            }
            foreach (var id in n.Keys) if (!o.ContainsKey(id)) newer_[id] = Change.New;
        }
        Mark(use.Older.Shapes, use.Newer.Shapes, result.Older.Shapes, result.Newer.Shapes);
        Mark(use.Older.Lines, use.Newer.Lines, result.Older.Lines, result.Newer.Lines);
        return new FlowDiff(true, result.Older.Done(), result.Newer.Done());
    }

    private sealed class Marks
    {
        public Dictionary<int, Change> Steps { get; } = new();
        public Dictionary<string, Change> Shapes { get; } = new();
        public Dictionary<string, Change> Lines { get; } = new();

        public SideMarks Done() => new(Steps, Shapes, Lines);
    }

    // The words of a step as JavaScript would join them: an absent value reads "undefined", an absent `to` reads empty.
    private static string KeyOf(Step s) => $"{s.From ?? "undefined"}\0{s.To ?? ""}\0{s.Text ?? "undefined"}";

    private static string EndsOf(Step s) => $"{s.From ?? "undefined"}\0{s.To ?? ""}";

    /// <summary>The value as JSON text with the keys of every mapping sorted, so equal values give equal text.</summary>
    private static string Canon(object? v) => v switch
    {
        null => "undefined",
        string s => JsonSerializer.Serialize(s),
        IReadOnlyDictionary<string, object?> map => "{" + string.Join(",", map.Keys.OrderBy(k => k, StringComparer.Ordinal).Select(k => $"{JsonSerializer.Serialize(k)}:{Canon(map[k])}")) + "}",
        System.Collections.IEnumerable list => "[" + string.Join(",", list.Cast<object?>().Select(Canon)) + "]",
        _ => JsonSerializer.Serialize(v.ToString()),
    };

    /// <summary>A missing animation, or an empty text, equals nothing; a bare text counts as a mapping with that text as its <c>kind</c>.</summary>
    private static string AnimationText(object? v) => Canon(v is "" ? null : v is string s ? new Dictionary<string, object?> { ["kind"] = s } : v);

    /// <summary>Pairs of step indexes (older, newer) that the longest common subsequence matches, in order. A tie skips the older step.</summary>
    private static List<(int, int)> MatchSteps(IReadOnlyList<Step> older, IReadOnlyList<Step> newer)
    {
        var a = older.Select(KeyOf).ToArray();
        var b = newer.Select(KeyOf).ToArray();
        var w = b.Length + 1;
        var best = new uint[(a.Length + 1) * w]; // best[i * w + j] is the longest common subsequence of a[i..] and b[j..]
        for (var i = a.Length - 1; i >= 0; i--)
            for (var j = b.Length - 1; j >= 0; j--)
                best[i * w + j] = a[i] == b[j] ? best[(i + 1) * w + j + 1] + 1 : Math.Max(best[(i + 1) * w + j], best[i * w + j + 1]);
        var pairs = new List<(int, int)>();
        int x = 0, y = 0;
        while (x < a.Length && y < b.Length)
        {
            if (a[x] == b[y])
            {
                pairs.Add((x, y));
                x++;
                y++;
            }
            else if (best[(x + 1) * w + y] >= best[x * w + y + 1]) x++;
            else y++;
        }
        return pairs;
    }

    /// <summary>The shapes and lines a flow's steps use, each with the indexes of the steps on it.</summary>
    private static (Dictionary<string, List<int>> Shapes, Dictionary<string, List<int>> Lines) Usage(IReadOnlyList<Step> steps)
    {
        var shapes = new Dictionary<string, List<int>>();
        var lines = new Dictionary<string, List<int>>();
        void Add(Dictionary<string, List<int>> map, string id, int step)
        {
            if (map.TryGetValue(id, out var list)) list.Add(step);
            else map[id] = [step];
        }
        for (var n = 0; n < steps.Count; n++)
        {
            var s = steps[n];
            var from = s.From ?? "undefined";
            Add(shapes, from, n);
            if (!string.IsNullOrEmpty(s.To))
            {
                Add(shapes, s.To, n);
                Add(lines, Failures.LineKey(from, s.To), n);
            }
        }
        return (shapes, lines);
    }
}
