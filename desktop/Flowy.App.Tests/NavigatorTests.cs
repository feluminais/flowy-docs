using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>
/// The rail, the Flows list and the Explorer tree, on the Plum demo (36 shapes, 3 flows: one at the top, one in Ordering, one in Delivery):
/// what is on them, what a click on a row does, the keys, the filter, and what is remembered.
/// </summary>
public class NavigatorTests
{
    private static string Plum => Path.Combine(Repo.Root, "docs", "demo", "flowy");

    private static (Window Window, ReaderView Reader) Open(string? dir = null)
    {
        dir ??= Plum;
        TestApp.NoMotion();
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        Dispatcher.UIThread.RunJobs();
        return (window, reader);
    }

    private static void Press(Window w, Key key, PhysicalKey physical) => w.KeyPress(key, RawInputModifiers.None, physical, null);

    [AvaloniaFact]
    public void The_rail_is_always_there_and_says_how_much_there_is()
    {
        var (_, reader) = Open();
        var icons = reader.Rail.Shown.ToList();
        Assert.Equal(["Details", "Flows, 3", "Explorer, 36"], icons.Select(i => i.Name));
        Assert.All(icons, i => Assert.True(i.Visible));
        Assert.False(reader.HasPanel); // nothing is open until an icon is picked
    }

