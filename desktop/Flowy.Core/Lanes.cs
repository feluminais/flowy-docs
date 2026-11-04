namespace Flowy.Core;

/// <summary>A box with the id its lane belongs to: the lanes of a pair are laid out from the shape with the smaller id (the way <see cref="Views.LineKey"/> orders a pair). <c>Edge</c> is the shape's outline (x0, y0, x1, y1, …), empty or null for the rectangle.</summary>
public sealed record LaneBox(string Id, Rect Rect, double[]? Edge);

/// <summary>Where a line sits among the lines of its pair: <c>Lane</c> counts from 0 of <c>Lanes</c>, and the first <c>Back</c> of them run from the pair's later id to its earlier.</summary>
public readonly record struct LaneSlot(int Lane, int Lanes, int Back);

/// <summary>
/// What a pair of lanes is doing: <c>S</c> is how far it is spread (0 to 1), and <c>Lam[j]</c> how lit its lane j is (0 to 1; the lane around which the others part).
/// A pose is a value: two poses with the same numbers are the same pose.
/// </summary>
public sealed record LanePose(double S, IReadOnlyList<double> Lam)
{
    /// <summary>Nothing selected and nothing playing.</summary>
    public static readonly LanePose Rest = new(0, []);

    /// <summary>The pair is selected, or a shape on it, or keyboard focus is on one of its lines: the lanes widen to a pitch that fits their labels.</summary>
    public static readonly LanePose Spread = new(1, []);

    /// <summary>Whether this is the pose of a pair at rest: not spread, and no lane lit.</summary>
    public bool IsRest => ReferenceEquals(this, Rest) || (S == 0 && Lam.All(l => l == 0));
}

/// <summary>A lane: the SVG path from its first shape to its second, the points it is made of (the flattened path), and its anchor, the middle of the line, where its label sits.</summary>
public sealed record LaneLine(string Path, double X, double Y, IReadOnlyList<Pt> Points)
{
    /// <summary>The lane as the canvas draws any line: its path, where its label sits, and where it ends and which way it points there, for the arrowheads.</summary>
    public LinePath AsLinePath()
    {
        var ends = Heads.EndsOfPath(Path) ?? throw new InvalidOperationException("a lane is made of M, L and Q");
        return new LinePath(Path, new Pt(X, Y), ends.End, ends.EndDir) { Start = ends.Start, StartDirection = ends.StartDir };
    }
}

/// <summary>A lane to be hit-tested: the points of its path at the pose on show, and the pair and the place among the pair's lanes it belongs to.</summary>
public sealed record HitLane(string Id, string Pair, int Lane, IReadOnlyList<Pt> Points);

/// <summary>
/// The lines of one pair of shapes where a project draws a line for each connection (<c>pairs: separate</c>, see <see cref="View.Strands"/>): where each one runs. They run as parallel
/// lanes, <see cref="Pitch"/> apart and centred on the line between the two shapes, from nothing but the order of the connections in the file and the geometry of the two shapes.
/// A port of src/core/lanes.ts, which both readers draw from. Only straight lanes so far.
///
/// The module uses <c>+ - * /</c>, <c>Sqrt</c> and comparisons only, and every number it hands out is rounded with <see cref="Round3"/>, so it lands on the browser's numbers: no hypot,
/// trigonometry or pow (a test looks for them).
/// </summary>
public static class Lanes
{
    /// <summary>The distance between lanes side by side, in pixels.</summary>
    public const double Pitch = 12;

    /// <summary>The extra space between the lanes that run one way and the lanes that run the other.</summary>
    public const double Gutter = 6;

    /// <summary>How far inside a shape's outline the outermost lane stays.</summary>
    public const double Margin = 10;

    /// <summary>Most lanes drawn for one pair; more are folded into trunks by direction and kind (a later phase).</summary>
    public const int Most = 8;

    /// <summary>Number of segments a lane that is displaced is drawn in (it has one more point than that).</summary>
    public const int Samples = 24;

