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
    /// <summary>Where a straight line between the centres of two boxes leaves one and enters the other.</summary>
    public static (Pt From, Pt To) LineEnds(Rect a, Rect b)
    {
        static Pt Edge(Rect from, Rect to)
        {
            var c = from.Center;
            var dx = to.Center.X - c.X;
            var dy = to.Center.Y - c.Y;
            if (dx == 0 && dy == 0) return c;
            // How far along the line the box's border is. Dividing by zero gives infinity, which Min ignores.
            var k = Math.Min(from.Width / 2 / Math.Abs(dx), from.Height / 2 / Math.Abs(dy));
            return new Pt(c.X + dx * k, c.Y + dy * k);
        }
        return (Edge(a, b), Edge(b, a));
    }

    /// <summary>The side of <paramref name="from"/> that faces <paramref name="to"/>: the one a line between their centres leaves through.</summary>
    private static Side Facing(Rect from, Rect to)
    {
        var dx = to.Center.X - from.Center.X;
        var dy = to.Center.Y - from.Center.Y;
        if (Math.Abs(dx) * from.Height > Math.Abs(dy) * from.Width) return dx > 0 ? Side.Right : Side.Left;
        return dy > 0 ? Side.Bottom : Side.Top;
    }

    private static Pt MiddleOf(Rect r, Side side) => side switch
    {
        Side.Top => new Pt(r.X + r.Width / 2, r.Y),
        Side.Bottom => new Pt(r.X + r.Width / 2, r.Y + r.Height),
        Side.Left => new Pt(r.X, r.Y + r.Height / 2),
        _ => new Pt(r.X + r.Width, r.Y + r.Height / 2),
    };

    /// <summary>Where a curved or right-angled line starts and ends: the middle of the side each box turns to the other.</summary>
    public sealed record Ports(Pt From, Side FromSide, Pt To, Side ToSide);

    public static Ports PortsBetween(Rect a, Rect b)
    {
        var fromSide = Facing(a, b);
        var toSide = Facing(b, a);
        return new Ports(MiddleOf(a, fromSide), fromSide, MiddleOf(b, toSide), toSide);
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
