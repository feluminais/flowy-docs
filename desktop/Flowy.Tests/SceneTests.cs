using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class SceneTests
{
    private static Model WithLayout(Model m, string yaml) =>
        new() { Objects = m.Objects, Connections = m.Connections, Meta = m.Meta, Flows = m.Flows, Layout = ModelFiles.ParseLayout(yaml) };

    private static SceneBox Box(Scene s, string id) => s.Boxes.Single(b => b.Id == id);

    private static SceneEdge Edge(Scene s, string id) => s.Edges.Single(e => e.Id == id);

    [Fact]
    public void The_top_level_shows_its_boxes_with_no_frame_and_no_labels()
    {
        var scene = SceneBuilder.Build(TestModels.Shop(), Names.Root);
        Assert.Equal(["customer", "shop", "mail"], scene.Boxes.Select(b => b.Id));
        Assert.Null(scene.Frame);
        Assert.All(scene.Edges, e => Assert.Null(e.Label));
        Assert.All(scene.Boxes, b => Assert.False(b.Outsider));
        Assert.Equal(3, Box(scene, "shop").Inside);
    }

    [Fact]
    public void Inside_a_box_a_frame_named_after_it_wraps_its_members_and_the_boxes_around_are_outsiders()
    {
        var scene = SceneBuilder.Build(TestModels.Shop(), "shop");
        Assert.Equal(["web", "api", "db"], scene.Members);
        Assert.Equal("Shop", scene.FrameName);
        Assert.True(Box(scene, "customer").Outsider);
        Assert.True(Box(scene, "mail").Outsider);
        Assert.False(Box(scene, "web").Outsider);
        var frame = scene.Frame!.Value;
        foreach (var id in scene.Members)
        {
            var r = Box(scene, id).Rect;
            Assert.True(r.X >= frame.X && r.Right <= frame.Right && r.Y >= frame.Y && r.Bottom <= frame.Bottom, $"{id} is inside the frame");
        }
        Assert.Equal(2, Box(scene, "api").Inside);
    }

    [Fact]
    public void A_box_keeps_the_place_layout_yaml_gives_it_and_nothing_lands_on_it()
    {
        var m = WithLayout(TestModels.Shop(), "shop:\n  web: [10, 20]\n");
        var scene = SceneBuilder.Build(m, "shop");
        Assert.Equal(new Rect(10, 20, 200, 72), Box(scene, "web").Rect);
        foreach (var a in scene.Boxes)
            foreach (var b in scene.Boxes)
                if (a.Id != b.Id) Assert.False(Math.Abs(a.Rect.X - b.Rect.X) < 200 && Math.Abs(a.Rect.Y - b.Rect.Y) < 72, $"{a.Id} and {b.Id} overlap");
    }

    [Fact]
    public void A_shape_that_takes_a_request_off_the_line_is_lit_with_the_step()
    {
        var scene = SceneBuilder.Build(TestModels.Shop(), "shop", new Playing(new (string, string)?[] { ("web", "api") }, 0, Also: ["db"]));
        Assert.Equal(BoxMode.Lit, Box(scene, "db").Mode);
        Assert.Equal(BoxMode.Lit, Box(scene, "web").Mode);
    }

    [Fact]
    public void Playing_a_step_lights_its_boxes_and_its_line_and_dims_the_rest()
    {
        var m = TestModels.Shop();
        var ends = new (string, string)?[] { ("customer", "web"), ("web", "api") };
        var scene = SceneBuilder.Build(m, "shop", new Playing(ends, 1));
        Assert.Equal(BoxMode.Lit, Box(scene, "web").Mode);
        Assert.Equal(BoxMode.Lit, Box(scene, "api").Mode);
        Assert.Equal(BoxMode.Dim, Box(scene, "db").Mode);
        Assert.True(Edge(scene, "web api").Flags.HasFlag(EdgeFlags.Active));
        Assert.Equal("REST", Edge(scene, "web api").Label); // the lit line shows its label
        Assert.True(Edge(scene, "customer web").Flags.HasFlag(EdgeFlags.Dim));
        Assert.Null(Edge(scene, "customer web").Label);
    }

    [Theory]
    [InlineData("step", true)]
    [InlineData("step-1", true)]
    [InlineData("lane-12", true)]
    [InlineData("lane", true)]
    [InlineData("web api", false)]
    [InlineData("step api", false)]
    [InlineData("step-", false)]
    [InlineData("step-x", false)]
    [InlineData("steps", false)]
    public void A_line_a_step_added_is_told_from_a_connection_by_its_id(string id, bool added) => Assert.Equal(added, SceneBuilder.IsStepLine(id));

    [Fact]
    public void A_stop_of_several_steps_lights_every_step_and_dims_the_rest()
    {
        var ends = new (string, string)?[] { ("web", "api"), ("api", "db"), ("api", "mail") };
        var scene = SceneBuilder.Build(TestModels.Shop(), "shop", new Playing(ends, Steps: [0, 1]));
        Assert.All(new[] { "web", "api", "db" }, id => Assert.Equal(BoxMode.Lit, Box(scene, id).Mode));
        Assert.Equal(BoxMode.Dim, Box(scene, "mail").Mode);
        Assert.True(Edge(scene, "web api").Flags.HasFlag(EdgeFlags.Active));
        Assert.True(Edge(scene, "api db").Flags.HasFlag(EdgeFlags.Active));
        Assert.True(Edge(scene, "api mail").Flags.HasFlag(EdgeFlags.Dim));
    }

    [Fact]
    public void Lit_steps_with_no_line_of_their_own_get_dashed_ones_the_click_handler_can_tell_apart()
    {
        var scene = SceneBuilder.Build(TestModels.Shop(), "shop", new Playing(new (string, string)?[] { ("web", "db"), ("mail", "db") }, Steps: [0, 1]));
        Assert.Equal(["step", "step-1"], scene.Edges.Where(e => e.Id.StartsWith("step")).Select(e => e.Id));
        Assert.All(scene.Edges.Where(e => e.Id.StartsWith("step")), e => Assert.True(e.Flags.HasFlag(EdgeFlags.Step)));
    }

    [Fact]
    public void The_steps_of_other_lanes_are_drawn_faint_and_dashed_and_their_boxes_stay_dim()
    {
        var ends = new (string, string)?[] { ("web", "api"), ("api", "mail"), ("web", "db") };
        var scene = SceneBuilder.Build(TestModels.Shop(), "shop", new Playing(ends, Steps: [0], Faint: [1, 2]));
        Assert.True(Edge(scene, "web api").Flags.HasFlag(EdgeFlags.Active));
        Assert.True(Edge(scene, "api mail").Flags.HasFlag(EdgeFlags.Lane));
        var extra = Edge(scene, "lane-2");
        Assert.Equal(("web", "db"), (extra.From, extra.To));
        Assert.True(extra.Flags.HasFlag(EdgeFlags.Lane));
        Assert.Equal(BoxMode.Dim, Box(scene, "mail").Mode);
    }

    [Fact]
    public void A_step_the_view_cannot_show_is_skipped_and_one_step_is_as_it_always_was()
    {
        var m = TestModels.Shop();
        Assert.Equal(BoxMode.Lit, Box(SceneBuilder.Build(m, "shop", new Playing(new (string, string)?[] { null, ("web", "api") }, Steps: [0, 1])), "web").Mode);
        var one = SceneBuilder.Build(m, "shop", new Playing(new (string, string)?[] { ("web", "api") }, 0));
        var same = SceneBuilder.Build(m, "shop", new Playing(new (string, string)?[] { ("web", "api") }, Steps: [0]));
        Assert.Equal(one.Edges.Select(e => (e.Id, e.Flags)), same.Edges.Select(e => (e.Id, e.Flags)));
        Assert.Equal(one.Boxes.Select(b => (b.Id, b.Mode)), same.Boxes.Select(b => (b.Id, b.Mode)));
    }

    [Fact]
    public void A_flow_that_is_not_at_a_step_shows_its_boxes_and_lights_nothing()
    {
        var scene = SceneBuilder.Build(TestModels.Shop(), "shop", new Playing(new (string, string)?[] { ("web", "api") }));
        Assert.All(scene.Boxes, b => Assert.Equal(BoxMode.Normal, b.Mode));
    }

    [Fact]
    public void A_step_with_no_line_of_its_own_gets_a_dashed_one_and_a_step_on_one_box_gets_none()
    {
        var m = TestModels.Shop();
        var scene = SceneBuilder.Build(m, "shop", new Playing(new (string, string)?[] { ("web", "db"), ("api", "api") }, 0));
        var step = Edge(scene, "step");
        Assert.Equal(("web", "db"), (step.From, step.To));
        Assert.True(step.Flags.HasFlag(EdgeFlags.Step));
        var alone = SceneBuilder.Build(m, "shop", new Playing(new (string, string)?[] { ("api", "api") }, 0));
        Assert.DoesNotContain(alone.Edges, e => e.Id == "step");
        Assert.Equal(BoxMode.Lit, Box(alone, "api").Mode);
    }

    [Fact]
    public void A_box_only_the_flow_uses_joins_as_an_outsider_for_the_whole_flow()
    {
        var m = TestModels.Shop(moreObjects: "  extra: { type: system, name: Extra }\n");
        var scene = SceneBuilder.Build(m, "shop", new Playing(new (string, string)?[] { ("web", "extra") }));
        Assert.True(Box(scene, "extra").Outsider);
    }

    [Fact]
    public void Selecting_a_box_labels_its_lines_and_fades_the_others()
    {
        var scene = SceneBuilder.Build(TestModels.Shop(), "shop", focus: new Focus(Box: "api"));
        Assert.Equal("REST", Edge(scene, "web api").Label);
        Assert.False(Edge(scene, "web api").Flags.HasFlag(EdgeFlags.Faint));
        Assert.True(Edge(scene, "customer web").Flags.HasFlag(EdgeFlags.Faint));
        Assert.Null(Edge(scene, "customer web").Label);
    }

    [Fact]
    public void Pointing_at_a_line_or_selecting_it_labels_it()
    {
        var hover = SceneBuilder.Build(TestModels.Shop(), "shop", focus: new Focus(Hover: "customer web"));
        Assert.Equal("browses", Edge(hover, "customer web").Label);
        Assert.True(Edge(hover, "customer web").Flags.HasFlag(EdgeFlags.Hover));
        var selected = SceneBuilder.Build(TestModels.Shop(), "shop", focus: new Focus(Line: "web api"));
        Assert.True(Edge(selected, "web api").Selected);
        Assert.Equal("REST", Edge(selected, "web api").Label);
    }

    [Fact]
    public void A_box_or_line_with_a_problem_is_flagged()
    {
        // 'bare' has no name; the second connection repeats the first, and at the top level both draw as customer → shop.
        var m = TestModels.Shop(moreObjects: "  bare: { type: actor }\n", moreConnections: "  - { from: customer, to: web, label: browses }\n");
        var scene = SceneBuilder.Build(m, Names.Root, problems: Checks.Run(m));
        Assert.True(Box(scene, "bare").Problem);
        Assert.False(Box(scene, "shop").Problem);
        Assert.True(Edge(scene, "customer shop").Flags.HasFlag(EdgeFlags.Problem));
        Assert.False(Edge(scene, "shop mail").Flags.HasFlag(EdgeFlags.Problem));
    }

    [Fact]
    public void The_same_view_is_laid_out_the_same_way_twice()
    {
        var a = SceneBuilder.Build(TestModels.Shop(), "api");
        var b = SceneBuilder.Build(TestModels.Shop(), "api");
        Assert.Equal(a.Boxes.Select(x => (x.Id, x.Rect)), b.Boxes.Select(x => (x.Id, x.Rect)));
    }

    [Fact]
    public void An_empty_view_has_no_boxes_and_no_frame()
    {
        var scene = SceneBuilder.Build(TestModels.FromYaml(""), Names.Root);
        Assert.Empty(scene.Boxes);
        Assert.Null(scene.Frame);
    }
}

