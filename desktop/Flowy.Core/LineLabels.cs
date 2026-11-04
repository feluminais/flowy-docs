namespace Flowy.Core;

/// <summary>
/// One line's label to place. <c>Path</c>: the line as SVG path data. <c>Mid</c>: the middle of it, where the label sits unless moved. <c>Width</c> and
/// <c>Height</c>: the label's box with its padding. <c>Pinned</c>: the label stays at <c>Mid</c> and the others keep clear of it (a lit line's label). <c>Across</c>: the other lines of the pair
/// this line is one of, as the points they are made of; the label keeps off them if it can, and is never stacked above or below the middle. <c>Extra</c>: width in pixels the label has besides
/// its text (the sample of its line that starts the label of a line of a pair side by side, see <see cref="LineLabels.Sample"/>). <c>Clear</c>: for a lit line of a pair side by side, the clear space its label keeps
/// from the line (a step's pipe is wider than the line, see <see cref="LineLabels.PipeClear"/>).
/// </summary>
public sealed record LabelItem(string Id, string Path, Pt Mid, double Width, double Height, bool Pinned = false, IReadOnlyList<IReadOnlyList<Pt>>? Across = null, double Extra = 0, double Clear = LineLabels.NextTo);

/// <summary>
/// Where a label's middle goes. <c>Side</c> is -1 for the label of a line among others that sits beside its line and runs to the left of it, 1 where it runs to the right, and 0 where it sits on its line; the sample of the line
/// that starts the label is then at the end by the line. <c>Hidden</c>: the line has no place clear of the boxes and the other labels, so its label is not drawn unless the line is pointed at.
/// </summary>
public readonly record struct LabelSpot(Pt At, int Side = 0, bool Hidden = false);

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

    /// <summary>The clear space between a lit line and its label where a step's pipe runs along the line: the pipe's half thickness and a little air.</summary>
    public const double PipeClear = 21;

    /// <summary>The clear space between a label beside a line and the line, and between a lit line and its label by default.</summary>
    public const double NextTo = 4;

    /// <summary>The cost of a place beside the line, and of each row from the middle (see <see cref="PlaceSpots"/>).</summary>
    private const double Beside = 20;
    private const double PerRow = 5;

    /// <summary>How far from each end of its line a label beside it stays, so it is clear of the heads and of the shape.</summary>
    private const double HeadRoom = 6;

    /// <summary>The rows beside the lines tried each way from the middle, in the order tried.</summary>
    private static readonly int[] Rows = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8];

    private const double OnBox = 1e6;
    private const double PerStep = 10;
    private const double PerStack = 50;

    /// <summary>The cost of a label over the line of another of its pair: dear, but a pair of lines side by side leaves a label no place clear of the others' lines, and then the middle is the best of them.</summary>
    private const double OnLane = 200;

    /// <summary>The cost of a label over the lit line of its pair, which a step plays along: far dearer than over another line, for a lit line is the one to see.</summary>
    private const double OnLit = 1e4;

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

    /// <summary>How far from its line a label of a line among others may be and still be read as its own: a label further off is by some other line.</summary>
    private const double Stray = 8;

    /// <summary>Whether <paramref name="box"/> is within <see cref="Stray"/> of the line through <paramref name="points"/>, which is walked in steps of about 2 pixels.</summary>
    private static bool Near(Rect box, IReadOnlyList<Pt> points)
    {
        for (var i = 0; i + 1 < points.Count; i++)
        {
            var (p, q) = (points[i], points[i + 1]);
            var steps = Math.Max(1, (int)Math.Ceiling(Math.Sqrt((q.X - p.X) * (q.X - p.X) + (q.Y - p.Y) * (q.Y - p.Y)) / 2));
            for (var k = 0; k <= steps; k++)
            {
                var (x, y) = (p.X + (q.X - p.X) * k / steps, p.Y + (q.Y - p.Y) * k / steps);
                var (dx, dy) = (Math.Max(Math.Max(box.X - x, 0), x - (box.X + box.Width)), Math.Max(Math.Max(box.Y - y, 0), y - (box.Y + box.Height)));
                if (dx * dx + dy * dy <= Stray * Stray) return true;
            }
        }
        return false;
    }

    private static List<Pt> PointsOf(string path)
    {
        var line = PathPoints.Flatten(path);
        return line.Xs.Select((x, i) => new Pt(x, line.Ys[i])).ToList();
    }

    /// <summary>Where the line through <paramref name="points"/> is at height <paramref name="y"/>: the crossing nearest <paramref name="x"/>, or none where the line does not reach that height.</summary>
    private static Pt? Crossing(IReadOnlyList<Pt> points, double y, double x)
    {
        Pt? best = null;
        for (var i = 0; i + 1 < points.Count; i++)
        {
            var (p, q) = (points[i], points[i + 1]);
            if ((p.Y - y) * (q.Y - y) > 0 || p.Y == q.Y) continue;
            var at = new Pt(p.X + (q.X - p.X) * (y - p.Y) / (q.Y - p.Y), y);
            if (best is null || Math.Abs(at.X - x) < Math.Abs(best.Value.X - x)) best = at;
        }
        return best;
    }

    /// <summary>
    /// Where a label of a row centred at height <paramref name="y"/> stands, beside the line through <paramref name="points"/> on the given side: level with the line, and as far out as the line reaches over the label's height,
    /// so a line that slants does not run through the label. None where the line does not reach that height.
    /// </summary>
    private static Pt? Abreast(IReadOnlyList<Pt> points, double y, double x, int side, double height)
    {
        if (Crossing(points, y, x) is not { } middle) return null;
        var xs = new List<double> { middle.X };
        if (Crossing(points, y - height / 2, x) is { } above) xs.Add(above.X);
        if (Crossing(points, y + height / 2, x) is { } below) xs.Add(below.X);
        return new Pt(side < 0 ? xs.Min() : xs.Max(), y);
    }

    /// <summary>A label of <paramref name="width"/> beside a line's middle, on the given side of it and <paramref name="gap"/> clear of it, <paramref name="dy"/> lower.</summary>
    private static Pt Next(Pt mid, double width, int side, double gap, double dy = 0) => new(mid.X + side * (width / 2 + gap), mid.Y + dy);

    /// <summary>The side of its line the label of a line among others runs to: away from the others. Level with them, to the right.</summary>
    private static int Outward(LabelItem item)
    {
        var others = item.Across ?? [];
        if (others.Count == 0) return 1;
        double sum = 0;
        foreach (var points in others) sum += (points.Min(p => p.X) + points.Max(p => p.X)) / 2;
        return item.Mid.X - sum / others.Count < -0.5 ? -1 : 1;
    }

    /// <summary>The place for the label of a lit line among others: beside the line, never on it. Right of it, left of it, above it or below it, whichever covers the fewest of the other lines and the boxes and the labels placed, the first when equal.</summary>
    private static LabelSpot BesideLit(LabelItem item, IReadOnlyList<Rect> placed, IReadOnlyList<Rect> boxes)
    {
        var width = item.Width + item.Extra;
        var own = PointsOf(item.Path);
        (Pt At, int Side)[] options =
        [
            (Next(item.Mid, width, 1, item.Clear), 1), (Next(item.Mid, width, -1, item.Clear), -1),
            (new Pt(item.Mid.X, item.Mid.Y - item.Clear - item.Height / 2), 0), (new Pt(item.Mid.X, item.Mid.Y + item.Clear + item.Height / 2), 0),
        ];
        var best = options[0];
        var bestCost = double.PositiveInfinity;
        for (var i = 0; i < options.Length; i++)
        {
            var label = Around(options[i].At, item);
            var onBoxes = 0.0;
            foreach (var b in boxes) onBoxes += Overlap(label, b) > 0 ? OnBox : 0;
            var onLabels = 0.0;
            foreach (var p in placed) onLabels += Overlap(label, p, RowGap, Apart);
            var onLanes = 0.0;
            foreach (var other in item.Across ?? []) onLanes += Touches(label, other) ? OnLane : 0;
            var cost = i + (Touches(label, own) ? 10 * OnLane : 0) + onBoxes + onLabels + onLanes;
            if (cost < bestCost)
            {
                best = options[i];
                bestCost = cost;
            }
        }
        return new LabelSpot(best.At, best.Side);
    }

    /// <summary>The spot for each label, by line id (the middle of the label; <see cref="PlaceSpots"/> says more).</summary>
    public static Dictionary<string, Pt> Place(IReadOnlyList<LabelItem> items, IReadOnlyList<Rect> boxes) => PlaceSpots(items, boxes).ToDictionary(e => e.Key, e => e.Value.At);

    /// <summary>
    /// The spot for each label, by line id. Pinned ones stay put (the lit line of a pair side by side has its label beside it). The rest go widest first, each at the first place along its line,
    /// nearest the middle, that clears everything placed so far, or else wherever it overlaps least. The label of a line of a pair side by side may sit beside its line, row by row, and has
    /// no place at all where the boxes and the labels placed leave none clear.
    /// </summary>
    public static Dictionary<string, LabelSpot> PlaceSpots(IReadOnlyList<LabelItem> items, IReadOnlyList<Rect> boxes)
    {
        var spots = new Dictionary<string, LabelSpot>();
        var placed = new List<Rect>();
        foreach (var item in items.Where(i => i.Pinned))
        {
            var spot = item.Across is null ? new LabelSpot(item.Mid) : BesideLit(item, placed, boxes);
            spots[item.Id] = spot;
            placed.Add(Around(spot.At, item));
        }
        // The lit lines of the pairs side by side: the label of another line of a pair keeps off them, and has no place at all where that is the only way.
        var lit = items.Where(i => i.Pinned && i.Across is not null).Select(i => PointsOf(i.Path)).ToList();
        // OrderBy is a stable sort, as Array.prototype.sort is: labels of one width keep the order they came in.
        foreach (var item in items.Where(i => !i.Pinned).OrderByDescending(i => i.Width))
        {
            var line = PathPoints.Flatten(item.Path);
            var points = PointsOf(item.Path);
            var candidates = new List<(Pt At, int Side, double Cost)>();
            foreach (var s in Along)
            {
                var (x, y) = s == 0.5 ? (item.Mid.X, item.Mid.Y) : PathPoints.PointAt(line, s);
                candidates.Add((new Pt(x, y), 0, Math.Abs(s - 0.5) * PerStep));
            }
            // A label of a line with others beside it slides along its own line and no further: stacked above or below, it would sit on another line's place. It may sit beside its line, row by row.
            if (item.Across is null)
                foreach (var k in Stacked) candidates.Add((new Pt(item.Mid.X, item.Mid.Y + k * (item.Height + Apart)), 0, Math.Abs(k) * PerStack));
            else
            {
                // Beside the line only where the line runs up and down enough for a label to sit by it, level with the line and clear of the heads at its ends (or at the middle where the line is too short for rows).
                var side = Outward(item);
                var minY = points.Min(p => p.Y);
                var maxY = points.Max(p => p.Y);
                foreach (var k in Rows)
                {
                    // Each row is by the line where the line is level with it (a line that slants has its rows shifted along it).
                    var level = k == 0 ? item.Mid : Abreast(points, item.Mid.Y + k * (item.Height + Apart), item.Mid.X, side, item.Height);
                    if (level is not { } found) continue;
                    var at = Next(found, item.Width + item.Extra, side, NextTo);
                    var label = Around(at, item);
                    var inRange = k == 0 || (label.Y >= minY + HeadRoom && label.Y + label.Height <= maxY - HeadRoom);
                    if (inRange && !Touches(label, points)) candidates.Add((at, side, Beside + Math.Abs(k) * PerRow));
                }
            }
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
                var cost = c.Cost + onBoxes + onLabels + onLanes + (item.Across is null ? 0 : lit.Count(l => Touches(label, l))) * OnLit;
                if (cost < bestCost)
                {
                    best = c;
                    bestCost = cost;
                }
                if (cost == c.Cost) break; // clear: the first such place is the one nearest the middle
            }
            var chosen = Around(best.At, item);
            // A line of a pair side by side whose label finds no place clear of the boxes, of the labels placed and of the lit line of its pair has no label drawn.
            if (item.Across is not null && (boxes.Any(b => Overlap(chosen, b) > 0) || placed.Any(p => Overlap(chosen, p, RowGap, Apart) > 0) || lit.Any(l => Touches(chosen, l)) || !Near(chosen, points)))
            {
                spots[item.Id] = new LabelSpot(best.At, best.Side, true);
                continue;
            }
            spots[item.Id] = new LabelSpot(best.At, best.Side);
            placed.Add(chosen);
        }
        return spots;
    }
}
