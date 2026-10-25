namespace Flowy.Core;

/// <summary>
/// One line's label to place. <c>Path</c>: the line as SVG path data. <c>Mid</c>: the middle of it, where the label sits unless moved. <c>Width</c> and
/// <c>Height</c>: the label's box with its padding. <c>Pinned</c>: the label stays at <c>Mid</c> and the others keep clear of it (a lit line's label).
/// </summary>
public sealed record LabelItem(string Id, string Path, Pt Mid, double Width, double Height, bool Pinned = false);

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

    /// <summary>How much of <paramref name="a"/> lies within <paramref name="b"/>, with <paramref name="gapX"/> added to each side of it and <paramref name="gapY"/> above and below.</summary>
    private static double Overlap(Rect a, Rect b, double gapX = 0, double gapY = 0)
    {
        var w = Math.Min(a.X + a.Width, b.X + b.Width + gapX) - Math.Max(a.X, b.X - gapX);
        var h = Math.Min(a.Y + a.Height, b.Y + b.Height + gapY) - Math.Max(a.Y, b.Y - gapY);
        return w > 0 && h > 0 ? w * h : 0;
    }

    /// <summary>The box of an item's label centred on <paramref name="at"/>.</summary>
    public static Rect Around(Pt at, LabelItem item) => new(at.X - item.Width / 2, at.Y - item.Height / 2, item.Width, item.Height);

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
                var cost = c.Cost + onBoxes + onLabels;
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