    /// <summary>The pitch in the middle of a pair that is spread, at most.</summary>
    public const double SpreadPitch = 22;

    /// <summary>How far from a lane a pointer still means that lane, at most, in screen pixels (see <see cref="NearestStrand"/>: the same distance at any zoom).</summary>
    public const double Reach = 7;

    /// <summary>
    /// The width, in screen pixels, of the strip a line takes clicks in where its pair has several lines: the reach on each side of it. A lone line keeps the usual 20. It is 14, not the 12 of
    /// the lanes' rest pitch: the strip only says which lines to ask <see cref="NearestStrand"/> about, and that accepts a pointer up to <see cref="Reach"/> from a lane. The desktop has no strips, only that function.
    /// </summary>
    public const double HitWidth = 2 * Reach;

    /// <summary>How long a pair takes to spread, and to close again, in milliseconds. Reduced motion snaps.</summary>
    public const double SpreadMs = 160;

    /// <summary>How faded the other lanes of a pair are while one of them is pointed at (the lane pointed at is drawn above them, in the accent).</summary>
    public const double SiblingOpacity = 0.85;

    /// <summary>The words on the two buttons that move a connection in the order of its pair's lines, and the reason on one that cannot move. Both readers say them.</summary>
    public const string MoveUp = "Move up";

    public const string MoveDown = "Move down";

    public const string AlreadyFirst = "Already first";

    public const string AlreadyLast = "Already last";

    /// <summary>The reason on both buttons of a connection with no other connection going its way: it can move neither. The buttons stay and grey out, they are never hidden.</summary>
    public const string OnlyLineThisWay = "Only line this way";

    /// <summary>
    /// How far a pair has gone from one pose towards the other after <paramref name="ms"/> more milliseconds: <paramref name="progress"/> is 0 for rest and 1 for spread, and it moves to
    /// <paramref name="goal"/> (0 or 1) at the same speed either way, so a pair that is turned round half way goes back from where it is, with no jump.
    /// </summary>
    public static double SpreadProgress(double progress, double goal, double ms)
    {
        var step = ms / SpreadMs;
        return goal > progress ? Math.Min(goal, progress + step) : Math.Max(goal, progress - step);
    }

    /// <summary>The <c>s</c> of a pose for a pair that is <paramref name="progress"/> of the way to spread: slow at both ends and quick between, so the lanes do not start or stop with a jolt.</summary>
    public static double EasedSpread(double progress) => progress * progress * (3 - 2 * progress);

    /// <summary>A number to three decimals, the way both readers round: half up, whatever the sign (<c>Math.round</c> and C#'s <c>Math.Round</c> differ on halves).</summary>
    public static double Round3(double x) => Math.Floor(x * 1000 + 0.5) / 1000;

    /// <summary>The slot of each strand of a view, by strand id, in the order View.Strands has them. <c>Back</c> is how many strands of the pair run from its later id to its earlier.</summary>
    public static OrderedDictionary<string, LaneSlot> SlotsOf(IReadOnlyList<Strand> strands)
    {
        var back = new Dictionary<string, int>();
        foreach (var s in strands)
            if (string.CompareOrdinal(s.From, s.To) > 0) back[s.Pair] = back.GetValueOrDefault(s.Pair) + 1;
        var slots = new OrderedDictionary<string, LaneSlot>();
        foreach (var s in strands) slots[s.Id] = new LaneSlot(s.Lane, s.Lanes, back.GetValueOrDefault(s.Pair));
        return slots;
    }

    private static Pt CentreOf(Rect r) => new(r.X + r.Width / 2, r.Y + r.Height / 2);

    /// <summary>The line between two shapes of a pair: A is the one with the smaller id, <c>U</c> points from A to B, <c>N</c> is <c>U</c> turned a quarter clockwise on the screen (to the right of the way from A to B).</summary>
    private sealed record Frame(LaneBox A, LaneBox B, Pt Ca, Pt Cb, double Length, Pt U, Pt N);

