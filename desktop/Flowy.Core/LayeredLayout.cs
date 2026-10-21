namespace Flowy.Core;

/// <summary>
/// Boxes in rows by rank, lines running downwards: the layout the browser canvas gets from dagre, here written for equal-sized boxes.
/// Cycles are broken, boxes get the shortest ranks that keep every line pointing down, lines that span several ranks get a stand-in at
/// each one, the stand-ins and boxes in a rank are ordered to cross as little as they can, and then placed as close under what they
/// connect to as the gaps allow. The result is the top-left corner of each box.
/// </summary>
public static class LayeredLayout
{
    private const double EdgeSep = 20; // the gap beside a line passing through a rank

    private sealed class Item
    {
        public int Rank;
        public bool Dummy;
        public readonly List<int> Up = [];
        public readonly List<int> Down = [];
        public double X; // centre
        public double Width => Dummy ? 0 : BoxGeometry.BoxWidth;
    }

    public static OrderedDictionary<string, Pt> Place(IReadOnlyList<string> ids, IReadOnlyList<Ends> edges, double nodeSep, double rankSep)
    {
        var result = new OrderedDictionary<string, Pt>();
        var n = ids.Count;
        if (n == 0) return result;
        var index = new Dictionary<string, int>();
        for (var i = 0; i < n; i++) index[ids[i]] = i;
        var pairs = edges.Where(e => e.From != e.To && index.ContainsKey(e.From) && index.ContainsKey(e.To))
            .Select(e => (From: index[e.From], To: index[e.To])).Distinct().ToList();

        var dag = BreakCycles(n, pairs);
        var rank = Ranks(n, dag);

        // Items 0..n-1 are the boxes; stand-ins for long lines come after.
        var items = Enumerable.Range(0, n).Select(i => new Item { Rank = rank[i] }).ToList();
        foreach (var (from, to) in dag)
        {
            var previous = from;
            for (var r = rank[from] + 1; r < rank[to]; r++)
            {
                items.Add(new Item { Rank = r, Dummy = true });
                Link(items, previous, items.Count - 1);
                previous = items.Count - 1;
            }
            Link(items, previous, to);
        }

        var layers = Order(items, n);
        PlaceAcross(items, layers, nodeSep);

        var left = Enumerable.Range(0, n).Min(i => items[i].X - BoxGeometry.BoxWidth / 2);
        for (var i = 0; i < n; i++)
            result[ids[i]] = new Pt(items[i].X - BoxGeometry.BoxWidth / 2 - left, items[i].Rank * (BoxGeometry.BoxHeight + rankSep));
        return result;
    }

    private static void Link(List<Item> items, int upper, int lower)
    {
        items[upper].Down.Add(lower);
        items[lower].Up.Add(upper);
    }

    /// <summary>The lines with those that close a cycle turned round, found by walking from each box in turn.</summary>
    private static List<(int From, int To)> BreakCycles(int n, List<(int From, int To)> pairs)
    {
        var next = Enumerable.Range(0, n).Select(_ => new List<int>()).ToList();
        foreach (var (from, to) in pairs) next[from].Add(to);
        var state = new int[n]; // 0 not seen, 1 on the way down, 2 done
        var flip = new HashSet<(int, int)>();
        // Depth first with a stack of its own: a chain of thousands of boxes would overflow the call stack, which can't be caught.
        var path = new Stack<(int Box, int Next)>();
        for (var start = 0; start < n; start++)
        {
            if (state[start] != 0) continue;
            state[start] = 1;
            path.Push((start, 0));
            while (path.Count > 0)
            {
                var (v, i) = path.Pop();
                if (i == next[v].Count)
                {
                    state[v] = 2;
                    continue;
                }
                path.Push((v, i + 1));
                var w = next[v][i];
                if (state[w] == 1) flip.Add((v, w));
                else if (state[w] == 0)
                {
                    state[w] = 1;
                    path.Push((w, 0));
                }
            }
        }
        return pairs.Select(p => flip.Contains(p) ? (p.To, p.From) : p).Distinct().ToList();
    }

