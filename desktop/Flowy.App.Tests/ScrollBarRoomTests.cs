using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Presenters;
using Avalonia.Controls.Primitives;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>A scroll bar has room of its own, in every kind of scroller, so it never lies over what scrolls.</summary>
public class ScrollBarRoomTests
{
    /// <summary>Every visible bar under <paramref name="root"/> is clear of the content of its scroller. Fails if there is no bar to look at.</summary>
    private static void AssertBarsClear(Control root)
    {
        var bars = 0;
        foreach (var scroller in root.GetVisualDescendants().Append(root).OfType<ScrollViewer>())
        {
            var inside = scroller.GetVisualDescendants().OfType<Control>().Where(c => c.TemplatedParent == scroller).ToList();
            var content = inside.OfType<ScrollContentPresenter>().Single();
            foreach (var bar in inside.OfType<ScrollBar>().Where(b => b.IsVisible))
            {
                bars++;
                Assert.False(content.Bounds.Intersects(bar.Bounds), $"The {bar.Orientation} bar at {bar.Bounds} lies over the content at {content.Bounds}");
            }
        }
        Assert.True(bars > 0, "no scroll bar showed");
    }

    private static Window Shown(Control content, double width = 200, double height = 200)
    {
        var window = new Window { Width = width, Height = height, Content = content };
        window.Show();
        window.UpdateLayout();
        return window;
    }

    [AvaloniaFact]
    public void A_scroller_keeps_both_bars_off_its_content()
    {
        var scroller = new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Content = new Border { Width = 600, Height = 600 },
        };
        Shown(scroller);
        AssertBarsClear(scroller);
    }

    [AvaloniaFact]
    public void A_list_keeps_its_bar_off_its_rows()
    {
        var list = new ListBox { ItemsSource = Enumerable.Range(0, 100).Select(i => $"Row {i}").ToList() };
        Shown(list);
        AssertBarsClear(list);
    }

    [AvaloniaFact]
    public void A_tree_keeps_its_bar_off_its_rows()
    {
        var tree = new TreeView { ItemsSource = Enumerable.Range(0, 100).Select(i => $"Row {i}").ToList() };
        Shown(tree);
        AssertBarsClear(tree);
    }

    [AvaloniaFact]
    public void A_text_box_keeps_its_bars_off_its_lines()
    {
        var box = new TextBox { AcceptsReturn = true, Text = string.Join('\n', Enumerable.Repeat(new string('x', 200), 50)) };
        ScrollViewer.SetHorizontalScrollBarVisibility(box, ScrollBarVisibility.Auto);
        Shown(box);
        AssertBarsClear(box);
    }

    [AvaloniaFact]
    public void A_scroller_sized_to_its_content_grows_by_the_bar()
    {
        var content = new Border { Width = 600, Height = 40 };
        var scroller = new ScrollViewer { HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, Content = content };
        Shown(new StackPanel { Children = { scroller } });
        AssertBarsClear(scroller);
        Assert.Equal(40, scroller.Viewport.Height);
    }

    [AvaloniaFact]
    public async Task The_yaml_file_list_scrolls_inside_itself_with_its_bar_off_the_rows()
    {
        var dir = Directory.CreateTempSubdirectory("flowy-yaml-files").FullName;
        try
        {
            Directory.CreateDirectory(Path.Combine(dir, "flows"));
            File.WriteAllText(Path.Combine(dir, FolderLayout.ModelFile), "name: Plum\n");
            foreach (var i in Enumerable.Range(0, 12)) File.WriteAllText(Path.Combine(dir, "flows", $"a-flow-with-a-long-name-{i}.yaml"), "title: A flow\n");
            var panel = new YamlPanel();
            Shown(panel, 300, 400);
            panel.Show(dir, new object(), null, null);
            await EditModeTests.Until(() => !panel.Reading);
            panel.UpdateLayout();

            var list = panel.FileList!;
            Assert.True(list.Bounds.Height <= 144, $"the list is {list.Bounds.Height} tall: it should cap at four rows and a half");
            var bar = list.GetVisualDescendants().OfType<ScrollBar>().First(b => b.Orientation == Avalonia.Layout.Orientation.Vertical && b.IsVisible);
            var content = list.GetVisualDescendants().OfType<ScrollContentPresenter>().First();
            Assert.False(content.Bounds.Intersects(bar.Bounds), $"The bar at {bar.Bounds} lies over the rows at {content.Bounds}");
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }
}
