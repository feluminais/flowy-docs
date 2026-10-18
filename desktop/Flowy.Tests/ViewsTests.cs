using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

// Ported from test/views.test.ts: the same shop, the same expectations.
public class ViewsTests
{
    private static string[] EdgeNames(View v) => v.Edges.Select(e => $"{e.From}>{e.To}").ToArray();

    [Fact]
    public void Chain_walks_up_to_root()
    {
        var m = TestModels.Shop();
        Assert.Equal(["auth", "api", "shop", "root"], Views.Chain(m, "auth"));
        Assert.Equal(["root"], Views.Chain(m, "root"));
    }

    [Fact]
    public void Chain_survives_cycles()
    {
        var m = TestModels.FromYaml("objects:\n" + TestModels.ShopObjects
            .Replace("web: { type: app, in: shop", "web: { type: app, in: api")
            .Replace("api: { type: app, in: shop", "api: { type: app, in: web"));
        Assert.Equal(["web", "api", "root"], Views.Chain(m, "web"));
    }

    [Fact]
    public void Members_are_the_direct_children()
    {
        var m = TestModels.Shop();
        Assert.Equal(["customer", "shop", "mail"], Views.MemberIds(m, "root"));
        Assert.Equal(["web", "api", "db"], Views.MemberIds(m, "shop"));
        Assert.True(Views.HasChildren(m, "api"));
        Assert.False(Views.HasChildren(m, "db"));
    }

    [Fact]
    public void The_root_view_folds_everything_inside_shop_into_one_box()
    {
        var v = Views.Compute(TestModels.Shop(), "root");
        Assert.Equal(["customer", "shop", "mail"], v.Members);
        Assert.Empty(v.Outsiders);
        Assert.Equal([new Edge("customer", "shop", "browses", 1), new Edge("shop", "mail", "sends receipts", 1)], v.Edges);
    }

    [Fact]
    public void Inside_shop_outsiders_appear_and_the_two_api_db_lines_merge()
    {
        var v = Views.Compute(TestModels.Shop(), "shop");
        Assert.Equal(["web", "api", "db"], v.Members);
        Assert.Equal(["customer", "mail"], v.Outsiders);
        Assert.Equal(
            [
                new Edge("customer", "web", "browses", 1),
                new Edge("web", "api", "REST", 1),
                new Edge("api", "db", "2 connections", 2),
                new Edge("api", "mail", "sends receipts", 1),
            ],
            v.Edges);
    }

    [Fact]
    public void Inside_api_sibling_stores_and_other_systems_are_outsiders()
    {
        var v = Views.Compute(TestModels.Shop(), "api");
        Assert.Equal(["auth", "orders"], v.Members);
        Assert.Equal(["db", "mail"], v.Outsiders);
        Assert.Equal(["orders>db", "auth>db", "orders>mail"], EdgeNames(v));
    }

    [Fact]
    public void A_connection_to_the_system_you_are_inside_shows_that_system_as_an_outsider()
    {
        var m = TestModels.Shop(moreConnections: "  - { from: auth, to: shop, label: reports to }\n");
        var v = Views.Compute(m, "api");
        Assert.Equal(["db", "mail", "shop"], v.Outsiders);
        Assert.Equal(new Edge("auth", "shop", "reports to", 1), v.Edges[^1]);
    }

    [Fact]
    public void Deep_objects_in_other_branches_are_lifted_to_the_box_you_can_see()
    {
        var m = TestModels.Shop(
            moreObjects: "  ui: { type: component, in: web, name: UI }\n  queue: { type: store, in: mail, name: Queue }\n",
            connections: "  - { from: ui, to: auth }\n  - { from: auth, to: queue }\n");
        var v = Views.Compute(m, "api");
        Assert.Equal(["web", "mail"], v.Outsiders);
        Assert.Equal(["web>auth", "auth>mail"], EdgeNames(v));
    }

