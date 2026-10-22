using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.VisualTree;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;
using static Flowy.App.Tests.EditModeTests;

namespace Flowy.App.Tests;

/// <summary>Several boxes picked at once in edit mode (Ctrl or Shift+click, Shift and drag, Ctrl+A), moved together and deleted together.</summary>
public class MultiSelectTests
{
    private static void Click(Window window, Point at, RawInputModifiers keys = RawInputModifiers.None)
    {
        window.MouseDown(at, MouseButton.Left, keys);
        window.MouseUp(at, MouseButton.Left, keys);
    }

    private static void Drag(Window window, Point from, Point to, RawInputModifiers keys = RawInputModifiers.None)
    {
        window.MouseDown(from, MouseButton.Left, keys);
        window.MouseMove(new Point(from.X + (to.X - from.X) / 3, from.Y + (to.Y - from.Y) / 3), RawInputModifiers.LeftMouseButton | keys);
        window.MouseMove(to, RawInputModifiers.LeftMouseButton | keys);
        window.MouseUp(to, MouseButton.Left, keys);
    }

    private static (TempFolder Temp, string Dir, Window Window, ReaderView Reader) OpenView(string view)
    {
        var (temp, dir, window, reader) = Open();
        reader.SetEditing(true);
        reader.GoTo(view);
        Settle(window);
        return (temp, dir, window, reader);
    }

    /// <summary>A point of the canvas that a scene position lands on, in the window's own coordinates.</summary>
    private static Point Screen(Window window, CanvasView canvas, double x, double y)
    {
        var at = canvas.Viewport.ToScreen(new Pt(x, y));
        return canvas.TranslatePoint(new Point(at.X, at.Y), window)!.Value;
    }

    [AvaloniaFact]
    public async Task Ctrl_click_adds_a_box_to_the_boxes_picked_and_takes_it_out_again()
    {
        var (temp, _, window, reader) = OpenView("shop");
        using var _ = temp;
        var canvas = reader.Canvas;
        Click(window, Where(window, canvas, "api", 100, 25)); // api opens, so its panel waits out the double-click…
        Click(window, Where(window, canvas, "web", 100, 25), RawInputModifiers.Control); // …and a Ctrl+click in the meantime still counts it
        Assert.Equal(["api", "web"], reader.PickedNow);
        Assert.Equal("2 selected", reader.Picked.Text);
        Assert.True(reader.Picked.IsVisible);
        Assert.False(reader.DetailsOpenNow); // no panel over the boxes: they are where they are to be dragged
        Assert.Null(reader.Panel.CurrentObjectEditor);

        Click(window, Where(window, canvas, "db", 100, 25), RawInputModifiers.Shift); // Shift works the same
        Assert.Equal(["api", "web", "db"], reader.PickedNow);

        Click(window, Where(window, canvas, "api", 100, 25), RawInputModifiers.Control);
        Assert.Equal(["web", "db"], reader.PickedNow);
        Click(window, Where(window, canvas, "db", 100, 25), RawInputModifiers.Control);
        await Until(() => reader.Panel.CurrentObjectEditor is not null); // one box left is an ordinary click on it
        Assert.Equal(["web"], reader.PickedNow);
        Assert.Equal("web", reader.SelectedBoxId);
    }

    [AvaloniaFact]
    public async Task Two_Ctrl_clicks_on_a_box_that_opens_pick_and_unpick_it_and_do_not_zoom_in()
    {
        var (temp, _, window, reader) = OpenView("root");
        using var _ = temp;
        var at = Where(window, reader.Canvas, "shop", 60, 25);
        Click(window, at, RawInputModifiers.Control);
        Assert.Equal(["shop"], reader.PickedNow);
        Click(window, at, RawInputModifiers.Control);
        await Task.Delay(300);
        Assert.Empty(reader.PickedNow);
        Assert.Equal("root", reader.View);
    }

