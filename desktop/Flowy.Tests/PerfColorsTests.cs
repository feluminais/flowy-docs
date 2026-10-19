using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>The strain outline's colours: the browser's <c>hsl(calc(150 - 150 * strain) 70% 38%)</c> (light) and <c>75% 62%</c> (dark), worked out with the CSS formula.</summary>
public class PerfColorsTests
{
    [Theory]
    [InlineData(0, "#1da561", "#55e79e")]
    [InlineData(0.5, "#83a51d", "#c2e755")]
    [InlineData(0.85, "#a5501d", "#e78c55")]
    [InlineData(1, "#a51d1d", "#e75555")]
    public void Strain_goes_from_green_through_amber_to_red(double strain, string light, string dark)
    {
        Assert.Equal(light, PerfColors.Hex(strain, false));
        Assert.Equal(dark, PerfColors.Hex(strain, true));
    }

    [Fact]
    public void A_strain_outside_0_to_1_is_held_at_the_ends()
    {
        Assert.Equal(PerfColors.Hex(0, false), PerfColors.Hex(-3, false));
        Assert.Equal(PerfColors.Hex(1, true), PerfColors.Hex(7, true));
    }
}
