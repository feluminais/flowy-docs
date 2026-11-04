using Avalonia.Headless.XUnit;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;
using CoreRect = Flowy.Core.Rect;

namespace Flowy.App.Tests;

/// <summary>
/// The lane store (Canvas/LaneStore.cs): the one place the desktop app makes the path of a line between two shapes, and parses it. It changes where no line is drawn, so these
/// hold that it answers what <see cref="LinePaths"/> does, that it answers the same object while the shapes stay put, and that no layer makes a path of its own.
/// </summary>
public class LaneStoreTests
{
    private static readonly CoreRect Top = new(0, 0, 200, 72);
    private static readonly CoreRect Right = new(400, 120, 200, 72);

    private static LaneEnd A(CoreRect? at = null) => new("a", at ?? Top, null);

    private static LaneEnd B(CoreRect? at = null) => new("b", at ?? Right, null);

    [AvaloniaTheory]
    [InlineData("straight")]
    [InlineData("curved")]
    [InlineData("angled")]
    public void A_lane_is_the_line_the_core_makes_and_it_is_parsed_once(string style)
    {
        var store = new LaneStore();
        var lane = store.PathFor("a|b", style, A(), B());
        var made = LinePaths.Build(style, Top, Right);
        Assert.Equal(made, lane.Path);
        Assert.Equal(Avalonia.Media.Geometry.Parse(made.Data).Bounds, lane.Geometry.Bounds);
    }

    [AvaloniaFact]
    public void The_same_question_gets_the_same_lane_until_a_shape_moves()
    {
        var store = new LaneStore();
        var first = store.PathFor("a|b", "curved", A(), B());
        Assert.Same(first, store.PathFor("a|b", "curved", A(), B()));
        Assert.Same(first.Geometry, store.PathFor("a|b", "curved", A(), B()).Geometry);
        var moved = store.PathFor("a|b", "curved", A(), B(Right with { X = 500 }));
        Assert.NotSame(first, moved);
        Assert.NotEqual(first.Path.Data, moved.Path.Data);
        Assert.Equal(1, store.Count); // the moved lane took the place of the old one
    }

    [AvaloniaFact]
    public void A_shape_with_another_outline_gives_another_lane()
    {
        var store = new LaneStore();
        var square = store.PathFor(null, "straight", A(), B());
        var diamond = store.PathFor(null, "straight", new LaneEnd("a", Top, LookData.Shapes["diamond"].Edge), B());
        Assert.NotSame(square, diamond);
    }

    [AvaloniaFact]
    public void The_line_that_runs_the_other_way_is_another_lane_that_starts_at_the_other_shape()
    {
        var store = new LaneStore();
        var there = store.PathFor(null, "straight", A(), B());
        var back = store.PathFor(null, "straight", B(), A());
        Assert.NotSame(there, back);
        Assert.Equal(there.Path.End, back.Path.Start);
        Assert.Equal(there.Path.Start, back.Path.End);
    }

    [AvaloniaFact]
    public void A_strand_id_names_a_lane_and_none_means_the_pair()
    {
        var store = new LaneStore();
        var pair = store.PathFor(null, "straight", A(), B());
        Assert.Same(pair, store.PathFor(SceneBuilder.LineId("a", "b"), "straight", A(), B()));
        var strand = store.PathFor("a|b|1", "straight", A(), B());
        Assert.NotSame(pair, strand);
        Assert.Equal(pair.Path.Data, strand.Path.Data); // no pose draws anything else yet
        Assert.Equal(2, store.Count);
    }

    [AvaloniaFact]
    public void A_pose_nearly_another_shares_its_lane_and_rest_is_one_pose()
    {
        var store = new LaneStore();
        var rest = store.PathFor("a|b", "straight", A(), B());
        Assert.Same(rest, store.PathFor("a|b", "straight", A(), B(), LanePose.Rest));
        Assert.Same(rest, store.PathFor("a|b", "straight", A(), B(), new LanePose(0, [])));
        var spread = store.PathFor("a|b", "straight", A(), B(), new LanePose(1, []));
        Assert.NotSame(rest, spread);
        Assert.Same(spread, store.PathFor("a|b", "straight", A(), B(), new LanePose(0.999, [])));
        Assert.NotSame(spread, store.PathFor("a|b", "straight", A(), B(), new LanePose(0.5, [])));
        var lit = store.PathFor("a|b", "straight", A(), B(), new LanePose(0, [0, 1]));
        Assert.NotSame(rest, lit);
        Assert.Same(lit, store.PathFor("a|b", "straight", A(), B(), new LanePose(0, [0.0, 1.0])));
        Assert.Equal(rest.Path.Data, lit.Path.Data); // only the rest path is drawn so far
    }

    [AvaloniaFact]
    public void A_store_that_fills_up_starts_again()
    {
        var store = new LaneStore();
        for (var i = 0; i < LaneStore.Most; i++) store.PathFor($"s{i}", "straight", A(), B());
        Assert.Equal(LaneStore.Most, store.Count);
        store.PathFor("one more", "straight", A(), B());
        Assert.Equal(1, store.Count);
    }

    /// <summary>A layer that made its own path would draw a line, or a step along it, where the others do not. Only the store asks the core for one.</summary>
    [Fact]
    public void No_layer_makes_a_path_of_its_own()
    {
        var app = Path.Combine(Repo.Root, "desktop", "Flowy.App");
        var makers = Directory.EnumerateFiles(app, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}") && !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}"))
            .Where(f => File.ReadAllText(f).Contains("LinePaths.Build(", StringComparison.Ordinal))
            .Select(f => Path.GetFileName(f))
            .ToList();
        Assert.Equal(["LaneStore.cs"], makers);
    }
}