    [AvaloniaFact]
    public async Task Dragging_one_of_several_picked_boxes_moves_them_all_and_one_undo_takes_them_back()
    {
        var (temp, _, window, reader) = OpenView("shop");
        using var _ = temp;
        var canvas = reader.Canvas;
        Click(window, Where(window, canvas, "web", 100, 25), RawInputModifiers.Control);
        Click(window, Where(window, canvas, "api", 100, 25), RawInputModifiers.Control);
        Assert.Equal(["web", "api"], reader.PickedNow);
        var (web, api, db) = (canvas.RectOf("web")!.Value, canvas.RectOf("api")!.Value, canvas.RectOf("db")!.Value);
        var zoom = canvas.Viewport.Zoom;

        var start = Where(window, canvas, "web", 100, 25);
        Drag(window, start, new Point(start.X + 90, start.Y + 45));
        var (dx, dy) = (90 / zoom, 45 / zoom);
        Assert.Equal(web.X + dx, canvas.RectOf("web")!.Value.X, 3);
        Assert.Equal(api.X + dx, canvas.RectOf("api")!.Value.X, 3); // the other picked box went with it
        Assert.Equal(api.Y + dy, canvas.RectOf("api")!.Value.Y, 3);
        Assert.Equal(db.X, canvas.RectOf("db")!.Value.X, 3); // one that was not picked stayed

        await Until(() => reader.Folder!.Model.Layout.TryGetValue("shop", out var saved) && saved.ContainsKey("api") && saved["api"].X != 0);
        var saved = reader.Folder!.Model.Layout["shop"];
        Assert.Equal(Math.Floor(web.X + dx + 0.5), saved["web"].X);
        Assert.Equal(Math.Floor(api.X + dx + 0.5), saved["api"].X);
        Assert.Equal(["web", "api"], reader.PickedNow); // still picked: they can be dragged again
        await Until(() => reader.CanUndoMove);

        Press(window, Key.Escape, PhysicalKey.Escape); // straight after a drag, Esc takes it back: the whole move, in one step
        await Until(() => reader.Folder!.Model.Layout["shop"]["web"].X == 0);
        Assert.False(reader.Folder!.Model.Layout["shop"].ContainsKey("api")); // the file is as it was before the drag, which pinned the whole view
    }

    [AvaloniaFact]
    public async Task Dragging_a_box_that_is_not_one_of_the_boxes_picked_moves_only_that_box()
    {
        var (temp, _, window, reader) = OpenView("shop");
        using var _ = temp;
        var canvas = reader.Canvas;
        Click(window, Where(window, canvas, "web", 100, 25), RawInputModifiers.Control);
        Click(window, Where(window, canvas, "api", 100, 25), RawInputModifiers.Control);
        var (web, api, db) = (canvas.RectOf("web")!.Value, canvas.RectOf("api")!.Value, canvas.RectOf("db")!.Value);
        var zoom = canvas.Viewport.Zoom;

        var start = Where(window, canvas, "db", 100, 25);
        Drag(window, start, new Point(start.X + 60, start.Y + 30));
        Assert.Equal(db.X + 60 / zoom, canvas.RectOf("db")!.Value.X, 3);
        Assert.Equal(web.X, canvas.RectOf("web")!.Value.X, 3);
        Assert.Equal(api.X, canvas.RectOf("api")!.Value.X, 3);
        await Until(() => reader.CanUndoMove);
    }

    [AvaloniaFact]
    public async Task Shift_and_drag_on_empty_space_picks_the_boxes_wholly_inside_and_leaves_the_view_where_it_is()
    {
        var (temp, _, window, reader) = OpenView("root");
        using var _ = temp;
        var canvas = reader.Canvas;
        var boxes = canvas.Scene!.Boxes.Where(b => canvas.Scene.Members.Contains(b.Id)).ToList();
        var (customer, shop) = (canvas.RectOf("customer")!.Value, canvas.RectOf("shop")!.Value);
        // From above and left of every box, to just past the bottom right of these two: whatever is wholly inside is picked.
        var (left, top) = (boxes.Min(b => b.Rect.X) - 30, boxes.Min(b => b.Rect.Y) - 30);
        var (right, bottom) = (Math.Max(customer.Right, shop.Right) + 10, Math.Max(customer.Bottom, shop.Bottom) + 10);
        var expected = boxes.Where(b => b.Rect.X >= left && b.Rect.Y >= top && b.Rect.Right <= right && b.Rect.Bottom <= bottom).Select(b => b.Id).ToList();
        Assert.Contains("customer", expected);
        Assert.Contains("shop", expected);
        var viewport = canvas.Viewport;

        Drag(window, Screen(window, canvas, left, top), Screen(window, canvas, right, bottom), RawInputModifiers.Shift);
        await Until(() => reader.PickedNow.Count > 1);
        Assert.Equal(expected.OrderBy(x => x), reader.PickedNow.OrderBy(x => x));
        Assert.Equal(viewport, canvas.Viewport); // it was a marquee, not a pan
        Assert.False(reader.CanUndo); // nothing was written
    }

