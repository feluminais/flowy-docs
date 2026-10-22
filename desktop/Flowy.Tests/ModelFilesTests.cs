using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class ModelFilesTests
{
    [Fact]
    public void A_model_file_gives_objects_connections_and_the_other_keys()
    {
        var parsed = ModelFiles.ParseModel("lines: curved\nobjects:\n  a: { type: actor, name: A, code: [src/a.ts] }\nconnections:\n  - { from: a, to: a, label: loop }\n");
        var a = parsed.Objects["a"];
        Assert.Equal(new FlowyObject("actor", "A", null, null, null, null, a.Code), a);
        Assert.Equal<object?>(["src/a.ts"], Assert.IsType<List<object?>>(a.Code));
        Assert.Equal(new Connection("a", "a", "loop"), Assert.Single(parsed.Connections));
        Assert.Equal("curved", parsed.Meta["lines"]);
        Assert.False(parsed.Meta.ContainsKey("objects"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("# nothing\n")]
    [InlineData("objects:\nconnections: ~\n")]
    [InlineData("objects: null\nconnections: Null\n")]
    public void An_empty_file_or_empty_sections_mean_an_empty_model(string text)
    {
        var parsed = ModelFiles.ParseModel(text);
        Assert.Equal(0, parsed.Objects.Count);
        Assert.Empty(parsed.Connections);
    }

    [Theory]
    [InlineData("- a\n", "expected a mapping with \"objects\" and \"connections\"")]
    [InlineData("just text\n", "expected a mapping with \"objects\" and \"connections\"")]
    [InlineData("objects:\n  - a\n", "\"objects\" must map ids to mappings")]
    [InlineData("objects:\n  a: text\n", "object \"a\" must be a mapping")]
    [InlineData("objects:\n  a:\n    name: [x]\n", "object \"a\": \"name\" must be plain text, not a list or a mapping")]
    [InlineData("connections: nope\n", "\"connections\" must be a list")]
    [InlineData("connections:\n  - a\n", "connection 1 must be a mapping")]
    [InlineData("connections:\n  - { from: a }\n  - { from: [x], to: b }\n", "connection 2: \"from\" must be plain text, not a list or a mapping")]
    public void A_file_of_the_wrong_shape_is_refused(string text, string reason)
    {
        var e = Assert.Throws<ParseError>(() => ModelFiles.ParseModel(text));
        Assert.Equal("model.yaml", e.File);
        Assert.Equal(reason, e.Reason);
    }

    [Fact]
    public void Objects_are_listed_the_way_JavaScript_lists_keys()
    {
        var parsed = ModelFiles.ParseModel("objects:\n  b: { type: actor, name: B }\n  10: { type: actor, name: Ten }\n  2: { type: actor, name: Two }\n  007: { type: actor, name: Bond }\n  a: { type: actor, name: A }\n");
        Assert.Equal(["2", "10", "b", "007", "a"], parsed.Objects.Keys);
        Assert.Equal(["2", "10", "b", "007", "a"], parsed.Objects.Select(kv => kv.Key));
    }

    [Fact]
    public void A_flow_file_gives_a_name_a_view_and_steps()
    {
        var flow = ModelFiles.ParseFlow("checkout", "name: Checkout\nview: shop\nsteps:\n  - { from: a, to: b, text: Pays }\n  - { from: b, text: Waits, description: Longer }\n");
        Assert.Equal("Checkout", flow.Name);
        Assert.Equal("shop", flow.View);
        Assert.Equal([new Step("a", "b", "Pays", null), new Step("b", null, "Waits", "Longer")], flow.Steps);
    }

    [Fact]
    public void A_flow_file_keeps_its_groups_and_a_steps_group_lane_and_flow()
    {
        var flow = ModelFiles.ParseFlow("pays", "name: Pays\nview: shop\ngroups:\n  charge: { kind: repeat, times: 3, text: Backs off }\nsteps:\n  - { from: a, to: b, text: Charges, group: charge, lane: First, flow: other }\n");
        var charge = Assert.IsType<OrderedDictionary<string, object?>>(flow.Groups!["charge"]);
        Assert.Equal(["kind", "times", "text"], charge.Keys.ToList());
        Assert.Equal("3", charge["times"]);
        Assert.Equal(new Step("a", "b", "Charges", null, null, "charge", "First", "other"), Assert.Single(flow.Steps));
    }

    [Theory]
    [InlineData("groups:\n")]
    [InlineData("groups: ~\n")]
    [InlineData("groups: null\n")]
    [InlineData("groups: \"\"\n")]
    public void A_blank_groups_section_is_no_groups(string section)
    {
        Assert.Null(ModelFiles.ParseFlow("x", "name: X\nview: root\n" + section + "steps: []\n").Groups);
    }

    [Theory]
    [InlineData("groups: [a]\n", "\"groups\" must map ids to mappings")]
    [InlineData("groups:\n  x: [a]\n", "group \"x\" must be a mapping")]
    [InlineData("groups:\n  x: { kind: [a] }\n", "group \"x\": \"kind\" must be plain text, not a list or a mapping")]
    [InlineData("groups:\n  x: { times: { a: b } }\n", "group \"x\": \"times\" must be plain text, not a list or a mapping")]
    [InlineData("steps:\n  - { from: a, text: t, lane: [a] }\n", "step 1: \"lane\" must be plain text, not a list or a mapping")]
    public void A_wrongly_shaped_group_is_refused(string text, string reason)
    {
        var e = Assert.Throws<ParseError>(() => ModelFiles.ParseFlow("x", "name: X\nview: root\n" + text));
        Assert.Equal("flows/x.yaml", e.File);
        Assert.Equal(reason, e.Reason);
    }

    [Fact]
    public void An_empty_flow_file_is_a_flow_with_no_steps()
    {
        var flow = ModelFiles.ParseFlow("empty", "");
        Assert.Null(flow.Name);
        Assert.Empty(flow.Steps);
    }

    [Theory]
    [InlineData("- a\n", "expected a mapping with \"name\", \"view\" and \"steps\"")]
    [InlineData("steps: nope\n", "\"steps\" must be a list")]
    [InlineData("steps:\n  - text\n", "step 1 must be a mapping")]
    [InlineData("name: [a]\n", "flow: \"name\" must be plain text, not a list or a mapping")]
    public void A_flow_file_of_the_wrong_shape_is_refused(string text, string reason)
    {
        var e = Assert.Throws<ParseError>(() => ModelFiles.ParseFlow("f", text));
        Assert.Equal("flows/f.yaml", e.File);
        Assert.Equal(reason, e.Reason);
    }

    [Fact]
    public void A_layout_point_too_far_out_to_draw_is_refused()
    {
        var e = Assert.Throws<ParseError>(() => ModelFiles.ParseLayout("root:\n  a: [1e308, 0]\n"));
        Assert.Equal("layout.yaml: root → a must be [x, y], each between -1000000 and 1000000", e.Message);
    }

    [Fact]
    public void A_layout_file_gives_a_point_per_box_per_view()
    {
        var layout = ModelFiles.ParseLayout("root:\n  a: [10, 20]\nshop:\n  web: [120.5, -40]\n  api: [\"1e3\", \" 7 \"]\nempty:\n");
        Assert.Equal(new LayoutPoint(10, 20), layout["root"]["a"]);
        Assert.Equal(new LayoutPoint(120.5, -40), layout["shop"]["web"]);
        Assert.Equal(new LayoutPoint(1000, 7), layout["shop"]["api"]);
        Assert.Empty(layout["empty"]);
    }

    [Theory]
    [InlineData("- a\n", "expected view → object → [x, y]")]
    [InlineData("root: nope\n", "view \"root\" must map object ids to [x, y]")]
    [InlineData("root:\n  a: [1]\n", "root → a must be [x, y], each between -1000000 and 1000000")]
    [InlineData("root:\n  a: [1, two]\n", "root → a must be [x, y], each between -1000000 and 1000000")]
    [InlineData("root:\n  a: [1, Infinity]\n", "root → a must be [x, y], each between -1000000 and 1000000")]
    [InlineData("root:\n  a: [1, '']\n", "root → a must be [x, y], each between -1000000 and 1000000")]
    [InlineData("root:\n  a: 5\n", "root → a must be [x, y], each between -1000000 and 1000000")]
    public void A_layout_file_of_the_wrong_shape_is_refused(string text, string reason)
    {
        var e = Assert.Throws<ParseError>(() => ModelFiles.ParseLayout(text));
        Assert.Equal("layout.yaml", e.File);
        Assert.Equal(reason, e.Reason);
    }

    [Theory]
    [InlineData("lines: curved", "curved")]
    [InlineData("lines: angled", "angled")]
    [InlineData("lines: wiggly", "straight")]
    [InlineData("other: 1", "straight")]
    public void The_line_style_is_the_projects_pick_or_straight(string text, string style)
    {
        var parsed = ModelFiles.ParseModel(text + "\n");
        Assert.Equal(style, new Model { Meta = parsed.Meta }.LineStyle);
    }

    [Theory]
    [InlineData("a-b", true)]
    [InlineData("0x", true)]
    [InlineData("root", false)]
    [InlineData("-a", false)]
    [InlineData("A", false)]
    [InlineData("a_b", false)]
    [InlineData("", false)]
    [InlineData("a\n", false)]
    public void An_id_is_lowercase_letters_digits_and_dashes(string id, bool valid) => Assert.Equal(valid, Names.IsValidId(id));

    [Fact]
    public void Links_Of_reads_the_well_formed_entries_and_ignores_the_rest()
    {
        var parsed = ModelFiles.ParseModel("objects:\n  a:\n    type: actor\n    name: A\n    links:\n      - { title: Doc, url: docs/a.md, note: x }\n      - { url: \"https://x.dev\" }\n      - { title: No url }\n      - text\n      - { url: [no] }\n      - { url: u, title: [no] }\n  b: { type: actor, name: B, links: text }\n  c: { type: actor, name: C }\n");
        Assert.Equal([new BoxLink("docs/a.md", "Doc"), new BoxLink("https://x.dev", null)], Links.Of(parsed.Objects["a"]));
        Assert.Empty(Links.Of(parsed.Objects["b"]));
        Assert.Empty(Links.Of(parsed.Objects["c"]));
        Assert.IsType<List<object?>>(parsed.Objects["a"].Links);
    }
}
