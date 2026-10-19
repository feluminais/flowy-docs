namespace Flowy.Core;

/// <summary>One line of the navigator's tree: the project, a shape, or a flow. <c>Key</c> is <c>shape:id</c> or <c>flow:id</c>.</summary>
public sealed record OutlineRow(
    string Key, string Kind, string Id, string? Parent, int Depth, string Name, string? Type, bool External, int Shapes, int Flows, int? Steps,
    bool Problem, bool Expandable, bool Expanded, bool Match);

public sealed record OutlineTotals(int Shapes, int Flows, int Problems);

public sealed record Outline(IReadOnlyList<OutlineRow> Rows, OutlineTotals Totals);

public sealed record FlowRef(string Id, string Name, int Steps, string? View);

/// <summary>The flows that play in one view, with where that view is: its path of names from the top, without the project.</summary>
public sealed record FlowGroup(string View, string Name, IReadOnlyList<string> Path, IReadOnlyList<FlowRef> Flows);

public sealed record FlowGroups(IReadOnlyList<FlowRef> Here, IReadOnlyList<FlowGroup> Elsewhere, int Total);

/// <summary>Where the focus goes (a row's key), whether a shape opens or closes, and the row Enter means.</summary>
public sealed record KeyResult(string? Focus = null, (string Id, bool Expand)? Toggle = null, OutlineRow? Open = null);

/// <summary>A port of src/core/outline.ts, with the same rules and the same order of rows. desktop/fixtures/outline.ts keeps the two equal.</summary>
public static class Outlines
{
    private sealed record Tree(Dictionary<string, List<string>> Kids, Dictionary<string, List<string>> FlowsIn, List<string> Preorder);

    private static Tree TreeOf(Model model, bool editing)
    {
        var kids = new Dictionary<string, List<string>>();
        foreach (var id in model.Objects.Keys)
        {
            if (model.GetObject(id) is null) continue;
            var parent = Views.ParentOf(model, id);
            if (!kids.TryGetValue(parent, out var list)) kids[parent] = list = [];
            list.Add(id);
        }
        var flowsIn = new Dictionary<string, List<string>>();
        foreach (var id in model.Flows.Keys)
        {
            var flow = model.Flows[id];
            if (!editing && flow.Steps.Count == 0) continue;
            if (flow.View is not { } view || (view != Names.Root && !kids.ContainsKey(view))) continue;
            if (!flowsIn.TryGetValue(view, out var list)) flowsIn[view] = list = [];
            list.Add(id);
        }
        // A loop of shapes inside each other is never reached from the project, and a stack (not recursion) keeps a long chain from overflowing.
        var preorder = new List<string>();
        var stack = new Stack<string>();
        if (kids.TryGetValue(Names.Root, out var top)) for (var i = top.Count - 1; i >= 0; i--) stack.Push(top[i]);
        while (stack.Count > 0)
        {
            var id = stack.Pop();
            preorder.Add(id);
            if (kids.TryGetValue(id, out var below)) for (var i = below.Count - 1; i >= 0; i--) stack.Push(below[i]);
        }
        return new Tree(kids, flowsIn, preorder);
    }

    private static Dictionary<string, (int Shapes, int Flows)> CountsOf(Tree tree)
    {
        var counts = new Dictionary<string, (int Shapes, int Flows)>();
        var order = new List<string> { Names.Root };
        order.AddRange(tree.Preorder);
        for (var i = order.Count - 1; i >= 0; i--) // what is inside comes after what holds it, so backwards sees the inside first
        {
            var id = order[i];
            var shapes = 0;
            var flows = tree.FlowsIn.TryGetValue(id, out var own) ? own.Count : 0;
            if (tree.Kids.TryGetValue(id, out var kids))
                foreach (var kid in kids)
                {
                    var inner = counts[kid];
                    shapes += 1 + inner.Shapes;
                    flows += inner.Flows;
                }
            counts[id] = (shapes, flows);
        }
        return counts;
    }

