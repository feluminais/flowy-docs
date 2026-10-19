using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class TrailsTests
{
    [Fact]
    public void Opening_a_flow_leaves_the_place_you_were_at_and_closing_it_gives_that_place_back_last_first()
    {
        var one = Trails.Open([], new FlowPlace("a", 3));
        var two = Trails.Open(one, new FlowPlace("b", 0));
        Assert.Equal([new FlowPlace("a", 3), new FlowPlace("b", 0)], two);
        var first = Trails.Close(two)!.Value;
        Assert.Equal(new FlowPlace("b", 0), first.Back);
        Assert.Equal(new FlowPlace("a", 3), Trails.Close(first.Trail)!.Value.Back);
        Assert.Null(Trails.Close([]));
        Assert.Equal([new FlowPlace("a", 3)], one); // nothing is changed in place
    }

    [Fact]
    public void A_cycle_three_deep_just_grows_the_trail_and_unwinds_the_same_way()
    {
        IReadOnlyList<FlowPlace> trail = [];
        foreach (var (flow, step) in new[] { ("a", 1), ("b", 2), ("a", 0) }) trail = Trails.Open(trail, new FlowPlace(flow, step));
        var seen = new List<string>();
        for (var closed = Trails.Close(trail); closed is { } c; closed = Trails.Close(c.Trail)) seen.Add($"{c.Back.Flow}{c.Back.Step}");
        Assert.Equal(["a0", "b2", "a1"], seen);
    }
}
