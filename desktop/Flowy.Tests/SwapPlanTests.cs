using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>
/// The C# side of dumpSwapPlans in desktop/fixtures/compare.ts: the plan for every case, and the swap's constants, must be what planSwap, swapDuration and the constants in
/// ui/src/swap.ts say.
/// </summary>
public class SwapPlanTests
{
    private static readonly JsonNode Expected = JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "swap-plans.json")))!;

    private static List<(string Id, double X, double Y)> Nodes(JsonNode? list) =>
        list!.AsArray().Select(n => (n!["id"]!.GetValue<string>(), n["x"]!.GetValue<double>(), n["y"]!.GetValue<double>())).ToList();

    private static string[] Ids(JsonNode? list) => list!.AsArray().Select(n => n!.GetValue<string>()).ToArray();

    [Fact]
    public void Every_case_gives_the_plan_the_TypeScript_planSwap_gives()
    {
        var cases = Expected["cases"]!.AsArray();
        Assert.NotEmpty(cases);
        foreach (var c in cases)
        {
            var plan = SwapPlans.Plan(Nodes(c!["from"]), Nodes(c["to"]));
            var name = c["name"]!.GetValue<string>();
            var stay = c["stay"]!.AsArray().Select(s => (s!["id"]!.GetValue<string>(), (s["from"]!["x"]!.GetValue<double>(), s["from"]!["y"]!.GetValue<double>()), (s["to"]!["x"]!.GetValue<double>(), s["to"]!["y"]!.GetValue<double>()))).ToArray();
            Assert.True(stay.SequenceEqual(plan.Stay.Select(g => (g.Id, g.From, g.To))), $"{name}: stay");
            Assert.Equal(Ids(c["entering"]), plan.Entering);
            Assert.Equal(Ids(c["leaving"]), plan.Leaving);
        }
    }

    [Fact]
    public void The_constants_and_durations_are_the_TypeScript_ones()
    {
        Assert.Equal(SwapPlans.SwapMs, Expected["swapMs"]!.GetValue<int>());
        Assert.Equal(SwapPlans.FadeMs, Expected["fadeMs"]!.GetValue<int>());
        var durations = Expected["durations"]!;
        Assert.Equal(durations["swap"]!.GetValue<int>(), SwapPlans.Duration(false));
        Assert.Equal(durations["swapReduced"]!.GetValue<int>(), SwapPlans.Duration(true));
        Assert.Equal(durations["crossfade"]!.GetValue<int>(), SwapPlans.CrossfadeDuration(false));
        Assert.Equal(durations["crossfadeReduced"]!.GetValue<int>(), SwapPlans.CrossfadeDuration(true));
    }

    [Fact]
    public void Nodes_a_and_b_to_b_and_c_keep_b_bring_c_and_drop_a()
    {
        var plan = SwapPlans.Plan([("a", 0, 0), ("b", 10, 20)], [("b", 30, 40), ("c", 50, 60)]);
        Assert.Equal([new Glide("b", (10, 20), (30, 40))], plan.Stay);
        Assert.Equal(["c"], plan.Entering);
        Assert.Equal(["a"], plan.Leaving);
    }

    [Fact]
    public void Ids_that_look_like_object_members_are_ordinary_ids()
    {
        var plan = SwapPlans.Plan([("__proto__", 1, 2), ("constructor", 3, 4)], [("__proto__", 5, 6), ("toString", 7, 8)]);
        Assert.Equal(["__proto__"], plan.Stay.Select(g => g.Id));
        Assert.Equal(["toString"], plan.Entering);
        Assert.Equal(["constructor"], plan.Leaving);
    }
}
