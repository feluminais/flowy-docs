using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>
/// The rail, the Flows list and the Explorer tree, on the Plum demo (36 shapes, 7 flows: one at the top, four in Ordering, two in Delivery):
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
    public void The_rails_are_always_there_the_navigators_on_the_left_says_how_much_there_is_and_Details_is_on_the_right()
    {
        var (window, reader) = Open();
        var icons = reader.Rail.Shown.ToList();
        Assert.Equal(["Explorer, 36", "Flows, 9", "Failures, 14"], icons.Select(i => i.Name)); // Failures is there only where there is an analysis: Plum has 14 modes
        Assert.All(icons, i => Assert.True(i.Visible));
        Assert.Equal(["Details", "Performance, 4"], reader.DetailsRail.Shown.Where(i => i.Visible).Select(i => i.Name)); // Performance is there only where there is a run: Plum has four
        Assert.False(reader.HasPanel); // nothing is open until an icon is picked
        double X(Avalonia.Visual v) => v.TranslatePoint(default, window)!.Value.X;
        Assert.True(X(reader.Rail) < X(reader.Canvas), "the navigator's rail is left of the canvas");
        Assert.True(X(reader.DetailsRail) > X(reader.Canvas), "Details' rail is right of it");
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
        Assert.Equal("36 shapes · 9 flows", explorer.SummaryText);
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
    public void Picking_a_shape_goes_to_the_level_it_is_drawn_in_and_selects_it_and_the_Explorer_stays_open_beside_its_Details()
    {
        var (_, reader) = Open();
        reader.ClickRail(PanelTab.Explorer);
        reader.ToggleRow("ordering", true);
        reader.Navigator.Explorer.Pick("shape:order-api");
        Assert.Equal("ordering", reader.View);
        Assert.Equal("order-api", reader.SelectedBoxId);
        Assert.Equal(PanelTab.Explorer, reader.ShownTabNow);
        Assert.True(reader.DetailsOpenNow);
        Assert.Contains(reader.Navigator.Explorer.Rows, r => r.Key == "shape:ordering" && r.Expanded); // the tree followed the canvas
    }

    [AvaloniaFact]
    public void The_row_the_canvas_shows_is_the_only_one_the_keyboard_ring_skips()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Explorer);
        reader.ToggleRow("ordering", true);
        reader.Navigator.Explorer.Pick("shape:order-api");
        window.UpdateLayout();
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(["shape:order-api"], reader.Navigator.Explorer.CanvasKeys);
        reader.Navigator.Explorer.Pick("shape:ordering");
        window.UpdateLayout();
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(["shape:ordering"], reader.Navigator.Explorer.CanvasKeys);
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
        Assert.Equal(9, listed.Count);
        Assert.Equal("delivery", listed[0].View); // the flows in this level come first
        reader.Navigator.Flows.Open("place-order");
        Assert.Equal("ordering", reader.View);
        Assert.Equal("place-order", reader.PlayingFlowId);
        Assert.Equal(PanelTab.Flows, reader.ShownTabNow); // the list stays open
    }

    [AvaloniaFact]
    public void A_click_on_the_canvas_opens_Details_on_the_right_and_leaves_the_navigator_where_it_is()
    {
        var (_, reader) = Open();
        reader.GoTo("ordering");
        reader.ClickRail(PanelTab.Explorer);
        Assert.False(reader.DetailsOpenNow);
        reader.OpenObject("order-api"); // what a click on a shape does
        Assert.True(reader.DetailsOpenNow);
        Assert.Equal(PanelTab.Explorer, reader.ShownTabNow);
        Assert.True(reader.Navigator.IsVisible);
    }

    private static Point At(Control control, Window window, double x, double y) =>
        control.TranslatePoint(new Point(control.Bounds.Width * x, control.Bounds.Height * y), window)!.Value;

    private static void Click(Window window, Point at)
    {
        window.MouseDown(at, MouseButton.Left);
        window.MouseUp(at, MouseButton.Left);
    }

    [AvaloniaFact]
    public void Esc_closes_the_navigator_first_while_it_is_the_last_thing_used_and_then_Details()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Explorer);
        reader.OpenObject("ordering");
        Assert.True(reader.DetailsOpenNow);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Null(reader.ShownTabNow);
        Assert.True(reader.DetailsOpenNow);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.False(reader.HasPanel);
    }

    [AvaloniaFact]
    public void A_click_in_the_diagram_takes_Esc_off_the_navigator_and_a_click_in_the_navigator_gives_it_back()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Explorer);
        Click(window, At(reader.Canvas, window, 0.8, 0.97));
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Equal(PanelTab.Explorer, reader.ShownTabNow); // worked in the diagram: Esc is for the diagram

        Click(window, At(reader.Navigator, window, 0.5, 0.95)); // even a click that lands on nothing in particular
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Null(reader.ShownTabNow);
    }

    [AvaloniaFact]
    public void Esc_in_the_diagram_still_closes_Details_and_goes_up_but_never_the_navigator()
    {
        var (window, reader) = Open();
        reader.GoTo("ordering");
        reader.ClickRail(PanelTab.Flows);
        reader.OpenObject("order-api");
        Click(window, At(reader.Canvas, window, 0.8, 0.97));
        reader.OpenObject("order-api"); // the click on empty canvas let go of it; pick it again, as a click on the shape would
        Assert.True(reader.DetailsOpenNow);

        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.False(reader.DetailsOpenNow);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Equal(Names.Root, reader.View);
        Press(window, Key.Escape, PhysicalKey.Escape); // at the top, with only the navigator open: nothing
        Assert.Equal(PanelTab.Flows, reader.ShownTabNow);
    }

    [AvaloniaFact]
    public void A_navigator_that_came_back_with_the_project_is_left_alone_by_Esc_until_it_is_used()
    {
        var (window, reader) = Open();
        reader.RestoreNavigator(new NavigatorState("explorer", [], null, null));
        Assert.Equal(PanelTab.Explorer, reader.ShownTabNow);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Equal(PanelTab.Explorer, reader.ShownTabNow);
        Click(window, At(reader.Navigator, window, 0.5, 0.95));
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Null(reader.ShownTabNow);
    }

    [AvaloniaFact]
    public void Details_with_nothing_picked_shows_the_level_and_the_top_level_shows_the_overview()
    {
        var (_, reader) = Open();
        reader.ClickRail(PanelTab.Details);
        Assert.True(reader.DetailsOpenNow);
        Assert.Null(reader.ShownTabNow); // Details has no tab of the navigator's
        Assert.True(reader.HasPanel);
        reader.GoTo("ordering"); // the panel stays open and now shows the level you are inside
        Assert.True(reader.DetailsOpenNow);
        Assert.Null(reader.SelectedBoxId); // it shows the level, and selects nothing
        reader.ClickRail(PanelTab.Details);
        Assert.False(reader.HasPanel);
    }

    [AvaloniaFact]
    public void The_filter_keeps_matches_and_the_shapes_that_hold_them()
    {
        var (_, reader) = Open();
        reader.ClickRail(PanelTab.Explorer);
        var explorer = reader.Navigator.Explorer;
        explorer.Filter = "order api";
        Assert.Equal(["Overview", "Ordering", "Order API"], explorer.Rows.Select(r => r.Name));
        Assert.Equal("36 shapes · 9 flows", explorer.SummaryText); // the totals are of the whole model
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
        explorer.Press("ArrowRight"); // steps into it: shapes that hold others come first
        Assert.Equal("shape:order-api", explorer.FocusKey);
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
    public void Dragging_the_edge_of_the_navigator_resizes_it_and_the_width_is_reported_when_the_drag_ends()
    {
        var (window, reader) = Open();
        NavigatorState? last = null;
        reader.NavigatorChanged += s => last = s;
        reader.ClickRail(PanelTab.Explorer);
        Assert.Equal((Camera.Nav, Camera.Panel), reader.Widths);
        var edge = reader.Canvas.TranslatePoint(new Point(Camera.Nav, 300), window)!.Value;
        window.MouseDown(edge, MouseButton.Left);
        window.MouseMove(edge + new Vector(100, 0));
        Assert.Equal(Camera.Nav + 100, reader.Widths.Nav);
        Assert.Equal(Camera.Nav + 100, reader.PanelWidthsOnScreen.Nav);
        window.MouseMove(edge + new Vector(-900, 0));
        Assert.Equal(NavigatorState.MinWidth, reader.Widths.Nav); // never narrower than it reads
        window.MouseMove(edge + new Vector(900, 0));
        Assert.True(reader.Widths.Nav <= NavigatorState.MaxWidth && reader.Widths.Nav <= reader.Canvas.Bounds.Width - 160, "never wider than the canvas can spare");
        window.MouseMove(edge + new Vector(100, 0));
        window.MouseUp(edge + new Vector(100, 0), MouseButton.Left);
        Assert.Equal(Camera.Nav + 100, last!.NavWidth);
    }

    [AvaloniaFact]
    public void Dragging_the_edge_of_Details_the_other_way_resizes_it_and_the_widths_come_back()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Details);
        var edge = reader.Canvas.TranslatePoint(new Point(reader.Canvas.Bounds.Width - Camera.Panel, 300), window)!.Value;
        window.MouseDown(edge, MouseButton.Left);
        window.MouseMove(edge + new Vector(-100, 0)); // its edge going left makes it wider
        window.MouseUp(edge + new Vector(-100, 0), MouseButton.Left);
        Assert.Equal(Camera.Panel + 100, reader.Widths.Details);
        Assert.Equal(Camera.Panel + 100, reader.PanelWidthsOnScreen.Details);

        var (_, other) = Open();
        other.RestoreNavigator(new NavigatorState("explorer", ["root"], 300, 500));
        Assert.Equal((300.0, 500.0), other.Widths);
        other.RestoreNavigator(new NavigatorState(null, ["root"]));
        Assert.Equal((Camera.Nav, Camera.Panel), other.Widths);
    }

    [AvaloniaFact]
    public void A_double_click_on_an_edge_puts_the_width_back_and_the_arrows_nudge_it()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Explorer);
        var (nav, _) = reader.Sashes;
        nav.Focus();
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Assert.Equal(Camera.Nav + 32, reader.Widths.Nav);
        Press(window, Key.Left, PhysicalKey.ArrowLeft);
        Assert.Equal(Camera.Nav + 16, reader.Widths.Nav);
        var edge = reader.Canvas.TranslatePoint(new Point(Camera.Nav + 16, 300), window)!.Value;
        window.MouseDown(edge, MouseButton.Left);
        window.MouseUp(edge, MouseButton.Left);
        window.MouseDown(edge, MouseButton.Left);
        window.MouseUp(edge, MouseButton.Left);
        Assert.Equal(Camera.Nav, reader.Widths.Nav);
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
