using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>
/// One line of the navigator's tree: the project, a shape, or a flow. <c>Key</c> is <c>shape:id</c> or <c>flow:id</c>. <c>Linked</c> is set on a flow row only: whether the flow is in a pair, by
/// tagging a flow that is there or being tagged by one (see <see cref="Compares.Linked"/>).
/// </summary>
public sealed record OutlineRow(
    string Key, string Kind, string Id, string? Parent, int Depth, string Name, string? Type, bool External, int Shapes, int Flows, int? Steps,
    bool Problem, bool Expandable, bool Expanded, bool Match, bool? Linked = null);

public sealed record OutlineTotals(int Shapes, int Flows, int Problems);

public sealed record Outline(IReadOnlyList<OutlineRow> Rows, OutlineTotals Totals);

/// <summary>A flow on the Flows list: where its file is (<c>Folder</c>, "" at the top of flows/) and its tags. <c>View</c> is where it plays. <c>Linked</c>: it is in a pair (see <see cref="OutlineRow"/>).</summary>
public sealed record FlowRef(string Id, string Name, int Steps, string? View, bool Linked, string Folder, IReadOnlyList<string> Tags);

/// <summary>One line of the Flows list: a folder of flows or a flow. <c>Key</c> is <c>folder:path</c> or <c>flow:id</c>.</summary>
public abstract record FlowRow(string Key, int Depth);

/// <summary>A folder on the list. <c>Flows</c> counts the flows in it and in the folders inside it that the list shows; <c>Open</c> is whether the rows below it are listed.</summary>
public sealed record FolderRow(string Key, string Path, string Name, int Depth, int Flows, bool Open) : FlowRow(Key, Depth);

/// <summary>A flow on the list.</summary>
public sealed record FlowItemRow(string Key, FlowRef Flow, int Depth) : FlowRow(Key, Depth);

/// <summary>A tag in use, as the first flow that has it spells it, with how many flows have it.</summary>
public sealed record FlowTag(string Tag, int Count);

/// <summary>
/// The Flows list: <c>Rows</c> top to bottom, <c>Tags</c> every tag any listed flow has, most used first (what a tag filter offers, whatever the filter), <c>Total</c> the flows that are listed
/// and <c>Shown</c> how many of them the filter lets through.
/// </summary>
public sealed record FlowList(IReadOnlyList<FlowRow> Rows, IReadOnlyList<FlowTag> Tags, int Total, int Shown);

/// <summary>
/// What the Flows list is asked for. <c>Editing</c>: a flow with no steps is listed. <c>Query</c> keeps the flows whose name, file name, folder or a tag has these letters (any case). <c>Tags</c> keeps the flows
/// that have at least one of them (see <see cref="Names.TagKey"/>). <c>Closed</c> holds the paths of the folders that are closed; with a query or a tag filter every folder that has a match is open.
/// </summary>
public sealed record FlowListOptions(bool Editing = false, string Query = "", IReadOnlyList<string>? Tags = null, IReadOnlySet<string>? Closed = null);

/// <summary>Where the focus goes (a row's key), whether a shape opens or closes, and the row Enter means.</summary>
public sealed record KeyResult(string? Focus = null, (string Id, bool Expand)? Toggle = null, OutlineRow? Open = null);

/// <summary>A port of src/core/outline.ts, with the same rules and the same order of rows. desktop/fixtures/outline.ts keeps the two equal.</summary>
public static class Outlines
{
    private sealed record Tree(Dictionary<string, List<string>> Kids, Dictionary<string, List<string>> FlowsIn, List<string> Preorder);

    private static string Lower(string text) => text.ToLowerInvariant();

    /// <summary>-1, 0 or 1 by name as VS Code's Explorer sorts: any case, and a run of digits counts as a number ("step 2" before "step 10"). Ordinal, like the TypeScript.</summary>
    public static int ByName(string a, string b)
    {
        var x = Regex.Split(Lower(a), "([0-9]+)");
        var y = Regex.Split(Lower(b), "([0-9]+)");
        for (var i = 0; i < Math.Min(x.Length, y.Length); i++)
        {
            if (x[i] == y[i]) continue;
            if (i % 2 == 1) // both are digit runs
            {
                var (m, n) = (Number(x[i]), Number(y[i]));
                if (m.Length != n.Length) return m.Length < n.Length ? -1 : 1;
                var c = string.CompareOrdinal(m, n);
                if (c != 0) return Math.Sign(c);
                continue; // 007 and 7 are the same number
            }
            return string.CompareOrdinal(x[i], y[i]) < 0 ? -1 : 1;
        }
        return Math.Sign(x.Length - y.Length); // one is the start of the other
    }

    private static string Number(string digits) => digits.TrimStart('0') is { Length: > 0 } t ? t : "0"; // without leading zeros, but 000 is 0

