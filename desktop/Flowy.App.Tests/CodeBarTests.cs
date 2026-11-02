using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;
using static Flowy.App.Tests.EditModeTests;

namespace Flowy.App.Tests;

/// <summary>
/// A code box with a long line scrolls along by a bar of its own under the box, never over the code, and Details can be dragged wider than
/// <see cref="NavigatorState.MaxWidth"/> while a line still runs past it, until the line shows whole.
/// </summary>
public class CodeBarTests
{
    private static readonly string Long = "{ " + string.Join(", ", Enumerable.Range(0, 12).Select(i => $"\"field{i}\": {i}")) + " }"; // about 150 characters, some 2000 px in the test font

    private static string Source(string example) => $$"""
        payloads:
          basket:
            name: Basket
            example:
              language: json
              text: '{{example}}'
        objects:
          shop: { type: system, name: Shop }
          app: { type: app, in: shop, name: App }
          api: { type: app, in: shop, name: API }
        connections:
          - { from: app, to: api, label: REST, payloads: [basket] }
        """;

    private static (TempFolder Temp, Window Window, ReaderView Reader) Open(string example, double width = 1200)
    {
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "model.yaml"), Source(example));
        var reader = new ReaderView();
        var window = new Window { Width = width, Height = 900, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        reader.GoTo("shop");
        reader.OpenLine("app", "api");
        Settle(window);
        return (temp, window, reader);
    }

    private static CodeBar Bar(ReaderView reader) => reader.Panel.GetVisualDescendants().OfType<CodeBar>().Single();

    private static ScrollViewer Code(ReaderView reader) =>
        reader.Panel.GetVisualDescendants().OfType<ScrollViewer>().Single(s => s.Content is SelectableTextBlock);

    [AvaloniaFact]
    public void A_long_line_scrolls_by_a_bar_under_the_box_and_the_box_draws_none_over_the_code()
    {
        var (temp, window, reader) = Open(Long);
        using var _ = temp;
        var code = Code(reader);
        Assert.Equal(ScrollBarVisibility.Hidden, code.HorizontalScrollBarVisibility);
        var bar = Bar(reader);
        Assert.True(bar.IsEffectivelyVisible);
        Assert.True(bar.Room > 0);
        var box = code.GetVisualAncestors().OfType<Border>().First();
        var boxBottom = box.TranslatePoint(new Point(0, box.Bounds.Height), window)!.Value.Y;
        var barTop = bar.TranslatePoint(new Point(0, 0), window)!.Value.Y;
        Assert.True(barTop >= boxBottom, $"the bar starts at {barTop}, above the box's bottom at {boxBottom}");
        Assert.Equal(CodeBar.Tall, bar.Bounds.Height);
    }

    [AvaloniaFact]
    public void Dragging_the_handle_or_clicking_the_bar_scrolls_the_code_along()
    {
        var (temp, window, reader) = Open(Long);
        using var _ = temp;
        var (bar, code) = (Bar(reader), Code(reader));
        var (left, width) = bar.Handle;
        var grab = bar.TranslatePoint(new Point(left + width / 2, CodeBar.Tall / 2), window)!.Value;
        window.MouseDown(grab, MouseButton.Left);
        window.MouseMove(grab + new Vector(40, 0));
        window.MouseUp(grab + new Vector(40, 0), MouseButton.Left);
        Assert.True(code.Offset.X > 0, "a drag to the right scrolls along");

        var end = bar.TranslatePoint(new Point(bar.Bounds.Width - 2, CodeBar.Tall / 2), window)!.Value;
        window.MouseDown(end, MouseButton.Left);
        window.MouseUp(end, MouseButton.Left);
        Assert.Equal(bar.Room, code.Offset.X, 1); // a click at the end brings the handle there
    }

    [AvaloniaFact]
    public void Code_that_fits_has_no_bar()
    {
        var (temp, _, reader) = Open("{ \"id\": 1 }");
        using var __ = temp;
        Assert.False(Bar(reader).IsVisible);
    }

    private static void DragDetails(Window window, ReaderView reader, double by)
    {
        var edge = reader.Canvas.TranslatePoint(new Point(reader.Canvas.Bounds.Width - reader.Widths.Details, 300), window)!.Value;
        window.MouseDown(edge, MouseButton.Left);
        window.MouseMove(edge + new Vector(-by, 0)); // its edge going left makes it wider
        window.MouseUp(edge + new Vector(-by, 0), MouseButton.Left);
        Settle(window);
    }

    [AvaloniaFact]
    public void Details_drags_wider_than_640_while_a_line_runs_past_it_and_stops_once_it_shows_whole()
    {
        var (temp, window, reader) = Open(Long, width: 3600);
        using var _ = temp;
        DragDetails(window, reader, 3000);
        var wide = reader.Widths.Details;
        Assert.True(wide > NavigatorState.MaxWidth, $"Details is {wide} wide");
        Assert.Equal(0, Bar(reader).Room, 1); // the line shows whole
        Assert.False(Bar(reader).IsVisible);
        var (_, edge) = reader.Sashes;
        edge.Focus();
        Press(window, Key.Left, PhysicalKey.ArrowLeft); // Details grows as its edge goes left
        Assert.Equal(wide, reader.Widths.Details); // no wider than that
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Assert.Equal(wide - 16, reader.Widths.Details); // and it comes back narrower as before
    }

    [AvaloniaFact]
    public void A_line_wider_than_the_canvas_can_spare_widens_Details_only_that_far()
    {
        var (temp, window, reader) = Open(Long, width: 1600);
        using var _ = temp;
        DragDetails(window, reader, 3000);
        Assert.True(reader.Widths.Details <= reader.Canvas.Bounds.Width - 160, "never wider than the canvas can spare");
    }

    [AvaloniaFact]
    public void Code_that_fits_keeps_Details_at_640_at_most()
    {
        var (temp, window, reader) = Open("{ \"id\": 1 }", width: 3600);
        using var _ = temp;
        DragDetails(window, reader, 3000);
        Assert.Equal(NavigatorState.MaxWidth, reader.Widths.Details);
    }
}
