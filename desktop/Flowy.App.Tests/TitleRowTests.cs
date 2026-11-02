using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Chrome;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.LogicalTree;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>The window's top row: the menu alone where the window keeps the system's title bar, and the title bar itself where the window draws into it.</summary>
public class TitleRowTests
{
    [AvaloniaFact]
    public void A_window_that_keeps_its_title_bar_gets_the_menu_alone()
    {
        var window = new Window { Title = "Plum - Flowy Docs" };
        var row = new TitleRow(window, new NativeMenuBar());
        window.Content = row;
        window.Show();
        Assert.False(row.IsTitleBar);
        Assert.Equal(WindowDecorationsElementRole.None, WindowDecorationProperties.GetElementRole(row));
    }

    [AvaloniaFact]
    public void Drawn_into_the_title_bar_it_moves_the_window_and_leaves_the_menu_and_the_buttons_their_clicks()
    {
        var window = new Window { Title = "Plum - Flowy Docs" };
        var menu = new NativeMenuBar();
        var row = new TitleRow(window, menu);
        window.Content = row;
        window.Show();
        row.Show(true, new Thickness(0, 30, 0, 0));
        Assert.True(row.IsTitleBar);
        Assert.Equal(WindowDecorationsElementRole.TitleBar, WindowDecorationProperties.GetElementRole(row));
        Assert.Equal(WindowDecorationsElementRole.User, WindowDecorationProperties.GetElementRole(menu));
        Assert.Equal(30, row.MinHeight);
        window.Title = "Other - Flowy Docs";
        Assert.Contains(row.GetLogicalDescendants().OfType<TextBlock>(), t => t.Text == "Other - Flowy Docs");

        // Full screen has no title bar: the row goes back to the menu alone.
        window.WindowState = WindowState.FullScreen;
        row.Show(true, new Thickness(0, 30, 0, 0));
        Assert.False(row.IsTitleBar);
    }
}