    [Fact]
    public void Opposite_directions_stay_separate_lines()
    {
        var v = Views.Compute(TestModels.Shop(moreConnections: "  - { from: api, to: web, label: pushes }\n"), "shop");
        Assert.Contains(v.Edges, e => e is { From: "web", To: "api", Count: 1 });
        Assert.Contains(v.Edges, e => e is { From: "api", To: "web", Count: 1 });
    }

    [Fact]
    public void A_missing_or_self_pointing_parent_counts_as_top_level()
    {
        var m = TestModels.Shop(
            moreObjects: "  lost: { type: app, in: nowhere, name: Lost }\n  loop: { type: system, in: loop, name: Loop }\n",
            moreConnections: "  - { from: loop, to: customer }\n");
        Assert.Equal(["customer", "shop", "mail", "lost", "loop"], Views.MemberIds(m, "root"));
        var v = Views.Compute(m, "root");
        Assert.Empty(v.Outsiders);
        Assert.Contains(v.Edges, e => e is { From: "loop", To: "customer" });
    }

    [Fact]
    public void PlaceEnds_maps_flow_steps_and_hides_what_a_view_cannot_show()
    {
        var m = TestModels.Shop();
        Assert.Equal(("customer", "web"), Views.PlaceEnds(m, "shop", "customer", "web"));
        Assert.Equal(("api", "db"), Views.PlaceEnds(m, "shop", "orders", "db"));
        Assert.Null(Views.PlaceEnds(m, "root", "web", "api"));
        Assert.Null(Views.PlaceEnds(m, "api", "customer", "web"));
        Assert.Null(Views.PlaceEnds(m, "shop", "ghost", "web"));
        Assert.Null(Views.PlaceEnds(m, "root", "root", "web"));
    }

    [Fact]
    public void PlaceStep_puts_a_one_box_step_on_the_box_that_stands_for_it_twice()
    {
        var m = TestModels.Shop();
        Assert.Equal(("api", "api"), Views.PlaceStep(m, "shop", "auth", null));
        Assert.Null(Views.PlaceStep(m, "shop", "mail", null)); // around the view, not in it
        Assert.Null(Views.PlaceStep(m, "shop", "shop", null)); // the box you're inside
        Assert.Equal(("web", "api"), Views.PlaceStep(m, "shop", "web", "api"));
        Assert.Null(Views.PlaceStep(m, "shop", "ghost", null));
    }

    [Fact]
    public void StepEnds_names_the_part_inside_a_box_a_step_lands_on()
    {
        var m = TestModels.Shop();
        Assert.Equal("Web app → API", Views.StepEnds(m, "web", "api", ("web", "api")));
        Assert.Equal("Customer → Web app in Shop", Views.StepEnds(m, "customer", "web", ("customer", "shop")));
        Assert.Equal("Web app in Shop → API in Shop", Views.StepEnds(m, "web", "api", ("shop", "shop")));
        Assert.Equal("API in Shop", Views.StepEnds(m, "api", null, ("shop", "shop")));
        Assert.Equal("API", Views.StepEnds(m, "api", null, null));
    }

    [Fact]
    public void IsView_is_the_top_level_or_an_object_with_children()
    {
        var m = TestModels.Shop();
        Assert.True(Views.IsView(m, "root"));
        Assert.True(Views.IsView(m, "shop"));
        Assert.False(Views.IsView(m, "db"));
        Assert.False(Views.IsView(m, "ghost"));
        Assert.False(Views.IsView(m, null));
    }

    [Fact]
    public void NameOf_falls_back_to_the_id_and_calls_the_top_level_Overview()
    {
        var m = TestModels.Shop(moreObjects: "  bare: { type: actor }\n");
        Assert.Equal("Overview", Views.NameOf(m, "root"));
        Assert.Equal("Web app", Views.NameOf(m, "web"));
        Assert.Equal("bare", Views.NameOf(m, "bare"));
        Assert.Equal("ghost", Views.NameOf(m, "ghost"));
    }
}