    private static (HashSet<string> Shapes, HashSet<string> Flows) ProblemsIn(Model model, IReadOnlyList<Problem> problems)
    {
        var shapes = new HashSet<string>();
        var flows = new HashSet<string>();
        void Mark(string from)
        {
            foreach (var id in Views.Chain(model, from)) shapes.Add(id);
        }
        foreach (var p in problems)
        {
            if (p.Id is { } id && model.GetObject(id) is not null) Mark(id);
            if (p.File.StartsWith("flows/", StringComparison.Ordinal) && p.File.EndsWith(".yaml", StringComparison.Ordinal) && p.File.Length > "flows/.yaml".Length)
            {
                var flow = p.File["flows/".Length..^".yaml".Length];
                if (model.Flows.Contains(flow))
                {
                    flows.Add(flow);
                    Mark(model.Flows[flow].View ?? "");
                }
            }
        }
        if (problems.Count > 0) shapes.Add(Names.Root);
        return (shapes, flows);
    }

    private static string Lower(string text) => text.ToLowerInvariant();

    /// <summary>The rows to draw, top to bottom. With a filter, only matching rows and the shapes holding them show, all open.</summary>
    public static Outline Build(Model model, IReadOnlyList<Problem> problems, IReadOnlySet<string> expanded, string? filter = null, bool editing = false)
    {
        var needle = Lower((filter ?? "").Trim());
        var tree = TreeOf(model, editing);
        var counts = CountsOf(tree);
        var bad = ProblemsIn(model, problems);
        var root = counts[Names.Root];
        var totals = new OutlineTotals(root.Shapes, root.Flows, problems.Count);

        bool Matches(string id, string name) => needle == "" || Lower(name).Contains(needle, StringComparison.Ordinal) || Lower(id).Contains(needle, StringComparison.Ordinal);
        string FlowName(string id) => model.Flows[id].Name is { Length: > 0 } name ? name : id;
        var shown = new HashSet<string>();
        if (needle != "")
        {
            void Holding(string view)
            {
                foreach (var id in Views.Chain(model, view)) shown.Add($"shape:{id}");
            }
            foreach (var id in new[] { Names.Root }.Concat(tree.Preorder))
                if (Matches(id, Views.NameOf(model, id))) Holding(id);
            foreach (var (view, ids) in tree.FlowsIn)
                foreach (var id in ids)
                {
                    if (!Matches(id, FlowName(id))) continue;
                    shown.Add($"flow:{id}");
                    Holding(view);
                }
        }
        bool Visible(string key) => needle == "" || shown.Contains(key);

        var rows = new List<OutlineRow>();
        var stack = new Stack<(string Kind, string Id, string? Parent, int Depth)>();
        stack.Push(("shape", Names.Root, null, 0));
        while (stack.Count > 0)
        {
            var (kind, id, parent, depth) = stack.Pop();
            if (!Visible($"{kind}:{id}")) continue;
            if (kind == "flow")
            {
                var name = FlowName(id);
                rows.Add(new OutlineRow($"flow:{id}", "flow", id, parent, depth, name, null, false, 0, 0, model.Flows[id].Steps.Count,
                    bad.Flows.Contains(id), false, false, Matches(id, name)));
                continue;
            }
            var obj = model.GetObject(id);
            var members = (tree.Kids.TryGetValue(id, out var k) ? k : []).Where(kid => Visible($"shape:{kid}")).ToList();
            var flows = (tree.FlowsIn.TryGetValue(id, out var f) ? f : []).Where(flow => Visible($"flow:{flow}")).ToList();
            var below = members.Count + flows.Count > 0;
            var open = below && (needle != "" || expanded.Contains(id));
            var size = counts[id];
            var shapeName = Views.NameOf(model, id);
            rows.Add(new OutlineRow($"shape:{id}", "shape", id, parent, depth, shapeName, obj?.Type, obj is not null && Model.IsExternal(obj),
                size.Shapes, size.Flows, null, bad.Shapes.Contains(id), below, open, Matches(id, shapeName)));
            if (!open) continue;
            // Pushed backwards so shapes come off first, in order, and then the flows.
            for (var i = flows.Count - 1; i >= 0; i--) stack.Push(("flow", flows[i], id, depth + 1));
            for (var i = members.Count - 1; i >= 0; i--) stack.Push(("shape", members[i], id, depth + 1));
        }
        return new Outline(rows, totals);
    }

