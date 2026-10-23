using System.Runtime.CompilerServices;

namespace Flowy.Core;

public static partial class Perf
{
    private sealed record Idle(Level? Level);

    private static readonly ConditionalWeakTable<LoadRun, Idle> IdleLevels = new();

    private static double? Calm(double? value) => value is null ? null : 0;

    /// <summary>What a part says with no load on it: nothing is used, queued, called or failing, and what a call weighs and how long it takes stay as the first level has them.</summary>
    private static Metrics Quiet(Metrics m) => m with { Rate = Calm(m.Rate), Util = Calm(m.Util), Queue = Calm(m.Queue), Errors = Calm(m.Errors) };

    private static IdMap<Metrics> QuietAll(IdMap<Metrics> parts)
    {
        var output = new IdMap<Metrics>();
        foreach (var (id, m) in parts) output.Add(id, Quiet(m));
        return output;
    }

    /// <summary>
    /// The level of a load run with no load: its first tested level with nothing used, queued, called or failing (rate, util, queue and errors 0), and the size of a call and how long one takes as the
    /// first level has them. A load between it and the first level is worked out by <see cref="Interpolate"/> as it is between two tested ones, and shown as estimated. Null for a run over time, which has
    /// no load, and for a run whose first level is already at 0. Twin of <c>idleOf</c> in src/core/perf/idle.ts.
    /// </summary>
    public static Level? IdleOf(LoadRun run) => IdleLevels.GetValue(run, r =>
    {
        var first = r.Levels[0];
        if (r.IsTime || !(first.Load > 0)) return new Idle(null);
        var connections = first.Connections.Select(c => ((Pair)Quiet(c)) with { By = c.By is null ? null : QuietAll(c.By) }).ToList();
        return new Idle(new Level(0, Quiet(first.Overall), QuietAll(first.Objects), connections));
    }).Level;
}
