using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class LevelsTests
{
    private static bool Anywhere(string _) => true;

    [Fact]
    public void A_move_remembers_where_the_reader_was_and_staying_put_does_not()
    {
        var levels = new List<string>();
        Levels.Remember(levels, "root", "ordering");
        Levels.Remember(levels, "ordering", "back-office");
        Assert.Equal(["root", "ordering"], levels);
        Levels.Remember(levels, "back-office", "back-office");
        Levels.Remember(levels, "ordering", "root"); // the same level is not listed twice in a row
        Assert.Equal(["root", "ordering"], levels);
    }

    [Fact]
    public void Esc_goes_back_to_the_level_before_then_the_one_before_that()
    {
        var levels = new List<string> { "root", "ordering" };
        Assert.Equal("ordering", Levels.CameBack(levels, "back-office", Anywhere));
        Assert.Equal(["root"], levels);
        Assert.Equal("root", Levels.CameBack(levels, "ordering", Anywhere));
        Assert.Null(Levels.CameBack(levels, "root", Anywhere));
    }

    [Fact]
    public void A_level_that_is_gone_or_is_the_current_one_is_passed_over()
    {
        var levels = new List<string> { "root", "gone", "ordering" };
        Assert.Equal("root", Levels.CameBack(levels, "ordering", id => id != "gone"));
        Assert.Empty(levels);
        levels = ["gone"];
        Assert.Null(Levels.CameBack(levels, "ordering", id => id != "gone"));
    }

    [Fact]
    public void Only_the_last_fifty_levels_are_kept()
    {
        var levels = new List<string>();
        for (var i = 0; i < 60; i++) Levels.Remember(levels, $"v{i}", $"v{i + 1}");
        Assert.Equal(50, levels.Count);
        Assert.Equal("v59", levels[^1]);
    }
}
