namespace Flowy.Core;

/// <summary>What folding a pair gave: its strands as they are drawn, and for each strand that was folded into a trunk, the id of the trunk (in the order the strands were folded).</summary>
public sealed record Folding(IReadOnlyList<Strand> Strands, OrderedDictionary<string, string> Stands);

/// <summary>A view with its pairs folded where their lines do not fit: <c>View.Strands</c> are the strands to draw, <c>Stands</c> the trunk each folded strand is in, <c>Unfolded</c> the view as <see cref="Views.Compute"/> made it.</summary>
public sealed record DrawnView(View View, OrderedDictionary<string, string> Stands, View Unfolded);

/// <summary>
/// Many lines between two shapes. A pair draws at most <see cref="Lanes.Most"/> lines side by side, fewer where the shapes are short across the pair (see <see cref="Lanes.LaneCapacity"/>). A pair with more has its
/// lines folded into trunks: the lines that run the same way and share a kind become one lane with two hairlines behind it and a chip with the number of connections it holds. A trunk opens
/// into its lines (up to <see cref="Lanes.OpenMost"/>) while its pair is selected. A trunk never hides a connection: the panel of the pair lists every one.
///
/// Where the folding stops depends on the room across the shapes, so it is worked out from where they are drawn (see <see cref="Draw"/>). A port of src/core/trunks.ts, held equal by desktop/fixtures.
/// </summary>
public static class Trunks
{
    /// <summary>The text between a trunk id's pair and ends and its kind: a control character, which YAML cannot hold, so no label can make a trunk's id the id of a strand.</summary>
    public const string Mark = "\u0002";

    /// <summary>The id of the trunk that stands for the lines of one direction and kind of a pair; <paramref name="kind"/> is null for a trunk of lines of different kinds, or of none.</summary>
    public static string TrunkId(string pair, string from, string to, string? kind) => $"{pair}|{from}>{to}|{Mark}{kind ?? ""}";

    /// <summary>The words a trunk goes by where it has a name (its pill, its accessible name): the kind and the number of connections, or just the number for lines of no one kind.</summary>
    public static string TrunkLabel(string? kind, int size) => kind is null ? $"{size} connections" : $"{Kinds.NameOf(kind)} x{size}";

    /// <summary>Whether a strand runs from the later id of its pair to the earlier: the lanes of one way and the other are told apart by it (see <see cref="Lanes.SlotsOf"/>).</summary>
    private static bool Backward(Strand s) => string.CompareOrdinal(s.From, s.To) > 0;

    /// <summary>The strands grouped by the way they run and, with <paramref name="byKind"/>, by kind; in the order of each group's first strand (the lanes are in order, the back ones first, so that is lane order).</summary>
    private static List<List<Strand>> GroupsOf(IReadOnlyList<Strand> strands, bool byKind)
    {
        var groups = new OrderedDictionary<string, List<Strand>>();
        foreach (var s in strands)
        {
            var key = $"{(Backward(s) ? 'b' : 'f')}|{(byKind ? s.Kind ?? "" : "")}";
            if (!groups.TryGetValue(key, out var group)) groups[key] = group = [];
            group.Add(s);
        }
        return [.. groups.Values];
    }

    /// <summary>One trunk for a group of strands of one pair that run the same way.</summary>
    private static Strand TrunkOf(List<Strand> group, int lane, int lanes)
    {
        var first = group[0];
        var kind = group.All(s => s.Kind == first.Kind) ? first.Kind : null;
        var look = group.All(s => (s.Look is null && first.Look is null) || (s.Look is not null && first.Look is not null && Kinds.SameLook(s.Look, first.Look))) ? first.Look : null;
        var connections = group.SelectMany(s => s.Connections).ToList();
        return new Strand(TrunkId(first.Pair, first.From, first.To, kind), first.Pair, first.From, first.To, TrunkLabel(kind, connections.Count), connections, lane, lanes, kind, look,
            new Trunk(connections.Count, group.Select(s => s.Id).ToList()));
    }

    /// <summary>
    /// The lines of one pair as they are drawn, given <paramref name="half"/>, the smaller half-room of its two shapes across it (see <see cref="Lanes.RoomOf"/>). <paramref name="strands"/> are the pair's strands in lane order.
    /// They all fit (<see cref="Lanes.LaneCapacity"/>): as they are. They do not: one trunk for each way and kind (a group of one stays a lane). If the lanes that makes, with
    /// <see cref="Lanes.TrunkExtra"/> more room for each trunk, fit, that is the folding. They do not: one trunk for each way, whatever the kinds. That is two lanes at most.
    /// The lanes are numbered again (<c>Lane</c>, <c>Lanes</c>) for what is drawn.
    /// </summary>
    public static Folding FoldPair(IReadOnlyList<Strand> strands, double half)
    {
        var bothWays = strands.Any(Backward) && strands.Any(s => !Backward(s));
        var same = new Folding([.. strands], []);
        if (strands.Count < 2 || strands.Count <= Lanes.LaneCapacity(half, bothWays)) return same;
        var byKind = GroupsOf(strands, true);
        var groups = byKind.Count <= Lanes.LaneCapacity(half, bothWays, byKind.Count(g => g.Count > 1)) ? byKind : GroupsOf(strands, false);
        var output = new List<Strand>();
        var stands = new OrderedDictionary<string, string>();
        for (var lane = 0; lane < groups.Count; lane++)
        {
            var group = groups[lane];
            if (group.Count == 1)
            {
                output.Add(group[0] with { Lane = lane, Lanes = groups.Count });
                continue;
            }
            var trunk = TrunkOf(group, lane, groups.Count);
            foreach (var s in group) stands[s.Id] = trunk.Id;
            output.Add(trunk);
        }
        return new Folding(output, stands);
    }