    /// <summary><paramref name="expanded"/> with every shape that holds <paramref name="id"/> added, so its row is on the list. <paramref name="self"/> opens it too.</summary>
    public static HashSet<string> ExpandTo(Model model, string id, IEnumerable<string> expanded, bool self = false)
    {
        var next = new HashSet<string>(expanded);
        foreach (var held in Views.Chain(model, id).Skip(self ? 0 : 1)) next.Add(held);
        return next;
    }

    /// <summary>The flows that play in <paramref name="view"/>, and all the others grouped by the view they play in, in tree order.</summary>
    public static FlowGroups Groups(Model model, string view, bool editing = false)
    {
        var tree = TreeOf(model, editing);
        FlowRef Ref(string id)
        {
            var flow = model.Flows[id];
            return new FlowRef(id, flow.Name is { Length: > 0 } name ? name : id, flow.Steps.Count, flow.View);
        }
        var here = (tree.FlowsIn.TryGetValue(view, out var own) ? own : []).Select(Ref).ToList();
        var elsewhere = new List<FlowGroup>();
        foreach (var v in new[] { Names.Root }.Concat(tree.Preorder))
        {
            if (v == view || !tree.FlowsIn.TryGetValue(v, out var ids)) continue;
            var path = Views.Chain(model, v).AsEnumerable().Reverse().Skip(1).Select(id => Views.NameOf(model, id)).ToList();
            elsewhere.Add(new FlowGroup(v, Views.NameOf(model, v), path, ids.Select(Ref).ToList()));
        }
        return new FlowGroups(here, elsewhere, here.Count + elsewhere.Sum(g => g.Flows.Count));
    }

    /// <summary>What a key does in the tree, as in any tree view: arrows move, → opens or steps in, ← closes or steps out, Enter picks. Keys are named as in the browser: ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, Enter.</summary>
    public static KeyResult Key(IReadOnlyList<OutlineRow> rows, string? focus, string key)
    {
        if (rows.Count == 0) return new KeyResult();
        var at = -1;
        for (var i = 0; i < rows.Count; i++)
            if (rows[i].Key == focus) at = i;
        if (at == -1) return new KeyResult(key == "End" ? rows[^1].Key : rows[0].Key); // nothing focused yet, or the row is gone
        var row = rows[at];
        switch (key)
        {
            case "ArrowDown": return new KeyResult(rows[Math.Min(at + 1, rows.Count - 1)].Key);
            case "ArrowUp": return new KeyResult(rows[Math.Max(at - 1, 0)].Key);
            case "Home": return new KeyResult(rows[0].Key);
            case "End": return new KeyResult(rows[^1].Key);
            case "ArrowRight":
                if (row.Expandable && !row.Expanded) return new KeyResult(row.Key, (row.Id, true));
                if (row.Expanded && at + 1 < rows.Count && rows[at + 1].Depth > row.Depth) return new KeyResult(rows[at + 1].Key);
                return new KeyResult(row.Key);
            case "ArrowLeft":
            {
                if (row.Expanded) return new KeyResult(row.Key, (row.Id, false));
                for (var i = at - 1; i >= 0; i--)
                    if (rows[i].Depth < row.Depth) return new KeyResult(rows[i].Key);
                return new KeyResult(row.Key);
            }
            case "Enter": return new KeyResult(row.Key, Open: row);
            default: return new KeyResult(row.Key);
        }
    }
}