public class NavigationTests
{
    [Fact]
    public void Moving_between_views_is_in_out_or_across()
    {
        var m = TestModels.Shop();
        Assert.Equal(Move.In, Navigation.MoveBetween(m, "root", "shop"));
        Assert.Equal(Move.In, Navigation.MoveBetween(m, "shop", "api"));
        Assert.Equal(Move.Out, Navigation.MoveBetween(m, "api", "shop"));
        Assert.Equal(Move.Out, Navigation.MoveBetween(m, "api", "root"));
        Assert.Equal(Move.Across, Navigation.MoveBetween(m, "shop", "mail"));
        Assert.Equal(Move.Across, Navigation.MoveBetween(m, "web", "db"));
    }

    [Fact]
    public void A_box_lists_its_lines_out_and_in_with_the_connections_each_stands_for()
    {
        var m = TestModels.Shop();
        var (outgoing, incoming) = Navigation.LinesOf(m, "api");
        var line = Assert.Single(outgoing, l => l.Other == "db");
        Assert.Equal(2, line.Connections.Count); // orders → db and auth → db
        Assert.Equal(["web"], incoming.Select(l => l.Other));
        Assert.Equal(["db", "mail"], outgoing.Select(l => l.Other));
    }

    [Fact]
    public void Connections_of_a_line_are_found_with_their_place_in_the_file()
    {
        var found = Navigation.ConnectionsOf(TestModels.Shop(), "shop", "api", "db");
        Assert.Equal([2, 3], found.Select(c => c.Index));
    }