    /// <summary>
    /// The view's strands folded pair by pair, and the id of the trunk for each strand that was folded. <paramref name="half"/> says the smaller half-room of the shapes at the ends of a pair (see
    /// <see cref="Lanes.RoomOf"/>), and is asked only for a pair with <see cref="Lanes.FoldFrom"/> strands or more. Null for a view that draws one line for each pair: it has no strands and nothing to fold.
    /// </summary>
    public static Folding? FoldStrands(IReadOnlyList<Strand>? strands, Func<string, string, double> half)
    {
        if (strands is null) return null;
        var pairs = new OrderedDictionary<string, List<Strand>>();
        foreach (var s in strands)
        {
            if (!pairs.TryGetValue(s.Pair, out var list)) pairs[s.Pair] = list = [];
            list.Add(s);
        }
        var output = new List<Strand>();
        var stands = new OrderedDictionary<string, string>();
        foreach (var list in pairs.Values)
        {
            if (list.Count < Lanes.FoldFrom)
            {
                output.AddRange(list);
                continue;
            }
            var folded = FoldPair(list, half(list[0].From, list[0].To));
            output.AddRange(folded.Strands);
            foreach (var (member, trunk) in folded.Stands) stands[member] = trunk;
        }
        return new Folding(output, stands);
    }

    /// <summary>
    /// The strands to draw when the pairs in <paramref name="opened"/> are selected: a trunk of such a pair is replaced by the strands it folded, each in the trunk's lane, which then fan out of its place
    /// (see <see cref="LaneSlot.Fan"/>), unless it holds more than <see cref="Lanes.OpenMost"/> of them. <paramref name="unfolded"/> are the strands before folding, by id.
    /// </summary>
    public static List<Strand> OpenTrunks(IReadOnlyList<Strand> strands, IReadOnlyDictionary<string, Strand> unfolded, ISet<string> opened)
    {
        if (opened.Count == 0) return [.. strands];
        return [.. strands.SelectMany(s => s.Trunk is null || !opened.Contains(s.Pair) || s.Trunk.Members.Count > Lanes.OpenMost
            ? [s]
            : s.Trunk.Members.Select(id => unfolded[id] with { Lane = s.Lane, Lanes = s.Lanes }))];
    }

    /// <summary>The pairs a selected line opens: the pair of the strand whose id it is, or the pair whose id it is.</summary>
    public static HashSet<string> PairsOpenedBy(IReadOnlyList<Strand> unfolded, string? selected) =>
        selected is null ? [] : unfolded.Where(s => s.Id == selected || s.Pair == selected).Select(s => s.Pair).ToHashSet();

    /// <summary>
    /// The view as it is drawn in a line <paramref name="style"/>: <see cref="Views.Compute"/>'s, with the strands of each pair that has too many for the room between its shapes folded into trunks.
    /// The room is measured where the shapes are laid out (see <see cref="SceneBuilder.SpotsOf"/>), each box big and with the outline of its shape; it is worked out only for a pair with
    /// <see cref="Lanes.FoldFrom"/> strands or more.
    /// </summary>
    public static DrawnView Draw(Model model, string view, string style = "straight", View? computed = null)
    {
        computed ??= Views.Compute(model, view);
        OrderedDictionary<string, Pt>? at = null;
        LaneBox Box(string id)
        {
            at ??= SceneBuilder.SpotsOf(model, view, computed, [.. computed.Members, .. computed.Outsiders]);
            var p = at.TryGetValue(id, out var found) ? found : new Pt(0, 0);
            return new LaneBox(id, new Rect(p.X, p.Y, BoxGeometry.BoxWidth, BoxGeometry.BoxHeight), model.Objects.TryGetValue(id, out var o) ? Look.DefOf(o).Edge : []);
        }
        var folded = FoldStrands(computed.Strands, (from, to) => Lanes.Round3(Lanes.RoomOf(Box(from), Box(to), style)));
        if (folded is null) return new DrawnView(computed, [], computed);
        return new DrawnView(computed with { Strands = folded.Strands }, folded.Stands, computed);
    }

    /// <summary>
    /// The id of the line a step rides as it is drawn: the id of the strand <see cref="Strands.StrandOf"/> gives, or of its trunk where the pair folded its lines. Null for a step that rides none.
    /// <paramref name="placed"/> is where the step lands on the view (see <see cref="Views.PlaceStep"/>).
    /// </summary>
    public static string? DrawnStrandOf(Model model, DrawnView drawn, Step step, (string From, string To) placed)
    {
        var id = Strands.StrandOf(model, drawn.Unfolded, step, placed)?.Id;
        return id is null ? null : drawn.Stands.TryGetValue(id, out var trunk) ? trunk : id;
    }
}
