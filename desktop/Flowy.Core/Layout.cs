namespace Flowy.Core;

public readonly record struct Ends(string From, string To);

/// <summary>Where an outsider waits: in the column left or right of the members, or in the rows below or above.</summary>
public enum Region { Left, Right, Below, Above }

/// <summary>
/// A view's members where the layered layout put them (<c>At</c>), how far they reach, and for each outsider the average place of
/// the members it connects to (the middle when it connects to none). None of this changes while the outsiders move around.
/// <c>People</c> only start lines and always wait above.
/// </summary>
public sealed record Members(
    OrderedDictionary<string, Pt> At, double Left, double Right, double Top, double Bottom, Pt Middle,
    OrderedDictionary<string, Pt> Mean, List<string> People, List<string> Rest);

public sealed record Arranged(OrderedDictionary<string, Pt> At, List<List<string>> Rows, List<List<string>> Columns);

/// <summary>
/// Where the boxes of a view go when nothing is saved. A port of the placement half of ui/src/graph.ts: the same measure of how
/// tangled a layout looks, the same arrangement of outsiders around the members, the same swaps. Only the layered layout under it
/// (<see cref="LayeredLayout"/>) is the app's own, where the browser uses dagre.
/// </summary>
public static class Layout
{
    /// <summary>Every box has the same size, so boxes can be placed before they are drawn. Keep in step with the box control.</summary>
    public const double BoxWidth = 200;

    public const double BoxHeight = 72;

    private const double Near = 80; // between the members and the outsiders around them
    private const double Stack = 30; // between boxes stacked in a column or row
    private const int PerRow = 4; // outsiders that only start lines wait above the members, this many to a row

    private static readonly Region[] Regions = [Region.Left, Region.Right, Region.Below, Region.Above];

    private readonly record struct Segment(double Ax, double Ay, double Bx, double By);

    /// <summary>Which side of the line through p and q the point r is on: 1, -1, or 0 when it's on the line.</summary>
    private static int Turn(double px, double py, double qx, double qy, double rx, double ry) => Math.Sign((qx - px) * (ry - py) - (qy - py) * (rx - px));

    /// <summary>Whether segment s and the segment (cx, cy)–(dx, dy) cross at a point inside both. Touching or lying in line doesn't count.</summary>
    private static bool Crosses(Segment s, double cx, double cy, double dx, double dy) =>
        Turn(s.Ax, s.Ay, s.Bx, s.By, cx, cy) * Turn(s.Ax, s.Ay, s.Bx, s.By, dx, dy) < 0
        && Turn(cx, cy, dx, dy, s.Ax, s.Ay) * Turn(cx, cy, dx, dy, s.Bx, s.By) < 0;

    /// <summary>Whether segment s runs through the box at p. The box is shrunk by 4px so a line grazing a corner doesn't count.</summary>
    private static bool RunsThrough(Segment s, Pt p)
    {
        double l = p.X + 4, t = p.Y + 4, r = p.X + BoxWidth - 4, b = p.Y + BoxHeight - 4;
        return Crosses(s, l, t, r, b) || Crosses(s, r, t, l, b);
    }

    /// <summary>
    /// The lines and boxes of a layout kept as arrays, so that trying a move of a box or two and scoring it again costs what the move touches
    /// and not a rebuild of everything. <see cref="Tangle"/> is its score, as the browser canvas's tangle() computes it.
    /// </summary>
    private sealed class Board
    {
        private const double Hx = BoxWidth / 2, Hy = BoxHeight / 2;
        private readonly Dictionary<string, int> _index = [];
        private readonly Pt[] _at;
        private readonly (int From, int To)[] _lines;
        private readonly List<int>[] _touching;
        private readonly Segment[] _segments;

