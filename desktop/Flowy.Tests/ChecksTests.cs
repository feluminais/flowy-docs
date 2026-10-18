using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class ChecksTests
{
    private static string[] Messages(Model m, ISet<string>? absent = null) => Checks.Run(m, absent).Select(p => p.Message).ToArray();

    private const string CheckoutFlow = "checkout\nname: Customer checks out\nview: shop\nsteps:\n  - { from: customer, to: web, text: Clicks Buy }\n  - { from: web, to: api, text: POST /orders }\n";

    [Fact]
    public void The_shop_has_no_problems() => Assert.Empty(Checks.Run(TestModels.Shop(flows: CheckoutFlow)));

    [Fact]
    public void Object_problems_name_the_object()
    {
        var m = TestModels.Shop(moreObjects: """
              Bad_ID: { type: actor, name: Bad }
              nameless: { type: app, in: shop }
              notype: { name: No type }
              gadget: { type: gadget, name: Gadget }
              orphan: { type: component, name: Orphan }
              lost: { type: component, in: nowhere, name: Lost }
              wrong: { type: component, in: customer, name: Wrong }
              inside: { type: actor, in: shop, name: Inside }
              ext: { type: system, name: Ext, external: maybe }

            """);
        Assert.Equal(
            [
                $"Bad_ID: ids {Names.IdRule}",
                "nameless: name is missing",
                "notype: type is missing",
                "gadget: unknown type \"gadget\" (use actor, system, app, store, component)",
                "orphan: component must be inside app or store",
                "lost: \"in\" points to unknown object \"nowhere\"",
                "wrong: component must be inside app or store, not actor",
                "inside: actor can't be inside anything",
                "ext: external must be true or false",
            ],
            Messages(m));
    }

    [Fact]
    public void Code_paths_are_checked_for_shape_and_for_existing()
    {
        var m = TestModels.Shop(moreObjects: """
              a: { type: system, name: A, code: [src/real.ts, src/gone.ts, ../escape.ts, /abs.ts, 'c:/x', ok/] }
              b: { type: system, name: B, code: not-a-list }
              c: { type: system, name: C, code: [[x]] }

            """);
        Assert.Equal(
            [
                "a: code path \"src/gone.ts\" doesn't exist",
                "a: code path \"../escape.ts\" must be relative, with / between folders and no \".\" or \"..\" parts",
                "a: code path \"/abs.ts\" must be relative, with / between folders and no \".\" or \"..\" parts",
                "a: code path \"c:/x\" must be relative, with / between folders and no \".\" or \"..\" parts",
                "b: code must be a list of paths",
                "c: code must be a list of paths",
            ],
            Messages(m, new HashSet<string> { "src/gone.ts" }));
    }

    [Theory]
    [InlineData("src/a.ts", true)]
    [InlineData("src/", true)]
    [InlineData("a", true)]
    [InlineData("", false)]
    [InlineData("/", false)]
    [InlineData("a//b", false)]
    [InlineData("./a", false)]
    [InlineData("a/../b", false)]
    [InlineData("a\\b", false)]
    [InlineData("C:/a", false)]
    public void A_repo_path_is_relative_with_slashes_and_no_dot_parts(string path, bool ok) => Assert.Equal(ok, Checks.IsRepoPath(path));

    [Fact]
    public void Connection_problems_name_the_ends_and_where_they_are()
    {
        var m = TestModels.Shop(connections: """
              - { from: customer, to: shop, label: a }
              - { from: customer, to: shop, label: a }
              - { from: customer, to: shop }
              - { from: shop, to: shop }
              - { from: shop, to: ghost }
              - from:
                to: web
              - { from: web }

            """);
        var problems = Checks.Run(m);
        Assert.Equal(
            [
                "connection customer → shop: duplicate \"a\"",
                "connection shop → shop: connects an object to itself",
                "connection shop → ghost: unknown object \"ghost\"",
                "connection ? → web: \"from\" is missing",
                "connection web → ?: \"to\" is missing",
            ],
            problems.Select(p => p.Message));
        Assert.Equal([1, 3, 4, 5, 6], problems.Select(p => p.Connection));
    }

    [Fact]
    public void Flow_problems_name_the_step()
    {
        var m = TestModels.Shop(flows: """
            Bad_Flow
            name: ''
            view: nowhere
            steps: []
            ===
            steps
            name: Steps
            view: shop
            steps:
              - { from: customer, to: shop, text: outside to inside }
              - { from: api, to: api, text: self }
              - { from: ghost, text: alone and unknown }
              - { from: api, text: fine }
              - { from: api, to: ghost, text: '' }

            """);
        var problems = Checks.Run(m);
        Assert.Equal(
            [
                $"\"Bad_Flow\" is not a valid flow id: the file name must {Names.IdRule}",
                "name is missing",
                "view \"nowhere\" must be \"root\" or an object with children",
                "has no steps",
                "step 1: customer → shop can't be shown in view \"shop\"",
                "step 2: goes from an object to itself (leave out \"to\" for a step one box does on its own)",
                "step 3: unknown object \"ghost\"",
                "step 5: unknown object \"ghost\"",
                "step 5: text is missing",
            ],
            problems.Select(p => p.Message));
        Assert.Equal([null, null, null, null, 0, 1, 2, 4, 4], problems.Select(p => p.Step));
        Assert.Equal("flows/Bad_Flow.yaml", problems[0].File);
        Assert.Equal("flows/steps.yaml", problems[^1].File);
    }

    [Fact]
    public void An_unknown_line_style_is_a_problem()
    {
        var m = TestModels.FromYaml("lines: wiggly\nobjects:\n  a: { type: actor, name: A }\n");
        Assert.Equal(["lines must be straight, curved or angled"], Messages(m));
        Assert.Empty(Checks.Run(TestModels.FromYaml("lines: curved\nobjects:\n  a: { type: actor, name: A }\n")));
    }
}
