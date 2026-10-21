using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class FlowFormTests
{
    private static OrderedDictionary<string, object?> StepWithStates() => new()
    {
        ["from"] = "web",
        ["states"] = new OrderedDictionary<string, object?> { ["web"] = "degraded", ["api"] = "starting", ["db"] = new List<object?>() },
    };

    [Fact]
    public void A_pick_keeps_every_other_entry_and_leaves_out_what_is_not_text()
    {
        var step = StepWithStates();
        Assert.Equal(["web", "api"], FlowForm.StatesWith(step, "db", "").Keys);
        var next = FlowForm.StatesWith(step, "api", "running");
        Assert.Equal(["web", "api"], next.Keys);
        Assert.Equal("running", next["api"]);
        Assert.Equal(["web"], FlowForm.StatesWith(step, "api", "").Keys);
    }

    [Fact]
    public void A_state_word_is_only_a_known_state()
    {
        var states = StepWithStates()["states"];
        Assert.Equal("degraded", FlowForm.StateWord(states, "web"));
        Assert.Equal("starting", FlowForm.StateWord(states, "api"));
        Assert.Equal("", FlowForm.StateWord(states, "cache"));
        Assert.Equal("", FlowForm.StateWord(states, "db"));
        Assert.Equal("", FlowForm.StateWord(null, "web"));
    }

    [Fact]
    public void Steps_are_the_shown_ones_when_their_text_matches()
    {
        var steps = new List<OrderedDictionary<string, object?>> { EditOps.NewStep("web", "api", "Calls"), EditOps.NewStep("api", null, "Works") };
        var shown = new[] { new Step("web", "api", "Calls", null), new Step("api", null, "Works", null) }.Select(FlowForm.Signature).ToList();
        Assert.True(FlowForm.StepsAreShown(steps, shown));
        FlowForm.RequireShown(steps, shown);
        steps[1]["text"] = "Rests";
        var stale = Assert.Throws<OpError>(() => FlowForm.RequireShown(steps, shown));
        Assert.Equal("The steps just changed. Check them and try again.", stale.Message);
    }

    [Fact]
    public void A_group_has_lanes_only_when_it_branches_or_runs_in_parallel()
    {
        var groups = new OrderedDictionary<string, object?>
        {
            ["a"] = new OrderedDictionary<string, object?> { ["kind"] = "branch" },
            ["b"] = new OrderedDictionary<string, object?> { ["kind"] = "repeat" },
        };
        Assert.Equal("branch", FlowForm.KindOf(groups, "a"));
        Assert.Null(FlowForm.KindOf(groups, "missing"));
        Assert.True(FlowForm.HasLanes("branch"));
        Assert.True(FlowForm.HasLanes("parallel"));
        Assert.False(FlowForm.HasLanes(FlowForm.KindOf(groups, "b")));
        Assert.False(FlowForm.HasLanes(null));
    }

    [Fact]
    public void An_animation_is_read_as_text_fields()
    {
        Assert.Equal(new AnimationFields("call", "", "", "", "", ""), FlowForm.ReadAnimation("call"));
        Assert.Equal(new AnimationFields("", "", "", "", "", ""), FlowForm.ReadAnimation(null));
        var named = new OrderedDictionary<string, object?>
        {
            ["kind"] = "send", ["outcome"] = "intercepted", ["share"] = "30", ["reason"] = "Rate limit",
            ["by"] = new OrderedDictionary<string, object?> { ["name"] = "Proxy" },
        };
        Assert.Equal(new AnimationFields("send", "intercepted", "30", "Rate limit", "", "Proxy"), FlowForm.ReadAnimation(named));
        named["by"] = "cache";
        Assert.Equal("cache", FlowForm.ReadAnimation(named).By);
    }

    [Fact]
    public void An_outcome_decides_which_fields_are_on()
    {
        var step = new Step("web", "api", "Calls", null);
        Assert.True(FlowForm.Travels(step));
        Assert.False(FlowForm.Travels(new Step("web", null, "Works", null)));
        Assert.False(FlowForm.Travels(new Step("web", "web", "Loops", null)));
        Assert.Null(FlowForm.KindBlock("", false));
        Assert.Null(FlowForm.KindBlock("call", true));
        Assert.Equal("Needs two shapes", FlowForm.KindBlock("call", false));
        Assert.Equal("Pick an outcome first", FlowForm.OutcomeFieldsBlock(""));
        Assert.Null(FlowForm.OutcomeFieldsBlock("fail"));
        Assert.Equal("Only for Intercepted", FlowForm.TakerBlock("fail", "cache", step));
        Assert.Equal("An end of the step", FlowForm.TakerBlock("intercepted", "api", step));
        Assert.Null(FlowForm.TakerBlock("intercepted", "cache", step));
        Assert.Null(FlowForm.TakerNameBlock("intercepted"));
        Assert.Equal("Only for Intercepted", FlowForm.TakerNameBlock("lost"));
    }
}
