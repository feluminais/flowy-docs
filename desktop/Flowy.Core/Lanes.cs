namespace Flowy.Core;

/// <summary>A box with the id its lane belongs to: the lanes of a pair are laid out from the shape with the smaller id (the way <see cref="Views.LineKey"/> orders a pair). <c>Edge</c> is the shape's outline (x0, y0, x1, y1, …), empty or null for the rectangle.</summary>
public sealed record LaneBox(string Id, Rect Rect, double[]? Edge);

/// <summary>
/// Where a line sits among the lines of its pair: <c>Lane</c> counts from 0 of <c>Lanes</c>, and the first <c>Back</c> of them run from the pair's later id to its earlier.
/// <c>Stack</c> lists the lanes that are trunks (several lines stacked as one, drawn with two hairlines behind them, so each takes <see cref="Lanes.TrunkExtra"/> more room), and
/// <c>Fan</c> how many lines are drawn at each lane: 1, or more for a trunk that is open, whose lines then fan out of its place (<c>Within</c> is the place of this line among them).
/// The three are null when a pair has none, so a pair of plain lanes is <c>(Lane, Lanes, Back)</c> as it always was. Two slots with the same numbers are the same slot.
/// </summary>
public readonly record struct LaneSlot(int Lane, int Lanes, int Back, IReadOnlyList<int>? Stack = null, IReadOnlyList<int>? Fan = null, int? Within = null)
{
    private static bool Same(IReadOnlyList<int>? a, IReadOnlyList<int>? b) => a is null || b is null ? a is null && b is null : a.SequenceEqual(b);

    public bool Equals(LaneSlot other) => Lane == other.Lane && Lanes == other.Lanes && Back == other.Back && Within == other.Within && Same(Stack, other.Stack) && Same(Fan, other.Fan);

    public override int GetHashCode() => HashCode.Combine(Lane, Lanes, Back, Within, Stack?.Count, Fan?.Count);
}

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
        var ends = Heads.EndsOfPath(Path) ?? throw new InvalidOperationException("a lane is made of M, L, Q and C");
        return new LinePath(Path, new Pt(X, Y), ends.End, ends.EndDir) { Start = ends.Start, StartDirection = ends.StartDir };
    }
}

/// <summary>A lane to be hit-tested: the points of its path at the pose on show, and the pair and the place among the pair's lanes it belongs to.</summary>
public sealed record HitLane(string Id, string Pair, int Lane, IReadOnlyList<Pt> Points);