    [Fact]
    public void A_problem_is_found_where_the_canvas_shows_it()
    {
        var m = TestModels.Shop(
            moreObjects: "  bare: { type: actor }\n",
            moreConnections: "  - { from: auth, to: ghost }\n  - { from: orders, to: orders }\n  - { from: web, to: api, label: REST }\n");
        var problems = Checks.Run(m);
        Assert.Equal(new Spot("root", "bare"), Navigation.Locate(m, problems.Single(p => p.Id == "bare")));
        // A line to nothing, or to itself, draws nowhere: the spot is the box it starts from, in the view that box sits in.
        Assert.Equal(new Spot("api", "auth"), Navigation.Locate(m, problems.Single(p => p.Message.Contains("ghost"))));
        Assert.Equal(new Spot("api", "orders"), Navigation.Locate(m, problems.Single(p => p.Message.Contains("itself"))));
        // A repeated line is shown where it is drawn: the lowest view, from one end up, that holds both ends.
        Assert.Equal(new Spot("shop", Line: ("web", "api")), Navigation.Locate(m, problems.Single(p => p.Message.Contains("duplicate"))));
    }

    [Fact]
    public void A_flow_problem_opens_the_flow_in_its_view()
    {
        var m = TestModels.Shop(flows: "checkout\nname: ''\nview: shop\nsteps:\n  - { from: web, to: api, text: Asks }\n");
        var spot = Navigation.Locate(m, Checks.Run(m).Single());
        Assert.Equal(new Spot("shop", Flow: "checkout"), spot);
    }