        public Board(OrderedDictionary<string, Pt> at, IReadOnlyList<Ends> edges)
        {
            var i = 0;
            foreach (var id in at.Keys) _index[id] = i++;
            _at = at.Values.ToArray();
            _lines = edges.Where(e => e.From != e.To && _index.ContainsKey(e.From) && _index.ContainsKey(e.To)).Select(e => (_index[e.From], _index[e.To])).ToArray();
            _touching = Enumerable.Range(0, _at.Length).Select(_ => new List<int>()).ToArray();
            _segments = new Segment[_lines.Length];
            for (var l = 0; l < _lines.Length; l++)
            {
                _touching[_lines[l].From].Add(l);
                _touching[_lines[l].To].Add(l);
                Recompute(l);
            }
        }

        private void Recompute(int l)
        {
            var (a, b) = (_at[_lines[l].From], _at[_lines[l].To]);
            _segments[l] = new Segment(a.X + Hx, a.Y + Hy, b.X + Hx, b.Y + Hy);
        }

        public int IndexOf(string id) => _index[id];

        public bool Has(string id) => _index.ContainsKey(id);

        public void Put(int box, Pt p)
        {
            _at[box] = p;
            foreach (var l in _touching[box]) Recompute(l);
        }

        /// <summary>Each pair of lines that cross, plus each time a line runs through a box that isn't one of its ends. With <paramref name="moved"/>, only what involves those boxes.</summary>
        public int Score(IReadOnlyCollection<int>? moved)
        {
            var movedSet = moved is null ? null : new HashSet<int>(moved);
            var moves = new bool[_lines.Length];
            for (var l = 0; l < _lines.Length; l++) moves[l] = movedSet is null || movedSet.Contains(_lines[l].From) || movedSet.Contains(_lines[l].To);
            var score = 0;
            for (var i = 0; i < _lines.Length; i++)
            {
                var (from, to) = _lines[i];
                // Each crossing pair is counted once, from the first of its lines that moves.
                if (moves[i])
                    for (var j = 0; j < _lines.Length; j++)
                    {
                        if (j == i || (moves[j] && j < i)) continue;
                        var m = _lines[j];
                        var shared = m.From == from || m.From == to || m.To == from || m.To == to;
                        if (!shared && Crosses(_segments[i], _segments[j].Ax, _segments[j].Ay, _segments[j].Bx, _segments[j].By)) score++;
                    }
                if (moves[i])
                {
                    for (var box = 0; box < _at.Length; box++)
                        if (box != from && box != to && RunsThrough(_segments[i], _at[box])) score++;
                }
                else if (movedSet is not null)
                {
                    foreach (var box in movedSet)
                        if (box != from && box != to && RunsThrough(_segments[i], _at[box])) score++;
                }
            }
            return score;
        }
    }

    /// <summary>
    /// How tangled a layout looks: each pair of lines that cross (lines from the same box never do), plus each time a line runs through
    /// a box that isn't one of its ends. Lines are taken centre to centre. With <paramref name="moved"/>, it counts only what involves
    /// those boxes, which is all a move of them can change.
    /// </summary>
    public static int Tangle(OrderedDictionary<string, Pt> at, IReadOnlyList<Ends> edges, ISet<string>? moved = null)
    {
        var board = new Board(at, edges);
        return board.Score(moved?.Where(board.Has).Select(board.IndexOf).ToList());
    }