/// <summary>
/// The lines of one pair of shapes where a project draws a line for each connection (<c>pairs: separate</c>, see <see cref="View.Strands"/>): where each one runs. They run as parallel
/// lanes, <see cref="Pitch"/> apart and centred on the line between the two shapes, from nothing but the order of the connections in the file and the geometry of the two shapes.
/// A port of src/core/lanes.ts, which both readers draw from.
///
/// Lanes follow the project's line style (<c>"straight"</c>, <c>"curved"</c> or <c>"angled"</c>). Straight lanes run parallel to the line between the shapes. Curved lanes are the curve a lone
/// line of the pair would be (React Flow's cubic between the middles of the two facing sides), moved along the sides. Angled lanes are the staircase a lone line would be, nested. Where a pair
/// has no such curve or staircase (its sides do not face each other, or there is no room between them), its lanes are straight in every style. A pair with one line is drawn as it always was.
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

    /// <summary>Most lanes drawn for one pair; more are folded into trunks by direction and kind (see <see cref="Trunks.FoldPair"/>).</summary>
    public const int Most = 8;

    /// <summary>The room a trunk (several lines stacked as one, see <see cref="Trunks"/>) takes beyond a lane's pitch: its two hairlines lie 3 px and 6 px behind it, on its outer side.</summary>
    public const double TrunkExtra = 6;

    /// <summary>How far behind a trunk the first of its two hairlines lies; the second lies twice as far.</summary>
    public const double HairlineGap = 3;

    /// <summary>Most lines a trunk opens into when its pair is selected; a trunk of more stays shut, and the panel lists its connections.</summary>
    public const int OpenMost = 12;

    /// <summary>The least lines of a pair at which they might not all fit across the shapes (three lanes need 30 px, which every shape has), so no pair with fewer is folded.</summary>
    public const int FoldFrom = 4;

    /// <summary>The words of the two items the key at the canvas foot has for lines side by side: a lane a step plays on among the others of its pair, and a trunk. Both readers say them.</summary>
    public const string KeyInUse = "In use";

    public const string KeyStacked = "Stacked lines";

    /// <summary>Number of segments a lane that is displaced is drawn in (it has one more point than that).</summary>
    public const int Samples = 24;

    /// <summary>
    /// The least room, along the way two facing sides look, between the middles of the two sides for a pair to run curved or right-angled; with less (or sides that do not face each other)
    /// its lanes run straight. A curve that short has no middle to speak of, and a staircase has no room for its turns.
    /// </summary>
    public const double MinRouteGap = 24;

    /// <summary>The most the lanes of a curved pair are moved along the sides, as a multiple of their offset: where the curve is steep it takes more than the offset to be a pitch apart across it.</summary>
    public const double KappaMax = 1.3;

    /// <summary>
    /// The least share of a pitch the lanes of a curved pair may be apart across the curve, which is in the middle, where the curve is steepest against the sides. With <see cref="KappaMax"/> it says how
    /// steep a curve may be: at least <c>GapLeast / KappaMax</c> of its middle must run the way out of the sides. A curve that runs nearly along the sides cannot be moved along them to make room,
    /// since its lanes would lie on top of one another, so the pair runs straight.
    /// </summary>
    public const double GapLeast = 0.4;

    /// <summary>The shortest run across (the middle leg of a staircase) a right-angled pair has: with less its lanes run straight.</summary>
    public const double AngleRun = 24;

    /// <summary>The corner radius of a right-angled lane before its offset is added or taken, at least.</summary>
    public const double Corner = 8;

    /// <summary>How much more than the widest offset of a pair the radius is, if that is more than <see cref="Corner"/>: the corner on the inside of the turn keeps at least this.</summary>
    public const double CornerAir = 6;

    /// <summary>The smallest radius a corner is rounded to; a corner between legs that are shorter is rounded to half the shorter.</summary>
    public const double CornerLeast = 2;

    /// <summary>How near the end of a side the outermost lane of a curved pair may be moved to: kappa is held to what leaves this much room.</summary>
    public const double SideAir = 3;

    /// <summary>How much of each leg a right-angled pair keeps for itself when its runs are squeezed together to fit across it: a run never gets nearer a shape than this.</summary>
    public const double LegAir = 6;

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

    /// <summary>Whether lines are drawn as lanes beside others: a slot of a pair of several lanes, or of a lane whose trunk is open and fans out into several lines.</summary>
    public static bool IsLaned(LaneSlot? slot) => slot is { } s && (s.Lanes > 1 || s.Fan is not null);

    /// <summary>
    /// The slot of each strand of a view, by strand id, in the order View.Strands has them. <c>Back</c> is how many lanes of the pair run from its later id to its earlier. A trunk
    /// (<see cref="Strand.Trunk"/>) is a lane that takes <see cref="TrunkExtra"/> more room (the <c>Stack</c> of its pair), and so is a lane that several strands share, which is a trunk that is
    /// open: its strands each have the lane of the trunk and fan out of it (the <c>Fan</c> of the pair, and the place of the strand among them, <c>Within</c>).
    /// </summary>
    public static OrderedDictionary<string, LaneSlot> SlotsOf(IReadOnlyList<Strand> strands)
    {
        var back = new Dictionary<string, SortedSet<int>>();
        var counts = new Dictionary<string, int[]>();
        var within = new Dictionary<string, int>();
        var stacked = new Dictionary<string, SortedSet<int>>();
        foreach (var s in strands)
        {
            if (string.CompareOrdinal(s.From, s.To) > 0)
            {
                if (!back.TryGetValue(s.Pair, out var lanes)) back[s.Pair] = lanes = [];
                lanes.Add(s.Lane);
            }
            if (!counts.TryGetValue(s.Pair, out var here)) counts[s.Pair] = here = new int[s.Lanes];
            within[s.Id] = here[s.Lane]++;
            if (s.Trunk is not null)
            {
                if (!stacked.TryGetValue(s.Pair, out var lanes)) stacked[s.Pair] = lanes = [];
                lanes.Add(s.Lane);
            }
        }
        var slots = new OrderedDictionary<string, LaneSlot>();
        foreach (var s in strands)
        {
            var fan = counts[s.Pair];
            var open = fan.Any(n => n > 1);
            var stack = new SortedSet<int>(stacked.GetValueOrDefault(s.Pair) ?? []);
            for (var lane = 0; lane < fan.Length; lane++)
                if (fan[lane] > 1) stack.Add(lane);
            slots[s.Id] = new LaneSlot(s.Lane, s.Lanes, back.TryGetValue(s.Pair, out var b) ? b.Count : 0, stack.Count == 0 ? null : [.. stack], open ? fan : null, open ? within[s.Id] : null);
        }
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

    /// <summary>The step out of a side of a shape: where a curved or right-angled line heads when it leaves by that side.</summary>
    private static Pt Out(Side side) => side switch
    {
        Side.Top => new Pt(0, -1),
        Side.Bottom => new Pt(0, 1),
        Side.Left => new Pt(-1, 0),
        _ => new Pt(1, 0),
    };

    /// <summary>
    /// The curve of a lone line between the middles of two facing sides: the first control point leaves the side straight out for half the gap, and the second arrives the same way.
    /// (React Flow's cubic with its curvature of 0.25: the control offset is half the distance when the other end is ahead.)
    /// </summary>
    private static (Pt P0, Pt P1, Pt P2, Pt P3) CurveOf(Pt from, Pt to, Side sideA, Side sideB, double gap)
    {
        var (outA, outB) = (Out(sideA), Out(sideB));
        var reach = gap / 2;
        return (from, new Pt(from.X + outA.X * reach, from.Y + outA.Y * reach), new Pt(to.X + outB.X * reach, to.Y + outB.Y * reach), to);
    }

    /// <summary>
    /// How much of the curve's middle runs along the way out of the sides (0 to 1): the component of its unit tangent there, 3/4 of (P3 + P2 - P1 - P0), along that way. 1 is a straight
    /// run between two sides; the smaller it is, the more of the middle runs along the sides, where the lanes are moved.
    /// </summary>
    private static double CurveSteepness(Pt from, Pt to, Side sideA, Side sideB, double gap)
    {
        var (p0, p1, p2, p3) = CurveOf(from, to, sideA, sideB, gap);
        var tx = 0.75 * (p3.X + p2.X - p1.X - p0.X);
        var ty = 0.75 * (p3.Y + p2.Y - p1.Y - p0.Y);
        return Math.Abs(Out(sideA).Y == 0 ? tx : ty) / Math.Sqrt(tx * tx + ty * ty);
    }

    /// <summary>
    /// How a pair of curved or right-angled lanes runs: between the middles of the two sides that face each other (<c>From</c> on the shape with the smaller id, <c>To</c> on the other), <c>Gap</c> apart
    /// along the way the sides look, and moved along the sides (<c>Lateral</c>, a unit step along them, to the same side as the pair's normal) to make room for the lanes side by side.
    /// </summary>
    private sealed record Route(Pt From, Pt To, Side SideA, Side SideB, double Gap, bool Horizontal, Pt Lateral);

    /// <summary>
    /// The route curved or angled lanes take between the shapes of <paramref name="f"/>, or null when they run straight: in the straight style, when the sides that face each other are not
    /// opposite or are less than <see cref="MinRouteGap"/> apart, and, for a right-angled pair, when the run across is shorter than <see cref="AngleRun"/>.
    /// </summary>
    private static Route? RouteOf(Frame f, string style)
    {
        if (style == "straight") return null;
        var p = BoxGeometry.PortsBetween(f.A.Rect, f.B.Rect, f.A.Edge, f.B.Edge);
        var (outward, back) = (Out(p.FromSide), Out(p.ToSide));
        if (outward.X + back.X != 0 || outward.Y + back.Y != 0) return null;
        var gap = (p.To.X - p.From.X) * outward.X + (p.To.Y - p.From.Y) * outward.Y;
        if (gap < MinRouteGap) return null;
        var horizontal = outward.Y == 0;
        if (style == "angled" && (horizontal ? Math.Abs(p.To.Y - p.From.Y) : Math.Abs(p.To.X - p.From.X)) < AngleRun) return null;
        if (style == "curved" && CurveSteepness(p.From, p.To, p.FromSide, p.ToSide, gap) * KappaMax < GapLeast) return null;
        var lateral = horizontal ? new Pt(0, f.N.Y >= 0 ? 1 : -1) : new Pt(f.N.X >= 0 ? 1 : -1, 0);
        return new Route(p.From, p.To, p.FromSide, p.ToSide, gap, horizontal, lateral);
    }

    /// <summary>The smaller half-room of the two shapes across the lanes of <paramref name="f"/>: along the normal for straight lanes, along the sides for the lanes of a route.</summary>
    private static double SpanOf(Frame f, Route? route)
    {
        var across = route?.Lateral ?? f.N;
        return Math.Min(HalfRoom(f.A, across), HalfRoom(f.B, across));
    }

    /// <summary>
    /// The smaller half-room of the two shapes of a pair across their lanes: how far each outline is from the line between the centres, along its normal, the nearer side of the nearer shape.
    /// In the curved and angled styles, where the pair has a curve or a staircase, the same measured along the sides the lanes are moved along.
    /// </summary>
    public static double RoomOf(LaneBox one, LaneBox other, string style = "straight")
    {
        var f = FrameOf(one, other);
        return SpanOf(f, RouteOf(f, style));
    }

    /// <summary>The gutter between the lanes of the two directions: only where there are lanes both ways.</summary>
    private static double GutterOf(LaneSlot slot) => slot.Back > 0 && slot.Lanes - slot.Back > 0 ? Gutter : 0;

    /// <summary>The room for lanes across a pair: twice the smaller half-room of the two shapes along <c>n</c>, less the margin each side.</summary>
    public static double UsableOf(double half) => 2 * (half - Margin);

    /// <summary>
    /// How many lanes fit across <paramref name="half"/> (the smaller half-room of the two shapes), at the usual pitch, and no more than <see cref="Most"/>. At least one. <paramref name="trunks"/> of them
    /// are trunks, which take <see cref="TrunkExtra"/> more room each: <c>min(8, floor((usable - gutter - 6 * trunks) / pitch) + 1)</c>.
    /// </summary>
    public static int LaneCapacity(double half, bool bothWays, int trunks = 0)
    {
        var fit = (int)Math.Floor((UsableOf(half) - (bothWays ? Gutter : 0) - TrunkExtra * trunks) / Pitch) + 1;
        return Math.Max(1, Math.Min(Most, fit));
    }

    /// <summary>The pitch for a pair: the usual one, or less when more lanes than fit across <paramref name="half"/> are drawn, so every lane still meets the outline (until trunks fold them, see <see cref="Trunks.FoldPair"/>).</summary>
    public static double PitchFor(double half, LaneSlot slot)
    {
        if (slot.Lanes < 2) return Pitch;
        return Math.Max(0, Math.Min(Pitch, (UsableOf(half) - GutterOf(slot) - TrunkExtra * (slot.Stack?.Count ?? 0)) / (slot.Lanes - 1)));
    }

    /// <summary>
    /// How far every lane of a pair sits to the right of the line between the centres (along <c>n</c>): the lanes are centred on it, in two groups with the gutter between. A trunk takes
    /// <see cref="TrunkExtra"/> more room on its outer side (the side away from the line between the centres; the right-hand one for a trunk on it), where its hairlines lie, so each lane beyond a trunk
    /// is moved that far out, and the bundle is centred again.
    /// </summary>
    public static double[] OffsetsOf(LaneSlot slot, double pitch = Pitch)
    {
        var gutter = GutterOf(slot);
        var raw = new double[slot.Lanes];
        for (var lane = 0; lane < slot.Lanes; lane++) raw[lane] = (lane - (slot.Lanes - 1) / 2.0) * pitch + (gutter == 0 ? 0 : lane < slot.Back ? -gutter / 2 : gutter / 2);
        if (slot.Stack is not { Count: > 0 } stack) return raw;
        var moved = new double[slot.Lanes];
        for (var lane = 0; lane < slot.Lanes; lane++)
        {
            var by = 0.0;
            foreach (var t in stack)
                if (t != lane) by += raw[t] >= 0 ? (lane > t ? TrunkExtra : 0) : lane < t ? -TrunkExtra : 0;
            moved[lane] = raw[lane] + by;
        }
        var middle = (moved.Max() + moved.Min()) / 2;
        return [.. moved.Select(o => o - middle)];
    }

    /// <summary>How far lane <c>slot.Lane</c> sits to the right of the line between the centres (along <c>n</c>), see <see cref="OffsetsOf"/>.</summary>
    public static double OffsetOf(LaneSlot slot, double pitch = Pitch)
    {
        if (slot.Stack is not { Count: > 0 })
        {
            var gutter = GutterOf(slot);
            var side = gutter == 0 ? 0 : slot.Lane < slot.Back ? -gutter / 2 : gutter / 2;
            return (slot.Lane - (slot.Lanes - 1) / 2.0) * pitch + side;
        }
        return OffsetsOf(slot, pitch)[slot.Lane];
    }

    /// <summary>
    /// The way a trunk's hairlines lie behind it: the unit step, along the normal of the pair, towards its outer side (see <see cref="OffsetsOf"/>), which the first hairline is <see cref="HairlineGap"/> out
    /// and the second twice as far. A trunk on the line between the centres lies towards the right-hand side. Rounded as the lanes are.
    /// </summary>
    public static Pt StackStep(LaneBox source, LaneBox target, LaneSlot slot)
    {
        var f = FrameOf(source, target);
        var outward = OffsetOf(slot) >= 0 ? 1 : -1;
        return new Pt(Round3(f.N.X * outward + 0), Round3(f.N.Y * outward + 0)); // + 0 turns a -0 into 0
    }

    /// <summary>How far the middle of a lane is moved at fraction <paramref name="t"/> of the way along: 1 in the middle, and 0 with no slope at both ends, so nothing near a shape moves.</summary>
    public static double Bulge(double t)
    {
        var m = t * (1 - t);
        return 16 * m * m;
    }

    private static string PointText(Pt p) => $"{JsCompat.Number(p.X)} {JsCompat.Number(p.Y)}";

    private static Pt Rounded(double x, double y) => new(Round3(x), Round3(y));

    /// <summary>The path through <paramref name="points"/>: short curves through their midpoints, so the lane is smooth and passes where the displaced line was sampled.</summary>
    private static string Chain(IReadOnlyList<Pt> points)
    {
        var last = points.Count - 1;
        var path = $"M{PointText(points[0])}";
        for (var i = 1; i < last; i++)
        {
            var next = points[i + 1];
            path += $"Q{PointText(points[i])} {PointText(Rounded((points[i].X + next.X) / 2, (points[i].Y + next.Y) / 2))}";
        }
        return $"{path}L{PointText(points[last])}";
    }

    /// <summary>
    /// The lane <paramref name="slot"/> of the pair between <paramref name="source"/> and <paramref name="target"/>, drawn from <paramref name="source"/> to <paramref name="target"/>, in <paramref name="pose"/> and in a line
    /// <paramref name="style"/>. A lane at rest is the straight line between the two points where its line (parallel to the line between the centres) meets the two outlines. A lane in another pose is the same
    /// line moved sideways by a field that is 0 at both ends and largest in the middle, written as 24 short curves, so the shapes and the heads never move. Every lane is moved by the same field in its own
    /// place, and the offset and the second term only grow with the lane's place, so the lanes keep their order: they never cross.
    /// In the curved and angled styles a pair whose sides face each other with room between them has curved or right-angled lanes instead (see <see cref="CurvedLane"/> and <see cref="AngledLane"/>); otherwise its
    /// lanes are straight, whatever the style.
    /// </summary>
    public static LaneLine LaneGeometry(LaneBox source, LaneBox target, LaneSlot slot, LanePose? pose = null, string style = "straight")
    {
        pose ??= LanePose.Rest;
        var f = FrameOf(source, target);
        var route = RouteOf(f, style);
        if (route is not null) return style == "curved" ? CurvedLane(f, route, source, slot, pose) : AngledLane(f, route, source, slot, pose);
        var pitch = PitchFor(SpanOf(f, null), slot);
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
        var middle = points[Samples / 2];
        return new LaneLine(Chain(points), middle.X, middle.Y, points);
    }

    /// <summary>A point of the cubic through <paramref name="p0"/>, <paramref name="c1"/>, <paramref name="c2"/>, <paramref name="p3"/> at <paramref name="t"/>.</summary>
    private static Pt CubicAt(double t, Pt p0, Pt c1, Pt c2, Pt p3)
    {
        var u = 1 - t;
        var (w0, w1, w2, w3) = (u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t);
        return new Pt(w0 * p0.X + w1 * c1.X + w2 * c2.X + w3 * p3.X, w0 * p0.Y + w1 * c1.Y + w2 * c2.Y + w3 * p3.Y);
    }

    /// <summary>
    /// A lane of a curved pair. The curve a lone line of the pair would be is React Flow's cubic between the middles of the two facing sides, leaving each side straight out for half the gap
    /// between them. Lane k is that curve with all four points moved along the sides, to the lane's side of the pair, by <c>offset * kappa</c>, where <c>kappa = min(KappaMax, 1 / |m|)</c> and <c>|m|</c>
    /// is how far the curve runs along the way out of the sides in its middle, which makes the lanes a pitch apart across the curve there, however steep it is. Where a shape's outline is not
    /// straight across the side the moved end is in the air or inside the shape, so the lane is joined to the outline by a short straight stub along the way out, and the curve itself stays
    /// the moved copy of the one curve.
    /// A pair that is not at rest moves each lane along the sides too, by the field of <see cref="LaneGeometry"/> (0 at both ends, so the ends and the stubs do not move).
    /// </summary>
    private static LaneLine CurvedLane(Frame f, Route route, LaneBox source, LaneSlot slot, LanePose pose)
    {
        var span = SpanOf(f, route);
        var pitch = PitchFor(span, slot);
        var offset = OffsetOf(slot, pitch);
        var (outA, outB) = (Out(route.SideA), Out(route.SideB));
        var widest = WidestOf(slot, pitch);
        var kappa = Math.Min(Math.Min(KappaMax, 1 / CurveSteepness(route.From, route.To, route.SideA, route.SideB, route.Gap)), widest == 0 ? double.PositiveInfinity : (span - SideAir) / widest);
        Pt Along(Pt c, double by) => new(c.X + route.Lateral.X * by, c.Y + route.Lateral.Y * by);
        var (c0, c1, c2, c3) = CurveOf(route.From, route.To, route.SideA, route.SideB, route.Gap);
        var (p0, p1, p2, p3) = (Along(c0, offset * kappa), Along(c1, offset * kappa), Along(c2, offset * kappa), Along(c3, offset * kappa));
        var (q0, q1, q2, q3) = (Rounded(p0.X, p0.Y), Rounded(p1.X, p1.Y), Rounded(p2.X, p2.Y), Rounded(p3.X, p3.Y));
        // Where the lane meets the outlines: the ray out of the shape from the lane's side of its middle. On a straight side that is the end of the curve itself.
        var exitA = BoxGeometry.LeaveAt(f.A.Rect, f.A.Edge, outA.X, outA.Y, Along(f.Ca, offset * kappa));
        var exitB = BoxGeometry.LeaveAt(f.B.Rect, f.B.Edge, outB.X, outB.Y, Along(f.Cb, offset * kappa));
        var (e0, e3) = (Rounded(exitA.X, exitA.Y), Rounded(exitB.X, exitB.Y));
        var (stubA, stubB) = (e0 != q0, e3 != q3);
        var sideways = Displacement(slot, pose, f.Length, pitch) * kappa;
        var samples = new Pt[Samples + 1];
        for (var i = 0; i <= Samples; i++)
        {
            double t = (double)i / Samples;
            var at = CubicAt(t, q0, q1, q2, q3);
            var away = Bulge(t) * sideways;
            samples[i] = i == 0 ? q0 : i == Samples ? q3 : Rounded(at.X + route.Lateral.X * away, at.Y + route.Lateral.Y * away);
        }
        // From the shape with the smaller id to the other; the lane runs the other way when it starts at the other shape.
        var forward = ReferenceEquals(source, f.A);
        var ordered = new List<Pt>();
        if (stubA) ordered.Add(e0);
        ordered.AddRange(samples);
        if (stubB) ordered.Add(e3);
        if (!forward) ordered.Reverse();
        if (sideways != 0)
        {
            var middle = samples[Samples / 2];
            return new LaneLine(Chain(ordered), middle.X, middle.Y, ordered);
        }
        Pt? head, tail;
        Pt from, first, second, to;
        if (forward) (head, from, first, second, to, tail) = (stubA ? e0 : null, q0, q1, q2, q3, stubB ? e3 : null);
        else (head, from, first, second, to, tail) = (stubB ? e3 : null, q3, q2, q1, q0, stubA ? e0 : null);
        var path = $"M{PointText(head ?? from)}{(head is not null ? $"L{PointText(from)}" : "")}C{PointText(first)} {PointText(second)} {PointText(to)}{(tail is { } t2 ? $"L{PointText(t2)}" : "")}";
        return new LaneLine(path, Round3((q0.X + 3 * q1.X + 3 * q2.X + q3.X) / 8), Round3((q0.Y + 3 * q1.Y + 3 * q2.Y + q3.Y) / 8), ordered);
    }

    /// <summary>
    /// The path through the corners of a right-angled lane, <c>radii[i - 1]</c> the radius of the corner at <c>vertices[i]</c>: straight legs, and each turn rounded by a quadratic curve that starts and
    /// ends that far from the corner (no more than half of either leg, and not under <see cref="CornerLeast"/>). A turn between two legs on a line is no turn. The points are the lane flattened.
    /// </summary>
    private static (string Path, List<Pt> Points) Staircase(IReadOnlyList<Pt> vertices, IReadOnlyList<double> radii)
    {
        var last = vertices.Count - 1;
        var path = $"M{PointText(vertices[0])}";
        var points = new List<Pt> { vertices[0] };
        for (var i = 1; i < last; i++)
        {
            var (p, b, q) = (vertices[i - 1], vertices[i], vertices[i + 1]);
            var (before, after) = (Math.Abs(b.X - p.X) + Math.Abs(b.Y - p.Y), Math.Abs(q.X - b.X) + Math.Abs(q.Y - b.Y));
            var radius = Math.Min(Math.Min(Math.Max(radii[i - 1], CornerLeast), before / 2), after / 2);
            if ((p.X == b.X && b.X == q.X) || (p.Y == b.Y && b.Y == q.Y) || !(radius > 0))
            {
                path += $"L{PointText(b)}";
                points.Add(b);
                continue;
            }
            var enter = Rounded(b.X - Sign(b.X - p.X) * radius, b.Y - Sign(b.Y - p.Y) * radius);
            var leave = Rounded(b.X + Sign(q.X - b.X) * radius, b.Y + Sign(q.Y - b.Y) * radius);
            path += $"L{PointText(enter)}Q{PointText(b)} {PointText(leave)}";
            points.Add(enter);
            foreach (var t in new[] { 0.25, 0.5, 0.75 })
            {
                var u = 1 - t;
                points.Add(Rounded(u * u * enter.X + 2 * u * t * b.X + t * t * leave.X, u * u * enter.Y + 2 * u * t * b.Y + t * t * leave.Y));
            }
            points.Add(leave);
        }
        points.Add(vertices[last]);
        return ($"{path}L{PointText(vertices[last])}", points);
    }

    /// <summary>
    /// A lane of a right-angled pair. The staircase a lone line of the pair would be goes out of the middle of one side, across to the middle of the way between the shapes, along the
    /// run, and across to the middle of the other side. Lane k leaves its side <c>offset</c> along it, to the lane's side of the pair, and its run is moved the same
    /// distance the other way (across the legs), so the lanes are nested staircases the same gap apart that never cross; where the legs are too short for that, the runs are squeezed
    /// together by the same factor, which keeps their order. A pair that is not at rest moves only the run, by the displacement of <see cref="LaneGeometry"/>, so the ends and the legs stay where they
    /// were. The corners are rounded to concentric arcs: the radius of the outer corner is the radius of the inner one plus the gap between them.
    /// </summary>
    private static LaneLine AngledLane(Frame f, Route route, LaneBox source, LaneSlot slot, LanePose pose)
    {
        var pitch = PitchFor(SpanOf(f, route), slot);
        var offset = OffsetOf(slot, pitch);
        var (outA, outB) = (Out(route.SideA), Out(route.SideB));
        Pt Moved(Pt c) => new(c.X + route.Lateral.X * offset, c.Y + route.Lateral.Y * offset);
        var exitA = BoxGeometry.LeaveAt(f.A.Rect, f.A.Edge, outA.X, outA.Y, Moved(f.Ca));
        var exitB = BoxGeometry.LeaveAt(f.B.Rect, f.B.Edge, outB.X, outB.Y, Moved(f.Cb));
        var (s, t) = (Rounded(exitA.X, exitA.Y), Rounded(exitB.X, exitB.Y));
        // Where the run of each lane is among the others: its offset and what the pose adds; all of them at once, to know how much room they need.
        // (an open trunk's lines each have a run of their own: lane by lane, and within a lane, line by line)
        var runs = Enumerable.Range(0, slot.Lanes).SelectMany(lane => Enumerable.Range(0, slot.Fan?[lane] ?? 1).Select(within =>
        {
            var there = slot with { Lane = lane, Within = slot.Fan is null ? slot.Within : within };
            return OffsetOf(there, pitch) + Displacement(there, pose, f.Length, pitch);
        })).ToArray();
        var widestRun = runs.Aggregate(0.0, (most, r) => Math.Max(most, Math.Abs(r)));
        var room = route.Gap / 2 - LegAir;
        var squeeze = widestRun <= room ? 1 : Math.Max(0, room) / widestRun;
        var run = squeeze * (offset + Displacement(slot, pose, f.Length, pitch));
        var (hx, hy) = (Sign(route.To.X - route.From.X), Sign(route.To.Y - route.From.Y));
        var radius = Math.Max(Corner, WidestOf(slot, pitch) + CornerAir);
        // The first and the second corner, by the gap between the lane's corner and the lone line's: the corner on the inside of a turn has the smaller radius.
        var turn = hx * hy * offset;
        Pt[] vertices;
        double[] radii;
        Pt anchor;
        if (route.Horizontal)
        {
            var x = Round3((route.From.X + route.To.X) / 2 - hy * run);
            vertices = [s, new Pt(x, s.Y), new Pt(x, t.Y), t];
            radii = [radius - turn, radius + turn];
            anchor = new Pt(x, Round3((s.Y + t.Y) / 2));
        }
        else
        {
            var y = Round3((route.From.Y + route.To.Y) / 2 + hx * run);
            vertices = [s, new Pt(s.X, y), new Pt(t.X, y), t];
            radii = [radius + turn, radius - turn];
            anchor = new Pt(Round3((s.X + t.X) / 2), y);
        }
        if (!ReferenceEquals(source, f.A))
        {
            Array.Reverse(vertices);
            Array.Reverse(radii);
        }
        var (path, points) = Staircase(vertices, radii);
        return new LaneLine(path, anchor.X, anchor.Y, points);
    }

    private static double Sign(double x) => x > 0 ? 1 : x < 0 ? -1 : 0;

    /// <summary>How far the outermost lane of a pair is from the line between the centres. The lanes are centred, so it is the same either side.</summary>
    private static double WidestOf(LaneSlot slot, double pitch)
    {
        var widest = 0.0;
        for (var k = 0; k < slot.Lanes; k++) widest = Math.Max(widest, Math.Abs(OffsetOf(slot with { Lane = k }, pitch)));
        return widest;
    }

    /// <summary>
    /// How far the middle of lane <c>slot.Lane</c> is moved along <c>n</c> in <paramref name="pose"/>, for a pair whose shapes are <paramref name="length"/> apart and whose lanes are
    /// <paramref name="pitch"/> apart: the widening of a spread pair plus the gap opened beside each lit lane. 0 for a pair at rest, and for a single line.
    /// </summary>
    public static double Displacement(LaneSlot slot, LanePose pose, double length, double pitch)
    {
        if (slot.Lanes < 2 && slot.Fan is null && pose.Lam.All(l => l == 0)) return 0;
        var offset = OffsetOf(slot, pitch);
        var spread = Math.Min(SpreadPitch / pitch, 1 + 0.2 * length / (WidestOf(slot, pitch) + Pitch));
        var gap = Math.Min(18, 0.2 * length);
        var parted = 0.0;
        for (var j = 0; j < pose.Lam.Count; j++) parted += pose.Lam[j] * Sign(slot.Lane - j);
        return (spread - 1) * pose.S * offset + gap * parted + Fanned(slot);
    }

    /// <summary>
    /// How far an open trunk moves the middle of a lane along <c>n</c>: its own lines fan out of its place, a <see cref="Pitch"/> apart and centred on it (the line's <c>Within</c> among the <c>Fan</c> of the lane),
    /// and the lanes beside it are moved away by the half of the fan on their side. A pair with no open trunk has none. The ends of every lane stay where they were, so the lines of an open
    /// trunk meet at its ends, and the field is monotone in the lane, so nothing crosses.
    /// </summary>
    private static double Fanned(LaneSlot slot)
    {
        if (slot.Fan is not { } fan) return 0;
        var by = ((slot.Within ?? 0) - (fan[slot.Lane] - 1) / 2.0) * Pitch;
        for (var j = 0; j < fan.Count; j++)
            if (j != slot.Lane) by += Sign(slot.Lane - j) * (fan[j] - 1) * Pitch / 2;
        return by;
    }

    /// <summary>
    /// The clear space left on each side of a lit lane in the middle of its pair while a step plays on it: the usual pitch plus the gap <see cref="Displacement"/> opens (18 px at most). The most
    /// the marks of an outcome (a bar, a clock, a puff) may reach is held to what the gap there leaves (see <see cref="MarkReach"/>).
    /// </summary>
    public const double PartClear = 30;

    /// <summary>How long the lanes take to move from one lit lane to another, or to close when the stop is left (ms), and to part from wherever they are when the player jumps (ms).</summary>
    public const double ShiftMs = 195;

    public const double JumpMs = 225;

    /// <summary>How faded the lines of a pair are that the step does not ride, while a step plays on the pair: more than the lines of other pairs (0.15), less than the lanes of the flow's other branches (0.55).</summary>
    public const double KinOpacity = 0.35;

    /// <summary>How much of its strength a lit lane keeps once its step has timed out, where it has neighbours: never fainter than they are (0.35), so more than the 0.25 a lone line fades to.</summary>
    public const double LitFloorLanes = 0.5;

    /// <summary>The easings of a parting: <c>Out</c> is a cubic that starts fast and settles, <c>Smooth</c> the smoothstep.</summary>
    public enum PartEasing { Out, Smooth }

    /// <summary>
    /// How a pair's lanes go from one pose to the next over a stop: <c>From</c> and <c>To</c> say how lit each lane is (the <c>Lam</c> of a pose; 1 for a lane a step rides) when the stop begins and
    /// once it has settled. Between <c>At</c> and <c>At + Dur</c> ms of the stop they move from one to the other, <c>Out</c> slowing down towards the end (a first parting), <c>Smooth</c> slow at both
    /// ends (from one lit lane to another, or back to rest). The pair holds <c>To</c> from then until the stop is left, through every rest of a repeat. The pose is a pure function of this
    /// and of the player's clock (see <see cref="PoseAt"/>), so pausing, scrubbing and the speed all work, and a fixture can pin any moment.
    /// </summary>
    public sealed record Parting(IReadOnlyList<double> From, IReadOnlyList<double> To, double At, double Dur, PartEasing Ease);

    /// <summary>How far an ease has come at <paramref name="p"/> (0 to 1). Multiplications only.</summary>
    public static double PartEase(PartEasing kind, double p)
    {
        if (kind == PartEasing.Out)
        {
            var q = 1 - p;
            return 1 - q * q * q;
        }
        return p * p * (3 - 2 * p);
    }

    /// <summary>The pose of a pair <paramref name="clock"/> ms into the stop: how lit each lane is, between <c>From</c> and <c>To</c>. Never spread (a step playing on a pair wins over its selection).</summary>
    public static LanePose PoseAt(Parting parting, double clock)
    {
        var p = parting.Dur <= 0 ? 1 : Math.Min(1, Math.Max(0, (clock - parting.At) / parting.Dur));
        var e = PartEase(parting.Ease, p);
        var n = Math.Max(parting.From.Count, parting.To.Count);
        var lam = new double[n];
        for (var j = 0; j < n; j++)
        {
            var (before, after) = (j < parting.From.Count ? parting.From[j] : 0, j < parting.To.Count ? parting.To[j] : 0);
            lam[j] = Round3(before + (after - before) * e);
        }
        return lam.All(l => l == 0) ? LanePose.Rest : new LanePose(0, lam);
    }

    private static bool Unlit(IReadOnlyList<double> lam) => lam.All(l => l == 0);

    /// <summary>
    /// How the lanes of a pair go from how lit they are (<paramref name="before"/>, what is on screen now) to how lit the stop on show wants them (<paramref name="lit"/>).
    /// <paramref name="jump"/>: the player went somewhere other than the next stop or the one before (a scrub, another flow): from where they are, over <see cref="JumpMs"/>, easing out, from the start of the stop.
    /// From rest to a lit lane: at the step's <c>part</c> beat (<paramref name="beat"/>; at once when it has none), over its length, easing out.
    /// Otherwise (from one lit lane to another, or back to rest): at the start of the stop, over <see cref="ShiftMs"/>, smooth. The pair never closes between two steps that ride it.
    /// </summary>
    public static Parting PartingFor(IReadOnlyList<double> before, IReadOnlyList<double> lit, (double At, double Dur)? beat = null, bool jump = false)
    {
        if (jump) return new Parting(before, lit, 0, JumpMs, PartEasing.Out);
        if (Unlit(before) && !Unlit(lit)) return new Parting(before, lit, beat?.At ?? 0, beat?.Dur ?? JumpMs, PartEasing.Out);
        return new Parting(before, lit, 0, ShiftMs, PartEasing.Smooth);
    }

    /// <summary>
    /// For each pair that has several lines and one that a step of the stop rides (<paramref name="lit"/> lists the ids of the strands the stop's steps ride), how lit each of its lanes is: 1 for a
    /// lane a step rides, 0 for the others. Every lit lane of a stop is lit at once, so an event to several subscribers on one pair opens the gaps for all of them together.
    /// </summary>
    public static OrderedDictionary<string, double[]> LitLanes(IReadOnlyList<Strand> strands, IEnumerable<string> lit)
    {
        var made = new OrderedDictionary<string, double[]>();
        var riding = lit.ToHashSet();
        foreach (var s in strands)
        {
            if (s.Lanes < 2 || !riding.Contains(s.Id)) continue;
            if (!made.TryGetValue(s.Pair, out var lam)) made[s.Pair] = lam = new double[s.Lanes];
            lam[s.Lane] = 1;
        }
        return made;
    }

    /// <summary>The pitch and the distance between the shapes of a pair of boxes the lane <paramref name="slot"/> is among: what a pose and the marks need to say where the neighbours of a lane are.</summary>
    private static (double Pitch, double Length) LayoutOf(LaneBox source, LaneBox target, LaneSlot slot, string style)
    {
        var f = FrameOf(source, target);
        return (PitchFor(SpanOf(f, RouteOf(f, style)), slot), f.Length);
    }

    /// <summary>
    /// The distance across, at fraction <paramref name="t"/> (0 to 1) of the way along a lane, from the lane <paramref name="slot"/> to the nearest of its neighbours in <paramref name="pose"/>, in
    /// pixels: the pitch at both ends and more in the middle where a lit lane has opened a gap beside it (<see cref="PartClear"/> beside a lit lane). Infinity for a lane with no neighbour. The marks
    /// of an outcome use it to stay clear of the lines beside.
    /// </summary>
    public static double GapBeside(LaneBox source, LaneBox target, LaneSlot slot, LanePose pose, double t, string style = "straight")
    {
        if (slot.Lanes < 2) return double.PositiveInfinity;
        var (pitch, length) = LayoutOf(source, target, slot, style);
        double At(int lane)
        {
            var mine = slot with { Lane = lane };
            return OffsetOf(mine, pitch) + Bulge(t) * Displacement(mine, pose, length, pitch);
        }
        var here = At(slot.Lane);
        var gap = double.PositiveInfinity;
        if (slot.Lane > 0) gap = Math.Min(gap, here - At(slot.Lane - 1));
        if (slot.Lane < slot.Lanes - 1) gap = Math.Min(gap, At(slot.Lane + 1) - here);
        return Round3(gap);
    }

    /// <summary>
    /// How far a mark may reach from the lane it sits on, given the <paramref name="gap"/> to the nearest neighbour there: its own half-extent <paramref name="half"/> (a bar's 22, a clock's 24, a puff's 40)
    /// held to what the gap leaves, less 3 px of air, and never below 6 so it stays a mark. A lane with no neighbour (a gap of Infinity) keeps its whole extent.
    /// </summary>
    public static double MarkReach(double half, double gap) => double.IsPositiveInfinity(gap) ? half : Round3(Math.Min(half, Math.Max(6, gap - 3)));

    /// <summary>
    /// How far from the lit lane a mark that hangs off it (the marker of whoever takes an intercepted request) must stand to clear every other lane of the bundle: the widest lane offset from the
    /// middle plus the gap a lit lane opens. 0 for a lane with no neighbours.
    /// </summary>
    public static double BundleReach(LaneBox source, LaneBox target, LaneSlot slot, string style = "straight")
    {
        if (slot.Lanes < 2) return 0;
        var (pitch, length) = LayoutOf(source, target, slot, style);
        return Round3(WidestOf(slot, pitch) + Math.Min(18, 0.2 * length));
    }

    /// <summary>How far ahead of the pattern, in pixels, the dots of a stream on a lane start: lane * 12.1 / lanes, so the streams of neighbouring lanes do not march in step (the pattern repeats every 12 px).</summary>
    public static double DashPhase(int lane, int lanes) => Round3(lane * 12.1 / lanes);

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