    [AvaloniaFact]
    public void There_is_no_Flows_icon_when_there_is_no_flow()
    {
        var (window, reader) = Open(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "text", "flowy"));
        Assert.False(reader.Rail.Shown.First(i => i.Name.StartsWith("Flows")).Visible);
        Press(window, Key.L, PhysicalKey.L);
        Assert.False(reader.HasPanel); // L has nothing to open
        Press(window, Key.O, PhysicalKey.O);
        Assert.Equal(PanelTab.Explorer, reader.ShownTabNow);
    }

    [AvaloniaFact]
    public void The_icons_open_the_tabs_and_the_open_one_closes_the_panel()
    {
        var (_, reader) = Open();
        reader.ClickRail(PanelTab.Explorer);
        Assert.Equal(PanelTab.Explorer, reader.ShownTabNow);
        Assert.True(reader.Navigator.IsVisible);
        reader.ClickRail(PanelTab.Flows);
        Assert.Equal(PanelTab.Flows, reader.ShownTabNow);
        reader.ClickRail(PanelTab.Flows);
        Assert.False(reader.HasPanel);
        Assert.False(reader.Navigator.IsVisible);
    }

    [AvaloniaFact]
    public void L_and_O_open_the_tabs_and_Esc_closes_the_panel()
    {
        var (window, reader) = Open();
        Press(window, Key.L, PhysicalKey.L);
        Assert.Equal(PanelTab.Flows, reader.ShownTabNow);
        Press(window, Key.O, PhysicalKey.O);
        Assert.Equal(PanelTab.Explorer, reader.ShownTabNow);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.False(reader.HasPanel);
        Assert.Equal(Names.Root, reader.View); // Esc closed the panel and nothing more
    }

    [AvaloniaFact]
    public void The_Explorer_has_the_project_first_with_the_totals_and_the_top_level_below_it()
    {
        var (_, reader) = Open();
        reader.ClickRail(PanelTab.Explorer);
        var explorer = reader.Navigator.Explorer;
        Assert.Equal("36 shapes · 3 flows", explorer.SummaryText);
        Assert.Equal("shape:root", explorer.Rows[0].Key);
        Assert.Equal(36, explorer.Rows[0].Shapes);
        Assert.Contains(explorer.Rows, r => r.Key == "shape:ordering" && r.Depth == 1 && r.Expandable && !r.Expanded);
        Assert.Contains(explorer.Rows, r => r.Key == "flow:refund" && r.Depth == 1);
    }

    [AvaloniaFact]
    public void Opening_a_row_with_a_chevron_shows_what_is_inside_it()
    {
        var (_, reader) = Open();
        reader.ClickRail(PanelTab.Explorer);
        reader.ToggleRow("ordering", true);
        var rows = reader.Navigator.Explorer.Rows;
        Assert.Contains(rows, r => r.Key == "shape:order-api" && r.Depth == 2 && r.Type == "app");
        reader.ToggleRow("ordering", false);
        Assert.DoesNotContain(reader.Navigator.Explorer.Rows, r => r.Key == "shape:order-api");
    }

    [AvaloniaFact]
    public void Picking_a_shape_goes_to_the_level_it_is_drawn_in_and_selects_it_and_the_panel_stays_on_the_Explorer()
    {
        var (_, reader) = Open();
        reader.ClickRail(PanelTab.Explorer);
        reader.ToggleRow("ordering", true);
        reader.Navigator.Explorer.Pick("shape:order-api");
        Assert.Equal("ordering", reader.View);
        Assert.Equal("order-api", reader.SelectedBoxId);
        Assert.Equal(PanelTab.Explorer, reader.ShownTabNow);
        Assert.Contains(reader.Navigator.Explorer.Rows, r => r.Key == "shape:ordering" && r.Expanded); // the tree followed the canvas
    }

    [AvaloniaFact]
    public void Opening_a_shape_in_the_Explorer_zooms_into_it_and_the_tree_follows()
    {
        var (_, reader) = Open();
        reader.ClickRail(PanelTab.Explorer);
        reader.Navigator.Explorer.Open("shape:delivery");
        Assert.Equal("delivery", reader.View);
        Assert.Null(reader.SelectedBoxId);
        Assert.Contains(reader.Navigator.Explorer.Rows, r => r.Key == "shape:delivery" && r.Expanded);
    }

    [AvaloniaFact]
    public void A_flow_in_another_level_goes_there_and_plays()
    {
        var (_, reader) = Open();
        reader.GoTo("delivery");
        reader.ClickRail(PanelTab.Flows);
        var listed = reader.Navigator.Flows.Listed;
        Assert.Equal(3, listed.Count);
        Assert.Equal("delivery", listed[0].View); // the flows in this level come first
        reader.Navigator.Flows.Open("place-order");
        Assert.Equal("ordering", reader.View);
        Assert.Equal("place-order", reader.PlayingFlowId);
        Assert.Equal(PanelTab.Flows, reader.ShownTabNow); // the list stays open
    }

    [AvaloniaFact]
    public void A_click_on_the_canvas_takes_the_panel_back_to_Details()
    {
        var (_, reader) = Open();
        reader.GoTo("ordering");
        reader.ClickRail(PanelTab.Explorer);
        reader.OpenObject("order-api"); // what a click on a shape does
        Assert.Equal(PanelTab.Details, reader.ShownTabNow);
    }

    [AvaloniaFact]
    public void Details_with_nothing_picked_shows_the_level_and_the_top_level_shows_the_overview()
    {
        var (_, reader) = Open();
        reader.ClickRail(PanelTab.Details);
        Assert.Equal(PanelTab.Details, reader.ShownTabNow);
        Assert.True(reader.HasPanel);
        reader.GoTo("ordering"); // the panel stays open and now shows the level you are inside
        Assert.Equal(PanelTab.Details, reader.ShownTabNow);
        Assert.True(reader.HasPanel);
        Assert.Null(reader.SelectedBoxId); // it shows the level, and selects nothing
    }

    [AvaloniaFact]
    public void The_filter_keeps_matches_and_the_shapes_that_hold_them()
    {
        var (_, reader) = Open();
        reader.ClickRail(PanelTab.Explorer);
        var explorer = reader.Navigator.Explorer;
        explorer.Filter = "order api";
        Assert.Equal(["Overview", "Ordering", "Order API"], explorer.Rows.Select(r => r.Name));
        Assert.Equal("36 shapes · 3 flows", explorer.SummaryText); // the totals are of the whole model
        explorer.Filter = "zzzzz";
        Assert.Empty(explorer.Rows);
        explorer.Filter = "";
        Assert.True(explorer.Rows.Count > 5);
    }

    [AvaloniaFact]
    public void The_keys_move_open_and_pick()
    {
        var (_, reader) = Open();
        reader.ClickRail(PanelTab.Explorer);
        var explorer = reader.Navigator.Explorer;
        explorer.Press("Home");
        Assert.Equal("shape:root", explorer.FocusKey);
        explorer.Press("ArrowDown");
        Assert.Equal(explorer.Rows[1].Key, explorer.FocusKey);
        while (explorer.FocusKey != "shape:ordering") explorer.Press("ArrowDown");
        explorer.Press("ArrowRight"); // opens it
        Assert.Contains(explorer.Rows, r => r.Key == "shape:order-api");
        explorer.Press("ArrowRight"); // steps into it
        Assert.Equal("shape:customer-app", explorer.FocusKey);
        explorer.Press("ArrowLeft"); // steps out
        Assert.Equal("shape:ordering", explorer.FocusKey);
        explorer.Press("Enter"); // goes into it
        Assert.Equal("ordering", reader.View);
    }

    [AvaloniaFact]
    public void What_was_open_is_reported_and_comes_back()
    {
        var (_, reader) = Open();
        NavigatorState? last = null;
        reader.NavigatorChanged += s => last = s;
        reader.ClickRail(PanelTab.Explorer);
        Assert.Equal("explorer", last!.Tab);
        reader.ToggleRow("ordering", true);
        Assert.Contains("ordering", last.Expanded);

        var (_, other) = Open();
        other.RestoreNavigator(new NavigatorState("flows", ["root", "delivery"]));
        Assert.Equal(PanelTab.Flows, other.ShownTabNow);
        other.RestoreNavigator(new NavigatorState("elsewhere", []));
        Assert.False(other.HasPanel);
        other.RestoreNavigator(null);
        Assert.False(other.HasPanel);
    }

    [AvaloniaFact]
    public void A_model_of_thousands_of_shapes_is_one_pass_of_rows()
    {
        var model = new Model();
        for (var s = 0; s < 100; s++)
        {
            model.Objects.Add($"sys{s}", new FlowyObject("system", $"System {s}", null, null, null, null, null));
            for (var a = 0; a < 50; a++) model.Objects.Add($"sys{s}-app{a}", new FlowyObject("app", $"App {a}", $"sys{s}", null, null, null, null));
        }
        var all = new HashSet<string>(model.Objects.Keys) { Names.Root };
        var clock = System.Diagnostics.Stopwatch.StartNew();
        var rows = Outlines.Build(model, [], all).Rows;
        Assert.Equal(5101, rows.Count);
        Assert.True(clock.ElapsedMilliseconds < 500, $"took {clock.ElapsedMilliseconds} ms");
    }
}
