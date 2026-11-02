using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>Text in the side panel can be selected with the mouse, the grey lines under a name as well as the name.</summary>
public class TextSelectionTests
{
    private const string Model = """
        objects:
          tracking:
            type: system
            name: Tracking
          live:
            type: service
            in: tracking
            name: Live tracking
          apps:
            type: system
            name: Apps
          customer:
            type: service
            in: apps
            name: Customer app
        connections:
          - from: live
            to: customer
            label: live map
        """;

    private static (TempFolder Temp, Window Window, ReaderView Reader) Open()
    {
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "model.yaml"), Model);
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        reader.OpenLine("tracking", "apps");
        EditModeTests.Settle(window);
        return (temp, window, reader);
    }

    private static string Drag(Window window, SelectableTextBlock block)
    {
        // Corner to corner, so a line that wraps is taken whole; a corner is off the letters, where a press used to fall through to the card.
        var from = block.TranslatePoint(new Point(1, 2), window)!.Value;
        var to = block.TranslatePoint(new Point(block.Bounds.Width - 1, block.Bounds.Height - 2), window)!.Value;
        window.MouseDown(from, MouseButton.Left);
        window.MouseMove(to, RawInputModifiers.LeftMouseButton);
        window.MouseUp(to, MouseButton.Left);
        return block.SelectedText;
    }

    private static SelectableTextBlock Block(ReaderView reader, string text) =>
        reader.Panel.GetVisualDescendants().OfType<SelectableTextBlock>().Single(b => b.Text == text);

    [AvaloniaFact]
    public void The_label_of_a_connection_can_be_selected()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        Assert.Equal("live map", Drag(window, Block(reader, "live map")));
    }

    [AvaloniaFact]
    public void The_grey_line_under_a_connection_can_be_selected()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        var grey = reader.Panel.GetVisualDescendants().OfType<SelectableTextBlock>().Single(b => b.Text?.Contains('→') == true);
        Assert.Equal(grey.Text, Drag(window, grey));
    }
}
