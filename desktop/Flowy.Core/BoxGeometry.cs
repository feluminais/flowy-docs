namespace Flowy.Core;

public readonly record struct Pt(double X, double Y);

public readonly record struct Rect(double X, double Y, double Width, double Height)
{
    public double Right => X + Width;

    public double Bottom => Y + Height;

    public Pt Center => new(X + Width / 2, Y + Height / 2);
}

public enum Side { Top, Right, Bottom, Left }

/// <summary>Where lines meet boxes, and the frame around a view's boxes. A port of the geometry in ui/src/graph.ts.</summary>
public static class BoxGeometry
{
    /// <summary>Every box has the same size, so boxes can be placed before they are drawn. Keep in step with the box control.</summary>
    public const double BoxWidth = 200;

    public const double BoxHeight = 72;

    /// <summary>
    /// Where a ray from the centre of <paramref name="r"/> towards (<paramref name="dx"/>, <paramref name="dy"/>) meets the shape's outline: the
    /// rectangle's border when <paramref name="edge"/> is empty, else the first side of the polygon it crosses (ShapeDef.Edge, x0, y0, x1, y1, …).
    /// </summary>
    public static Pt LeaveAt(Rect r, double[]? edge, double dx, double dy)
    {
        var cx = r.X + r.Width / 2;
        var cy = r.Y + r.Height / 2;
        if (edge is null || edge.Length == 0)
        {
            // How far along the line the box's border is. Dividing by zero gives infinity, which Min ignores.
            var k = Math.Min(r.Width / 2 / Math.Abs(dx), r.Height / 2 / Math.Abs(dy));
            return new Pt(cx + dx * k, cy + dy * k);
        }
        var best = double.PositiveInfinity;
        var n = edge.Length / 2;
        for (var i = 0; i < n; i++)
        {
            double px = edge[2 * i], py = edge[2 * i + 1];
            double qx = edge[2 * ((i + 1) % n)], qy = edge[2 * ((i + 1) % n) + 1];
            var ex = qx - px;
            var ey = qy - py;
            var den = dx * ey - dy * ex;
            if (den == 0) continue; // the ray runs along this side
            var t = ((r.X + px - cx) * ey - (r.Y + py - cy) * ex) / den;
            var s = ((r.X + px - cx) * dy - (r.Y + py - cy) * dx) / den;
            if (t > 0 && s >= 0 && s <= 1 && t < best) best = t;
        }
        return double.IsPositiveInfinity(best) ? new Pt(cx, cy) : new Pt(cx + dx * best, cy + dy * best);
    }

    /// <summary>
    /// The path of a recursion's loop pipe for a box: it leaves the shape's outline on the right a little above the middle, swings out to the
    /// right (about 70 px) and comes back in a little below the middle. A port of loopAround in ui/src/graph.ts.
    /// </summary>
    public static string LoopAround(Rect r, double[]? edge)
    {
        var start = LeaveAt(r, edge, r.Width / 2, -r.Height * 0.22);
        var end = LeaveAt(r, edge, r.Width / 2, r.Height * 0.22);
        const double reach = 90; // the control points sit this far out, so the curve itself bulges about three quarters of it
        static string N(double v) => v.ToString("0.###############", System.Globalization.CultureInfo.InvariantCulture);
        return $"M{N(start.X)} {N(start.Y)}C{N(start.X + reach)} {N(start.Y - 40)} {N(end.X + reach)} {N(end.Y + 40)} {N(end.X)} {N(end.Y)}";
    }

    /// <summary>Where a straight line between the centres of two shapes leaves one and enters the other. A shape without an outline is the box itself.</summary>
    public static (Pt From, Pt To) LineEnds(Rect a, Rect b, double[]? edgeA = null, double[]? edgeB = null)
    {
        static Pt Leave(Rect from, double[]? edge, Rect to)
        {
            var c = from.Center;
            var dx = to.Center.X - c.X;
            var dy = to.Center.Y - c.Y;
            return dx == 0 && dy == 0 ? c : LeaveAt(from, edge, dx, dy);
        }
        return (Leave(a, edgeA, b), Leave(b, edgeB, a));
    }

