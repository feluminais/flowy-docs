using System.Reflection;
using System.Text.RegularExpressions;
using Avalonia.Headless.XUnit;
using Avalonia.Media;
using Flowy.App.Canvas;
using Xunit;

namespace Flowy.App.Tests;

public class IconsTests
{
    [AvaloniaFact]
    public void Control_icons_match_the_browser_and_fit_their_grid()
    {
        var paths = typeof(Icons).GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(field => field.FieldType == typeof(string))
            .ToDictionary(field => field.Name, field => (string)field.GetValue(null)!);
        var browser = File.ReadAllText(Path.Combine(Repo.Root, "ui", "src", "icons.tsx"));
        foreach (Match icon in Regex.Matches(browser, @"export const (\w+) = one\('([^']+)'\)"))
        {
            if (!paths.TryGetValue(icon.Groups[1].Value, out var path)) continue;
            Assert.Equal(icon.Groups[2].Value, path);
        }
        foreach (var path in paths.Values)
        {
            var bounds = Geometry.Parse(path).Bounds;
            Assert.True(bounds.Width > 0 || bounds.Height > 0);
            Assert.InRange(bounds.Left, -0.001, 24.001);
            Assert.InRange(bounds.Top, -0.001, 24.001);
            Assert.InRange(bounds.Right, -0.001, 24.001);
            Assert.InRange(bounds.Bottom, -0.001, 24.001);
        }
    }
}