    /// <summary>
    /// Pairs of boxes next to each other. Within each group of <paramref name="rows"/>, boxes in the same row (same y), in order along it;
    /// within each group of <paramref name="columns"/>, boxes in the same column (same x). Boxes never pair across groups, so an outsider
    /// never trades places with a member, and a view's own boxes never trade places up and down.
    /// </summary>
    private static List<(string, string)> Neighbours(OrderedDictionary<string, Pt> at, List<List<string>> rows, List<List<string>> columns)
    {
        var pairs = new List<(string, string)>();
        void Pair(List<string> ids, bool rowsOfY)
        {
            var lines = new OrderedDictionary<long, List<string>>();
            foreach (var id in ids)
            {
                // Math.round in JavaScript rounds halves up, unlike Math.Round here.
                var k = (long)Math.Floor((rowsOfY ? at[id].Y : at[id].X) + 0.5);
                if (!lines.TryGetValue(k, out var line)) lines[k] = line = [];
                line.Add(id);
            }
            foreach (var line in lines.Values)
            {
                var sorted = line.OrderBy(id => rowsOfY ? at[id].X : at[id].Y).ToList();
                for (var i = 1; i < sorted.Count; i++) pairs.Add((sorted[i - 1], sorted[i]));
            }
        }
        foreach (var ids in rows) Pair(ids, true);
        foreach (var ids in columns) Pair(ids, false);
        return pairs;
    }

    /// <summary>
    /// Swaps neighbouring boxes while a swap makes the layout less tangled, until a whole pass swaps nothing, or after
    /// <paramref name="passes"/> passes. Boxes only trade spots, so the layout's shape stays the same. Without groups, any two boxes in a row may trade.
    /// </summary>
    public static OrderedDictionary<string, Pt> Untangle(
        OrderedDictionary<string, Pt> at, IReadOnlyList<Ends> edges, List<List<string>>? rows = null, List<List<string>>? columns = null, int passes = 30)
    {
        rows ??= [at.Keys.ToList()];
        columns ??= [];
        var next = new OrderedDictionary<string, Pt>(at);
        var board = new Board(next, edges);
        var score = board.Score(null);
        for (var pass = 0; pass < passes && score > 0; pass++)
        {
            var swapped = false;
            foreach (var (a, b) in Neighbours(next, rows, columns))
            {
                var pair = new[] { board.IndexOf(a), board.IndexOf(b) };
                var before = board.Score(pair);
                var (pa, pb) = (next[a], next[b]);
                next[a] = pb;
                next[b] = pa;
                board.Put(pair[0], pb);
                board.Put(pair[1], pa);
                var change = board.Score(pair) - before;
                if (change < 0)
                {
                    score += change;
                    swapped = true;
                }
                else
                {
                    next[a] = pa;
                    next[b] = pb;
                    board.Put(pair[0], pa);
                    board.Put(pair[1], pb);
                }
            }
            if (!swapped) break;
        }
        return next;
    }

    /// <summary>Outsiders that only start lines (people, mostly). They always wait above.</summary>
    private static bool StartsOnly(string id, IReadOnlyList<Ends> edges) => edges.Any(e => e.From == id) && !edges.Any(e => e.To == id);

    public static Members MembersOf(OrderedDictionary<string, Pt> inner, IReadOnlyList<string> outsiders, IReadOnlyList<Ends> edges)
    {
        var spots = inner.Values.ToList();
        var left = spots.Count == 0 ? double.PositiveInfinity : spots.Min(p => p.X);
        var right = spots.Count == 0 ? double.NegativeInfinity : spots.Max(p => p.X) + BoxWidth;
        var top = spots.Count == 0 ? double.PositiveInfinity : spots.Min(p => p.Y);
        var bottom = spots.Count == 0 ? double.NegativeInfinity : spots.Max(p => p.Y) + BoxHeight;
        var middle = new Pt((left + right) / 2, (top + bottom) / 2);
        var mean = new OrderedDictionary<string, Pt>();
        foreach (var id in outsiders)
        {
            var ps = edges.SelectMany(e => e.From == id ? [e.To] : e.To == id ? [e.From] : Array.Empty<string>())
                .SelectMany(end => inner.TryGetValue(end, out var p) ? [p] : Array.Empty<Pt>()).ToList();
            mean[id] = ps.Count == 0 ? middle : new Pt(ps.Sum(p => p.X) / ps.Count, ps.Sum(p => p.Y) / ps.Count);
        }
        var people = outsiders.Where(id => StartsOnly(id, edges)).ToList();
        return new Members(inner, left, right, top, bottom, middle, mean, people, outsiders.Where(id => !people.Contains(id)).ToList());
    }

