namespace Flowy.Core;

/// <summary>
/// A channel that is open at a stop. <c>Step</c> is the file step number (from 0) that opened it, <c>From</c> and <c>To</c> are that step's ends, <c>End</c> is the one
/// it points at (from or to). <c>Opening</c> is true at the stop that opens it, <c>Closing</c> at the stop that closes it (it is still there, and goes when the step has played).
/// </summary>
public sealed record Channel(int Step, string Kind, string? Name, string From, string To, string End, bool Opening, bool Closing);

/// <summary>
/// What a step leaves open: a port of src/core/channels.ts, with the same wording and the same order. A step's <c>animation</c> may open a channel (<c>opens: stream</c>,
/// <c>listener</c> or <c>job</c>) and a later step may close it (<c>closes: name</c>). This folds those along a flow's stops into the channels that are open at each one,
/// so a player can keep drawing them after the step that opened them. desktop/fixtures/channels.ts keeps the two equal.
/// </summary>
public static class Channels
{
    /// <summary>The words a person says.</summary>
    public static readonly IReadOnlyDictionary<string, string> Labels = new Dictionary<string, string> { ["stream"] = "Open stream", ["listener"] = "Listening", ["job"] = "Running job" };

    /// <summary>The stops that lead to stop <paramref name="k"/>, first to last, following the <c>Before</c> chain as <see cref="States.At"/> does. Empty for a <paramref name="k"/> that is not a stop.</summary>
    private static List<int> PathTo(IReadOnlyList<Stop> stops, int k)
    {
        var path = new List<int>();
        if (k < 0 || k >= stops.Count) return path;
        for (int? at = k; at is { } here && path.Count <= stops.Count; at = Structure.StopBefore(stops, here)) path.Add(here);
        path.Reverse();
        return path;
    }

    /// <summary>What a stop does to the open channels: the channels it opens and the names it closes, in the order of its steps.</summary>
    private static (List<Channel> Opened, List<string> Closed) ChangesOf(Flow flow, Stop stop)
    {
        var opened = new List<Channel>();
        var closed = new List<string>();
        foreach (var i in stop.Steps)
        {
            if (i < 0 || i >= flow.Steps.Count) continue;
            var step = flow.Steps[i];
            var a = Animations.Read(step);
            if (a is null) continue;
            if (a.Opens is { } kind && step.To is not null)
                opened.Add(new Channel(i, kind, a.Name, step.From ?? "", step.To, a.Towards ?? Animations.DefaultEnd[kind], true, false));
            if (a.Closes is { } name) closed.Add(name);
        }
        return (opened, closed);
    }

    /// <summary>The key that tells one channel from another: its name, else the step that opened it (so an unnamed channel stays open to the end).</summary>
    private static string KeyOf(Channel c) => c.Name is null ? $"#{c.Step}" : $"name:{c.Name}";

    /// <summary>
    /// The channels open at stop <paramref name="k"/>, in the order they were opened: the ones opened by the stops that lead to it (the <c>Before</c> chain, as <see cref="States.At"/> follows),
    /// the ones it opens itself (<c>Opening</c>), and the ones it closes (<c>Closing</c>), which are still there while the step plays. A channel opened again under a
    /// name that is open replaces it. Nothing is stored between stops, so stepping back needs no undo. Total: a <paramref name="k"/> that is not a stop gives none.
    /// </summary>
    public static List<Channel> At(Flow flow, IReadOnlyList<Stop> stops, int k)
    {
        var open = new OrderedDictionary<string, Channel>();
        if (!flow.Steps.Any(s => s.Animation is not null)) return [];
        var path = PathTo(stops, k);
        for (var n = 0; n < path.Count; n++)
        {
            var last = n == path.Count - 1;
            var (opened, closed) = ChangesOf(flow, stops[path[n]]);
            foreach (var name in closed)
            {
                if (!open.TryGetValue($"name:{name}", out var found)) continue;
                if (last) open[$"name:{name}"] = found with { Opening = false, Closing = true };
                else open.Remove($"name:{name}");
            }
            foreach (var c in opened)
            {
                open.Remove(KeyOf(c)); // a re-open goes to the end of the order
                open[KeyOf(c)] = last ? c : c with { Opening = false };
            }
        }
        return [.. open.Values];
    }

    /// <summary>Whether any step of the flow opens or closes a channel. A flow that does not draws nothing of the kind.</summary>
    public static bool Uses(Flow flow) => flow.Steps.Any(s => Animations.Read(s) is { } a && (a.Opens is not null || a.Closes is not null));

    /// <summary>The kinds of channel the list holds, in the order of <see cref="Animations.ChannelKinds"/>, for a key that shows only what is on screen.</summary>
    public static List<string> KindsOf(IEnumerable<Channel> channels)
    {
        var list = channels.ToList();
        return Animations.ChannelKinds.Where(k => list.Any(c => c.Kind == k)).ToList();
    }

    /// <summary>The named channels that are open on arriving at stop <paramref name="k"/>: what the stop before it left open, without the ones that stop closed.</summary>
    private static List<Channel> OpenBefore(Flow flow, IReadOnlyList<Stop> stops, int k) =>
        Structure.StopBefore(stops, k) is { } prior ? At(flow, stops, prior).Where(c => !c.Closing && c.Name is not null).ToList() : [];

    /// <summary>The channels file step <paramref name="step"/> can close: the named ones open when its stop is reached. For the form that picks one.</summary>
    public static List<(string Name, string Kind)> ClosableAt(Flow flow, IReadOnlyList<Stop> stops, int step) =>
        OpenBefore(flow, stops, Structure.StopIndexOf(stops, step)).Select(c => (c.Name!, c.Kind)).ToList();

    /// <summary>
    /// What is wrong with the channels of a flow, in the order of its stops, each worded to follow "step N: " with its 0-based step: a step that closes a
    /// name nothing has open at that point (the message lists what is open), and one that opens a name that is already open.
    /// </summary>
    public static List<Finding> Problems(Flow flow, IReadOnlyList<Stop> stops)
    {
        var output = new List<Finding>();
        for (var k = 0; k < stops.Count; k++)
        {
            var names = OpenBefore(flow, stops, k).Select(c => c.Name!).ToList();
            var (opened, closed) = ChangesOf(flow, stops[k]);
            foreach (var i in stops[k].Steps)
            {
                if (i < 0 || i >= flow.Steps.Count) continue;
                var a = Animations.Read(flow.Steps[i]);
                if (a?.Closes is { } closes && !names.Contains(closes))
                    output.Add(new Finding(i, $"closes \"{closes}\", but nothing by that name is open{(names.Count == 0 ? "" : $" (open: {string.Join(", ", names)})")}"));
                var again = opened.Find(c => c.Step == i);
                if (again?.Name is { } name && names.Contains(name) && !closed.Contains(name)) output.Add(new Finding(i, $"opens \"{name}\", which is already open"));
            }
        }
        return output;
    }
}
