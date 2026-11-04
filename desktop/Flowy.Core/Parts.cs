namespace Flowy.Core;

/// <summary>What a stop asks of a pair: how lit each of its lanes should be once it has settled (1 for the lane a step rides), and when the step's <c>part</c> beat opens them (see <see cref="Animations.PartOf"/>).</summary>
public sealed record PartPlan(IReadOnlyList<double> Lit, (double At, double Dur)? Beat = null);

/// <summary>
/// How a stop parts the lines of a pair around the one a step rides (the working of <see cref="Lanes.PoseAt"/>): what a stop asks of each pair, and the lit amounts the way the lanes are drawn. A port
/// of planOf and the cutting of a lane's value in ui/src/parts.ts, whose store (<c>createPartStore</c>) the desktop's PartStore is the twin of.
/// </summary>
public static class Parts
{
    /// <summary>How many steps the lit amount of a lane is cut to: the lane store keeps a path for each, so a change is a handful of paths made once and not one for each frame.</summary>
    public const int Steps = 32;

    /// <summary>A pose's lanes cut to <see cref="Steps"/> steps; a pair at rest, however it got there, is the empty list.</summary>
    public static IReadOnlyList<double> Cut(IReadOnlyList<double> lam)
    {
        var steps = lam.Select(l => Math.Floor(l * Steps + 0.5) / Steps).ToList();
        return steps.All(l => l == 0) ? [] : steps;
    }

    /// <summary>
    /// What a stop asks of the pairs of the view: for each pair of several lines that one of the stop's steps rides, which of its lines are lit, and when the earliest <c>part</c> beat of the steps on it starts
    /// (a step with no motion, which has no beats, parts at once). <paramref name="steps"/> are the steps of the stop: the id of the strand each rides (null for one that rides none) and its beats (as
    /// <see cref="Animations.BeatsFor"/> gives them for the pair's number of lines), if it moves. Empty when no step of the stop rides a pair of several lines.
    /// </summary>
    public static OrderedDictionary<string, PartPlan> PlanOf(IReadOnlyList<Strand> strands, IReadOnlyList<(string? Strand, IReadOnlyList<Beat>? Beats)> steps)
    {
        var made = new OrderedDictionary<string, PartPlan>();
        var lit = Lanes.LitLanes(strands, steps.Select(s => s.Strand).OfType<string>());
        if (lit.Count == 0) return made;
        var pairOf = strands.ToDictionary(s => s.Id, s => s.Pair);
        foreach (var (pair, lam) in lit)
        {
            (double At, double Dur)? beat = null;
            foreach (var step in steps)
            {
                if (step.Strand is null || !pairOf.TryGetValue(step.Strand, out var of) || of != pair || step.Beats is null) continue;
                if (Animations.PartOf(step.Beats) is { } found && (beat is null || found.At < beat.Value.At)) beat = found;
            }
            made[pair] = new PartPlan(lam, beat);
        }
        return made;
    }
}