    [AvaloniaFact]
    public void Escape_in_the_middle_of_a_marquee_forgets_it_and_leaves_the_boxes_picked_as_they_were()
    {
        var (temp, _, window, reader) = OpenView("root");
        using var _ = temp;
        var canvas = reader.Canvas;
        var from = Screen(window, canvas, canvas.Scene!.Boxes.Min(b => b.Rect.X) - 30, canvas.Scene.Boxes.Min(b => b.Rect.Y) - 30);
        window.MouseDown(from, MouseButton.Left, RawInputModifiers.Shift);
        window.MouseMove(new Point(from.X + 300, from.Y + 200), RawInputModifiers.LeftMouseButton | RawInputModifiers.Shift);
        Press(window, Key.Escape, PhysicalKey.Escape);
        window.MouseMove(new Point(from.X + 320, from.Y + 220), RawInputModifiers.LeftMouseButton | RawInputModifiers.Shift);
        window.MouseUp(new Point(from.X + 320, from.Y + 220), MouseButton.Left, RawInputModifiers.Shift);
        Assert.Empty(reader.PickedNow);
    }

    [AvaloniaFact]
    public async Task Ctrl_A_picks_every_box_of_the_view_and_Delete_takes_the_ones_that_can_go_in_one_edit_that_one_Ctrl_Z_brings_back()
    {
        var (temp, dir, window, reader) = OpenView("root");
        using var _ = temp;
        var canvas = reader.Canvas;
        Press(window, Key.A, PhysicalKey.A, RawInputModifiers.Control);
        Assert.Equal(canvas.Scene!.Members.OrderBy(x => x), reader.PickedNow.OrderBy(x => x));
        Assert.Equal(5, reader.PickedNow.Count);

        // The customer and the shop are used by flows, so the Used by panel opens for all of them, and Cancel changes nothing and picks them again.
        var before = Model(dir);
        Press(window, Key.Delete, PhysicalKey.Delete);
        await Until(() => reader.UsedByNow is not null);
        Assert.Contains(reader.UsedByNow!.RowKeys, k => k.StartsWith("step:browse:"));
        Assert.Equal(before, Model(dir));
        reader.UsedByNow.PressCancel();
        Assert.Null(reader.UsedByNow);
        Assert.Equal(5, reader.PickedNow.Count);

        Click(window, Where(window, canvas, "customer", 60, 25), RawInputModifiers.Control);
        Click(window, Where(window, canvas, "shop", 60, 25), RawInputModifiers.Control);
        Assert.Equal(["10", "2", "pay"], reader.PickedNow.OrderBy(x => x, StringComparer.Ordinal));
        Press(window, Key.Delete, PhysicalKey.Delete);
        await Until(() => reader.Folder!.Model.GetObject("pay") is null);
        Assert.Null(reader.Folder!.Model.GetObject("2"));
        Assert.Null(reader.Folder.Model.GetObject("10"));
        Assert.NotNull(reader.Folder.Model.GetObject("customer"));
        Assert.DoesNotContain("Payments", Model(dir));
        Assert.DoesNotContain("charges", Model(dir)); // the line to it went too
        Assert.Empty(reader.PickedNow);
        Assert.False(reader.HasPanel);

        Press(window, Key.Z, PhysicalKey.Z, RawInputModifiers.Control); // one step puts all three back
        await Until(() => reader.Folder!.Model.GetObject("pay") is not null);
        Assert.NotNull(reader.Folder.Model.GetObject("2"));
        Assert.NotNull(reader.Folder.Model.GetObject("10"));
        Assert.Contains("charges", Model(dir));
    }