    [Fact]
    public void A_problem_that_points_nowhere_opens_the_top_level()
    {
        Assert.Equal(new Spot("root"), Navigation.Locate(TestModels.Shop(), new Problem("model.yaml", null, "lines must be straight, curved or angled")));
    }

    [Fact]
    public void An_objects_problems_include_those_of_connections_that_touch_it()
    {
        var m = TestModels.Shop(moreConnections: "  - { from: auth, to: ghost }\n");
        var problems = Checks.Run(m);
        Assert.Single(Navigation.ProblemsOf(m, problems, "auth"));
        Assert.Empty(Navigation.ProblemsOf(m, problems, "web"));
    }

    [Theory]
    [InlineData("", new string[0])]
    [InlineData("   ", new string[0])]
    [InlineData("api", new[] { "api" })]
    [InlineData("APP", new[] { "web" })]
    [InlineData("o", new[] { "db", "orders", "customer", "shop" })]
    [InlineData("order db", new[] { "db" })]
    [InlineData("zzz", new string[0])]
    public void Search_finds_objects_holding_every_word_and_puts_names_starting_with_the_first_word_first(string query, string[] expected) =>
        Assert.Equal(expected, Navigation.FindObjects(TestModels.Shop(), query));

    [Fact]
    public void Search_stops_at_the_limit()
    {
        var many = string.Concat(Enumerable.Range(0, 12).Select(i => $"  box{i}: {{ type: actor, name: Box {i} }}\n"));
        Assert.Equal(8, Navigation.FindObjects(TestModels.FromYaml("objects:\n" + many), "box").Count);
        Assert.Equal(3, Navigation.FindObjects(TestModels.FromYaml("objects:\n" + many), "box", 3).Count);
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("", "")]
    [InlineData("One paragraph.", "One paragraph.")]
    [InlineData("First.\n\nSecond.", "First.")]
    [InlineData("  First line\ncontinues.\n   \nNext.  ", "First line\ncontinues.")]
    public void A_teaser_is_the_first_paragraph(string? description, string? teaser) => Assert.Equal(teaser, Navigation.Teaser(description));

