using System.Globalization;

namespace Flowy.Core;

/// <summary>
/// A line between two boxes as an SVG path (the syntax Avalonia's <c>Geometry.Parse</c> reads), where its label sits,
/// and where it ends and which way it points there, for the arrowhead.
/// </summary>
public sealed record LinePath(string Data, Pt Label, Pt End, Pt Direction);

/// <summary>Straight, curved and right-angled lines. Ports of getStraightPath, getBezierPath and getSmoothStepPath in @xyflow/system, which the browser canvas draws with.</summary>
public static class LinePaths
{
    private static string N(double d) => d == 0 ? "0" : d.ToString("R", CultureInfo.InvariantCulture);

    private static Pt Unit(Pt from, Pt to)
    {
        var dx = to.X - from.X;
        var dy = to.Y - from.Y;
        var length = Math.Sqrt(dx * dx + dy * dy);
        return length == 0 ? new Pt(0, 1) : new Pt(dx / length, dy / length);
    }

    /// <summary>The line between boxes <paramref name="a"/> and <paramref name="b"/> in a style: "straight", "curved" or "angled".</summary>
    public static LinePath Build(string style, Rect a, Rect b)
    {
        if (style == "straight")
        {
            var (from, to) = BoxGeometry.LineEnds(a, b);
            return Straight(from, to);
        }
        var ports = BoxGeometry.PortsBetween(a, b);
        return style == "curved" ? Bezier(ports) : SmoothStep(ports, 8);
    }

    private static LinePath Straight(Pt s, Pt t)
    {
        var xOffset = Math.Abs(t.X - s.X) / 2;
        var yOffset = Math.Abs(t.Y - s.Y) / 2;
        var label = new Pt(t.X < s.X ? t.X + xOffset : t.X - xOffset, t.Y < s.Y ? t.Y + yOffset : t.Y - yOffset);
        return new LinePath($"M {N(s.X)},{N(s.Y)}L {N(t.X)},{N(t.Y)}", label, t, Unit(s, t));
    }

    private static double ControlOffset(double distance, double curvature) =>
        distance >= 0 ? 0.5 * distance : curvature * 25 * Math.Sqrt(-distance);

    private static Pt Control(Side pos, Pt p1, Pt p2, double c) => pos switch
    {
        Side.Left => new Pt(p1.X - ControlOffset(p1.X - p2.X, c), p1.Y),
        Side.Right => new Pt(p1.X + ControlOffset(p2.X - p1.X, c), p1.Y),
        Side.Top => new Pt(p1.X, p1.Y - ControlOffset(p1.Y - p2.Y, c)),
        _ => new Pt(p1.X, p1.Y + ControlOffset(p2.Y - p1.Y, c)),
    };

    private static LinePath Bezier(BoxGeometry.Ports p, double curvature = 0.25)
    {
        var c1 = Control(p.FromSide, p.From, p.To, curvature);
        var c2 = Control(p.ToSide, p.To, p.From, curvature);
        // The cubic's t = 0.5 point: not the middle of its length, but easy to find.
        var label = new Pt(
            p.From.X * 0.125 + c1.X * 0.375 + c2.X * 0.375 + p.To.X * 0.125,
            p.From.Y * 0.125 + c1.Y * 0.375 + c2.Y * 0.375 + p.To.Y * 0.125);
        var data = $"M{N(p.From.X)},{N(p.From.Y)} C{N(c1.X)},{N(c1.Y)} {N(c2.X)},{N(c2.Y)} {N(p.To.X)},{N(p.To.Y)}";
        var direction = c2 == p.To ? Unit(p.From, p.To) : Unit(c2, p.To);
        return new LinePath(data, label, p.To, direction);
    }

    private static Pt Dir(Side side) => side switch
    {
        Side.Left => new Pt(-1, 0),
        Side.Right => new Pt(1, 0),
        Side.Top => new Pt(0, -1),
        _ => new Pt(0, 1),
    };

    private static double Get(Pt p, int axis) => axis == 0 ? p.X : p.Y;

    private static Pt Set(Pt p, int axis, double v) => axis == 0 ? p with { X = v } : p with { Y = v };

    private static double Distance(Pt a, Pt b) => Math.Sqrt(Math.Pow(b.X - a.X, 2) + Math.Pow(b.Y - a.Y, 2));

