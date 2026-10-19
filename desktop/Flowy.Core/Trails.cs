namespace Flowy.Core;

/// <summary>A place in a flow: the flow and the stop the player was at.</summary>
public sealed record FlowPlace(string Flow, int Step);

/// <summary>
/// The trail Open flow leaves behind: where the reader was in each flow they left to read another. It lives in memory only, so quitting
/// the app drops it. A port of ui/src/trail.ts; the functions return new trails and change nothing in place.
/// </summary>
public static class Trails
{
    /// <summary>The trail after leaving <paramref name="here"/> to open another flow.</summary>
    public static IReadOnlyList<FlowPlace> Open(IReadOnlyList<FlowPlace> trail, FlowPlace here) => [.. trail, here];

    /// <summary>The place the last flow was opened from, and the trail without it; null when there is nowhere to go back to.</summary>
    public static (FlowPlace Back, IReadOnlyList<FlowPlace> Trail)? Close(IReadOnlyList<FlowPlace> trail) =>
        trail.Count == 0 ? null : (trail[^1], trail.Take(trail.Count - 1).ToList());
}