    private static Frame FrameOf(LaneBox one, LaneBox other)
    {
        var (a, b) = string.CompareOrdinal(one.Id, other.Id) < 0 ? (one, other) : (other, one);
        var (ca, cb) = (CentreOf(a.Rect), CentreOf(b.Rect));
        var dx = cb.X - ca.X;
        var dy = cb.Y - ca.Y;
        var length = Math.Sqrt(dx * dx + dy * dy);
        var u = length < 1e-6 ? new Pt(1, 0) : new Pt(dx / length, dy / length);
        return new Frame(a, b, ca, cb, length, u, new Pt(-u.Y, u.X));
    }

    /// <summary>How far from the centre of <paramref name="box"/> its outline is along <paramref name="n"/> and against it, the nearer of the two.</summary>
    private static double HalfRoom(LaneBox box, Pt n)
    {
        var c = CentreOf(box.Rect);
        double Along(double sign)
        {
            var p = BoxGeometry.LeaveAt(box.Rect, box.Edge, n.X * sign, n.Y * sign);
            var dx = p.X - c.X;
            var dy = p.Y - c.Y;
            return Math.Sqrt(dx * dx + dy * dy);
        }
        return Math.Min(Along(1), Along(-1));
    }

    /// <summary>The smaller half-room of the two shapes of a pair across their lanes: how far each outline is from the line between the centres, along its normal, the nearer side of the nearer shape.</summary>
    public static double RoomOf(LaneBox one, LaneBox other)
    {
        var f = FrameOf(one, other);
        return Math.Min(HalfRoom(f.A, f.N), HalfRoom(f.B, f.N));
    }

    /// <summary>The gutter between the lanes of the two directions: only where there are lanes both ways.</summary>
    private static double GutterOf(LaneSlot slot) => slot.Back > 0 && slot.Lanes - slot.Back > 0 ? Gutter : 0;

    /// <summary>The room for lanes across a pair: twice the smaller half-room of the two shapes along <c>n</c>, less the margin each side.</summary>
    public static double UsableOf(double half) => 2 * (half - Margin);

    /// <summary>How many lanes fit across <paramref name="half"/> (the smaller half-room of the two shapes), at the usual pitch, and no more than <see cref="Most"/>. At least one.</summary>
    public static int LaneCapacity(double half, bool bothWays)
    {
        var fit = (int)Math.Floor((UsableOf(half) - (bothWays ? Gutter : 0)) / Pitch) + 1;
        return Math.Max(1, Math.Min(Most, fit));
    }

    /// <summary>The pitch for a pair: the usual one, or less when more lanes than fit across <paramref name="half"/> are drawn, so every lane still meets the outline (until trunks fold them).</summary>
    public static double PitchFor(double half, LaneSlot slot)
    {
        if (slot.Lanes < 2) return Pitch;
        return Math.Max(0, Math.Min(Pitch, (UsableOf(half) - GutterOf(slot)) / (slot.Lanes - 1)));
    }

    /// <summary>How far lane <c>slot.Lane</c> sits to the right of the line between the centres (along <c>n</c>): the lanes are centred on it, in two groups with the gutter between.</summary>
    public static double OffsetOf(LaneSlot slot, double pitch = Pitch)
    {
        var gutter = GutterOf(slot);
        var side = gutter == 0 ? 0 : slot.Lane < slot.Back ? -gutter / 2 : gutter / 2;
        return (slot.Lane - (slot.Lanes - 1) / 2.0) * pitch + side;
    }

    /// <summary>How far the middle of a lane is moved at fraction <paramref name="t"/> of the way along: 1 in the middle, and 0 with no slope at both ends, so nothing near a shape moves.</summary>
    public static double Bulge(double t)
    {
        var m = t * (1 - t);
        return 16 * m * m;
    }

