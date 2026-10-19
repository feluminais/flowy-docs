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
