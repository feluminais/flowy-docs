using Avalonia.Media;
using Flowy.Core;
using CoreRect = Flowy.Core.Rect;

namespace Flowy.App.Canvas;

/// <summary>A shape at one end of a lane: its id, where it is, and the outline the lane meets.</summary>
internal sealed record LaneEnd(string Id, CoreRect Rect, double[]? Edge);

/// <summary>
/// What a lane is doing: <see cref="S"/> is how far its pair is spread (0 to 1), and <see cref="Lam"/>[j] how lit the pair's lane j is (0 to 1).
/// Only the rest pose is drawn so far, so every pose gives the rest path; a pose still belongs to the question, so the layers that ask are written for
/// the displaced paths the moment those exist.
/// </summary>
internal sealed record LanePose(double S, IReadOnlyList<double> Lam)
{
    /// <summary>Nothing selected and nothing playing.</summary>
    public static readonly LanePose Rest = new(0, []);

    /// <summary>
    /// How a pose is told from another in the store's keys. Poses come from a clock and change every frame, so the numbers are cut to 32 steps: a pose that
    /// is nearly another one shares its path, and a scrub does not fill the store with one lane for each frame.
    /// </summary>
    internal string Bucket() => ReferenceEquals(this, Rest) || (S == 0 && Lam.Count == 0) ? "" : $"{Math.Round(S * 32)}:{string.Join(',', Lam.Select(l => Math.Round(l * 32)))}";
}

/// <summary>A lane: the path from the first shape to the second as the core makes it (its data, its label's place, where it ends), and that path parsed once.</summary>
internal sealed record Lane(LinePath Path, StreamGeometry Geometry);

/// <summary>
/// The lane store: the one place in the desktop app that makes the path of a line between two shapes. The line itself, its label, the pipe a step runs
/// along, the stream of an open channel, the marks of a group and the dots of a load all ask it, so they cannot disagree about where a line is. It is the
/// twin of <c>lanes</c> in <c>ui/src/lanes.ts</c>.
///
/// A lane is asked for by its strand id (the id of the line the reader draws: an edge's id, or the pair's own id where the caller has no other), the style
/// of lines, the shapes at its two ends and a pose. The answer stays the same object while the shapes stay where they are, so a layer that asks on every
/// draw gets the same lane back and has nothing new to work out, and the path is parsed into a geometry once, not on every frame.
///
/// One store belongs to one canvas and is used from the UI thread only.
/// </summary>
internal sealed class LaneStore
{
    /// <summary>What a lane was worked out from: it stays good for as long as all of this is the same.</summary>
    private sealed record Slot(CoreRect A, CoreRect B, double[]? EdgeA, double[]? EdgeB, Lane Lane);

    /// <summary>More lanes than this in one store and it starts again, so a canvas that is made again with new ids many times over does not keep every line it ever drew.</summary>
    internal const int Most = 20000;

    private Dictionary<string, Slot> _slots = [];

    /// <summary>How many lanes the store holds, for the tests.</summary>
    internal int Count => _slots.Count;

    /// <summary>
    /// The lane for <paramref name="strand"/> (null where the caller has no strand id: the pair's own id, which is also the id of the line the reader draws for the pair) in
    /// <paramref name="style"/> ("straight", "curved" or "angled"), in <paramref name="pose"/>. A line that runs the other way between the same two shapes is another lane: its path starts at the other shape.
    /// </summary>
    public Lane PathFor(string? strand, string style, LaneEnd from, LaneEnd to, LanePose? pose = null)
    {
        var key = $"{strand ?? SceneBuilder.LineId(from.Id, to.Id)}\u0001{from.Id}\u0001{to.Id}\u0001{style}\u0001{(pose ?? LanePose.Rest).Bucket()}";
        if (_slots.TryGetValue(key, out var found) && found.A == from.Rect && found.B == to.Rect && ReferenceEquals(found.EdgeA, from.Edge) && ReferenceEquals(found.EdgeB, to.Edge)) return found.Lane;
        if (_slots.Count >= Most) _slots = [];
        var path = LinePaths.Build(style, from.Rect, to.Rect, from.Edge, to.Edge);
        var lane = new Lane(path, StreamGeometry.Parse(path.Data));
        _slots[key] = new Slot(from.Rect, to.Rect, from.Edge, to.Edge, lane);
        return lane;
    }
}
