using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class LayeredLayoutTests
{
    private static Ends E(string from, string to) => new(from, to);

    private static OrderedDictionary<string, Pt> Place(string[] ids, params Ends[] edges) => LayeredLayout.Place(ids, edges, 40, 70);

    private static bool Overlap(Pt a, Pt b) => Math.Abs(a.X - b.X) < Layout.BoxWidth && Math.Abs(a.Y - b.Y) < Layout.BoxHeight;

    [Fact]
    public void Nothing_in_gives_nothing_out() => Assert.Empty(Place([]));

    [Fact]
    public void A_single_box_sits_at_the_origin() => Assert.Equal(new Pt(0, 0), Place(["a"])["a"]);

    [Fact]
    public void A_chain_runs_straight_down_one_rank_apart()
    {
        var at = Place(["a", "b", "c"], E("a", "b"), E("b", "c"));
        Assert.Equal(new Pt(0, 0), at["a"]);
        Assert.Equal(new Pt(0, 142), at["b"]);
        Assert.Equal(new Pt(0, 284), at["c"]);
    }

    [Fact]
    public void Boxes_in_a_rank_sit_side_by_side_with_the_gap_between()
    {
        var at = Place(["root", "x", "y"], E("root", "x"), E("root", "y"));
        Assert.Equal(at["x"].Y, at["y"].Y);
        Assert.Equal(Layout.BoxWidth + 40, Math.Abs(at["x"].X - at["y"].X));
        // the parent is centred over its two children
        Assert.Equal((at["x"].X + at["y"].X) / 2, at["root"].X, 9);
    }

    [Fact]
    public void A_box_that_only_starts_lines_is_pulled_down_to_just_above_what_it_points_at()
    {
        // Courier → Delivery → Ordering: Customer also points at Ordering, so Customer sits one rank above it, not at the top.
        var at = Place(["courier", "delivery", "customer", "ordering"], E("courier", "delivery"), E("delivery", "ordering"), E("customer", "ordering"));
        Assert.Equal(at["delivery"].Y, at["customer"].Y);
        Assert.True(at["courier"].Y < at["delivery"].Y);
    }

    [Fact]
    public void Every_line_points_downwards_and_no_two_boxes_overlap_even_with_cycles()
    {
        string[] ids = ["a", "b", "c", "d", "e", "f"];
        Ends[] edges = [E("a", "b"), E("b", "c"), E("c", "a"), E("c", "d"), E("a", "e"), E("e", "f"), E("d", "f"), E("f", "b")];
        var at = Place(ids, edges);
        Assert.Equal(ids.Length, at.Count);
        foreach (var x in ids)
            foreach (var y in ids)
                if (x != y) Assert.False(Overlap(at[x], at[y]), $"{x} and {y} overlap");
    }

    [Fact]
    public void A_long_chain_does_not_overflow_a_small_stack()
    {
        // Cycle breaking once walked the boxes by recursion: a few thousand in a row overflowed the stack, which ends the process.
        var ids = Enumerable.Range(0, 4000).Select(i => $"o{i}").ToArray();
        var edges = ids.Zip(ids.Skip(1), E).Append(E(ids[^1], ids[0])).ToArray();
        OrderedDictionary<string, Pt>? at = null;
        var thread = new Thread(() => at = Place(ids, edges), 256 * 1024);
        thread.Start();
        thread.Join();
        Assert.Equal(ids.Length, at?.Count);
    }

    [Fact]
    public void A_line_that_spans_ranks_leaves_its_ends_in_the_ranks_the_chain_gives_them()
    {
        // a → b → c → d and a → d: d is three ranks down whichever way round the long line goes.
        var at = Place(["a", "b", "c", "d"], E("a", "b"), E("b", "c"), E("c", "d"), E("a", "d"));
        Assert.Equal(new[] { 0.0, 142, 284, 426 }, new[] { at["a"].Y, at["b"].Y, at["c"].Y, at["d"].Y });
    }

    [Fact]
    public void The_same_input_gives_the_same_layout_and_stays_in_the_order_given()
    {
        string[] ids = ["z", "y", "x", "w"];
        Ends[] edges = [E("z", "x"), E("y", "x"), E("x", "w")];
        var first = Place(ids, edges);
        var second = Place(ids, edges);
        Assert.Equal(first.Select(kv => (kv.Key, kv.Value)), second.Select(kv => (kv.Key, kv.Value)));
        Assert.Equal(ids, first.Keys);
    }

    [Fact]
    public void Lines_to_boxes_that_are_not_there_and_lines_to_self_are_ignored()
    {
        var at = Place(["a", "b"], E("a", "ghost"), E("a", "a"), E("a", "b"));
        Assert.True(at["a"].Y < at["b"].Y);
    }

    [Fact]
    public void Disconnected_boxes_all_share_the_top_rank()
    {
        var at = Place(["a", "b", "c"]);
        Assert.All(at.Values, p => Assert.Equal(0, p.Y));
        Assert.Equal(3, at.Values.Select(p => p.X).Distinct().Count());
    }
}

