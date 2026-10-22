using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class CompareTests
{
    private static OrderedDictionary<string, object?> Map(params (string Key, object? Value)[] pairs)
    {
        var map = new OrderedDictionary<string, object?>();
        foreach (var (key, value) in pairs) map.Add(key, value);
        return map;
    }

    /// <summary>Items by id, each holding its raw compare value (null for none), in the order given.</summary>
    private static OrderedDictionary<string, object?> Items(params (string Id, object? Compare)[] items) => Map(items.Select(i => (i.Id, i.Compare)).ToArray());

    [Fact]
    public void Of_reads_the_short_and_the_long_form()
    {
        Assert.Equal(new CompareTag("a"), Compares.Of("a"));
        Assert.Equal(new CompareTag("a"), Compares.Of(Map(("with", "a"))));
        Assert.Equal(new CompareTag("a", "why"), Compares.Of(Map(("with", "a"), ("note", "why"))));
    }

    [Fact]
    public void Of_drops_a_blank_note_and_reads_anything_else_as_no_tag()
    {
        Assert.Equal(new CompareTag("a"), Compares.Of(Map(("with", "a"), ("note", " "))));
        Assert.Equal(new CompareTag("a"), Compares.Of(Map(("with", "a"), ("note", new List<object?> { "x" }))));
        foreach (var bad in new object?[] { null, "", "  ", new List<object?> { "a" }, Map(), Map(("note", "x")), Map(("with", "")), Map(("with", new List<object?>())) })
            Assert.Null(Compares.Of(bad));
    }

    [Fact]
    public void Problem_is_quiet_for_an_absent_or_readable_value_and_names_the_kind_otherwise()
    {
        Assert.Null(Compares.Problem(null, "flow"));
        Assert.Null(Compares.Problem("a", "flow"));
        Assert.Null(Compares.Problem(Map(("with", "a"), ("note", "x")), "run"));
        Assert.Equal("compare must be a flow id, or { with, note } with text", Compares.Problem(new List<object?> { "a" }, "flow"));
        Assert.Equal("compare must be a run id, or { with, note } with text", Compares.Problem(Map(("note", "x")), "run"));
        Assert.Equal("compare must be a flow id, or { with, note } with text", Compares.Problem("", "flow"));
    }

    [Fact]
    public void Partners_lists_every_item_that_tags_the_id_in_key_order()
    {
        Assert.Equal([new Partner("b", "after"), new Partner("c", "after")], Compares.Partners(Items(("a", null), ("b", "a"), ("c", "a")), "a"));
    }

    [Fact]
    public void Partners_lists_what_the_id_tags_first_as_the_older_side_with_its_note()
    {
        var items = Items(("a", Map(("with", "z"), ("note", "n"))), ("b", "a"), ("z", null));
        Assert.Equal([new Partner("z", "before", "n"), new Partner("b", "after")], Compares.Partners(items, "a"));
    }

    [Fact]
    public void A_mutual_pair_lists_once_as_the_ids_own_tag()
    {
        var items = Items(("a", "b"), ("b", "a"));
        Assert.Equal([new Partner("b", "before")], Compares.Partners(items, "a"));
        Assert.Equal([new Partner("a", "before")], Compares.Partners(items, "b"));
    }

    [Fact]
    public void An_item_never_lists_itself()
    {
        Assert.Empty(Compares.Partners(Items(("a", "a")), "a"));
        Assert.Equal([new Partner("b", "after")], Compares.Partners(Items(("a", "a"), ("b", "a")), "a"));
    }

    [Fact]
    public void A_tag_to_a_missing_item_is_still_listed_so_the_ui_can_grey_it_out()
    {
        Assert.Equal([new Partner("gone", "before")], Compares.Partners(Items(("a", "gone")), "a"));
        Assert.Empty(Compares.Partners(Items(), "nobody"));
    }

    [Fact]
    public void Linked_holds_every_id_that_tags_or_is_tagged_where_the_target_exists()
    {
        var items = Items(("a", "b"), ("b", null), ("c", null), ("d", "gone"), ("e", "e"));
        Assert.Equal(["a", "b"], Compares.Linked(items).Order().ToArray());
    }

    [Fact]
    public void A_flow_file_keeps_its_raw_compare_and_reads_the_tag_from_it()
    {
        const string steps = "steps:\n  - { from: a, to: b, text: t }\n";
        Assert.Null(ModelFiles.ParseFlow("f", "name: F\nview: root\n" + steps).CompareRaw);
        Assert.Equal(new CompareTag("old"), ModelFiles.ParseFlow("f", "name: F\nview: root\ncompare: old\n" + steps).Compare);
        Assert.Equal(new CompareTag("old", "why"), ModelFiles.ParseFlow("f", "name: F\nview: root\ncompare: { with: old, note: why }\n" + steps).Compare);
    }

    [Theory]
    [InlineData("compare:\n  - old\n")]
    [InlineData("compare:\n")]
    [InlineData("compare: { note: why }\n")]
    public void A_flow_with_a_compare_of_the_wrong_shape_still_loads_and_has_no_tag(string text)
    {
        var flow = ModelFiles.ParseFlow("f", "name: F\nview: root\n" + text + "steps:\n  - { from: a, to: b, text: t }\n");
        Assert.NotNull(flow.CompareRaw);
        Assert.Null(flow.Compare);
        Assert.Empty(flow.NoValue); // the shape problem is the check's, not an empty key
    }

    private const string Steps = "steps:\n  - { from: customer, to: web, text: Clicks Buy }\n";

    /// <summary>What the checks say about a shop with an older flow and a newer one whose file holds <paramref name="compare"/>.</summary>
    private static string[] Said(string compare) =>
        [.. Checks.Run(TestModels.Shop(flows: "older\nname: Older\nview: shop\n" + Steps + "===\nnewer\nname: Newer\nview: shop\n" + compare + Steps)).Select(p => $"{p.File} {p.Message}")];

    [Fact]
    public void The_check_names_a_compare_that_is_not_a_flow_or_is_the_flow_itself_or_has_the_wrong_shape()
    {
        Assert.Empty(Said("compare: older\n"));
        Assert.Empty(Said("compare: { with: older, note: after the fix }\n"));
        Assert.Equal(["flows/newer.yaml compare \"nope\" is not a flow"], Said("compare: nope\n"));
        Assert.Equal(["flows/newer.yaml compare points at this flow itself"], Said("compare: newer\n"));
        Assert.Equal(["flows/newer.yaml compare must be a flow id, or { with, note } with text"], Said("compare:\n  - older\n"));
        Assert.Equal(["flows/newer.yaml compare must be a flow id, or { with, note } with text"], Said("compare:\n"));
    }

    private const string Levels = "levels:\n  - { load: 1 }\n  - { load: 2 }\n";

    [Fact]
    public void A_run_keeps_the_tag_in_either_form_and_leaves_out_one_that_cannot_be_read()
    {
        Assert.Equal(new CompareTag("other"), Perf.ParseRun("r", "name: Run\ncompare: other\n" + Levels).Run.Compare);
        Assert.Equal(new CompareTag("other", "why"), Perf.ParseRun("r", "name: Run\ncompare: { with: other, note: why }\n" + Levels).Run.Compare);
        Assert.Null(Perf.ParseRun("r", "name: Run\n" + Levels).Run.Compare);
        var (run, problems) = Perf.ParseRun("r", "name: Run\ncompare: [a]\n" + Levels);
        Assert.Null(run.Compare);
        Assert.Equal("compare must be a run id, or { with, note } with text", Assert.Single(problems).Message);
    }

    [Fact]
    public void A_bare_compare_on_a_run_is_no_tag_and_no_problem()
    {
        var (run, problems) = Perf.ParseRun("r", "name: Run\ncompare:\n" + Levels);
        Assert.Null(run.Compare);
        Assert.Empty(problems);
    }

    [Fact]
    public void A_run_that_adds_others_keeps_its_tag_too()
    {
        Assert.Equal(new CompareTag("other"), Perf.ParseRun("both", "name: Both\ncompare: other\nadds: [a, b]\n").Run.Compare);
    }

    private static LoadRun Run(CompareTag? compare = null) => new("R", null, "load", null, []) { Compare = compare };

    [Fact]
    public void CheckRuns_names_a_compare_that_is_not_a_run_or_is_the_run_itself()
    {
        string[] Said(IdMap<LoadRun> runs) => [.. Perf.CheckRuns(runs).Select(p => $"{p.File} {p.Message}")];
        Assert.Equal(["perf/a.yaml compare \"b\" is not a run"], Said(new IdMap<LoadRun> { { "a", Run(new CompareTag("b")) } }));
        Assert.Equal(["perf/a.yaml compare points at this run itself"], Said(new IdMap<LoadRun> { { "a", Run(new CompareTag("a")) } }));
        Assert.Empty(Said(new IdMap<LoadRun> { { "a", Run(new CompareTag("b")) }, { "b", Run() } }));
    }
}
