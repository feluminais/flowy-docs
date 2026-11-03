using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>Text can be selected with the mouse: the grey lines in a panel as well as the names, and the names in the Explorer.</summary>
public class TextSelectionTests
{
    // The Plum demo, which nothing writes to: a model written to a folder just before it is read is read again when the file watcher
    // catches up, and that redraws the panel under a drag.
    private static (Window Window, ReaderView Reader) Open()
    {
        var dir = Path.Combine(Repo.Root, "docs", "demo", "flowy");
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        return (window, reader);
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

    /// <summary>The panel of the line from Delivery to Ordering on Overview, which stands for Live tracking's two "live map" connections.</summary>
    private static (Window Window, ReaderView Reader) OpenLine()
    {
        var (window, reader) = Open();
        reader.OpenLine("delivery", "ordering");
        EditModeTests.Settle(window);
        return (window, reader);
    }

    /// <summary>The Explorer, and the name on the row of a shape on Overview.</summary>
    private static (Window Window, ReaderView Reader, string Id, SelectableTextBlock Name) OpenExplorer()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Explorer);
        EditModeTests.Settle(window);
        var explorer = reader.Navigator.Explorer;
        var row = explorer.Rows.Where(r => r.Kind != "flow" && r.Id != Names.Root && r.Depth == 1).MinBy(r => r.Name.Length)!; // short, so the narrow column shows it whole
        var name = explorer.GetVisualDescendants().OfType<SelectableTextBlock>().Single(b => b.Classes.Contains("treename") && b.Text == row.Name);
        return (window, reader, row.Id, name);
    }

    private static SelectableTextBlock InPanel(ReaderView reader, string text) =>
        reader.Panel.GetVisualDescendants().OfType<SelectableTextBlock>().First(b => b.Text == text);

    [AvaloniaFact]
    public void The_label_of_a_connection_can_be_selected()
    {
        var (window, reader) = OpenLine();
        Assert.Equal("live map", Drag(window, InPanel(reader, "live map")));
    }

    [AvaloniaFact]
    public void The_grey_line_under_a_connection_can_be_selected()
    {
        var (window, reader) = OpenLine();
        Assert.Equal("Live tracking → Customer app", Drag(window, InPanel(reader, "Live tracking → Customer app")));
    }

    [AvaloniaFact]
    public void A_drag_across_a_name_in_the_Explorer_selects_it_and_picks_nothing()
    {
        var (window, reader, id, name) = OpenExplorer();
        Assert.Equal(name.Text, Drag(window, name));
        Assert.NotEqual(id, reader.SelectedBoxId);
    }

    [AvaloniaFact]
    public void A_click_on_a_name_in_the_Explorer_picks_its_row()
    {
        var (window, reader, id, name) = OpenExplorer();
        var at = name.TranslatePoint(new Point(name.Bounds.Width / 2, name.Bounds.Height / 2), window)!.Value;
        window.MouseDown(at, MouseButton.Left);
        window.MouseUp(at, MouseButton.Left);
        EditModeTests.Settle(window);
        Assert.Equal(id, reader.SelectedBoxId);
    }
}
