using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>
/// A click or a pick that redraws the screen redraws the very control it came from: a crumb, a tree row, a flow row, the line picker.
/// These go through real pointer input (not the methods the app calls itself), so a control that can't take being rebuilt under its own event fails here.
/// </summary>
public class ReentrancyTests
{
    private static string Plum => Path.Combine(Repo.Root, "docs", "demo", "flowy");

    private static (Window Window, ReaderView Reader) Open()
    {
        var reader = new ReaderView();
        var window = new Window { Width = 1100, Height = 700, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(Plum), Plum);
        window.UpdateLayout();
        return (window, reader);
    }

    private static void Click(Window window, Visual target)
    {
        window.UpdateLayout();
        var at = target.TranslatePoint(new Point(target.Bounds.Width / 2, target.Bounds.Height / 2), window)!.Value;
        window.MouseDown(at, MouseButton.Left);
        window.MouseUp(at, MouseButton.Left);
    }

    [AvaloniaFact]
    public void Clicking_a_crumb_goes_up_a_level_though_the_bar_is_rebuilt_under_the_click()
    {
        var (window, reader) = Open();
        reader.GoTo("ordering");
        window.UpdateLayout();
        var overview = reader.GetVisualDescendants().OfType<Button>().First(b => b.Classes.Contains("crumb") && b.IsEnabled);
        Click(window, overview);
        Assert.Equal(Names.Root, reader.View);
        Assert.Contains(reader.GetVisualDescendants().OfType<Button>(), b => b.Classes.Contains("crumb"));
    }

    [AvaloniaFact]
    public void Clicking_a_row_of_the_Explorer_picks_it_though_the_list_is_refilled_under_the_click()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Explorer);
        window.UpdateLayout();
        var explorer = reader.Navigator.Explorer;
        var rows = explorer.GetVisualDescendants().OfType<Border>().Where(b => b.Classes.Contains("treerow")).ToList();
        Assert.True(rows.Count > 2);
        Click(window, rows[2]);
        window.UpdateLayout();
        Assert.Contains(explorer.GetVisualDescendants().OfType<Border>(), b => b.Classes.Contains("treerow"));
        Assert.NotNull(explorer.FocusKey);
    }

    [AvaloniaFact]
    public void Clicking_a_flow_in_the_Flows_list_plays_it_though_the_list_is_rebuilt_under_the_click()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Flows);
        window.UpdateLayout();
        var row = reader.Navigator.GetVisualDescendants().OfType<Button>().First(b => b.Classes.Contains("flowrow"));
        Click(window, row);
        Assert.NotNull(reader.PlayingFlowId);
        Assert.Contains(reader.Navigator.GetVisualDescendants().OfType<Button>(), b => b.Classes.Contains("flowrow"));
    }

    [AvaloniaFact]
    public void The_line_picker_keeps_its_list_when_the_mode_changes_with_its_dropdown_open()
    {
        var (_, reader) = Open();
        var picker = reader.LinePicker;
        picker.IsDropDownOpen = true;
        reader.SetEditing(true);
        Assert.Equal(3, picker.Items.Count);
        reader.SetEditing(false);
        Assert.Equal(3, picker.Items.Count);
        Assert.Equal(0, picker.SelectedIndex);
    }
}
