namespace Flowy.Core;

/// <summary>
/// The maths for drawing a step's beats: a port of ui/src/motion.ts, with the same names and numbers. Nothing here draws, so the
/// tests can run it where the app can't rasterise. desktop/fixtures/beats.ts keeps the two equal.
/// </summary>
public static class MotionMath
{
    /// <summary>How long Autoplay rests after a step has finished moving, in ms.</summary>
    public const double Gap = 900;

    /// <summary>How long Autoplay stays on a step that doesn't move, or when motion is reduced, in ms.</summary>
    public const double Dwell = 2200;

    /// <summary>How far through a beat the moment <paramref name="t"/> is: 0 before it, 1 after it.</summary>
    public static double Progress(Beat b, double t) => Math.Min(1, Math.Max(0, (t - b.At) / b.Dur));

    /// <summary>Whether the beat is running at <paramref name="t"/>.</summary>
    public static bool Active(Beat b, double t) => t >= b.At && t < b.At + b.Dur;

    /// <summary>Slow at both ends, fast in the middle: a blob eases into the pipe and out of it.</summary>
    public static double Ease(double p) => p < 0.5 ? 4 * p * p * p : 1 - Math.Pow(-2 * p + 2, 3) / 2;

    /// <summary>0 at the ends of a beat and 1 in the middle: a squash, or a blob stretched at full speed.</summary>
    public static double Bump(double p) => Math.Sin(Math.PI * p);

    /// <summary>How much longer a squishing blob gets along the way it runs, and how much thinner across it, at full strength.</summary>
    public const double SquishAlong = 0.3, SquishAcross = -0.15;

    /// <summary>
    /// How a blob squishes at <paramref name="s"/> (0 to 1, see <see cref="Bump"/>) while it runs at <paramref name="angle"/> radians: a scale of
    /// <c>Sx</c> by <c>Sy</c> along the axes turned by <c>Rotation</c>. A dot is stretched along its way. A label's pill gets the same stretch along its own edges (no turn),
    /// since along a slanted way it would shear. Twin of <c>squishParts</c> in ui/src/motion.ts, with the angle in radians.
    /// </summary>
    public static (double Rotation, double Sx, double Sy) Squish(bool label, double angle, double s)
    {
        var (along, across) = (1 + SquishAlong * s, 1 + SquishAcross * s);
        if (!label) return (angle, along, across);
        var (cos, sin) = (Math.Cos(angle) * Math.Cos(angle), Math.Sin(angle) * Math.Sin(angle));
        return (0, 1 + (along - 1) * cos + (across - 1) * sin, 1 + (along - 1) * sin + (across - 1) * cos);
    }

    /// <summary>How high a bouncing blob hops, in pixels, how much a pulsing one swells, how far a wiggling one rocks, in degrees, and how many times each runs along the line.</summary>
    public const double Hop = 10, Swell = 0.2, Rock = 12, Beats = 3;

    /// <summary>
    /// Where a blob is and how it is drawn <paramref name="p"/> of the way through its run (0 to 1) along a line that runs at <paramref name="angle"/> radians, for the step's
    /// <paramref name="effect"/>: lifted by <c>Dy</c>, the whole of it turned by <c>Turn</c> radians, its shape grown by <c>Grow</c> and scaled <c>Sx</c> by <c>Sy</c> along axes turned by
    /// <c>Rotation</c> radians. No effect is <see cref="Still"/>. Every effect is zero at both ends of the run and none bends the shape. Twin of <c>effectPose</c> in ui/src/motion.ts.
    /// </summary>
    public static Pose PoseOf(string? effect, bool label, double angle, double p)
    {
        switch (effect)
        {
            case "squish":
                var (rotation, sx, sy) = Squish(label, angle, Bump(p));
                return Still with { Rotation = rotation, Sx = sx, Sy = sy };
            case "bounce": return Still with { Dy = -Hop * Math.Abs(Math.Sin(Beats * Math.PI * p)) };
            case "pulse": return Still with { Grow = 1 + Swell * (1 - Math.Cos(2 * Beats * Math.PI * p)) / 2 };
            case "wiggle": return Still with { Turn = Rock * Math.PI / 180 * Math.Sin(2 * Beats * Math.PI * p) };
            default: return Still;
        }
    }

    /// <summary>A blob as it is, with no effect.</summary>
    public static readonly Pose Still = new(0, 0, 1, 0, 1, 1);

