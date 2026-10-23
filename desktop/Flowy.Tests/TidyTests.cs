using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>
/// Tidy (src/core/layout.ts, ported in Tidy.cs): neighbours sit on the side they have in the view above. The layered layout under it is the app's
/// own, so these check the rule itself and not the browser's numbers.
/// </summary>
public class TidyTests
{
    private const string Pair = """
        objects:
          ordering: { type: system, name: Ordering }
          backoffice: { type: system, name: Back office }
          api: { type: app, name: Order API, in: ordering }
          web: { type: app, name: Website, in: ordering }
          admin: { type: app, name: Admin, in: backoffice }
          console: { type: app, name: Console, in: backoffice }
        connections:
          - { from: web, to: api }
          - { from: admin, to: api }
          - { from: console, to: api }
          - { from: api, to: admin }

        """;

    private static readonly string[] AllViews = [Names.Root, "ordering", "backoffice"];

    private static EditDoc Start(string layout = "{}\n") => EditDoc.Parse(Pair, layout, [], []);

    private static Region Opposite(Region r) => r switch { Region.Left => Region.Right, Region.Right => Region.Left, Region.Above => Region.Below, _ => Region.Above };

    private static Region SideIn(Model model, string view, string box) => Tidy.NeighbourSides(model, view, [box])[box];

    [Fact]
    public void An_outsider_meets_the_view_in_the_view_both_share()
    {
        var model = Start().ToModel();
        Assert.Equal((Names.Root, "ordering", "backoffice"), Views.Meeting(model, "ordering", "backoffice"));
        Assert.Equal((Names.Root, "ordering", "backoffice"), Views.Meeting(model, "ordering", "admin"));
        Assert.Null(Views.Meeting(model, "ordering", "api")); // a member is not an outsider
        Assert.Null(Views.Meeting(model, "ordering", Names.Root));
        Assert.Null(Views.Meeting(model, "ordering", "ordering"));
    }

    [Fact]
    public void Two_neighbours_sit_on_opposite_sides_of_each_other_whichever_way_the_top_level_has_them()
    {
        foreach (var (a, b, side) in new[] { ((0.0, 0.0), (600.0, 0.0), Region.Right), ((0.0, 0.0), (0.0, 400.0), Region.Below), ((600.0, 0.0), (0.0, 0.0), Region.Left) })
        {
            var model = EditOps.PlaceBoxes(Start(), Names.Root, [("ordering", a.Item1, a.Item2), ("backoffice", b.Item1, b.Item2)]).ToModel();
            Assert.Equal(side, SideIn(model, "ordering", "backoffice"));
            Assert.Equal(Opposite(side), SideIn(model, "backoffice", "ordering"));
        }
    }

    [Fact]
    public void Tidy_puts_every_view_right_and_a_second_look_finds_nothing()
    {
        var doc = EditOps.PlaceBoxes(Start(), Names.Root, [("ordering", 0, 0), ("backoffice", 600, 0)]);
        Assert.NotEmpty(AllViews.SelectMany(v => Tidy.SideProblems(doc.ToModel(), v)));
        foreach (var view in new[] { "ordering", "backoffice" }) doc = EditOps.TidyLayout(doc, view);
        var model = doc.ToModel();
        foreach (var view in AllViews) Assert.Empty(Tidy.SideProblems(model, view));
        Assert.Equal(Region.Right, SideIn(model, "ordering", "backoffice"));
        Assert.Equal(Region.Left, SideIn(model, "backoffice", "ordering"));
    }

    [Fact]
    public void A_view_dragged_the_wrong_way_is_found_and_tidy_puts_it_right()
    {
        var doc = Start();
        foreach (var view in new[] { "ordering", "backoffice" }) doc = EditOps.TidyLayout(doc, view);
        Assert.Empty(AllViews.SelectMany(v => Tidy.SideProblems(doc.ToModel(), v)));
        var wrong = EditOps.PlaceBoxes(doc, "backoffice", [("ordering", 0, 600)]);
        var found = Tidy.SideProblems(wrong.ToModel(), "backoffice");
        var problem = Assert.Single(found);
        Assert.Equal("ordering", problem.Box);
        Assert.Equal(Region.Below, problem.Drawn);
        Assert.Equal(Region.Above, problem.Wanted);
        Assert.Empty(Tidy.SideProblems(EditOps.TidyLayout(wrong, "backoffice").ToModel(), "backoffice"));
    }

    [Fact]
    public void TidyLayout_saves_every_box_of_the_view_as_whole_numbers_and_replaces_what_was_dragged()
    {
        var doc = EditOps.PlaceBoxes(Start(), "ordering", [("web", 11.4, 7.6)]);
        var next = EditOps.TidyLayout(doc, "ordering");
        var saved = (OrderedDictionary<string, object?>)next.Layout["ordering"]!;
        Assert.Equal(["api", "backoffice", "web"], saved.Keys.OrderBy(k => k, StringComparer.Ordinal));
        foreach (var p in saved.Values) foreach (var n in (List<object?>)p!) Assert.Equal(Math.Floor(Convert.ToDouble(n)), Convert.ToDouble(n));
        Assert.NotEqual(new[] { 11.0, 8.0 }, ((List<object?>)saved["web"]!).Select(Convert.ToDouble).ToArray());
        var error = Assert.Throws<OpError>(() => EditOps.TidyLayout(doc, "nowhere"));
        Assert.Contains("unknown view \"nowhere\"", error.Message);
    }

    [Fact]
    public void Tidy_on_the_top_level_saves_the_layout_of_the_boxes_there()
    {
        var saved = (OrderedDictionary<string, object?>)EditOps.TidyLayout(Start(), Names.Root).Layout[Names.Root]!;
        Assert.Equal(["backoffice", "ordering"], saved.Keys.OrderBy(k => k, StringComparer.Ordinal));
    }
}