    /// <summary>Every box one rank below its lowest predecessor, then boxes with more lines going out than coming in moved down toward what they point at, and the other way round.</summary>
    private static int[] Ranks(int n, List<(int From, int To)> dag)
    {
        var preds = Enumerable.Range(0, n).Select(_ => new List<int>()).ToList();
        var succs = Enumerable.Range(0, n).Select(_ => new List<int>()).ToList();
        foreach (var (from, to) in dag)
        {
            succs[from].Add(to);
            preds[to].Add(from);
        }
        // Topological order, boxes taken in the order given.
        var left = preds.Select(p => p.Count).ToArray();
        var order = new List<int>();
        var ready = new Queue<int>(Enumerable.Range(0, n).Where(v => left[v] == 0));
        while (ready.Count > 0)
        {
            var v = ready.Dequeue();
            order.Add(v);
            foreach (var w in succs[v])
                if (--left[w] == 0) ready.Enqueue(w);
        }
        var rank = new int[n];
        foreach (var v in order) rank[v] = preds[v].Count == 0 ? 0 : preds[v].Max(p => rank[p]) + 1;

        for (var pass = 0; pass < 20; pass++)
        {
            var moved = false;
            foreach (var v in order)
            {
                int? target = null;
                if (succs[v].Count > preds[v].Count) target = succs[v].Min(s => rank[s]) - 1;
                else if (preds[v].Count > succs[v].Count) target = preds[v].Max(p => rank[p]) + 1;
                if (target is { } t && t != rank[v])
                {
                    rank[v] = t;
                    moved = true;
                }
            }
            if (!moved) break;
        }
        var min = rank.Min();
        for (var v = 0; v < n; v++) rank[v] -= min;
        return rank;
    }

    /// <summary>The items in each rank, in an order with few crossings: a starting order from walking down, then sweeps up and down by the average place of neighbours.</summary>
    private static List<List<int>> Order(List<Item> items, int n)
    {
        var depth = items.Max(i => i.Rank) + 1;
        var layers = Enumerable.Range(0, depth).Select(_ => new List<int>()).ToList();
        var seen = new bool[items.Count];
        for (var r = 0; r < depth; r++)
        {
            if (r > 0)
                foreach (var v in layers[r - 1])
                    foreach (var w in items[v].Down)
                        if (!seen[w])
                        {
                            seen[w] = true;
                            layers[r].Add(w);
                        }
            for (var v = 0; v < items.Count; v++)
                if (items[v].Rank == r && !seen[v])
                {
                    seen[v] = true;
                    layers[r].Add(v);
                }
        }

        var best = layers.Select(l => l.ToList()).ToList();
        var bestCrossings = Crossings(items, layers);
        for (var iteration = 0; iteration < 24 && bestCrossings > 0; iteration++)
        {
            if (iteration % 2 == 0)
                for (var r = 1; r < depth; r++) Sweep(items, layers, r, true);
            else
                for (var r = depth - 2; r >= 0; r--) Sweep(items, layers, r, false);
            var crossings = Crossings(items, layers);
            if (crossings < bestCrossings)
            {
                bestCrossings = crossings;
                best = layers.Select(l => l.ToList()).ToList();
            }
        }
        return best;
    }

    /// <summary>Reorders rank r by the average place, in the rank above (<paramref name="fromAbove"/>) or below, of what each item connects to. Items with no such neighbour keep their place.</summary>
    private static void Sweep(List<Item> items, List<List<int>> layers, int r, bool fromAbove)
    {
        var position = new Dictionary<int, int>();
        var reference = layers[fromAbove ? r - 1 : r + 1];
        for (var i = 0; i < reference.Count; i++) position[reference[i]] = i;
        layers[r] = layers[r].Select((v, i) =>
        {
            var ns = fromAbove ? items[v].Up : items[v].Down;
            return (V: v, Key: ns.Count == 0 ? i : ns.Average(w => position[w]), I: i);
        }).OrderBy(k => k.Key).ThenBy(k => k.I).Select(k => k.V).ToList();
    }