    /// <summary>The tube fades in over the first 150 ms of its beat and out over the last 250.</summary>
    public static double TubeOpacity(Beat b, double t) => Math.Min(1, Math.Max(0, Math.Min((t - b.At) / 150, (b.At + b.Dur - t) / 250)));

    /// <summary>
    /// How far along a line of length <paramref name="length"/> a blob is at progress <paramref name="p"/>, running forward or back. <paramref name="start"/> and
    /// <paramref name="end"/> are the stretch of the line it runs between, as fractions of it (the whole line when left out): forward runs from start to end,
    /// back from end to start, and a blob whose start is its end waits where it is.
    /// </summary>
    public static double Distance(string? dir, double p, double length, double? start = null, double? end = null)
    {
        var from = start ?? 0;
        var to = end ?? 1;
        return (from + (to - from) * (dir == "back" ? 1 - Ease(p) : Ease(p))) * length;
    }

    /// <summary>The colour of a slot of <see cref="Animations.Tints"/> as [light, dark] #rrggbb: a request that meets an outcome in a burst. The slot wraps round.</summary>
    public static (string Light, string Dark) TintPair(int slot)
    {
        var n = Animations.Tints.Length;
        return Look.ColorPair(Animations.Tints[(slot % n + n) % n])!.Value;
    }

    private const double PipeHalf = 15;
    private const double LabelGap = 6;

    // JavaScript's `|| 0`: a negative zero or NaN is plain 0.
    private static double Zero(double v) => v == 0 || double.IsNaN(v) ? 0 : v;

    /// <summary>
    /// Where to move a line's label so it sits beside the blob's path, on the upper side of the line (the right side of a vertical line), far enough that a label of
    /// <paramref name="chars"/> characters clears the blob at any slope. <paramref name="dx"/> and <paramref name="dy"/> run from one end of the line to the other.
    /// </summary>
    public static (double X, double Y) LabelOffset(double dx, double dy, int chars)
    {
        var len = double.Hypot(dx, dy);
        if (len == 0) return (0, -(PipeHalf + LabelGap + 10));
        var nx = dy / len;
        var ny = -dx / len;
        if (ny > 0 || (ny == 0 && nx < 0))
        {
            nx = -nx;
            ny = -ny;
        }
        var far = PipeHalf + LabelGap + Math.Abs(nx) * (chars * 3 + 6) + Math.Abs(ny) * 10;
        return (Zero(nx * far), Zero(ny * far));
    }

    /// <summary>The unit normal of a line that points to its lower side: away from where its label sits, so a note or a marker beside the line never meets the label.</summary>
    public static (double X, double Y) LowerSide(double dx, double dy)
    {
        var up = LabelOffset(dx, dy, 0);
        var len = double.Hypot(up.X, up.Y);
        return (Zero(-up.X / len), Zero(-up.Y / len));
    }

    /// <summary>How far a note sits from the line: clear of a puff or a clock of radius about 26 around the spot it is about.</summary>
    private const double NoteGap = 32;

    /// <summary>Where to put a note of <paramref name="chars"/> characters, from the spot it is about: on the lower side of the line, further for a long note on a steep line.</summary>
    public static (double X, double Y) NoteSpot(double dx, double dy, int chars)
    {
        var n = LowerSide(dx, dy);
        var far = NoteGap + Math.Abs(n.X) * (chars * 3.2 + 6) + Math.Abs(n.Y) * 6;
        return (Zero(n.X * far), Zero(n.Y * far));
    }

    /// <summary>The size of the dashed marker of a party that is not in the model, for its name.</summary>
    public static (double Width, double Height) MarkerSize(string name) => (Math.Floor(name.Length * 7.5 + 28 + 0.5), 28);

    /// <summary>The clear space between the pipe and the marker beside it.</summary>
    private const double MarkerGap = 26;

    /// <summary>Where the middle of a marker of this size sits, from the point on the line it hangs from: on the lower side, clear of the blob that runs along the line.</summary>
    public static (double X, double Y) MarkerSpot(double dx, double dy, (double Width, double Height) size)
    {
        var n = LowerSide(dx, dy);
        var far = MarkerGap + Math.Abs(n.X) * (size.Width / 2) + Math.Abs(n.Y) * (size.Height / 2);
        return (Zero(n.X * far), Zero(n.Y * far));
    }