    [Fact]
    public void Escape_peels_one_layer_at_a_time_and_then_goes_back()
    {
        Assert.Equal(EscapeStep.Shortcuts, Navigation.Escape(true, true, true, true, true, true));
        Assert.Equal(EscapeStep.Navigator, Navigation.Escape(false, true, true, true, true, true));
        Assert.Equal(EscapeStep.Flow, Navigation.Escape(false, false, true, true, true, true));
        Assert.Equal(EscapeStep.Panel, Navigation.Escape(false, false, false, true, true, true));
        Assert.Equal(EscapeStep.Compare, Navigation.Escape(false, false, false, false, true, true)); // a panel over a comparison closes first; the comparison before going up a level
        Assert.Equal(EscapeStep.Back, Navigation.Escape(false, false, false, false, true, false, paneInside: true)); // a pane zoomed into a shape goes up before the comparison closes
        Assert.Equal(EscapeStep.Panel, Navigation.Escape(false, false, false, true, true, false, paneInside: true));
        Assert.Equal(EscapeStep.Back, Navigation.Escape(false, false, false, false, false, true));
        Assert.Null(Navigation.Escape(false, false, false, false, false, false));
    }
}

/// <summary>The scene's choices (outsiders, lit, dim, flagged, quiet, labelled) and what the panels work out must match ui/src/graph.ts and edit.ts.</summary>
public class SceneParityTests
{
    private static JsonNode ScenesJson() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "scenes.json")))!;

    private static JsonNode NavigationJson() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "navigation.json")))!;

    private static Folder Load(string folder) => FolderLoader.Load(Path.Combine(Repo.Root, folder));

    private static List<string> Tokens(IEnumerable<string> classes) => classes.OrderBy(c => c, StringComparer.Ordinal).ToList();

    private static List<string> Tokens(JsonNode n) => n.AsArray().Select(c => c!.GetValue<string>()).ToList();

    [Fact]
    public void Every_scene_decides_what_the_browser_canvas_decides()
    {
        var scenes = ScenesJson()["scenes"]!.AsArray();
        Assert.True(scenes.Count > 30);
        foreach (var s in scenes)
        {
            var folder = Load(s!["folder"]!.GetValue<string>());
            var view = s["view"]!.GetValue<string>();
            Playing? playing = s["playing"] is { } p
                ? new Playing(p["ends"]!.AsArray().Select(e => e is null ? ((string, string)?)null : (e[0]!.GetValue<string>(), e[1]!.GetValue<string>())).ToList(), p["step"]?.GetValue<int>(),
                    p["steps"]?.AsArray().Select(i => i!.GetValue<int>()).ToList(), p["faint"]?.AsArray().Select(i => i!.GetValue<int>()).ToList())
                : null;
            var f = s["focus"]!;
            var focus = new Focus(f["box"]?.GetValue<string>(), f["line"]?.GetValue<string>(), f["hover"]?.GetValue<string>());
            var what = $"{s["folder"]} {view} {s["playing"]?.ToJsonString()} {f.ToJsonString()}";

            var scene = SceneBuilder.Build(folder.Model, view, playing, folder.Problems, focus);
            Assert.True(Tokens(s["members"]!).SequenceEqual(scene.Members), $"{what}: members");
            var boxes = s["boxes"]!.AsArray();
            Assert.True(boxes.Select(b => b!["id"]!.GetValue<string>()).SequenceEqual(scene.Boxes.Select(b => b.Id)), $"{what}: boxes in order");
            for (var i = 0; i < boxes.Count; i++)
            {
                Assert.True(Tokens(boxes[i]!["classes"]!).SequenceEqual(Tokens(SceneBuilder.Classes(scene.Boxes[i]))), $"{what}: classes of {scene.Boxes[i].Id}");
                Assert.Equal(boxes[i]!["inside"]!.GetValue<int>(), scene.Boxes[i].Inside);
            }
            var edges = s["edges"]!.AsArray();
            Assert.True(edges.Select(e => e!["id"]!.GetValue<string>()).SequenceEqual(scene.Edges.Select(e => e.Id)), $"{what}: lines in order");
            for (var i = 0; i < edges.Count; i++)
            {
                var (want, got) = (edges[i]!, scene.Edges[i]);
                Assert.Equal(want["source"]!.GetValue<string>(), got.From);
                Assert.Equal(want["target"]!.GetValue<string>(), got.To);
                Assert.Equal(want["label"]?.GetValue<string>(), got.Label);
                Assert.Equal(want["selected"]!.GetValue<bool>(), got.Selected);
                Assert.True(Tokens(want["classes"]!).SequenceEqual(Tokens(SceneBuilder.Classes(got))), $"{what}: classes of line {got.Id}");
            }
        }
    }

    /// <summary>One line of text per line in a panel, so two lists compare with a readable difference.</summary>
    private static string Describe(string from, string to, string other, IEnumerable<(string From, string To, string? Label)> connections) =>
        $"{from} > {to} (other: {other}): " + string.Join("; ", connections.Select(c => $"{c.From} > {c.To} [{c.Label ?? "no label"}]"));

    private static List<string> Lines(JsonNode n) =>
        n.AsArray().Select(l => Describe(l!["from"]!.GetValue<string>(), l["to"]!.GetValue<string>(), l["other"]!.GetValue<string>(),
            l["connections"]!.AsArray().Select(c => (c!["from"]!.GetValue<string>(), c["to"]!.GetValue<string>(), c["label"]?.GetValue<string>())))).ToList();

    private static List<string> Lines(IEnumerable<BoxLine> lines) =>
        lines.Select(l => Describe(l.From, l.To, l.Other, l.Connections.Select(c => (c.From!, c.To!, c.Label)))).ToList();

    [Fact]
    public void A_boxs_lines_are_the_same_in_its_panel()
    {
        foreach (var (name, folder) in new[] { ("plum", "docs/demo/flowy"), ("example", "example") })
        {
            var model = Load(folder).Model;
            var expected = NavigationJson()["linesOf"]![name]!.AsArray();
            Assert.Equal(model.Objects.Keys.Count, expected.Count);
            foreach (var e in expected)
            {
                var (outgoing, incoming) = Navigation.LinesOf(model, e!["id"]!.GetValue<string>());
                Assert.Equal(Lines(e["out"]!), Lines(outgoing));
                Assert.Equal(Lines(e["in"]!), Lines(incoming));
            }
        }
    }

    [Fact]
    public void A_problem_is_located_where_the_browser_canvas_shows_it()
    {
        var folder = Load("desktop/fixtures/cases/problems/flowy");
        var located = NavigationJson()["locate"]!.AsArray();
        Assert.Equal(folder.Problems.Count, located.Count);
        for (var i = 0; i < located.Count; i++)
        {
            var spot = Navigation.Locate(folder.Model, folder.Problems[i]);
            var want = located[i]!["spot"]!;
            var what = folder.Problems[i].Message;
            Assert.Equal(want["view"]!.GetValue<string>(), spot.View);
            Assert.Equal(want["object"]?.GetValue<string>(), spot.Object);
            Assert.Equal(want["flow"]?.GetValue<string>(), spot.Flow);
            Assert.Equal(want["step"]?.GetValue<int>(), spot.Step);
            Assert.Equal(want["line"] is { } l ? (l[0]!.GetValue<string>(), l[1]!.GetValue<string>()) : ((string, string)?)null, spot.Line);
            _ = what;
        }
    }

    [Fact]
    public void Moves_and_searches_give_the_browser_canvas_answers()
    {
        var plum = Load("docs/demo/flowy").Model;
        foreach (var m in NavigationJson()["moves"]!.AsArray())
            Assert.Equal(m!["move"]!.GetValue<string>(), Navigation.MoveBetween(plum, m["from"]!.GetValue<string>(), m["to"]!.GetValue<string>()).ToString().ToLowerInvariant());
        var models = new Dictionary<string, Model> { ["plum"] = plum, ["example"] = Load("example").Model };
        foreach (var s in NavigationJson()["search"]!.AsArray())
            Assert.Equal(Tokens(s!["found"]!), Navigation.FindObjects(models[s["model"]!.GetValue<string>()], s["query"]!.GetValue<string>()));
    }
}
