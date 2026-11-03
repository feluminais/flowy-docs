namespace Flowy.Core;

/// <summary>The marks a line wears: the shape of its head, whether it has one on its start too, and its tail (null for none).</summary>
public sealed record LineMarks(string Head, bool HeadAtStart, string? Tail);

/// <summary>
/// What the key of the kinds and the drawing of a line's marks work out from the lines on show: a port of ui/src/kindkey.ts. The key lists the kinds the lines
/// are drawn as; a line wears its kind's head and tail.
/// </summary>
public static class KindKey
{
    /// <summary>Marks on a line that is one of several side by side are drawn no bigger than this, so a head stays within the gap between neighbours.</summary>
    public const double LaneMarkScale = 1.2;

    /// <summary>
    /// The kinds the lines on the canvas are drawn as, for the key: the kinds in the order of the list, and whether a plain line is on show as well. A line a step
    /// added (the dashed step line) is not a connection and does not count. A line drawn as no kind (a mixed line) counts as plain.
    /// </summary>
    public static (IReadOnlyList<string> Kinds, bool Plain) OnScreen(IEnumerable<SceneEdge> lines)
    {
        var looks = lines.Where(l => !SceneBuilder.IsStepLine(l.Id)).Select(l => l.Look).ToList();
        var kinds = Kinds.All.Where(k => looks.Any(look => look is not null && Kinds.SameLook(look, k.Look))).Select(k => k.Id).ToList();
        return (kinds, looks.Any(look => look is null));
    }

    /// <summary>The scale a line's marks are drawn at: the head scale for its width, and no more than <see cref="LaneMarkScale"/> when it is one of several lines side by side.</summary>
    public static double MarkScale(double headScale, int lanes) => lanes > 1 ? Math.Min(headScale, LaneMarkScale) : headScale;

    /// <summary>
    /// Which marks a line wears: its head (a plain line has a filled one) on its end, and also on its start when it carries connections both ways; and, when it runs one way,
    /// the kind's tail on its start. A line that runs both ways has no tail, since it would sit where the other end's head is.
    /// </summary>
    public static LineMarks MarksOf(LineLook? look, bool both)
    {
        var tail = look is null || both || look.Tail == "none" ? null : look.Tail;
        return new LineMarks(look?.Head ?? Kinds.PlainLook.Head, both, tail);
    }
}