    /// <summary>Where a straight run from <paramref name="from"/> to the middle of a box first meets the box's edge, so a blob taken in by a box stops at its edge. From inside the box it is the middle.</summary>
    public static (double X, double Y) EntryPoint((double X, double Y) from, Rect box)
    {
        var middle = (X: box.X + box.Width / 2, Y: box.Y + box.Height / 2);
        if (from.X >= box.X && from.X <= box.X + box.Width && from.Y >= box.Y && from.Y <= box.Y + box.Height) return middle;
        // The fraction of the run at which each axis enters the box; the run enters when both have.
        static double Enter(double a, double to, double lo, double size) => to == a ? 0 : Math.Min((lo - a) / (to - a), (lo + size - a) / (to - a));
        var t = Math.Min(1, Math.Max(Math.Max(Enter(from.X, middle.X, box.X, box.Width), Enter(from.Y, middle.Y, box.Y, box.Height)), 0));
        return (from.X + (middle.X - from.X) * t, from.Y + (middle.Y - from.Y) * t);
    }

    /// <summary>How much of its strength a lit line keeps once a step has timed out.</summary>
    public const double LitFloor = 0.25;

    /// <summary>
    /// How strong the lit lines of a stop are at <paramref name="t"/>: full until a <c>fade</c> beat starts, falling to <see cref="LitFloor"/> over it, and
    /// staying there after it (the line is dim until the step is left). The strongest fade of several wins; beats with no <c>fade</c> leave it at 1.
    /// </summary>
    public static double LitOpacity(IEnumerable<Beat> beats, double t) =>
        1 - (1 - LitFloor) * beats.Where(b => b.Do == "fade").Aggregate(0.0, (most, b) => Math.Max(most, Progress(b, t)));

    /// <summary>The biggest of some squashes, 0 for none: a box that several steps squash takes the largest.</summary>
    public static double Largest(IEnumerable<double> amounts) => amounts.Aggregate(0.0, Math.Max);

    /// <summary>
    /// How many ghost cards show at <paramref name="t"/>, as a fraction while one slides in or out. Each <c>stack</c> beat that has started takes the
    /// count from the level before it to its own over its duration; a beat that has not started yet changes nothing.
    /// </summary>
    public static double CardsAt(IEnumerable<Beat> beats, double t)
    {
        double before = 0, cards = 0;
        foreach (var b in beats)
        {
            if (b.Do != "stack") continue;
            if (t < b.At) break;
            var level = b.Level ?? 0;
            cards = before + (level - before) * Ease(Progress(b, t));
            before = level;
        }
        return cards;
    }

    /// <summary>The rect of ghost card <paramref name="k"/> (1 is the nearest): 8 px lower and 7 px narrower on each side for every level down, scaled by how far it has slid in, 0 to 1.</summary>
    public static Rect CardBox(Rect r, int k, double amount) => new(r.X + 7 * k * amount, r.Y + 8 * k * amount, r.Width - 14 * k * amount, r.Height);

    /// <summary>The counter on a recursing box: the height of the stack while it plays, and how deep it went once it has finished. JavaScript rounds a half up, so this does too.</summary>
    public static string PillText(bool playing, double cards, int depth) =>
        playing ? $"↻ {(int)Math.Round(cards, MidpointRounding.AwayFromZero) + 1}" : $"↻ {depth} deep";

    /// <summary>The squash for the <c>from</c> and <c>to</c> boxes. With one box at both ends the larger goes on it, so the empty second side never wipes the first.</summary>
    public static (double From, double To) TileSquash(bool sameBox, (double From, double To) squash) =>
        sameBox ? (Math.Max(squash.From, squash.To), 0) : squash;

    /// <summary>How hard each end of the step is squashed at <paramref name="t"/>: the strongest of the gulps running then.</summary>
    public static (double From, double To) Squash(IEnumerable<Beat> beats, double t)
    {
        double from = 0, to = 0;
        foreach (var b in beats.Where(b => b.Do == "gulp" && Active(b, t)))
        {
            var s = Bump(Progress(b, t));
            if (b.On == "to") to = Math.Max(to, s);
            else from = Math.Max(from, s);
        }
        return (from, to);
    }
}

/// <summary>How a blob is placed and drawn at a moment of its run. See <see cref="MotionMath.PoseOf"/>.</summary>
public sealed record Pose(double Dy, double Turn, double Grow, double Rotation, double Sx, double Sy);