    /// <summary>
    /// How far inside the shape drawn in <paramref name="r"/> the point (<paramref name="x"/>, <paramref name="y"/>) is: positive inside, 0 on the outline, negative
    /// outside (close to the distance from it). The shape is its outline, or the box itself when <paramref name="edge"/> is empty. A line that runs behind a
    /// shape is covered by it, and traffic on that line goes dim as its depth grows (<see cref="Particles.HowBehind"/>).
    /// </summary>
    public static double DepthIn(Rect r, double[]? edge, double x, double y)
    {
        if (edge is null || edge.Length == 0) return Math.Min(Math.Min(x - r.X, r.Right - x), Math.Min(y - r.Y, r.Bottom - y));
        // The outline is convex, so the depth is the point's distance from the nearest side, on the inner side, whichever way the outline winds.
        var n = edge.Length / 2;
        var area = 0.0;
        for (var i = 0; i < n; i++)
        {
            var j = (i + 1) % n;
            area += edge[2 * i] * edge[2 * j + 1] - edge[2 * j] * edge[2 * i + 1];
        }
        var inward = area < 0 ? -1 : 1;
        var depth = double.PositiveInfinity;
        for (var i = 0; i < n; i++)
        {
            double px = edge[2 * i], py = edge[2 * i + 1];
            double qx = edge[2 * ((i + 1) % n)], qy = edge[2 * ((i + 1) % n) + 1];
            var cross = (qx - px) * (y - r.Y - py) - (qy - py) * (x - r.X - px);
            depth = Math.Min(depth, inward * cross / Math.Sqrt((qx - px) * (qx - px) + (qy - py) * (qy - py)));
        }
        return depth;
    }

    /// <summary>The side of <paramref name="from"/> that faces <paramref name="to"/>: the one a line between their centres leaves through.</summary>
    private static Side Facing(Rect from, Rect to)
    {
        var dx = to.Center.X - from.Center.X;
        var dy = to.Center.Y - from.Center.Y;
        if (Math.Abs(dx) * from.Height > Math.Abs(dy) * from.Width) return dx > 0 ? Side.Right : Side.Left;
        return dy > 0 ? Side.Bottom : Side.Top;
    }

    private static Pt MiddleOf(Rect r, Side side, double[]? edge) => side switch
    {
        Side.Top => LeaveAt(r, edge, 0, -1),
        Side.Bottom => LeaveAt(r, edge, 0, 1),
        Side.Left => LeaveAt(r, edge, -1, 0),
        _ => LeaveAt(r, edge, 1, 0),
    };

    /// <summary>Where a curved or right-angled line starts and ends: the middle of the side each box turns to the other.</summary>
    public sealed record Ports(Pt From, Side FromSide, Pt To, Side ToSide);

    public static Ports PortsBetween(Rect a, Rect b, double[]? edgeA = null, double[]? edgeB = null)
    {
        var fromSide = Facing(a, b);
        var toSide = Facing(b, a);
        return new Ports(MiddleOf(a, fromSide, edgeA), fromSide, MiddleOf(b, toSide, edgeB), toSide);
    }

    /// <summary>The frame around a view's own boxes: their bounding box plus <paramref name="pad"/> on every side.</summary>
    public static Rect FrameAround(IEnumerable<Rect> rects, double pad = 28)
    {
        var list = rects.ToList();
        var x = list.Min(r => r.X) - pad;
        var y = list.Min(r => r.Y) - pad;
        var right = list.Max(r => r.Right) + pad;
        var bottom = list.Max(r => r.Bottom) + pad;
        return new Rect(x, y, right - x, bottom - y);
    }
}
