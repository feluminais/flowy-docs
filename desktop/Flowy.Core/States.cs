namespace Flowy.Core;

/// <summary>A shape that is not Running (<c>State</c>), and whether that is only because something inside it is not (<c>Inside</c>).</summary>
public sealed record StateMark(string State, bool Inside);

/// <summary>
/// The state a shape is in: a port of src/core/states.ts, with the same wording and the same order. A shape is Running unless a flow says otherwise: a
/// flow's <c>states</c> say where shapes stand before step 1, and a step's change some of them, from that stop on, until another step changes them.
/// desktop/fixtures/states.ts keeps the two equal. A states value is shape id → state word; <c>Read</c> keeps the well-formed entries.
/// </summary>
public static class States
{
    public static readonly string[] Names = ["running", "starting", "stopping", "stopped", "restarting", "degraded"];

    /// <summary>The words a person says. The file holds the lowercase word.</summary>
    public static readonly IReadOnlyDictionary<string, string> Labels = new Dictionary<string, string>
    {
        ["running"] = "Running", ["starting"] = "Starting", ["stopping"] = "Stopping", ["stopped"] = "Stopped", ["restarting"] = "Restarting", ["degraded"] = "Degraded",
    };

    public static bool IsName(object? v) => v is string s && Names.Contains(s);

    /// <summary>Whether a flow says anything about states, in its start or in any step. A flow that does not folds to nothing and draws nothing.</summary>
    public static bool Uses(Flow flow) => flow.States is not null || flow.Steps.Any(s => s.States is not null);

    private static readonly string Use = $"use {string.Join(", ", Names)}";

    private const string ShapeMap = "states must map shape ids to states";

    /// <summary>Worst first: what a container shows at the overview when several things inside it are not running.</summary>
    private static readonly string[] Worst = ["stopped", "restarting", "degraded", "stopping", "starting"];

    /// <summary>The well-formed entries of a states value, in JavaScript's key order: a mapping whose values are state words. Anything else is left out (the checks report it).</summary>
    public static OrderedDictionary<string, string> Read(object? raw)
    {
        var output = new OrderedDictionary<string, string>();
        if (raw is OrderedDictionary<string, object?> map)
            foreach (var id in JsCompat.OrderKeys(map.Keys))
                if (map[id] is string state && Names.Contains(state)) output[id] = state;
        return output;
    }

    /// <summary>
    /// What is wrong with a flow's states and its steps', in this order: the flow's own, then each step's (in file order), then each parallel stop whose lanes set one
    /// shape to different states. A step's problem has its 0-based step number and is worded to follow "step N: "; the others stand alone. <paramref name="exists"/> says whether an id is a shape.
    /// </summary>
    public static List<(int? Step, string Message)> Problems(Flow flow, IReadOnlyList<Stop> stops, Func<string, bool> exists)
    {
        var output = new List<(int? Step, string Message)>();
        void Check(object? raw, int? step)
        {
            void Add(string message) => output.Add((step, message));
            if (raw is null) return;
            if (raw is not OrderedDictionary<string, object?> map)
            {
                Add(ShapeMap);
                return;
            }
            foreach (var id in JsCompat.OrderKeys(map.Keys))
            {
                var state = map[id];
                if (!exists(id)) Add($"states: unknown shape \"{id}\"");
                if (state is not string word) Add($"states: \"{id}\" needs a state word ({Use})");
                else if (!Names.Contains(word)) Add($"states: unknown state \"{word}\" for \"{id}\" ({Use})");
            }
        }
        Check(flow.States, null);
        for (var i = 0; i < flow.Steps.Count; i++) Check(flow.Steps[i].States, i);

        // Two lanes of one parallel stop that leave a shape in different states: the picture still follows the later lane, but the file contradicts itself.
        foreach (var stop in stops)
        {
            if (stop.Steps.Count < 2) continue;
            var first = new Dictionary<string, string>();
            var told = new HashSet<string>();
            foreach (var i in stop.Steps)
            {
                if (i < 0 || i >= flow.Steps.Count) continue;
                foreach (var (id, state) in Read(flow.Steps[i].States))
                {
                    if (!first.TryGetValue(id, out var seen)) first[id] = state;
                    else if (seen != state && told.Add(id)) output.Add((i, $"shape \"{id}\" is set to both {seen} and {state} in one stop"));
                }
            }
        }
        return output;
    }

    /// <summary>
    /// Where every shape stands at stop <paramref name="k"/>: the flow's states, then the states of each stop along the <c>Before</c> chain up to and including <paramref name="k"/>,
    /// the later one winning. The chain is followed, not the file order, so a branch lane starts from the state before the branch and the last lane's changes carry on after it.
    /// Total: a <paramref name="k"/> that is not a stop, or a flow with no stops, gives the flow's start. A flow with no states anywhere gives nothing at once.
    /// </summary>
    public static OrderedDictionary<string, string> At(Flow flow, IReadOnlyList<Stop> stops, int k)
    {
        var output = Read(flow.States);
        if (!flow.Steps.Any(s => s.States is not null) || k < 0 || k >= stops.Count) return output;
        // Walked back first, then applied from the start. A stop only ever follows an earlier one, so this ends; the bound is for stops that came from elsewhere.
        var path = new List<int>();
        for (int? at = k; at is { } here && path.Count <= stops.Count; at = Structure.StopBefore(stops, here)) path.Add(here);
        for (var p = path.Count - 1; p >= 0; p--)
        {
            foreach (var i in stops[path[p]].Steps)
            {
                if (i < 0 || i >= flow.Steps.Count) continue;
                foreach (var (id, state) in Read(flow.Steps[i].States)) output[id] = state;
            }
        }
        return output;
    }

    /// <summary>
    /// What to draw for each shape: every shape of the model whose state is not Running, with <c>Inside</c> false; and every shape that holds one and has no state of its own,
    /// with the worst state below it and <c>Inside</c> true. A shape with its own entry (Running included) shows that and no roll-up. Running entries and ids the model does not have are dropped.
    /// </summary>
    public static OrderedDictionary<string, StateMark> Marks(Model model, IReadOnlyDictionary<string, string> states)
    {
        var marks = new OrderedDictionary<string, StateMark>();
        var entries = JsCompat.OrderKeys(states.Keys).Where(id => states[id] != "running" && model.GetObject(id) is not null).Select(id => (Id: id, State: states[id])).ToList();
        foreach (var (id, state) in entries) marks[id] = new StateMark(state, false);
        foreach (var (id, state) in entries)
        {
            foreach (var above in Views.Chain(model, id).Skip(1))
            {
                if (above == Flowy.Core.Names.Root || states.ContainsKey(above)) continue;
                var seen = marks.TryGetValue(above, out var mark) ? mark.State : null;
                if (seen is null || Array.IndexOf(Worst, state) < Array.IndexOf(Worst, seen)) marks[above] = new StateMark(state, true);
            }
        }
        return marks;
    }
}
