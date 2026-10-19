namespace Flowy.Core;

/// <summary>
/// What a reader is told about a stop: <c>Chip</c> is the card's words for the group ("" outside one), <c>Text</c> the group's own text. A branch lists
/// its lanes as <c>Tabs</c> and says which this stop is in (<c>Tab</c>, -1 elsewhere). A parallel stop names the lane of each of its steps in <c>Lanes</c>.
/// <c>Marks</c> has one short mark for each step of the stop, drawn on its line. No glyphs: each reader adds its own icon.
/// </summary>
public sealed record Caption(string Chip, string Text, IReadOnlyList<string> Tabs, int Tab, IReadOnlyList<string> Lanes, IReadOnlyList<string> Marks);

/// <summary>A stop's cell in the progress bar, and what hovering it says (the lane it is in).</summary>
public sealed record Cell(int Stop, int Col, int Row, string Title);

/// <summary>A group's bracket under the progress bar: the columns it covers, its short words and what hovering it says.</summary>
public sealed record Bracket(string Kind, int From, int To, string Text, string Title);

public sealed record Progress(int Cols, int Rows, IReadOnlyList<Cell> Cells, IReadOnlyList<Bracket> Brackets);

/// <summary>One line of the legend: the kind of group whose icon it gets (null for the bar and the labels on lines), a title and what it means.</summary>
public sealed record LegendRow(string? Kind, string Title, string Text);

/// <summary>A port of src/core/captions.ts, with the same words. desktop/fixtures/structure.ts keeps the two equal.</summary>
public static class Captions
{
    /// <summary>What each thing on the card means, in plain words: the legend the card opens.</summary>
    public static readonly IReadOnlyList<LegendRow> Legend =
    [
        new("repeat", "Repeat", "The same steps again. The chip says how many times, or what stops it."),
        new("branch", "Branch", "Only one lane happens. Each tab is a lane, and the one you are in is marked. The others are dashed on the canvas."),
        new("parallel", "Same time", "Lanes that run together. Each stop lights the next step of every lane."),
        new(null, "The bar", "One cell for each stop, and a row for each lane of a branch. A bracket under it names each group. Point at one for more."),
        new(null, "The label on a line", "Which lane, or which repeat, the step is in."),
    ];

    private static string Part(OrderedDictionary<string, object?> group, string key)
    {
        group.TryGetValue(key, out var v);
        return Structure.Blank(v) ? "" : Structure.JsTrim((string)v!);
    }

    private static OrderedDictionary<string, object?> GroupOf(Flow flow, string id) =>
        flow.Groups is { } groups && groups.TryGetValue(id, out var v) && v is OrderedDictionary<string, object?> body ? body : [];

    /// <summary>What a repeat does, in words: "up to 3 times, until it works", or "" when it says neither.</summary>
    private static string RepeatWords(OrderedDictionary<string, object?> group)
    {
        var times = Part(group, "times");
        var until = Part(group, "until");
        return string.Join(", ", new[] { times == "" ? "" : $"up to {times} times", until == "" ? "" : $"until {until}" }.Where(w => w != ""));
    }

    public static Caption Of(Flow flow, Stop stop)
    {
        var none = new Caption("", "", [], -1, [], stop.Steps.Select(_ => "").ToList());
        if (stop.Group is null || stop.Kind is null) return none;
        var group = GroupOf(flow, stop.Group);
        var text = Part(group, "text");
        IReadOnlyList<string> labels = stop.LaneLabels ?? [];
        string LaneOf(int i) => stop.Lanes is { } lanes && i < lanes.Count && lanes[i] >= 0 && lanes[i] < labels.Count ? labels[lanes[i]] : "";
        if (stop.Kind == "repeat")
        {
            var times = Part(group, "times");
            var until = Part(group, "until");
            var words = RepeatWords(group);
            var mark = times != "" ? $"up to {times}" : until != "" ? $"until {until}" : "";
            return none with { Chip = words == "" ? "Repeats" : $"Repeats {words}", Text = text, Marks = stop.Steps.Select(_ => mark).ToList() };
        }
        if (stop.Kind == "branch")
            return none with
            {
                Chip = labels.Count > 1 ? $"One of {labels.Count}" : "Only if",
                Text = text,
                Tabs = labels,
                Tab = stop.Lanes is { Count: > 0 } l ? l[0] : -1,
                Marks = stop.Steps.Select((_, i) => LaneOf(i)).ToList(),
            };
        var named = stop.Steps.Select((_, i) => LaneOf(i)).ToList();
        return none with { Chip = labels.Count > 1 ? $"At the same time, {labels.Count} lanes" : "At the same time", Text = text, Lanes = named, Marks = named };
    }

    /// <summary>
    /// The progress bar: a cell for each stop, and a bracket for each group over the columns it covers. Most stops take the next column on row 0.
    /// The lanes of a branch start in the same column and sit on rows of their own, each lane's stops in the columns after it, and what follows the
    /// branch starts after its longest lane. <c>Rows</c> is the most any branch needs, and at least 1.
    /// </summary>
    public static Progress ProgressOf(Flow flow, IReadOnlyList<Stop> stops)
    {
        var cells = new List<Cell>();
        var brackets = new List<Bracket>();
        var col = 0;
        var rows = 1;
        for (var k = 0; k < stops.Count;)
        {
            var s = stops[k];
            if (s.Group is null || s.Kind is null)
            {
                cells.Add(new Cell(k, col++, 0, ""));
                k++;
                continue;
            }
            var end = k;
            while (end + 1 < stops.Count && stops[end + 1].Group == s.Group) end++;
            var start = col;
            if (s.Kind == "branch")
            {
                var lanes = s.LaneLabels?.Count ?? 1;
                var used = new List<int>();
                for (var j = k; j <= end; j++)
                {
                    var lane = stops[j].Lanes is { Count: > 0 } l ? l[0] : 0;
                    while (used.Count <= lane) used.Add(0);
                    cells.Add(new Cell(j, start + used[lane], lane, s.LaneLabels is { } labels && lane < labels.Count ? labels[lane] : ""));
                    used[lane]++;
                }
                var longest = Math.Max(1, used.Count == 0 ? 0 : used.Max());
                rows = Math.Max(rows, lanes);
                var only = s.LaneLabels is { Count: > 0 } first ? first[0] : "";
                brackets.Add(new Bracket("branch", start, start + longest - 1,
                    lanes > 1 ? $"one of {lanes} lanes" : "only if",
                    lanes > 1 ? "Alternatives: only one of these lanes happens" : only == "" ? "Happens only sometimes" : $"Happens only if: {only}"));
                col = start + longest;
            }
            else
            {
                for (var j = k; j <= end; j++)
                    cells.Add(new Cell(j, col++, 0, stops[j].Lanes is { } named ? string.Join(" + ", named.Select(n => s.LaneLabels is { } labels && n >= 0 && n < labels.Count ? labels[n] : "")) : ""));
                var group = GroupOf(flow, s.Group);
                var times = Part(group, "times");
                var words = RepeatWords(group);
                brackets.Add(s.Kind == "repeat"
                    ? new Bracket(s.Kind, start, col - 1, times == "" ? "" : $"×{times}", words == "" ? "Repeats" : $"Repeats {words}")
                    : new Bracket(s.Kind, start, col - 1, "same time", "The lanes happen at the same time: each stop shows the next step of every lane"));
            }
            k = end + 1;
        }
        return new Progress(col, rows, cells, brackets);
    }
}