    private static int Crossings(List<Item> items, List<List<int>> layers)
    {
        // Two lines between the same pair of ranks cross when their upper ends and their lower ends are in opposite orders. Sorted by upper
        // end (then lower), that is a pair where the earlier one's lower end is further along: counted with a Fenwick tree, in n log n.
        var total = 0;
        var position = new int[items.Count];
        for (var r = 0; r + 1 < layers.Count; r++)
        {
            for (var i = 0; i < layers[r + 1].Count; i++) position[layers[r + 1][i]] = i;
            var lines = new List<(int Upper, int Lower)>();
            for (var i = 0; i < layers[r].Count; i++)
                foreach (var w in items[layers[r][i]].Down) lines.Add((i, position[w]));
            lines.Sort((a, b) => a.Upper != b.Upper ? a.Upper.CompareTo(b.Upper) : a.Lower.CompareTo(b.Lower));
            var tree = new int[layers[r + 1].Count + 1];
            for (var seen = 0; seen < lines.Count; seen++)
            {
                var lower = lines[seen].Lower;
                var notAfter = 0; // how many earlier lines end at or before this one's lower end
                for (var k = lower + 1; k > 0; k -= k & -k) notAfter += tree[k];
                total += seen - notAfter;
                for (var k = lower + 1; k < tree.Length; k += k & -k) tree[k]++;
            }
        }
        return total;
    }

    private static double MinGap(Item a, Item b, double nodeSep) => (a.Width + b.Width) / 2 + (a.Dummy || b.Dummy ? EdgeSep : nodeSep);

    /// <summary>Boxes packed left to right, then a few passes down and up moving each rank as near as the gaps allow to the average place of what it connects to.</summary>
    private static void PlaceAcross(List<Item> items, List<List<int>> layers, double nodeSep)
    {
        foreach (var layer in layers)
        {
            var x = 0.0;
            for (var i = 0; i < layer.Count; i++)
            {
                var item = items[layer[i]];
                x = i == 0 ? 0 : items[layer[i - 1]].X + MinGap(items[layer[i - 1]], item, nodeSep);
                item.X = x;
            }
        }
        for (var pass = 0; pass < 12; pass++)
        {
            if (pass % 2 == 0)
                for (var r = 1; r < layers.Count; r++) Pull(items, layers[r], v => items[v].Up, nodeSep);
            else
                for (var r = layers.Count - 2; r >= 0; r--) Pull(items, layers[r], v => items[v].Down, nodeSep);
        }
    }

    /// <summary>
    /// Moves one rank toward the average place of each item's neighbours without changing its order or closing a gap. That is an
    /// isotonic regression: the closest positions to the wanted ones, in order, with the gaps kept (pool adjacent violators).
    /// </summary>
    private static void Pull(List<Item> items, List<int> layer, Func<int, List<int>> neighbours, double nodeSep)
    {
        var count = layer.Count;
        if (count == 0) return;
        // offset[i]: how far item i must be right of item 0 at the least; y[i] = wanted x - offset[i] must not decrease.
        var offset = new double[count];
        for (var i = 1; i < count; i++) offset[i] = offset[i - 1] + MinGap(items[layer[i - 1]], items[layer[i]], nodeSep);
        var wanted = layer.Select((v, i) => (neighbours(v) is { Count: > 0 } ns ? ns.Average(w => items[w].X) : items[v].X) - offset[i]).ToArray();
        var blocks = new List<(double Sum, int Size)>();
        foreach (var w in wanted)
        {
            blocks.Add((w, 1));
            while (blocks.Count > 1 && blocks[^2].Sum / blocks[^2].Size > blocks[^1].Sum / blocks[^1].Size)
            {
                var last = blocks[^1];
                blocks.RemoveAt(blocks.Count - 1);
                blocks[^1] = (blocks[^1].Sum + last.Sum, blocks[^1].Size + last.Size);
            }
        }
        var i2 = 0;
        foreach (var (sum, size) in blocks)
            for (var k = 0; k < size; k++, i2++) items[layer[i2]].X = sum / size + offset[i2];
    }
}
