using System.Collections.Concurrent;
using System.Runtime.CompilerServices;

namespace Flowy.Core;

/// <summary>A line as a view draws it. Several connections between the same two boxes merge into one, labelled "N connections".</summary>
/// <summary>
/// One line between two shapes of a view, whichever way their connections run. <c>From</c> and <c>To</c> are the way the first of them runs;
/// <c>Both</c> is set when some run the other way too, and the line gets an arrowhead at each end.
/// </summary>
public sealed record Edge(string From, string To, string Label, int Count, bool Both = false);

/// <summary>What one level shows: the boxes inside it, the boxes elsewhere that its lines reach, and the lines.</summary>
public sealed record View(string Id, IReadOnlyList<string> Members, IReadOnlyList<string> Outsiders, IReadOnlyList<Edge> Edges);

/// <summary>Which boxes and lines a level shows. A port of src/core/views.ts.</summary>
public static class Views
{
    /// <summary>The view an object sits in: its parent, or root when it has none or a broken one (missing, or itself).</summary>
    public static string ParentOf(Model model, string id) => ModelIndex.Of(model).ParentOf(id);

    /// <summary>[id, parent, grandparent, ..., root]. Stops at cycles, which the checks report.</summary>
    public static List<string> Chain(Model model, string id) => [.. ModelIndex.Of(model).ChainOf(id)];

    public static List<string> MemberIds(Model model, string view) => ModelIndex.Of(model).MemberIds(view);

    /// <summary>How many objects each object holds directly, for every object that holds any: <see cref="MemberIds"/> counted for all at once.</summary>
    public static Dictionary<string, int> ChildCounts(Model model) => ModelIndex.Of(model).ChildCounts();

    public static bool HasChildren(Model model, string id) => ModelIndex.Of(model).HasChildren(id);

    /// <summary>Whether <paramref name="id"/> can be the view of a flow: the top level, or an object with children.</summary>
    public static bool IsView(Model model, string? id) =>
        id == Names.Root || (id is not null && model.GetObject(id) is not null && HasChildren(model, id));

    /// <summary>The box standing for x inside view v (x or one of its ancestors), if x is inside v.</summary>
    private static string? Rep(Model model, string x, string v)
    {
        var chain = ModelIndex.Of(model).ChainOf(x);
        var i = IndexOf(chain, v);
        return i > 0 ? chain[i - 1] : null;
    }

    /// <summary>For x outside v: x's ancestor just below the point where x's branch meets v's. A line to the box you're inside lands on x.</summary>
    private static string Outsider(Model model, string x, string v)
    {
        var index = ModelIndex.Of(model);
        var cx = index.ChainOf(x);
        var cv = index.ChainOf(v);
        for (var i = 0; i < cx.Count; i++)
            if (cv.Contains(cx[i])) return i <= 0 ? x : cx[i - 1];
        return x;
    }

    private static int IndexOf(IReadOnlyList<string> chain, string id)
    {
        for (var i = 0; i < chain.Count; i++) if (chain[i] == id) return i;
        return -1;
    }

    /// <summary>
    /// Where an outsider of view v meets v: the view both branches share, the box standing for v there (<c>Here</c>) and the box standing for x
    /// (<c>There</c>). Both are members of that view. Null for x itself being v or above it.
    /// </summary>
    public static (string View, string Here, string There)? Meeting(Model model, string v, string x)
    {
        var index = ModelIndex.Of(model);
        var cx = index.ChainOf(x);
        var cv = index.ChainOf(v);
        var i = -1;
        for (var k = 0; k < cx.Count && i < 0; k++) if (cv.Contains(cx[k])) i = k;
        var j = i < 0 ? -1 : IndexOf(cv, cx[i]);
        return i <= 0 || j <= 0 ? null : (cx[i], cv[j - 1], cx[i - 1]);
    }

    /// <summary>Where a from → to line lands in view v, or null when v can't show it (or an end doesn't exist).</summary>
    public static (string From, string To)? PlaceEnds(Model model, string? v, string? from, string? to)
    {
        if (v is null || model.GetObject(from) is null || model.GetObject(to) is null) return null;
        var a = Rep(model, from!, v);
        var b = Rep(model, to!, v);
        if (a is null && b is null) return null;
        var ends = (From: a ?? Outsider(model, from!, v), To: b ?? Outsider(model, to!, v));
        return ends.From == ends.To ? null : ends;
    }

    /// <summary>The actors the flows of each view name, worked out once per model and dropped when its objects or flows are other ones.</summary>
    private sealed class FlowDrawn(Model model)
    {
        public readonly IdMap<FlowyObject> Objects = model.Objects;
        public readonly IdMap<Flow> Flows = model.Flows;
        public readonly ConcurrentDictionary<string, List<string>> Actors = new();
    }

    private static readonly ConditionalWeakTable<Model, FlowDrawn> FlowCache = new();

    private static FlowDrawn CacheOf(Model model)
    {
        if (FlowCache.TryGetValue(model, out var cache) && ReferenceEquals(cache.Objects, model.Objects) && ReferenceEquals(cache.Flows, model.Flows))
            return cache;
        cache = new FlowDrawn(model);
        FlowCache.AddOrUpdate(model, cache);
        return cache;
    }