    private static string PointText(Pt p) => $"{JsCompat.Number(p.X)} {JsCompat.Number(p.Y)}";

    private static Pt Rounded(double x, double y) => new(Round3(x), Round3(y));

    /// <summary>
    /// The lane <paramref name="slot"/> of the pair between <paramref name="source"/> and <paramref name="target"/>, drawn from <paramref name="source"/> to <paramref name="target"/>, in <paramref name="pose"/>.
    /// A lane at rest is the straight line between the two points where its line (parallel to the line between the centres) meets the two outlines. A lane in another pose is the same line moved
    /// sideways by a field that is 0 at both ends and largest in the middle, written as 24 short curves, so the shapes and the heads never move. Every lane is moved by the same field in its own
    /// place, and the offset and the second term only grow with the lane's place, so the lanes keep their order: they never cross.
    /// </summary>
    public static LaneLine LaneGeometry(LaneBox source, LaneBox target, LaneSlot slot, LanePose? pose = null)
    {
        pose ??= LanePose.Rest;
        var f = FrameOf(source, target);
        var half = Math.Min(HalfRoom(f.A, f.N), HalfRoom(f.B, f.N));
        var pitch = PitchFor(half, slot);
        var offset = OffsetOf(slot, pitch);
        var exitA = BoxGeometry.LeaveAt(f.A.Rect, f.A.Edge, f.U.X, f.U.Y, new Pt(f.Ca.X + f.N.X * offset, f.Ca.Y + f.N.Y * offset));
        var exitB = BoxGeometry.LeaveAt(f.B.Rect, f.B.Edge, -f.U.X, -f.U.Y, new Pt(f.Cb.X + f.N.X * offset, f.Cb.Y + f.N.Y * offset));
        var (from, to) = ReferenceEquals(source, f.A) ? (exitA, exitB) : (exitB, exitA);
        var start = Rounded(from.X, from.Y);
        var end = Rounded(to.X, to.Y);
        var sideways = Displacement(slot, pose, f.Length, pitch);
        if (sideways == 0)
            return new LaneLine($"M{PointText(start)}L{PointText(end)}", Round3((start.X + end.X) / 2), Round3((start.Y + end.Y) / 2), [start, end]);
        // The same field for every lane: the middle of this lane is `sideways` along n, and the points before and after it follow Bulge(t).
        var points = new Pt[Samples + 1];
        for (var i = 0; i <= Samples; i++)
        {
            double t = (double)i / Samples;
            var moved = Bulge(t) * sideways;
            points[i] = i == 0 ? start : i == Samples ? end : Rounded(start.X + (end.X - start.X) * t + f.N.X * moved, start.Y + (end.Y - start.Y) * t + f.N.Y * moved);
        }
        var path = $"M{PointText(points[0])}";
        for (var i = 1; i < Samples; i++)
        {
            var next = points[i + 1];
            path += $"Q{PointText(points[i])} {PointText(Rounded((points[i].X + next.X) / 2, (points[i].Y + next.Y) / 2))}";
        }
        path += $"L{PointText(points[Samples])}";
        var middle = points[Samples / 2];
        return new LaneLine(path, middle.X, middle.Y, points);
    }

    private static double Sign(double x) => x > 0 ? 1 : x < 0 ? -1 : 0;

    /// <summary>
    /// How far the middle of lane <c>slot.Lane</c> is moved along <c>n</c> in <paramref name="pose"/>, for a pair whose shapes are <paramref name="length"/> apart and whose lanes are
    /// <paramref name="pitch"/> apart: the widening of a spread pair plus the gap opened beside each lit lane. 0 for a pair at rest, and for a single line.
    /// </summary>
    public static double Displacement(LaneSlot slot, LanePose pose, double length, double pitch)
    {
        if (slot.Lanes < 2 && pose.Lam.All(l => l == 0)) return 0;
        var offset = OffsetOf(slot, pitch);
        var widest = 0.0;
        for (var k = 0; k < slot.Lanes; k++) widest = Math.Max(widest, Math.Abs(OffsetOf(slot with { Lane = k }, pitch)));
        var spread = Math.Min(SpreadPitch / pitch, 1 + 0.2 * length / (widest + Pitch));
        var gap = Math.Min(18, 0.2 * length);
        var parted = 0.0;
        for (var j = 0; j < pose.Lam.Count; j++) parted += pose.Lam[j] * Sign(slot.Lane - j);
        return (spread - 1) * pose.S * offset + gap * parted;
    }

