namespace Flowy.Core;

/// <summary>
/// One line's label to place. <c>Path</c>: the line as SVG path data. <c>Mid</c>: the middle of it, where the label sits unless moved. <c>Width</c> and
/// <c>Height</c>: the label's box with its padding. <c>Pinned</c>: the label stays at <c>Mid</c> and the others keep clear of it (a lit line's label). <c>Across</c>: the other lines of the pair
/// this line is one of, as the points they are made of; the label keeps off them if it can, and is never stacked above or below the middle. <c>Extra</c>: width in pixels the label has besides
/// its text (the sample of its line that starts the label of a line of a pair side by side, see <see cref="LineLabels.Sample"/>).
/// </summary>
public sealed record LabelItem(string Id, string Path, Pt Mid, double Width, double Height, bool Pinned = false, IReadOnlyList<IReadOnlyList<Pt>>? Across = null, double Extra = 0);

/// <summary>
/// Where each line's label goes, so labels that would sit on top of each other, or side by side close enough to read as one sentence, are read one by
/// one. The lines and boxes stay where they are and only the labels move: try a few places along the line, keep the first that is clear of the boxes and
/// of the labels placed before it, and when none is, take the least bad. A port of ui/src/labels.ts, which sizes a label by its characters where this
/// takes the size the desktop measured. No drawing in here.
/// </summary>
public static class LineLabels
{
    /// <summary>The clear space kept between two labels, one above the other.</summary>
    private const double Apart = 3;

    /// <summary>The clear space kept between two labels side by side, about four characters with the padding.</summary>
    private const double RowGap = 16;

    /// <summary>How far along a line to try a label, in the order tried: the middle first, then each side of it.</summary>
    private static readonly double[] Along = [0.5, 0.62, 0.38, 0.74, 0.26, 0.85, 0.15];

    /// <summary>Last resort when no place along the line is clear: stacked above or below the middle, in label heights.</summary>
    private static readonly int[] Stacked = [1, -1, 2, -2];

    /// <summary>The longest label drawn on a line, in characters. A longer one is cut short with an ellipsis; the whole label is in the line's panel.</summary>
    public const int MaxLabel = 42;

    /// <summary>The label as drawn on its line: as it is, or cut short with an ellipsis past <see cref="MaxLabel"/> characters.</summary>
    public static string Clip(string label) => label.Length > MaxLabel ? $"{label[..(MaxLabel - 1)].TrimEnd()}…" : label;

    private const double OnBox = 1e6;
    private const double PerStep = 10;
    private const double PerStack = 50;

    /// <summary>The cost of a label over the line of another of its pair: dear, but a pair of lines side by side leaves a label no place clear of the others' lines, and then the middle is the best of them.</summary>
    private const double OnLane = 200;

    /// <summary>The width of the sample of a line (its pattern and marks) that starts the label of a line of a pair side by side, with the space after it.</summary>
    public const double Sample = 34;

    /// <summary>Whether the line through <paramref name="points"/> passes through <paramref name="box"/> (the ends of its segments count).</summary>
    private static bool Touches(Rect box, IReadOnlyList<Pt> points)
    {
        double x0 = box.X, y0 = box.Y, x1 = box.X + box.Width, y1 = box.Y + box.Height;
        for (var i = 0; i + 1 < points.Count; i++)
        {
            // Liang-Barsky: the part of the segment, as a fraction of it, that lies inside each of the box's four sides; the segment touches the box when some part lies inside all four.
            var (p, q) = (points[i], points[i + 1]);
            var dx = q.X - p.X;
            var dy = q.Y - p.Y;
            double low = 0, high = 1;
            var inside = true;
            foreach (var (step, room) in new[] { (-dx, p.X - x0), (dx, x1 - p.X), (-dy, p.Y - y0), (dy, y1 - p.Y) })
            {
                if (step == 0)
                {
                    if (room < 0) inside = false;
                }
                else if (step < 0) low = Math.Max(low, room / step);
                else high = Math.Min(high, room / step);
            }
            if (inside && low <= high) return true;
        }
        return false;
    }

    /// <summary>How much of <paramref name="a"/> lies within <paramref name="b"/>, with <paramref name="gapX"/> added to each side of it and <paramref name="gapY"/> above and below.</summary>
    private static double Overlap(Rect a, Rect b, double gapX = 0, double gapY = 0)
    {
        var w = Math.Min(a.X + a.Width, b.X + b.Width + gapX) - Math.Max(a.X, b.X - gapX);
        var h = Math.Min(a.Y + a.Height, b.Y + b.Height + gapY) - Math.Max(a.Y, b.Y - gapY);
        return w > 0 && h > 0 ? w * h : 0;
    }

    /// <summary>The box of an item's label centred on <paramref name="at"/>.</summary>
    public static Rect Around(Pt at, LabelItem item) => new(at.X - (item.Width + item.Extra) / 2, at.Y - item.Height / 2, item.Width + item.Extra, item.Height);

    /// <summary>
    /// The spot for each label, by line id. Pinned ones stay put. The rest go widest first (the hardest to fit), each at the first place along its line,
    /// nearest the middle, that clears everything placed so far, or else wherever it overlaps least.
    /// </summary>
    public static Dictionary<string, Pt> Place(IReadOnlyList<LabelItem> items, IReadOnlyList<Rect> boxes)
    {
        var spots = new Dictionary<string, Pt>();
        var placed = new List<Rect>();
        foreach (var item in items.Where(i => i.Pinned))
        {
            spots[item.Id] = item.Mid;
            placed.Add(Around(item.Mid, item));
        }
        // OrderBy is a stable sort, as Array.prototype.sort is: labels of one width keep the order they came in.
        foreach (var item in items.Where(i => !i.Pinned).OrderByDescending(i => i.Width))
        {
            var line = PathPoints.Flatten(item.Path);
            var candidates = new List<(Pt At, double Cost)>();
            foreach (var s in Along)
            {
                var (x, y) = s == 0.5 ? (item.Mid.X, item.Mid.Y) : PathPoints.PointAt(line, s);
                candidates.Add((new Pt(x, y), Math.Abs(s - 0.5) * PerStep));
            }
            // A label of a line with others beside it slides along its own line and no further: stacked above or below, it would sit on another line's place.
            if (item.Across is null)
                foreach (var k in Stacked) candidates.Add((new Pt(item.Mid.X, item.Mid.Y + k * (item.Height + Apart)), Math.Abs(k) * PerStack));
            var best = candidates[0];
            var bestCost = double.PositiveInfinity;
            foreach (var c in candidates)
            {
                var label = Around(c.At, item);
                // Summed as the browser sums them, each kind on its own, so the two land on the same costs to the last bit.
                var onBoxes = 0.0;
                foreach (var b in boxes) onBoxes += Overlap(label, b) > 0 ? OnBox : 0;
                var onLabels = 0.0;
                foreach (var p in placed) onLabels += Overlap(label, p, RowGap, Apart);
                var onLanes = 0.0;
                foreach (var other in item.Across ?? []) onLanes += Touches(label, other) ? OnLane : 0;
                var cost = c.Cost + onBoxes + onLabels + onLanes;
                if (cost < bestCost)
                {
                    best = c;
                    bestCost = cost;
                }
                if (cost == c.Cost) break; // clear: the first such place is the one nearest the middle
            }
            spots[item.Id] = best.At;
            placed.Add(Around(best.At, item));
        }
        return spots;
    }
}