    /// <summary>
    /// Inside a box: the members sit together in the middle. The outsiders stay at the edges: people above, in rows, and the rest where
    /// <paramref name="region"/> says, in a column on either side or in rows below or above. Each group is sorted by where the members it
    /// connects to are, which keeps lines from crossing on the way in. Also returns which boxes may trade places (see <see cref="Untangle"/>).
    /// </summary>
    public static Arranged Arrange(Members m, Func<string, Region> region)
    {
        var at = new OrderedDictionary<string, Pt>(m.At);
        List<string> ByMean(IEnumerable<string> ids, bool byY) => ids.OrderBy(id => byY ? m.Mean[id].Y : m.Mean[id].X).ToList();
        // Rows of at most PerRow, centred under or over the members. `y` gives each row's top.
        void PutRows(List<string> ids, Func<int, double> y)
        {
            for (var row = 0; row * PerRow < ids.Count; row++)
            {
                var r = ids.Skip(row * PerRow).Take(PerRow).ToList();
                var width = r.Count * BoxWidth + (r.Count - 1) * Stack;
                for (var j = 0; j < r.Count; j++) at[r[j]] = new Pt(m.Middle.X - width / 2 + j * (BoxWidth + Stack), y(row));
            }
        }
        static double Height(int n) => n * BoxHeight + Math.Max(0, n - 1) * Stack;

        List<List<string>> columns = [ByMean(m.Rest.Where(id => region(id) == Region.Left), true), ByMean(m.Rest.Where(id => region(id) == Region.Right), true)];
        var tallest = Math.Max(0, columns.Max(c => Height(c.Count)));
        for (var i = 0; i < columns.Count; i++)
        {
            var ids = columns[i];
            var x = i == 0 ? m.Left - Near - BoxWidth : m.Right + Near;
            for (var j = 0; j < ids.Count; j++) at[ids[j]] = new Pt(x, m.Middle.Y - Height(ids.Count) / 2 + j * (BoxHeight + Stack));
        }
        // Rows above and below are wider than the members, so they clear the side columns too.
        var below = ByMean(m.Rest.Where(id => region(id) == Region.Below), false);
        var belowTop = Math.Max(m.Bottom, m.Middle.Y + tallest / 2) + Near;
        PutRows(below, row => belowTop + row * (BoxHeight + Stack));
        var above = ByMean([.. m.People, .. m.Rest.Where(id => region(id) == Region.Above)], false);
        var aboveBottom = Math.Min(m.Top, m.Middle.Y - tallest / 2) - Near - BoxHeight;
        PutRows(above, row => aboveBottom - row * (BoxHeight + Stack));
        return new Arranged(at, [m.At.Keys.ToList(), above, below], columns);
    }

    /// <summary>
    /// Moves outsiders between the side columns and the rows below and above, one at a time, keeping a move when it makes the layout less
    /// tangled, until a whole pass moves nothing (or <paramref name="passes"/> passes).
    /// </summary>
    private static OrderedDictionary<string, Region> Settle(Members m, IReadOnlyList<Ends> edges, OrderedDictionary<string, Region> start, int passes)
    {
        var region = new OrderedDictionary<string, Region>(start);
        OrderedDictionary<string, Pt> Arranged() => Arrange(m, id => region[id]).At;
        var at = Arranged();
        var score = Tangle(at, edges);
        for (var pass = 0; pass < passes && score > 0; pass++)
        {
            var changed = false;
            foreach (var id in region.Keys.ToList())
                foreach (var r in Regions)
                {
                    var was = region[id];
                    if (r == was) continue;
                    region[id] = r;
                    var next = Arranged();
                    // A move re-sorts the groups it leaves and joins, so more than one box can shift.
                    var moved = next.Keys.Where(k => next[k] != at[k]).ToHashSet();
                    var change = Tangle(next, edges, moved) - Tangle(at, edges, moved);
                    if (change < 0)
                    {
                        score += change;
                        at = next;
                        changed = true;
                    }
                    else region[id] = was;
                }
            if (!changed) break;
        }
        return region;
    }

