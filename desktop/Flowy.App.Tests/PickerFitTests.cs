using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>The bar's pickers are as wide as the chosen words, with the chevron right beside them.</summary>
public class PickerFitTests
{
    [AvaloniaFact]
    public void The_line_picker_keeps_its_chevron_next_to_the_chosen_words()
    {
        using var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "model.yaml"), "objects:\n  thing:\n    type: system\n    name: Thing\nconnections: []\n");
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        var picker = reader.LinePicker;
        var widths = new List<double>();
        for (var i = 0; i < 3; i++)
        {
            picker.SelectedIndex = i;
            AvaloniaHeadlessPlatform.ForceRenderTimerTick(3);
            Dispatcher.UIThread.RunJobs();
            var words = picker.GetVisualDescendants().OfType<TextBlock>().First(t => t.Text?.StartsWith("Lines") == true);
            var chevron = picker.GetVisualDescendants().OfType<Control>().First(c => c.Name == "DropDownGlyph");
            var wordsRight = words.TranslatePoint(new Point(words.Bounds.Width, 0), picker)!.Value.X;
            var chevronBox = chevron.TranslatePoint(new Point(0, 0), picker)!.Value.X;
            Assert.InRange(chevronBox - wordsRight, 0, 8);
            Assert.InRange(picker.Bounds.Width - (chevronBox + chevron.Bounds.Width), 0, 10);
            widths.Add(picker.Bounds.Width);
        }
        Assert.NotEqual(widths[0], widths[2]); // it follows the choice, not the longest item
    }
}
