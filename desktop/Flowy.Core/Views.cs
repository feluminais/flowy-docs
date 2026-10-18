namespace Flowy.Core;

/// <summary>A line as a view draws it. Several connections between the same two boxes merge into one, labelled "N connections".</summary>
public sealed record Edge(string From, string To, string Label, int Count);

/// <summary>What one level shows: the boxes inside it, the boxes elsewhere that its lines reach, and the lines.</summary>
public sealed record View(string Id, IReadOnlyList<string> Members, IReadOnlyList<string> Outsiders, IReadOnlyList<Edge> Edges);

/// <summary>Which boxes and lines a level shows. A port of src/core/views.ts.</summary>
public static class Views
{
    /// <summary>The view an object sits in: its parent, or root when it has none or a broken one (missing, or itself).</summary>
    public static string ParentOf(Model model, string id)
    {
        var parent = model.GetObject(id)?.In;
        return parent is not null && parent != id && model.GetObject(parent) is not null ? parent : Names.Root;
    }

    /// <summary>[id, parent, grandparent, ..., root]. Stops at cycles, which the checks report.</summary>
    public static List<string> Chain(Model model, string id)
    {
        var chain = new List<string> { id };
        var seen = new HashSet<string> { id };
        var current = id;
        while (current != Names.Root)
        {
            current = ParentOf(model, current);
            if (!seen.Add(current)) break;
            chain.Add(current);
        }
        if (chain[^1] != Names.Root) chain.Add(Names.Root);
        return chain;
    }

    public static List<string> MemberIds(Model model, string view) =>
        model.Objects.Keys.Where(id => model.GetObject(id) is not null && ParentOf(model, id) == view).ToList();

    /// <summary>How many objects each object holds directly, for every object that holds any: <see cref="MemberIds"/> counted for all at once.</summary>
    public static Dictionary<string, int> ChildCounts(Model model)
    {
        var counts = new Dictionary<string, int>();
        foreach (var id in model.Objects.Keys)
        {
            if (model.GetObject(id) is null) continue;
            var parent = ParentOf(model, id);
            counts[parent] = counts.GetValueOrDefault(parent) + 1;
        }
        return counts;
    }

    // Known limit: scans every object per call; fine for hundreds of objects, index children by parent if views get slow.
    public static bool HasChildren(Model model, string id) => MemberIds(model, id).Count > 0;

    /// <summary>Whether <paramref name="id"/> can be the view of a flow: the top level, or an object with children.</summary>
    public static bool IsView(Model model, string? id) =>
        id == Names.Root || (id is not null && model.GetObject(id) is not null && HasChildren(model, id));

    /// <summary>The box standing for x inside view v (x or one of its ancestors), if x is inside v.</summary>
    private static string? Rep(Model model, string x, string v)
    {
        var chain = Chain(model, x);
        var i = chain.IndexOf(v);
        return i > 0 ? chain[i - 1] : null;
    }

    /// <summary>For x outside v: x's ancestor just below the point where x's branch meets v's. A line to the box you're inside lands on x.</summary>
    private static string Outsider(Model model, string x, string v)
    {
        var cx = Chain(model, x);
        var cv = Chain(model, v);
        var i = cx.FindIndex(cv.Contains);
        return i <= 0 ? x : cx[i - 1];
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

    /// <summary>
    /// Where a flow step lands in view v. A step with no <c>to</c> is one box acting on its own: the box inside the
    /// view that stands for it, given twice. Null when the view can't show the step.
    /// </summary>
    public static (string From, string To)? PlaceStep(Model model, string? v, string? from, string? to)
    {
        if (to is not null) return PlaceEnds(model, v, from, to);
        if (v is null || model.GetObject(from) is null) return null;
        var box = Rep(model, from!, v);
        return box is null ? null : (box, box);
    }

    public static View Compute(Model model, string view)
    {
        var members = MemberIds(model, view);
        var known = members.ToHashSet(); // members, then outsiders as they are found
        var outsiders = new List<string>();
        var order = new List<(string From, string To)>();
        var edges = new Dictionary<(string, string), (string Label, int Count)>();
        foreach (var c in model.Connections)
        {
            if (PlaceEnds(model, view, c.From, c.To) is not { } ends) continue;
            foreach (var end in new[] { ends.From, ends.To })
                if (known.Add(end)) outsiders.Add(end);
            if (edges.TryGetValue(ends, out var edge))
            {
                var count = edge.Count + 1;
                edges[ends] = ($"{count} connections", count);
            }
            else
            {
                order.Add(ends);
                edges[ends] = (c.Label ?? "", 1);
            }
        }
        return new View(view, members, outsiders, order.Select(e => new Edge(e.From, e.To, edges[e].Label, edges[e].Count)).ToList());
    }

    /// <summary>What a reader calls an object: its name, its id when it has none, and "Overview" for the top level.</summary>
    public static string NameOf(Model model, string id)
    {
        if (id == Names.Root) return "Overview";
        var name = model.GetObject(id)?.Name;
        return string.IsNullOrEmpty(name) ? id : name;
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