    /// <summary>The same ids in an order that only depends on <paramref name="seed"/>, so a layout never changes between runs.</summary>
    private static List<string> Shuffled(List<string> ids, long seed)
    {
        var o = ids.ToList();
        for (var i = o.Count - 1; i > 0; i--)
        {
            seed = seed * 16807 % 2147483647;
            var j = (int)(seed % (i + 1));
            (o[i], o[j]) = (o[j], o[i]);
        }
        return o;
    }

    /// <summary>
    /// Where every box of a view goes when nothing is saved. Finding the least tangled layout is NP-hard, so this settles for a good one. The
    /// layered layout starts from several orders of the boxes (as given, reversed, most lines first, then a few fixed shuffles), and the
    /// outsiders from two places (split between the side columns, or all in rows below). From each start, outsiders move between sides while
    /// that helps, then boxes trade places. The least tangled wins, the first on a tie, so a clean view keeps its side columns.
    /// </summary>
    public static OrderedDictionary<string, Pt> Place(IReadOnlyList<string> members, IReadOnlyList<string> around, IReadOnlyList<Edge> edges)
    {
        var lines = edges.Select(e => new Ends(e.From, e.To)).ToList();
        int Degree(string id) => lines.Count(e => e.From == id || e.To == id);
        // Known limit: a big view tries one starting order with fewer passes, so it still opens without a pause.
        var big = (members.Count + around.Count) * lines.Count > 2000;
        var passes = big ? 5 : 30;
        // Known limit: past this many boxes times lines, scoring the tangle alone takes seconds, so the layered layout stands as it is.
        var huge = (members.Count + around.Count) * lines.Count > 500_000;
        List<Func<List<string>, List<string>>> orders =
        [
            ids => ids,
            ids => Enumerable.Reverse(ids).ToList(),
            ids => ids.OrderByDescending(Degree).ToList(),
            .. Enumerable.Range(1, 6).Select<int, Func<List<string>, List<string>>>(seed => ids => Shuffled(ids, seed)),
        ];
        if (big) orders = orders[..1];

        OrderedDictionary<string, Pt>? best = null;
        var bestScore = int.MaxValue;
        void Consider(OrderedDictionary<string, Pt> at, List<List<string>> rows, List<List<string>> columns)
        {
            var tidy = huge ? at : Untangle(at, lines, rows, columns, passes);
            var score = huge ? 0 : Tangle(tidy, lines);
            if (score < bestScore) (best, bestScore) = (tidy, score);
        }
        foreach (var order in orders)
        {
            if (members.Count == 0 || around.Count == 0)
            {
                var all = order([.. members, .. around]);
                Consider(LayeredLayout.Place(all, lines, 60, 90), [all], []);
                continue;
            }
            var m = MembersOf(LayeredLayout.Place(order(members.ToList()), lines, 40, 70), order(around.ToList()), lines);
            // Split by where their members are: the left half of them in the left column, the rest on the right.
            var rest = m.Rest.OrderBy(id => m.Mean[id].X).ToList();
            var split = new OrderedDictionary<string, Region>();
            for (var i = 0; i < rest.Count; i++) split[rest[i]] = i < rest.Count / 2 ? Region.Left : Region.Right;
            var below = new OrderedDictionary<string, Region>();
            foreach (var id in rest) below[id] = Region.Below;
            foreach (var start in new[] { split, below })
            {
                var region = huge ? start : Settle(m, lines, start, passes);
                var arranged = Arrange(m, id => region[id]);
                Consider(arranged.At, arranged.Rows, arranged.Columns);
            }
        }
        return best!;
    }
}