public class LayoutTests
{
    private static Edge Line(string from, string to) => new(from, to, "", 1);

    private static bool Overlap(Pt a, Pt b) => Math.Abs(a.X - b.X) < Layout.BoxWidth && Math.Abs(a.Y - b.Y) < Layout.BoxHeight;

    [Fact]
    public void A_view_with_members_and_outsiders_gets_every_box_a_place_of_its_own()
    {
        var at = Layout.Place(["a", "b", "c"], ["p", "q", "r"], [Line("p", "a"), Line("a", "b"), Line("b", "c"), Line("c", "q"), Line("r", "b")]);
        Assert.Equal(6, at.Count);
        foreach (var x in at.Keys)
            foreach (var y in at.Keys)
                if (x != y) Assert.False(Overlap(at[x], at[y]), $"{x} and {y} overlap");
    }

    [Fact]
    public void Outsiders_wait_outside_the_members_and_people_wait_above()
    {
        var at = Layout.Place(["a", "b"], ["person", "other"], [Line("person", "a"), Line("b", "other"), Line("a", "b")]);
        var top = Math.Min(at["a"].Y, at["b"].Y);
        Assert.True(at["person"].Y < top, "a box that only starts lines waits above the members");
        Assert.NotEqual(at["other"], at["a"]);
    }

    [Fact]
    public void The_same_view_always_gets_the_same_layout()
    {
        string[] members = ["a", "b", "c", "d"];
        string[] around = ["x", "y", "z"];
        Edge[] edges = [Line("x", "a"), Line("a", "b"), Line("b", "c"), Line("c", "d"), Line("d", "y"), Line("z", "c"), Line("a", "d")];
        var first = Layout.Place(members, around, edges);
        var second = Layout.Place(members, around, edges);
        Assert.Equal(first.Select(kv => (kv.Key, kv.Value)), second.Select(kv => (kv.Key, kv.Value)));
    }

    [Fact]
    public void A_view_with_no_outsiders_or_no_members_is_laid_out_as_one_group()
    {
        Assert.Equal(2, Layout.Place(["a", "b"], [], [Line("a", "b")]).Count);
        Assert.Equal(2, Layout.Place([], ["a", "b"], [Line("a", "b")]).Count);
        Assert.Empty(Layout.Place([], [], []));
    }

    [Fact]
    public void Swapping_neighbours_stops_a_crossing_when_it_can()
    {
        var at = new OrderedDictionary<string, Pt> { ["a"] = new Pt(0, 0), ["b"] = new Pt(300, 0), ["c"] = new Pt(600, 0) };
        Ends[] lines = [new("a", "c"), new("b", "c")];
        Assert.Equal(1, Layout.Tangle(at, lines)); // a → c runs through b
        var after = Layout.Untangle(at, lines);
        Assert.Equal(0, Layout.Tangle(after, lines));
    }
}

