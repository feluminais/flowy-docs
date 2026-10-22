namespace Flowy.Core;

/// <summary>A shape both diagrams draw: it glides from where the old diagram had it to where the new one puts it.</summary>
public sealed record Glide(string Id, (double X, double Y) From, (double X, double Y) To);

/// <summary>What changes on the canvas when it swaps from one flow's diagram to the other's: see <see cref="SwapPlans.Plan"/>.</summary>
public sealed record SwapPlan(IReadOnlyList<Glide> Stay, IReadOnlyList<string> Entering, IReadOnlyList<string> Leaving);

/// <summary>A port of <c>planSwap</c> and the durations in ui/src/swap.ts. The browser and the app swap the same way, by the same plan.</summary>
public static class SwapPlans
{
    /// <summary>How long the boxes take to glide to the other flow's places, and the camera to fit it.</summary>
    public const int SwapMs = 450;

    /// <summary>How long the lines take to fade out before the boxes move, and to fade in once they have settled (a line is drawn from where its boxes are, so it cannot follow a gliding box).</summary>
    public const int FadeMs = 150;

    /// <summary>The time a swap takes: none under reduced motion, where it cuts.</summary>
    public static int Duration(bool reduced) => reduced ? 0 : SwapMs;

    /// <summary>The time a swap of two runs takes (the traffic fades from one run's to the other's); none under reduced motion.</summary>
    public static int CrossfadeDuration(bool reduced) => reduced ? 0 : FadeMs * 2;

    /// <summary>
    /// Shapes are told apart by their id, so a shape both diagrams draw <c>Stay</c>s and glides from where it was to where it goes; one only the new diagram draws is
    /// <c>Entering</c>, one only the old one drew is <c>Leaving</c>. <c>Stay</c> and <c>Entering</c> follow the order of <paramref name="to"/>, <c>Leaving</c> that of
    /// <paramref name="from"/>. An id that comes twice is treated as the TypeScript does: the later place in <paramref name="from"/> is where it was, and each in
    /// <paramref name="to"/> is listed.
    /// </summary>
    public static SwapPlan Plan(IReadOnlyList<(string Id, double X, double Y)> from, IReadOnlyList<(string Id, double X, double Y)> to)
    {
        var was = new Dictionary<string, (double X, double Y)>(StringComparer.Ordinal);
        foreach (var (id, x, y) in from) was[id] = (x, y);
        var now = new HashSet<string>(to.Select(n => n.Id), StringComparer.Ordinal);
        var stay = new List<Glide>();
        var entering = new List<string>();
        foreach (var (id, x, y) in to)
        {
            if (was.TryGetValue(id, out var old)) stay.Add(new Glide(id, old, (x, y)));
            else entering.Add(id);
        }
        return new SwapPlan(stay, entering, from.Where(n => !now.Contains(n.Id)).Select(n => n.Id).ToList());
    }
}