    /// <summary>An orthogonal route between two ports, the way @xyflow/system's getPoints finds one.</summary>
    private static (List<Pt> Points, Pt Center) Route(Pt source, Side sourcePos, Pt target, Side targetPos, double offset, double stepPosition)
    {
        var sd = Dir(sourcePos);
        var td = Dir(targetPos);
        var sg = new Pt(source.X + sd.X * offset, source.Y + sd.Y * offset);
        var tg = new Pt(target.X + td.X * offset, target.Y + td.Y * offset);
        var dir = sourcePos is Side.Left or Side.Right
            ? (sg.X < tg.X ? new Pt(1, 0) : new Pt(-1, 0))
            : (sg.Y < tg.Y ? new Pt(0, 1) : new Pt(0, -1));
        var ax = dir.X != 0 ? 0 : 1;
        var currDir = Get(dir, ax);
        List<Pt> points;
        double cx, cy;
        Pt sourceGapOffset = new(0, 0), targetGapOffset = new(0, 0);

        if (Get(sd, ax) * Get(td, ax) == -1)
        {
            // Opposite sides, the default case.
            if (ax == 0)
            {
                cx = sg.X + (tg.X - sg.X) * stepPosition;
                cy = (sg.Y + tg.Y) / 2;
            }
            else
            {
                cx = (sg.X + tg.X) / 2;
                cy = sg.Y + (tg.Y - sg.Y) * stepPosition;
            }
            List<Pt> verticalSplit = [new Pt(cx, sg.Y), new Pt(cx, tg.Y)];
            List<Pt> horizontalSplit = [new Pt(sg.X, cy), new Pt(tg.X, cy)];
            points = Get(sd, ax) == currDir ? (ax == 0 ? verticalSplit : horizontalSplit) : (ax == 0 ? horizontalSplit : verticalSplit);
        }
        else
        {
            List<Pt> sourceTarget = [new Pt(sg.X, tg.Y)];
            List<Pt> targetSource = [new Pt(tg.X, sg.Y)];
            points = ax == 0 ? (sd.X == currDir ? targetSource : sourceTarget) : (sd.Y == currDir ? sourceTarget : targetSource);
            if (sourcePos == targetPos)
            {
                var diff = Math.Abs(Get(source, ax) - Get(target, ax));
                // Same side on both ends and closer than the gap: push one end out so the bend doesn't fold back on itself.
                if (diff <= offset)
                {
                    var gapOffset = Math.Min(offset - 1, offset - diff);
                    if (Get(sd, ax) == currDir) sourceGapOffset = Set(sourceGapOffset, ax, (Get(sg, ax) > Get(source, ax) ? -1 : 1) * gapOffset);
                    else targetGapOffset = Set(targetGapOffset, ax, (Get(tg, ax) > Get(target, ax) ? -1 : 1) * gapOffset);
                }
            }
            if (sourcePos != targetPos)
            {
                var opposite = 1 - ax;
                var isSameDir = Get(sd, ax) == Get(td, opposite);
                var sourceGt = Get(sg, opposite) > Get(tg, opposite);
                var sourceLt = Get(sg, opposite) < Get(tg, opposite);
                var flip = (Get(sd, ax) == 1 && ((!isSameDir && sourceGt) || (isSameDir && sourceLt)))
                    || (Get(sd, ax) != 1 && ((!isSameDir && sourceLt) || (isSameDir && sourceGt)));
                if (flip) points = ax == 0 ? sourceTarget : targetSource;
            }
            var sgp = new Pt(sg.X + sourceGapOffset.X, sg.Y + sourceGapOffset.Y);
            var tgp = new Pt(tg.X + targetGapOffset.X, tg.Y + targetGapOffset.Y);
            var maxX = Math.Max(Math.Abs(sgp.X - points[0].X), Math.Abs(tgp.X - points[0].X));
            var maxY = Math.Max(Math.Abs(sgp.Y - points[0].Y), Math.Abs(tgp.Y - points[0].Y));
            // The label goes on the longest segment.
            if (maxX >= maxY)
            {
                cx = (sgp.X + tgp.X) / 2;
                cy = points[0].Y;
            }
            else
            {
                cx = points[0].X;
                cy = (sgp.Y + tgp.Y) / 2;
            }
        }
        var gappedSource = new Pt(sg.X + sourceGapOffset.X, sg.Y + sourceGapOffset.Y);
        var gappedTarget = new Pt(tg.X + targetGapOffset.X, tg.Y + targetGapOffset.Y);
        var route = new List<Pt> { source };
        if (gappedSource != points[0]) route.Add(gappedSource);
        route.AddRange(points);
        if (gappedTarget != points[^1]) route.Add(gappedTarget);
        route.Add(target);
        return (route, new Pt(cx, cy));
    }

    private static string Bend(Pt a, Pt b, Pt c, double size)
    {
        var bendSize = Math.Min(Math.Min(Distance(a, b) / 2, Distance(b, c) / 2), size);
        if ((a.X == b.X && b.X == c.X) || (a.Y == b.Y && b.Y == c.Y)) return $"L{N(b.X)} {N(b.Y)}";
        if (a.Y == b.Y)
        {
            // The first segment is horizontal.
            var xDir = a.X < c.X ? -1 : 1;
            var yDir = a.Y < c.Y ? 1 : -1;
            return $"L {N(b.X + bendSize * xDir)},{N(b.Y)}Q {N(b.X)},{N(b.Y)} {N(b.X)},{N(b.Y + bendSize * yDir)}";
        }
        var xd = a.X < c.X ? 1 : -1;
        var yd = a.Y < c.Y ? -1 : 1;
        return $"L {N(b.X)},{N(b.Y + bendSize * yd)}Q {N(b.X)},{N(b.Y)} {N(b.X + bendSize * xd)},{N(b.Y)}";
    }

    private static LinePath SmoothStep(BoxGeometry.Ports p, double borderRadius, double offset = 20, double stepPosition = 0.5)
    {
        var (points, center) = Route(p.From, p.FromSide, p.To, p.ToSide, offset, stepPosition);
        var data = $"M{N(points[0].X)} {N(points[0].Y)}";
        for (var i = 1; i < points.Count - 1; i++) data += Bend(points[i - 1], points[i], points[i + 1], borderRadius);
        data += $"L{N(points[^1].X)} {N(points[^1].Y)}";
        return new LinePath(data, center, p.To, Unit(points[^2], points[^1]));
    }
}