/// <summary>
/// Layout's tangle count, arrangement of outsiders and swaps must give the browser canvas's numbers (ui/src/graph.ts) from the same
/// starting places. The members' own places come from dagre there and from LayeredLayout here, so the scenarios fix them by hand.
/// </summary>
public class LayoutParityTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "placement.json")))!;

    private static OrderedDictionary<string, Pt> Spots(JsonNode n)
    {
        var map = new OrderedDictionary<string, Pt>();
        foreach (var s in n.AsArray()) map[s![0]!.GetValue<string>()] = new Pt(s[1]!.GetValue<double>(), s[2]!.GetValue<double>());
        return map;
    }

    private static List<Ends> Edges(JsonNode n) => n.AsArray().Select(e => new Ends(e!["from"]!.GetValue<string>(), e["to"]!.GetValue<string>())).ToList();

    private static List<string> Strings(JsonNode n) => n.AsArray().Select(s => s!.GetValue<string>()).ToList();

    private static List<List<string>> Groups(JsonNode n) => n.AsArray().Select(g => Strings(g!)).ToList();

    private static void SameSpots(OrderedDictionary<string, Pt> want, OrderedDictionary<string, Pt> got, string what)
    {
        Assert.Equal(want.Keys, got.Keys); // the order boxes are listed in matters: the swaps walk them in it
        foreach (var (id, p) in want)
        {
            Assert.True(Math.Abs(p.X - got[id].X) < 1e-9 && Math.Abs(p.Y - got[id].Y) < 1e-9, $"{what}: {id} expected {p}, got {got[id]}");
        }
    }

    [Fact]
    public void Outsiders_are_measured_arranged_and_untangled_as_the_browser_canvas_does()
    {
        var scenarios = Expected()["scenarios"]!.AsArray();
        Assert.True(scenarios.Count >= 9);
        foreach (var s in scenarios)
        {
            var name = s!["name"]!.GetValue<string>();
            var (inner, outsiders, edges) = (Spots(s["inner"]!), Strings(s["outsiders"]!), Edges(s["edges"]!));
            var regions = s["regions"]!.AsObject().ToDictionary(kv => kv.Key, kv => Enum.Parse<Region>(kv.Value!.GetValue<string>(), true));

            var m = Layout.MembersOf(inner, outsiders, edges);
            var want = s["members"]!;
            Assert.Equal(want["left"]!.GetValue<double>(), m.Left);
            Assert.Equal(want["right"]!.GetValue<double>(), m.Right);
            Assert.Equal(want["top"]!.GetValue<double>(), m.Top);
            Assert.Equal(want["bottom"]!.GetValue<double>(), m.Bottom);
            Assert.Equal(new Pt(want["middle"]!["x"]!.GetValue<double>(), want["middle"]!["y"]!.GetValue<double>()), m.Middle);
            SameSpots(Spots(want["mean"]!), m.Mean, $"{name} mean");
            Assert.Equal(Strings(want["people"]!), m.People);
            Assert.Equal(Strings(want["rest"]!), m.Rest);

            var arranged = Layout.Arrange(m, id => regions[id]);
            SameSpots(Spots(s["arranged"]!["at"]!), arranged.At, $"{name} arranged");
            Assert.Equal(Groups(s["arranged"]!["rows"]!), arranged.Rows);
            Assert.Equal(Groups(s["arranged"]!["columns"]!), arranged.Columns);
            Assert.Equal(s["tangleArranged"]!.GetValue<int>(), Layout.Tangle(arranged.At, edges));

            var tidy = Layout.Untangle(arranged.At, edges, arranged.Rows, arranged.Columns);
            SameSpots(Spots(s["tidy"]!), tidy, $"{name} untangled");
            Assert.Equal(s["tangleTidy"]!.GetValue<int>(), Layout.Tangle(tidy, edges));
        }
    }

    [Fact]
    public void Without_groups_any_two_boxes_in_a_row_may_trade()
    {
        var u = Expected()["ungrouped"]!;
        var before = Spots(u["before"]!);
        var edges = Edges(u["edges"]!);
        Assert.Equal(u["tangleBefore"]!.GetValue<int>(), Layout.Tangle(before, edges));
        SameSpots(Spots(u["after"]!), Layout.Untangle(before, edges), "ungrouped");
    }
}
