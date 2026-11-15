using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>The words on the top bar of a sketch share one line: the model name, the Sketch word and the crumbs.</summary>
public class BarAlignTests
{
    private const string Nested =
        "objects:\n  core:\n    type: system\n    name: Core\n  inner:\n    type: system\n    name: Inner\n    in: core\nconnections: []\n";

    [AvaloniaFact]
    public async Task The_words_on_the_bar_of_a_sketch_share_one_baseline()
    {
        using var temp = new TempFolder();
        var model = System.IO.Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(model);
        File.WriteAllText(System.IO.Path.Combine(model, "model.yaml"), "name: Plum\n" + Nested);
        var dir = Sketches.Create(model, "Idea");
        File.WriteAllText(System.IO.Path.Combine(dir, "model.yaml"), "name: Idea\n" + Nested);
        TestApp.NoMotion();
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        await reader.Settled;
        reader.OpenBox("core");
        await reader.Settled;
        AvaloniaHeadlessPlatform.ForceRenderTimerTick(3);
        Dispatcher.UIThread.RunJobs();

        var bottoms = new Dictionary<string, double>();
        foreach (var word in new[] { "Plum", "Sketch", "Overview", "Core" })
        {
            var text = reader.GetVisualDescendants().OfType<TextBlock>().First(t => t.Text == word && t.IsEffectivelyVisible);
            bottoms[word] = text.TranslatePoint(new Point(0, text.Bounds.Height), window)!.Value.Y;
        }
        foreach (var (word, bottom) in bottoms)
            Assert.True(Math.Abs(bottom - bottoms["Plum"]) < 0.5, $"{word} sits at {bottom}, the model name at {bottoms["Plum"]}");
    }
}
