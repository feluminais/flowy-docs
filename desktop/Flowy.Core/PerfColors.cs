using System.Globalization;

namespace Flowy.Core;

/// <summary>
/// The colour of a shape's strain outline, from green (0) through amber to red (1): the browser's <c>hsl(calc(150 - 150 * strain) 70% 38%)</c> in the
/// light theme and <c>hsl(... 75% 62%)</c> in the dark one, as hex for the brushes that follow the app's theme.
/// </summary>
public static class PerfColors
{
    /// <summary>The colour at <paramref name="strain"/> (0 to 1), as <c>#rrggbb</c>.</summary>
    public static string Hex(double strain, bool dark)
    {
        var s = Math.Min(1, Math.Max(0, strain));
        var (r, g, b) = Hsl(150 - 150 * s, dark ? 0.75 : 0.70, dark ? 0.62 : 0.38);
        return string.Create(CultureInfo.InvariantCulture, $"#{r:x2}{g:x2}{b:x2}");
    }

    private static (int R, int G, int B) Hsl(double hue, double saturation, double lightness)
    {
        var c = (1 - Math.Abs(2 * lightness - 1)) * saturation;
        var x = c * (1 - Math.Abs(hue / 60 % 2 - 1));
        var m = lightness - c / 2;
        var (r, g, b) = hue switch
        {
            < 60 => (c, x, 0d),
            < 120 => (x, c, 0d),
            _ => (0d, c, x),
        };
        return ((int)Math.Round((r + m) * 255), (int)Math.Round((g + m) * 255), (int)Math.Round((b + m) * 255));
    }
}
