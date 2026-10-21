using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class ModelIndexTests
{
    [Fact]
    public void A_model_is_indexed_once()
    {
        var m = TestModels.Shop();
        Assert.Same(ModelIndex.Of(m), ModelIndex.Of(m));
    }

    [Fact]
    public void Members_keep_the_order_of_the_objects_and_a_copy_is_returned()
    {
        var m = TestModels.Shop();
        var index = ModelIndex.Of(m);
        Assert.Equal(["web", "api", "db"], index.MemberIds("shop"));
        index.MemberIds("shop").Clear();
        Assert.Equal(["web", "api", "db"], index.MemberIds("shop"));
        Assert.Empty(index.MemberIds("mail"));
        Assert.True(index.HasChildren("api"));
        Assert.False(index.HasChildren("mail"));
    }

    [Fact]
    public void Parents_fall_back_to_the_top_level()
    {
        var m = TestModels.FromYaml("objects:\n  a: { type: system, name: A, in: nope }\n  b: { type: system, name: B, in: b }\nconnections:\n");
        var index = ModelIndex.Of(m);
        Assert.Equal("root", index.ParentOf("a"));
        Assert.Equal("root", index.ParentOf("b"));
        Assert.Equal("root", index.ParentOf("unknown"));
    }

    [Fact]
    public void Counts_follow_the_order_parents_first_appear()
    {
        var counts = ModelIndex.Of(TestModels.Shop()).ChildCounts();
        Assert.Equal(["root", "shop", "api"], counts.Keys);
        Assert.Equal([3, 3, 2], counts.Values);
    }

    [Fact]
    public void An_index_made_before_objects_were_added_is_made_again()
    {
        var m = new Model();
        m.Objects.Add("a", new FlowyObject("system", "A", null, null, null, null, null));
        Assert.Equal(["a"], Views.MemberIds(m, "root"));
        m.Objects.Add("b", new FlowyObject("app", "B", "a", null, null, null, null));
        Assert.Equal(["b"], Views.MemberIds(m, "a"));
    }
}