    /// <summary>
    /// The actors that the flows playing in view v name, where v would draw them as themselves: a person who sets a flow off or takes part in it is drawn on the level the flow
    /// plays at, even when no line reaches them there, so a flow never looks like the system acting on its own. In the order the flows name them. A port of <c>flowActors</c>.
    /// </summary>
    public static IReadOnlyList<string> FlowActors(Model model, string v) => CacheOf(model).Actors.GetOrAdd(v, view =>
    {
        var found = new List<string>();
        var seen = new HashSet<string>();
        var above = ModelIndex.Of(model).ChainOf(view);
        foreach (var (_, flow) in model.Flows)
        {
            if (flow.View != view) continue;
            foreach (var step in flow.Steps)
                foreach (var id in new[] { step.From, step.To })
                {
                    if (id is null || !seen.Add(id)) continue;
                    if (model.GetObject(id)?.Type == "actor" && !above.Contains(id) && Rep(model, id, view) is null && Outsider(model, id, view) == id) found.Add(id);
                }
        }
        return found;
    });

    /// <summary>
    /// Where a flow step lands in view v. A step with no <c>to</c> is one box acting on its own: the box inside the
    /// view that stands for it, given twice. Null when the view can't show the step. A step with both ends outside is shown when
    /// one of them is an actor the view draws for its flows (see <see cref="FlowActors"/>); the other end joins the view while the flow plays.
    /// </summary>
    public static (string From, string To)? PlaceStep(Model model, string? v, string? from, string? to)
    {
        if (to is not null)
        {
            var ends = PlaceEnds(model, v, from, to);
            if (ends is not null || v is null || model.GetObject(from) is null || model.GetObject(to) is null) return ends;
            if (Rep(model, from!, v) is not null || Rep(model, to, v) is not null) return null;
            var a = Outsider(model, from!, v);
            var b = Outsider(model, to, v);
            var actors = FlowActors(model, v);
            return a != b && (actors.Contains(a) || actors.Contains(b)) ? (a, b) : null;
        }
        if (v is null || model.GetObject(from) is null) return null;
        var box = Rep(model, from!, v);
        return box is null ? null : (box, box);
    }

    public static View Compute(Model model, string view)
    {
        var members = MemberIds(model, view);
        var known = members.ToHashSet(); // members, then outsiders as they are found
        var outsiders = new List<string>();
        var order = new List<string>();
        var edges = new Dictionary<string, Edge>();
        foreach (var c in model.Connections)
        {
            if (PlaceEnds(model, view, c.From, c.To) is not { } ends) continue;
            foreach (var end in new[] { ends.From, ends.To })
                if (known.Add(end)) outsiders.Add(end);
            var key = LineKey(ends.From, ends.To);
            if (edges.TryGetValue(key, out var edge))
            {
                var count = edge.Count + 1;
                edges[key] = edge with { Label = $"{count} connections", Count = count, Both = edge.Both || edge.From != ends.From };
            }
            else
            {
                order.Add(key);
                edges[key] = new Edge(ends.From, ends.To, c.Label ?? "", 1);
            }
        }
        foreach (var id in FlowActors(model, view)) if (known.Add(id)) outsiders.Add(id);
        return new View(view, members, outsiders, order.Select(k => edges[k]).ToList());
    }

    /// <summary>
    /// The text a drawn line is known by: the same as <c>lineKey</c> in src/core/views.ts. A view draws one line between two shapes whichever way
    /// their connections run, so the two ends go in sorted order and A → B and B → A are the same line.
    /// </summary>
    public static string LineKey(string a, string b) => string.CompareOrdinal(a, b) < 0 ? $"{a} {b}" : $"{b} {a}";

    /// <summary>What a reader calls an object: its name, its id when it has none, and "Overview" for the top level.</summary>
    public static string NameOf(Model model, string id)
    {
        if (id == Names.Root) return "Overview";
        var name = model.GetObject(id)?.Name;
        return string.IsNullOrEmpty(name) ? id : name;
    }

    /// <summary>
    /// A shape's name the way the canvas at <paramref name="view"/> shows it: the shape drawn there that holds it, then each shape down to it ("Dispatch > ETA"). A shape the view draws itself is
    /// just its name; one on another branch is named from where the branches part.
    /// </summary>
    public static string PathName(Model model, string view, string id)
    {
        var inView = Chain(model, view).ToHashSet();
        var down = Chain(model, id).Where(x => x != Names.Root).Reverse().ToList();
        var from = down.FindIndex(x => !inView.Contains(x));
        return from < 0 ? NameOf(model, id) : string.Join(" > ", down.Skip(from).Select(x => NameOf(model, x)));
    }

    /// <summary>
    /// A step's ends as a reader sees them. When an end lands on a box that stands for something inside it, both are
    /// named ("Scheduler in Core"), so two steps on two parts of one box never read as a round trip.
    /// </summary>
    public static string StepEnds(Model model, string from, string? to, (string From, string To)? placed)
    {
        string[] real = [from, to ?? from];
        string[] drawn = placed is { } p ? [p.From, p.To] : real;
        string Name(int i) => drawn[i] == real[i] ? NameOf(model, real[i]) : $"{NameOf(model, real[i])} in {NameOf(model, drawn[i])}";
        return to is null || to == from ? Name(0) : $"{Name(0)} → {Name(1)}";
    }
}