    private static Comparison<string> ByNameThenId(Func<string, string> name) =>
        (a, b) => ByName(name(a), name(b)) is var c and not 0 ? c : Math.Sign(string.CompareOrdinal(a, b));

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
        // As in VS Code's Explorer: a shape that holds others comes first, as a folder does, then the rest, each group by name.
        bool Folder(string id) => kids.ContainsKey(id) || flowsIn.ContainsKey(id);
        var byShape = ByNameThenId(id => Views.NameOf(model, id));
        foreach (var list in kids.Values)
            list.Sort((a, b) => Folder(a) == Folder(b) ? byShape(a, b) : Folder(a) ? -1 : 1);
        var byFlow = ByNameThenId(id => model.Flows[id].Name is { Length: > 0 } name ? name : id);
        foreach (var list in flowsIn.Values) list.Sort(byFlow);
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
            if (FolderLayout.FlowIdOf(p.File) is { } flow)
            {
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

    /// <summary>The flows that are in a pair (see <see cref="Compares.Linked"/>).</summary>
    private static IReadOnlySet<string> LinkedFlows(Model model) => Compares.Linked(CompareChoices.TagsOf(model, new Dictionary<string, LoadRun>(), "flow"));

    /// <summary>The rows to draw, top to bottom. With a filter, only matching rows and the shapes holding them show, all open.</summary>
    public static Outline Build(Model model, IReadOnlyList<Problem> problems, IReadOnlySet<string> expanded, string? filter = null, bool editing = false)
    {
        var needle = Lower((filter ?? "").Trim());
        var tree = TreeOf(model, editing);
        var counts = CountsOf(tree);
        var bad = ProblemsIn(model, problems);
        var linked = LinkedFlows(model);
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
                    bad.Flows.Contains(id), false, false, Matches(id, name), linked.Contains(id)));
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

    private sealed class FolderNode
    {
        public readonly Dictionary<string, FolderNode> Folders = [];

        public readonly List<FlowRef> Flows = [];

        public int Inside => Flows.Count + Folders.Values.Sum(f => f.Inside);
    }

    /// <summary>
    /// The Flows list: the flows as the folders they are filed in, a folder before the flows beside it, the folders by name and the flows by file name. Only the folders that hold a flow the filter lets through are
    /// listed, and a folder in <see cref="FlowListOptions.Closed"/> shows no rows below it. A flow whose view can't open is left out, as in the tree. A port of <c>flowList</c> in src/core/outline.ts.
    /// </summary>
    public static FlowList FlowList(Model model, FlowListOptions? options = null)
    {
        var (editing, query, tags, closed) = options ?? new FlowListOptions();
        var tree = TreeOf(model, editing);
        var linked = LinkedFlows(model);
        var playable = tree.FlowsIn.Values.SelectMany(ids => ids).ToHashSet();
        var refs = model.Flows.Keys.Where(playable.Contains).Select(id =>
        {
            var flow = model.Flows[id];
            return new FlowRef(id, flow.Name is { Length: > 0 } name ? name : id, flow.Steps.Count, flow.View, linked.Contains(id), model.FolderOf(id), flow.Tags);
        }).ToList();
        refs.Sort((a, b) => ByName(a.Id, b.Id) is var c and not 0 ? c : Math.Sign(string.CompareOrdinal(a.Id, b.Id)));

        var counts = new Dictionary<string, (string Tag, int Count)>();
        foreach (var flow in refs)
            foreach (var tag in flow.Tags)
                counts[Names.TagKey(tag)] = counts.TryGetValue(Names.TagKey(tag), out var known) ? (known.Tag, known.Count + 1) : (tag, 1);
        var offered = counts.Values.OrderBy(t => t, Comparer<(string Tag, int Count)>.Create((a, b) =>
            b.Count != a.Count ? b.Count.CompareTo(a.Count) : ByName(a.Tag, b.Tag) is var c and not 0 ? c : Math.Sign(string.CompareOrdinal(a.Tag, b.Tag)))).Select(t => new FlowTag(t.Tag, t.Count)).ToList();

        var needle = Lower(JsCompat.JsTrim(query));
        var wanted = (tags ?? []).Select(Names.TagKey).ToHashSet();
        bool Keep(FlowRef f) =>
            (needle == "" || new[] { f.Name, f.Id, f.Folder }.Concat(f.Tags).Any(text => Lower(text).Contains(needle, StringComparison.Ordinal))) && (wanted.Count == 0 || f.Tags.Any(t => wanted.Contains(Names.TagKey(t))));
        var filtering = needle != "" || wanted.Count > 0;

        var top = new FolderNode();
        var shown = refs.Where(Keep).ToList();
        foreach (var flow in shown)
        {
            var at = top;
            if (flow.Folder != "")
                foreach (var name in flow.Folder.Split('/'))
                {
                    if (!at.Folders.TryGetValue(name, out var inner)) at.Folders[name] = inner = new FolderNode();
                    at = inner;
                }
            at.Flows.Add(flow);
        }

        var rows = new List<FlowRow>();
        void Emit(FolderNode at, string path, int depth)
        {
            var names = at.Folders.Keys.ToList();
            names.Sort((a, b) => ByName(a, b) is var c and not 0 ? c : Math.Sign(string.CompareOrdinal(a, b)));
            foreach (var name in names)
            {
                var inner = at.Folders[name];
                var here = path == "" ? name : $"{path}/{name}";
                var open = filtering || !(closed?.Contains(here) ?? false);
                rows.Add(new FolderRow($"folder:{here}", here, name, depth, inner.Inside, open));
                if (open) Emit(inner, here, depth + 1);
            }
            foreach (var flow in at.Flows) rows.Add(new FlowItemRow($"flow:{flow.Id}", flow, depth));
        }
        Emit(top, "", 0);
        return new FlowList(rows, offered, refs.Count, shown.Count);
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