    private static (double Distance, Pt Point) NearestOn(IReadOnlyList<Pt> points, Pt at)
    {
        var best = (Distance: double.PositiveInfinity, Point: points[0]);
        for (var i = 0; i + 1 < points.Count; i++)
        {
            var (p, q) = (points[i], points[i + 1]);
            var dx = q.X - p.X;
            var dy = q.Y - p.Y;
            var lengthSquared = dx * dx + dy * dy;
            var along = lengthSquared == 0 ? 0 : Math.Max(0, Math.Min(1, ((at.X - p.X) * dx + (at.Y - p.Y) * dy) / lengthSquared));
            var point = new Pt(p.X + dx * along, p.Y + dy * along);
            var ex = at.X - point.X;
            var ey = at.Y - point.Y;
            var distance = Math.Sqrt(ex * ex + ey * ey);
            if (distance < best.Distance) best = (distance, point);
        }
        if (points.Count == 1)
        {
            var ex = at.X - points[0].X;
            var ey = at.Y - points[0].Y;
            best = (Math.Sqrt(ex * ex + ey * ey), points[0]);
        }
        return best;
    }

    /// <summary>The distance from <paramref name="at"/> to the polyline <paramref name="points"/> (the points a lane is made of).</summary>
    public static double DistanceTo(IReadOnlyList<Pt> points, Pt at) => NearestOn(points, at).Distance;

    /// <summary>
    /// The lane a pointer at <paramref name="at"/> means, or null when it is near none: the lane whose line is nearest, within <c>min(Reach, half the space to its nearest neighbour in the pair + 1)</c>.
    /// Lanes that are equally near go to the lower lane. The space to the neighbour is measured from the nearest point of the lane, so where the lanes of a curve crowd together the strips shrink with them.
    /// <paramref name="canvasLanes"/> and <paramref name="canvasAt"/> are in canvas units and <paramref name="zoom"/> is how many screen pixels one canvas unit is: the distances above are in screen pixels,
    /// so a line a pointer is 7 pixels from is picked at any zoom, and zoomed out, where the lanes are close on screen, the strips shrink with them.
    /// </summary>
    public static string? NearestStrand(IReadOnlyList<HitLane> canvasLanes, Pt canvasAt, double zoom = 1)
    {
        var lanes = zoom == 1 ? canvasLanes : canvasLanes.Select(l => l with { Points = l.Points.Select(p => new Pt(p.X * zoom, p.Y * zoom)).ToList() }).ToList();
        var at = zoom == 1 ? canvasAt : new Pt(canvasAt.X * zoom, canvasAt.Y * zoom);
        (string Id, int Lane, double Distance)? best = null;
        foreach (var lane in lanes)
        {
            var (distance, point) = NearestOn(lane.Points, at);
            if (distance > Reach) continue;
            var gap = double.PositiveInfinity;
            foreach (var other in lanes)
                if (other.Pair == lane.Pair && other.Id != lane.Id) gap = Math.Min(gap, NearestOn(other.Points, point).Distance);
            if (distance > Math.Min(Reach, gap / 2 + 1)) continue;
            if (best is null || distance < best.Value.Distance - 1e-9 || (Math.Abs(distance - best.Value.Distance) <= 1e-9 && lane.Lane < best.Value.Lane)) best = (lane.Id, lane.Lane, distance);
        }
        return best?.Id;
    }
}
