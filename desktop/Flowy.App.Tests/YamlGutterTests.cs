using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>The line numbers of the YAML tab stay at the left edge while the text scrolls sideways, and a click in the text does not take them away.</summary>
public class YamlGutterTests
{
    private static async Task<(YamlPanel Panel, Window Window, string Dir)> OpenAsync()
    {
        var dir = Directory.CreateTempSubdirectory("flowy-yaml-gutter").FullName;
        File.WriteAllText(Path.Combine(dir, FolderLayout.ModelFile), "name: Plum\ntext: " + new string('x', 400) + "\nlast: 1\n");
        var panel = new YamlPanel();
        var window = new Window { Width = 300, Height = 400, Content = panel };
        window.Show();
        panel.Show(dir, new object(), null, null);
        await EditModeTests.Until(() => !panel.Reading);
        window.UpdateLayout();
        return (panel, window, dir);
    }

    private static double NumbersLeft(YamlPanel panel) => panel.Numbers.TranslatePoint(new Point(0, 0), panel)!.Value.X;

    [AvaloniaFact]
    public async Task The_line_numbers_stay_put_when_the_text_scrolls_sideways()
    {
        var (panel, window, dir) = await OpenAsync();
        try
        {
            var before = NumbersLeft(panel);
            panel.Scroller.Offset = new Vector(60, 0);
            window.UpdateLayout();
            Assert.Equal(60, panel.Scroller.Offset.X);
            Assert.Equal(before, NumbersLeft(panel), 0.5);
        }
        finally
        {
            window.Close();
            Directory.Delete(dir, true);
        }
    }

    [AvaloniaFact]
    public async Task A_click_in_the_text_leaves_the_line_numbers_where_they_are()
    {
        var (panel, window, dir) = await OpenAsync();
        try
        {
            var before = NumbersLeft(panel);
            var at = panel.Code.TranslatePoint(new Point(40, 30), window)!.Value;
            window.MouseDown(at, MouseButton.Left);
            window.MouseUp(at, MouseButton.Left);
            window.UpdateLayout();
            Assert.Equal(before, NumbersLeft(panel), 0.5);
        }
        finally
        {
            window.Close();
            Directory.Delete(dir, true);
        }
    }
}
