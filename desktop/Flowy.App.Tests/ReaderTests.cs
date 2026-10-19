using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

public class ReaderTests
{
    private static string Plum => Path.Combine(Repo.Root, "docs", "demo", "flowy");

    private static (Window Window, ReaderView Reader) Open(string? dir = null, double width = 1100, double height = 700)
    {
        dir ??= Plum;
        var reader = new ReaderView();
        var window = new Window { Width = width, Height = height, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        return (window, reader);
    }

    private static void Press(Window w, Key key, PhysicalKey physical, RawInputModifiers modifiers = RawInputModifiers.None, string? symbol = null) =>
        w.KeyPress(key, modifiers, physical, symbol);

    private static void Esc(Window w) => Press(w, Key.Escape, PhysicalKey.Escape);

    [AvaloniaFact]
    public void The_overview_is_drawn_with_its_boxes_and_fitted_in_the_window()
    {
        var (_, reader) = Open();
        var scene = reader.Canvas.Scene!;
        Assert.Equal(Names.Root, scene.View);
        Assert.True(scene.Boxes.Count > 5);
        Assert.InRange(reader.Canvas.Viewport.Zoom, Camera.MinZoom, Camera.MaxZoom);
    }

    [AvaloniaFact]
    public void Escape_closes_the_panel_and_then_goes_up_a_level()
    {
        var (window, reader) = Open();
        reader.GoTo("ordering");
        reader.OpenObject("order-api");
        Assert.True(reader.HasPanel);
        Assert.Equal("order-api", reader.SelectedBoxId);

        Esc(window);
        Assert.False(reader.HasPanel);
        Assert.Equal("ordering", reader.View);

        Esc(window);
        Assert.Equal(Names.Root, reader.View);

        Esc(window); // at the top, with nothing open: nothing
        Assert.Equal(Names.Root, reader.View);
    }

    [AvaloniaFact]
    public void A_click_on_the_outline_round_the_level_opens_Details_for_that_system()
    {
        var (window, reader) = Open();
        reader.GoTo("ordering");
        Dispatcher.UIThread.RunJobs();
        var frame = reader.Canvas.Scene!.Frame!.Value;
        var vp = reader.Canvas.Viewport;
        Point OnScreen(double x, double y) => reader.Canvas.TranslatePoint(new Point(x * vp.Zoom + vp.X, y * vp.Zoom + vp.Y), window)!.Value;
        Assert.False(reader.HasPanel);

        var onEdge = OnScreen(frame.X, frame.Y + frame.Height / 2);
        window.MouseDown(onEdge, MouseButton.Left);
        window.MouseUp(onEdge, MouseButton.Left);

        Assert.True(reader.DetailsOpenNow); // what the (i) button on the rail opens: the level you are inside
        Assert.Null(reader.SelectedBoxId);
        Assert.Equal("ordering", reader.View);
    }

    [AvaloniaFact]
    public void Backspace_goes_up_a_level_but_not_from_the_top()
    {
        var (window, reader) = Open();
        reader.GoTo("ordering");
        Press(window, Key.Back, PhysicalKey.Backspace);
        Assert.Equal(Names.Root, reader.View);
        Press(window, Key.Back, PhysicalKey.Backspace);
        Assert.Equal(Names.Root, reader.View);
    }

    [AvaloniaFact]
    public void Enter_opens_the_selected_box_if_it_has_boxes_inside_and_shows_its_panel_if_not()
    {
        var (window, reader) = Open();
        reader.OpenObject("ordering");
        Press(window, Key.Enter, PhysicalKey.Enter);
        Assert.Equal("ordering", reader.View);

        reader.OpenObject("orders-db"); // a store: nothing inside it
        Press(window, Key.Enter, PhysicalKey.Enter);
        Assert.Equal("orders-db", reader.SelectedBoxId);
        Assert.Equal("ordering", reader.View);
    }

    [AvaloniaFact]
    public void A_flow_plays_with_the_arrow_keys_and_Escape_stops_it_before_going_up()
    {
        var (window, reader) = Open();
        reader.GoTo("ordering");
        reader.Play("place-order");
        Assert.Equal("place-order", reader.PlayingFlowId);
        Assert.Equal(0, reader.PlayingStep);

        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Assert.Equal(2, reader.PlayingStep);
        Press(window, Key.Left, PhysicalKey.ArrowLeft);
        Assert.Equal(1, reader.PlayingStep);
        Press(window, Key.End, PhysicalKey.End);
        var last = reader.PlayingStep;
        Assert.True(last > 1);
        Press(window, Key.Right, PhysicalKey.ArrowRight); // past the end stays on the last step
        Assert.Equal(last, reader.PlayingStep);
        Press(window, Key.Home, PhysicalKey.Home);
        Assert.Equal(0, reader.PlayingStep);

        Esc(window);
        Assert.Null(reader.PlayingFlowId);
        Assert.Equal("ordering", reader.View);
    }

    [AvaloniaFact]
    public void The_lit_step_follows_the_flow_on_the_canvas()
    {
        var (_, reader) = Open();
        reader.GoTo("ordering");
        reader.Play("place-order", 1);
        var scene = reader.Canvas.Scene!;
        Assert.Equal(2, scene.Boxes.Count(b => b.Mode == BoxMode.Lit));
        Assert.Contains(scene.Boxes, b => b.Mode == BoxMode.Dim);
    }

    [AvaloniaFact]
    public void A_question_mark_shows_the_shortcuts_and_Escape_closes_them_first()
    {
        var (window, reader) = Open();
        reader.GoTo("ordering");
        Press(window, Key.OemQuestion, PhysicalKey.Slash, RawInputModifiers.Shift, "?");
        Assert.True(reader.ShortcutsOpen);
        Esc(window);
        Assert.False(reader.ShortcutsOpen);
        Assert.Equal("ordering", reader.View);
        Press(window, Key.OemQuestion, PhysicalKey.Slash, RawInputModifiers.Shift, "?");
        Press(window, Key.OemQuestion, PhysicalKey.Slash, RawInputModifiers.Shift, "?");
        Assert.False(reader.ShortcutsOpen);
    }

    [AvaloniaFact]
    public void Search_finds_a_box_anywhere_and_picking_it_opens_its_view_and_panel()
    {
        var (window, reader) = Open();
        Press(window, Key.K, PhysicalKey.K, RawInputModifiers.Control);
        Assert.True(reader.SearchOpen);
        Dispatcher.UIThread.RunJobs(); // the field takes the focus once it is on screen
        window.KeyTextInput("refunds");
        Press(window, Key.Enter, PhysicalKey.Enter);
        Assert.False(reader.SearchOpen);
        var refunds = reader.Folder!.Model.Objects.Single(kv => kv.Value.Name == "Refunds").Key;
        Assert.Equal(refunds, reader.SelectedBoxId);
        Assert.Equal(Views.ParentOf(reader.Folder.Model, refunds), reader.View);
    }

    [AvaloniaFact]
    public void Escape_closes_search_without_going_anywhere()
    {
        var (window, reader) = Open();
        reader.GoTo("ordering");
        Press(window, Key.Oem2, PhysicalKey.Slash, RawInputModifiers.None, "/");
        Assert.True(reader.SearchOpen);
        Esc(window);
        Assert.False(reader.SearchOpen);
        Assert.Equal("ordering", reader.View);
    }

    [AvaloniaFact]
    public void F_fits_the_view_again_after_zooming_in()
    {
        var (window, reader) = Open();
        var fitted = reader.Canvas.Viewport;
        window.MouseWheel(new Point(500, 300), new Vector(0, 3));
        Assert.NotEqual(fitted.Zoom, reader.Canvas.Viewport.Zoom);
        Press(window, Key.F, PhysicalKey.F);
        // the fit animates; with motion off it is at once
        Assert.Equal(fitted.Zoom, reader.Canvas.Viewport.Zoom, 3);
    }

    [AvaloniaFact]
    public void The_wheel_zooms_in_and_dragging_empty_space_pans()
    {
        var (window, reader) = Open();
        var before = reader.Canvas.Viewport;
        window.MouseWheel(new Point(window.Bounds.Width / 2, 400), new Vector(0, 2));
        var zoomed = reader.Canvas.Viewport;
        Assert.True(zoomed.Zoom > before.Zoom);

        // empty space: near the top-left corner of the canvas, past the navigator's rail
        window.MouseDown(new Point(60, 120), MouseButton.Left);
        window.MouseMove(new Point(120, 160));
        window.MouseUp(new Point(120, 160), MouseButton.Left);
        var panned = reader.Canvas.Viewport;
        Assert.Equal(zoomed.X + 60, panned.X, 3);
        Assert.Equal(zoomed.Y + 40, panned.Y, 3);
        Assert.Equal(zoomed.Zoom, panned.Zoom);
    }

    [AvaloniaFact]
    public void A_click_on_a_box_that_opens_waits_for_a_double_click_only_while_no_panel_is_open()
    {
        var (window, reader) = Open();
        void Click(string id)
        {
            window.UpdateLayout();
            Dispatcher.UIThread.RunJobs();
            AvaloniaHeadlessPlatform.ForceRenderTimerTick(3);
            var at = ((Visual)reader.Canvas.BoxControlFor(id)!).TranslatePoint(new Point(100, 25), window)!.Value;
            window.MouseDown(at, MouseButton.Left);
            window.MouseUp(at, MouseButton.Left);
        }

        Click("ordering"); // has boxes inside and nothing is open: its panel waits in case this is the first half of a double-click
        Assert.False(reader.HasPanel);
        Click("customer"); // nothing inside it: at once
        Assert.Equal("customer", reader.SelectedBoxId);
        Click("ordering"); // a panel is open, so there's nothing to wait for: the panel just changes
        Assert.Equal("ordering", reader.SelectedBoxId);
    }

    [AvaloniaFact]
    public void A_second_click_on_a_box_closes_its_panel()
    {
        var (window, reader) = Open();
        void Click(string id)
        {
            window.UpdateLayout();
            Dispatcher.UIThread.RunJobs();
            AvaloniaHeadlessPlatform.ForceRenderTimerTick(3);
            var at = ((Visual)reader.Canvas.BoxControlFor(id)!).TranslatePoint(new Point(100, 25), window)!.Value;
            window.MouseDown(at, MouseButton.Left);
            window.MouseUp(at, MouseButton.Left);
        }

        Click("customer");
        Assert.Equal("customer", reader.SelectedBoxId);
        Click("customer");
        Assert.False(reader.HasPanel);

        Click("customer");
        Click("ordering"); // another box changes the panel, as before
        Assert.Equal("ordering", reader.SelectedBoxId);
        Click("ordering");
        Assert.False(reader.HasPanel);
    }

    [AvaloniaFact]
    public void A_second_click_on_the_outline_round_the_level_closes_Details()
    {
        var (window, reader) = Open();
        reader.GoTo("ordering");
        Dispatcher.UIThread.RunJobs();
        var frame = reader.Canvas.Scene!.Frame!.Value;
        var vp = reader.Canvas.Viewport;
        var onEdge = reader.Canvas.TranslatePoint(new Point(frame.X * vp.Zoom + vp.X, (frame.Y + frame.Height / 2) * vp.Zoom + vp.Y), window)!.Value;

        window.MouseDown(onEdge, MouseButton.Left);
        window.MouseUp(onEdge, MouseButton.Left);
        Assert.True(reader.DetailsOpenNow);

        window.MouseDown(onEdge, MouseButton.Left);
        window.MouseUp(onEdge, MouseButton.Left);
        Assert.False(reader.DetailsOpenNow);
        Assert.Equal("ordering", reader.View);
    }

    [AvaloniaFact]
    public void A_reload_keeps_where_the_reader_is_and_closes_a_panel_whose_box_is_gone()
    {
        var (_, reader) = Open();
        reader.GoTo("ordering");
        reader.OpenObject("order-api");
        reader.Reload(FolderLoader.Load(Plum));
        Assert.Equal("ordering", reader.View);
        Assert.Equal("order-api", reader.SelectedBoxId);

        reader.Reload(FolderLoader.Load(Path.Combine(Repo.Root, "example")));
        Assert.Equal(Names.Root, reader.Canvas.Scene!.View); // ordering is gone: the nearest view that still exists
        Assert.False(reader.HasPanel);
    }

    [AvaloniaFact]
    public void A_view_that_does_not_exist_falls_back_to_the_top()
    {
        var (_, reader) = Open();
        reader.GoTo("no-such-box");
        Assert.Equal(Names.Root, reader.Canvas.Scene!.View);
    }

    [AvaloniaFact]
    public void Selecting_a_box_that_does_not_exist_does_nothing()
    {
        var (_, reader) = Open();
        reader.OpenObject("ghost");
        Assert.False(reader.HasPanel);
        Assert.Null(reader.SelectedBoxId);
    }

    [AvaloniaFact]
    public void The_line_style_follows_the_readers_pick_and_the_projects_otherwise()
    {
        var (_, reader) = Open();
        Assert.Equal("straight", reader.LineStyle);
        reader.PickLines("curved");
        Assert.Equal("curved", reader.LineStyle);
        Assert.Equal("curved", reader.Canvas.LineStyle);
        reader.PickLines(null);
        Assert.Equal("straight", reader.LineStyle);
    }

    [AvaloniaFact]
    public void Picking_a_line_style_in_the_picker_keeps_its_list_and_follows_the_pick()
    {
        var (_, reader) = Open();
        var picker = reader.LinePicker;
        Assert.Equal(4, picker.Items.Count);

        foreach (var (index, style) in new[] { (2, "curved"), (3, "angled"), (1, "straight"), (0, "straight") })
        {
            picker.IsDropDownOpen = true;
            picker.SelectedIndex = index;
            picker.IsDropDownOpen = false;
            Assert.Equal(4, picker.Items.Count);
            Assert.Equal(index, picker.SelectedIndex);
            Assert.Equal(style, reader.LineStyle);
        }
    }
}