    [AvaloniaFact]
    public async Task The_panels_button_deletes_all_the_boxes_picked_and_a_name_in_it_narrows_the_pick_to_that_box()
    {
        var (temp, _, window, reader) = OpenView("root");
        using var _ = temp;
        var canvas = reader.Canvas;
        Click(window, Where(window, canvas, "pay", 60, 25), RawInputModifiers.Control);
        Click(window, Where(window, canvas, "2", 60, 25), RawInputModifiers.Control);
        Assert.Equal("2 selected", reader.Picked.Text);
        reader.OpenObject("pay"); // what a name in the panel does
        Assert.Equal(["pay"], reader.PickedNow);

        Click(window, Where(window, canvas, "2", 60, 25), RawInputModifiers.Control);
        await reader.DeleteSelectedAsync();
        await Until(() => reader.Folder!.Model.GetObject("2") is null);
        Assert.Null(reader.Folder!.Model.GetObject("pay"));
    }

    [AvaloniaFact]
    public async Task The_bars_Delete_button_deletes_all_the_boxes_picked_and_its_clear_button_and_Esc_let_them_go()
    {
        var (temp, _, window, reader) = OpenView("root");
        using var _ = temp;
        var canvas = reader.Canvas;
        Click(window, Where(window, canvas, "pay", 60, 25), RawInputModifiers.Control);
        Click(window, Where(window, canvas, "2", 60, 25), RawInputModifiers.Control);
        Click(window, Where(window, canvas, "10", 60, 25), RawInputModifiers.Control);
        Assert.Equal("3 selected", reader.Picked.Text);

        Button Named(string name) => reader.Picked.GetVisualDescendants().OfType<Button>().Single(b => Avalonia.Automation.AutomationProperties.GetName(b) == name);
        Named("Clear selection").RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
        Assert.Empty(reader.PickedNow);
        Assert.False(reader.Picked.IsVisible);

        Click(window, Where(window, canvas, "pay", 60, 25), RawInputModifiers.Control);
        Click(window, Where(window, canvas, "2", 60, 25), RawInputModifiers.Control);
        Press(window, Key.Escape, PhysicalKey.Escape); // Esc lets them go, and does not go up a level
        Assert.Empty(reader.PickedNow);
        Assert.Equal("root", reader.View);

        Click(window, Where(window, canvas, "pay", 60, 25), RawInputModifiers.Control);
        Click(window, Where(window, canvas, "2", 60, 25), RawInputModifiers.Control);
        Named("Delete").RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
        await Until(() => reader.Folder!.Model.GetObject("pay") is null);
        Assert.Null(reader.Folder!.Model.GetObject("2"));
        Assert.NotNull(reader.Folder.Model.GetObject("10"));
        Assert.False(reader.Picked.IsVisible);
    }

    [AvaloniaFact]
    public void Leaving_edit_mode_drops_the_boxes_picked()
    {
        var (temp, _, window, reader) = OpenView("root");
        using var _ = temp;
        Press(window, Key.A, PhysicalKey.A, RawInputModifiers.Control);
        Assert.NotEmpty(reader.PickedNow);
        reader.SetEditing(false);
        Assert.Empty(reader.PickedNow);
        Assert.False(reader.Picked.IsVisible);
    }

    [AvaloniaFact]
    public async Task A_Ctrl_click_in_reading_mode_is_just_a_click_and_picks_nothing_to_edit()
    {
        var (temp, _, window, reader) = Open();
        using var _ = temp;
        Settle(window);
        Click(window, Where(window, reader.Canvas, "customer", 60, 25), RawInputModifiers.Control);
        await Until(() => reader.SelectedBoxId == "customer");
        Assert.False(reader.Picked.IsVisible);
    }
}
