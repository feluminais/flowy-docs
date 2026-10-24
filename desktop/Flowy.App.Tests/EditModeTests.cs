using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>Edit mode as a person uses it: switch it on, type into the forms, press Add, Delete, Undo, and look at the files and the screen.</summary>
[Trait("Weight", "Heavy")]
public class EditModeTests
{
    /// <summary>A reader on a copy of the crafted folder (hand-written extras, two flows, a layout), which the test may change.</summary>
    internal static (TempFolder Temp, string Dir, Window Window, ReaderView Reader) Open(bool empty = false)
    {
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(dir);
        if (!empty)
        {
            var source = Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "edit", "flowy");
            foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
            {
                var target = Path.Combine(dir, Path.GetRelativePath(source, file));
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.WriteAllText(target, File.ReadAllText(file));
            }
        }
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        return (temp, dir, window, reader);
    }

    internal static string Model(string dir) => File.ReadAllText(Path.Combine(dir, "model.yaml"));

    internal static void Press(Window w, Key key, PhysicalKey physical, RawInputModifiers modifiers = RawInputModifiers.None) => w.KeyPress(key, modifiers, physical, null);

    /// <summary>Lays the window out and lets the compositor draw it, which hit testing needs before a pointer can find a box.</summary>
    internal static void Settle(Window window)
    {
        window.UpdateLayout();
        Dispatcher.UIThread.RunJobs();
        AvaloniaHeadlessPlatform.ForceRenderTimerTick(3);
        Dispatcher.UIThread.RunJobs();
    }

    internal static async Task Until(Func<bool> done)
    {
        for (var i = 0; i < 500 && !done(); i++) await Task.Delay(10);
        Assert.True(done(), "gave up waiting");
    }

    [AvaloniaFact]
    public void E_turns_edit_mode_on_and_off_and_the_bar_gets_its_tools()
    {
        var (temp, _, window, reader) = Open();
        using var _ = temp;
        Assert.False(reader.Editing);
        Assert.False(reader.EditToolsVisible);
        Press(window, Key.E, PhysicalKey.E);
        Assert.True(reader.Editing);
        Assert.True(reader.EditToolsVisible);
        Press(window, Key.E, PhysicalKey.E);
        Assert.False(reader.Editing);
        Assert.False(reader.EditToolsVisible);
    }

    [AvaloniaFact]
    public void A_file_that_cannot_be_read_or_a_model_that_is_only_for_reading_keeps_edit_mode_off()
    {
        var (temp, _, window, reader) = Open();
        using var _ = temp;
        reader.SetBanner("model.yaml:3: broken");
        reader.SetEditing(true);
        Press(window, Key.E, PhysicalKey.E);
        Assert.False(reader.Editing);
        reader.SetBanner(null);
        reader.CanEdit = false;
        reader.SetEditing(true);
        Assert.False(reader.Editing);
    }

    [AvaloniaFact]
    public async Task Leaving_a_field_saves_it_keeps_every_hand_written_key_and_the_form_shows_what_is_on_disk()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.GoTo("shop");
        reader.OpenObject("api");
        var form = reader.Panel.CurrentObjectEditor!;
        Assert.Equal("API", form.NameField.Text);
        form.NameField.Text = "Orders API";
        await form.NameField.Commit();
        await Until(() => reader.Folder!.Model.GetObject("api")!.Name == "Orders API");
        Assert.Contains("name: Orders API", Model(dir));
        Assert.Contains("owner: sales", Model(dir)); // another box's extra key
        Assert.Contains("owner: platform-team", Model(dir));
        Assert.Same(form, reader.Panel.CurrentObjectEditor); // the same form, so the next field keeps its focus
        Assert.Equal("Orders API", form.NameField.Text);
    }

    [AvaloniaFact]
    public async Task The_links_field_writes_links_title_first_and_clearing_it_removes_them()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        Directory.CreateDirectory(Path.Combine(temp.Path, "docs"));
        File.WriteAllText(Path.Combine(temp.Path, "docs", "runbook.md"), "x");
        reader.SetEditing(true);
        reader.GoTo("shop");
        reader.OpenObject("api");
        var form = reader.Panel.CurrentObjectEditor!;
        form.LinksField.Text = "Runbook | docs/runbook.md\nhttps://status.example.com";
        await form.LinksField.Commit();
        await Until(() => LinkText.Format(reader.Folder!.Model.GetObject("api")!) == "Runbook | docs/runbook.md\nhttps://status.example.com");
        Assert.Contains("- title: Runbook\n        url: docs/runbook.md", Model(dir));
        Assert.Contains("- url: https://status.example.com", Model(dir));
        Assert.Equal("Runbook | docs/runbook.md\nhttps://status.example.com", form.LinksField.Text);

        form.LinksField.Text = "file:///etc/passwd"; // neither a web address nor a path in the repo: refused, and the old text comes back
        await form.LinksField.Commit();
        Assert.Equal("Runbook | docs/runbook.md\nhttps://status.example.com", form.LinksField.Text);
        Assert.DoesNotContain("file:///", Model(dir));

        form.LinksField.Text = "docs/missing.md"; // a path that isn't there is saved, as a missing code path is, and shows up as a problem
        await form.LinksField.Commit();
        await Until(() => reader.Folder!.Problems.Any(p => p.Message == "api: link path \"docs/missing.md\" doesn't exist"));

        form.LinksField.Text = "";
        await form.LinksField.Commit();
        await Until(() => !Model(dir).Contains("links:"));
    }

    [AvaloniaFact]
    public async Task A_refused_edit_says_why_puts_the_old_text_back_and_changes_no_file()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.GoTo("shop");
        reader.OpenObject("api");
        var before = Model(dir);
        var form = reader.Panel.CurrentObjectEditor!;
        form.NameField.Text = "";
        await form.NameField.Commit();
        Assert.Equal("API", form.NameField.Text);
        Assert.StartsWith("Refused, nothing saved. This would add:", reader.NoticeText);
        Assert.Contains("name is missing", reader.NoticeText);
        Assert.Equal(before, Model(dir));
        Assert.False(reader.CanUndo);
    }

    [AvaloniaFact]
    public async Task The_description_tech_code_type_and_outside_service_all_save()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.GoTo("shop");
        reader.OpenObject("db");
        var form = reader.Panel.CurrentObjectEditor!;
        form.DescriptionField.Text = "Holds the orders.\r\n\r\nSecond paragraph.";
        await form.DescriptionField.Commit();
        await Until(() => reader.Folder!.Model.GetObject("db")!.Description is not null);
        Assert.Equal("Holds the orders.\n\nSecond paragraph.", reader.Folder!.Model.GetObject("db")!.Description); // Windows line ends made plain
        form.TechField.Text = "MySQL";
        await form.TechField.Commit();
        form.CodeField.Text = "services/db/\n  apps/web/  \n\n";
        await form.CodeField.Commit();
        await Until(() => reader.Folder!.Model.GetObject("db")!.Code is List<object?> { Count: 2 });
        Assert.Equal(["services/db/", "apps/web/"], ((List<object?>)reader.Folder.Model.GetObject("db")!.Code!).OfType<string>());
        form.ExternalBox.IsChecked = true;
        await Until(() => Model(dir).Contains("external: \"true\"") || Model(dir).Contains("external: true"));
        await Until(() => reader.Folder!.Model.GetObject("db")!.External == "true");
        Assert.Equal("MySQL", reader.Folder.Model.GetObject("db")!.Tech);
    }

    [AvaloniaFact]
    public async Task Add_offers_the_types_that_fit_makes_an_id_from_the_name_and_opens_the_new_box()
    {
        var (temp, dir, window, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.GoTo("shop");
        Press(window, Key.N, PhysicalKey.N);
        var form = reader.Panel.CurrentAddForm!;
        Assert.Equal(["app", "store"], form.TypeChoices.Ids);
        await form.SubmitAsync("store", "Orders DB");
        await Until(() => reader.Folder!.Model.GetObject("orders-db") is not null);
        Assert.Equal("orders-db", reader.SelectedBoxId);
        Assert.Contains("orders-db:", Model(dir));
        Assert.Equal("shop", reader.Folder!.Model.GetObject("orders-db")!.In);
        Assert.Contains(reader.Canvas.Scene!.Boxes, b => b.Id == "orders-db");
    }

    [AvaloniaFact]
    public async Task Delete_removes_the_open_box_and_its_lines_and_undo_brings_them_back()
    {
        var (temp, dir, window, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.GoTo("shop");
        reader.OpenObject("db");
        Press(window, Key.Delete, PhysicalKey.Delete);
        await Until(() => reader.Folder!.Model.GetObject("db") is null);
        Assert.False(reader.HasPanel);
        Assert.DoesNotContain("Orders DB", Model(dir));
        Assert.True(reader.CanUndo);

        Press(window, Key.Z, PhysicalKey.Z, RawInputModifiers.Control);
        await Until(() => reader.Folder!.Model.GetObject("db") is not null);
        Assert.Contains("Orders DB", Model(dir));
        Assert.True(reader.CanRedo);
        Press(window, Key.Y, PhysicalKey.Y, RawInputModifiers.Control);
        await Until(() => reader.Folder!.Model.GetObject("db") is null);
    }

    [AvaloniaFact]
    public async Task A_box_that_a_flow_uses_opens_the_Used_by_panel_with_a_row_for_each_step_and_nothing_is_deleted_until_each_is_settled()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.OpenObject("customer");
        var before = Model(dir);
        await reader.DeleteSelectedAsync();
        var used = reader.UsedByNow!;
        Assert.Equal(["step:browse:1", "step:order:1"], used.RowKeys);
        Assert.Equal(["Customer browses", "Customer orders"], used.RowWords.Select(r => r.Title));
        Assert.False(used.CanDelete);
        Assert.Equal("Choose for 2 more", used.Reason);
        Assert.Equal(before, Model(dir));

        used.PressRemoveAll(); // browse has no other step, so the flow goes; order loses the one step
        Assert.True(used.CanDelete);
        Assert.Equal("deleteFlow", used.ChoiceOf("step:browse:1")!.Action);
        Assert.Equal("removeStep", used.ChoiceOf("step:order:1")!.Action);
        Assert.True(await used.PressDeleteAsync());
        await Until(() => reader.Folder!.Model.GetObject("customer") is null);
        Assert.False(File.Exists(Path.Combine(dir, "flows", "browse.yaml")));
        Assert.Single(reader.Folder!.Model.Flows["order"].Steps);
        Assert.Contains("Deleted Customer.", reader.NoticeText);
        Assert.Equal("Undo", reader.NoticeNow!.ActionText);

        reader.NoticeNow.PressAction(); // one step takes the whole delete back
        await Until(() => reader.Folder!.Model.GetObject("customer") is not null);
        Assert.True(File.Exists(Path.Combine(dir, "flows", "browse.yaml")));
        Assert.Equal(2, reader.Folder!.Model.Flows["order"].Steps.Count);
    }

    [AvaloniaFact]
    public async Task A_lines_label_is_a_field_and_its_connection_can_be_deleted()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.GoTo("shop");
        reader.OpenLine("web", "api");
        var form = reader.Panel.CurrentLineEditor!;
        Assert.Equal("REST", form.Labels.Single().Text);
        form.Labels.Single().Text = "HTTP";
        await form.Labels.Single().Commit();
        await Until(() => Model(dir).Contains("label: HTTP"));
        Assert.Same(form, reader.Panel.CurrentLineEditor);
        await reader.DeleteSelectedAsync();
        await Until(() => !Model(dir).Contains("label: HTTP"));
        Assert.False(reader.HasPanel);
    }

    internal static Point Where(Window window, Flowy.App.Canvas.CanvasView canvas, string id, double x, double y) =>
        ((Visual)canvas.BoxControlFor(id)!).TranslatePoint(new Point(x, y), window)!.Value;

    [AvaloniaFact]
    public async Task Dragging_a_box_moves_it_and_saves_where_every_box_of_the_view_is()
    {
        var (temp, dir, window, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.GoTo("shop");
        Settle(window);
        var canvas = reader.Canvas;
        var before = canvas.RectOf("web")!.Value;
        var zoom = canvas.Viewport.Zoom;
        var start = Where(window, canvas, "web", 100, 25);
        window.MouseDown(start, MouseButton.Left);
        window.MouseMove(new Point(start.X + 20, start.Y + 10), RawInputModifiers.LeftMouseButton);
        window.MouseMove(new Point(start.X + 80, start.Y + 40), RawInputModifiers.LeftMouseButton);
        // On the way the box is already where the pointer is, and its lines went with it.
        Assert.Equal(before.X + 80 / zoom, canvas.RectOf("web")!.Value.X, 3);
        window.MouseUp(new Point(start.X + 80, start.Y + 40), MouseButton.Left);

        await Until(() => reader.Folder!.Model.Layout.TryGetValue("shop", out var saved) && saved.ContainsKey("api"));
        var saved = reader.Folder!.Model.Layout["shop"];
        Assert.Equal(Math.Floor(before.X + 80 / zoom + 0.5), saved["web"].X);
        Assert.Equal(Math.Floor(before.Y + 40 / zoom + 0.5), saved["web"].Y);
        Assert.Equal(new[] { "web", "api", "db" }.OrderBy(x => x), saved.Keys.Where(k => k is "web" or "api" or "db").OrderBy(x => x)); // the whole view is pinned, as in the browser
        Assert.False(reader.HasPanel); // a drag is not a click
        await Until(() => reader.CanUndo);
    }

    [AvaloniaFact]
    public async Task A_press_and_release_in_place_still_opens_the_boxs_panel_in_edit_mode()
    {
        var (temp, _, window, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.GoTo("shop");
        Settle(window);
        var at = Where(window, reader.Canvas, "api", 100, 25);
        window.MouseDown(at, MouseButton.Left);
        window.MouseUp(at, MouseButton.Left);
        await Until(() => reader.SelectedBoxId == "api");
        Assert.NotNull(reader.Panel.CurrentObjectEditor);
    }

    [AvaloniaFact]
    public async Task Drawing_a_line_from_the_dot_under_a_box_to_another_box_connects_them_and_opens_the_label()
    {
        var (temp, dir, window, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.GoTo("shop");
        Settle(window);
        var canvas = reader.Canvas;
        var from = Where(window, canvas, "web", 100, 66);
        var to = Where(window, canvas, "db", 100, 30);
        window.MouseDown(from, MouseButton.Left);
        window.MouseMove(new Point(from.X + 30, from.Y + 30), RawInputModifiers.LeftMouseButton);
        window.MouseMove(to, RawInputModifiers.LeftMouseButton);
        window.MouseUp(to, MouseButton.Left);
        await Until(() => reader.Folder!.Model.Connections.Any(c => c.From == "web" && c.To == "db"));
        Assert.Contains("to: db", Model(dir));
        await Until(() => reader.Panel.CurrentLineEditor is not null);
        Assert.Equal("", reader.Panel.CurrentLineEditor!.Labels.Single().Text);
        Assert.Equal("web", reader.Canvas.Scene!.Edges.Single(e => e.To == "db" && e.From == "web").From);
    }

    [AvaloniaFact]
    public async Task A_line_that_ends_nowhere_connects_nothing()
    {
        var (temp, dir, window, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.GoTo("shop");
        Settle(window);
        var before = Model(dir);
        var from = Where(window, reader.Canvas, "web", 100, 66);
        window.MouseDown(from, MouseButton.Left);
        var empty = new Point(4, 70); // the canvas corner, clear of every box
        window.MouseMove(empty, RawInputModifiers.LeftMouseButton);
        window.MouseUp(empty, MouseButton.Left);
        await Task.Delay(100);
        Assert.Equal(before, Model(dir));
    }

    /// <summary>Drags the box "web" of the view "shop" a little, and waits until it is saved.</summary>
    private static async Task DragWebAsync(Window window, ReaderView reader)
    {
        var start = Where(window, reader.Canvas, "web", 100, 25);
        window.MouseDown(start, MouseButton.Left);
        window.MouseMove(new Point(start.X + 20, start.Y + 10), RawInputModifiers.LeftMouseButton);
        window.MouseMove(new Point(start.X + 80, start.Y + 40), RawInputModifiers.LeftMouseButton);
        window.MouseUp(new Point(start.X + 80, start.Y + 40), MouseButton.Left);
        await Until(() => reader.CanUndoMove);
    }

    [AvaloniaTheory]
    [InlineData(Key.Escape, PhysicalKey.Escape)]
    [InlineData(Key.Back, PhysicalKey.Backspace)]
    public async Task Escape_or_Backspace_right_after_a_drag_takes_the_drag_back_instead_of_going_up_a_level(Key key, PhysicalKey physical)
    {
        var (temp, _, window, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.GoTo("shop");
        Settle(window);
        var before = reader.Folder!.Model.Layout["shop"]["web"];
        await DragWebAsync(window, reader);
        Assert.NotEqual(before, reader.Folder!.Model.Layout["shop"]["web"]);

        Press(window, key, physical);
        await Until(() => reader.Folder!.Model.Layout["shop"]["web"] == before);
        Assert.Equal("shop", reader.View); // still here
        Assert.Single(reader.Folder.Model.Layout["shop"]); // the view is no longer pinned, as before the drag
        Assert.False(reader.CanUndoMove);

        Press(window, key, physical); // nothing left to take back: now it goes up
        Assert.Equal("root", reader.View);
    }

    [AvaloniaFact]
    public async Task Z_zooms_out_one_level_in_reading_and_in_editing_even_just_after_a_drag()
    {
        var (temp, _, window, reader) = Open();
        using var _ = temp;
        reader.GoTo("shop");
        Press(window, Key.Z, PhysicalKey.Z);
        Assert.Equal("root", reader.View);

        reader.SetEditing(true);
        reader.GoTo("shop");
        Settle(window);
        await DragWebAsync(window, reader);
        Press(window, Key.Z, PhysicalKey.Z); // not an undo: that is Ctrl+Z, and Esc or Backspace straight after a drag
        Assert.Equal("root", reader.View);
        Assert.True(reader.CanUndo);

        Press(window, Key.Z, PhysicalKey.Z); // at the top there is nowhere to go
        Assert.Equal("root", reader.View);
    }

    [AvaloniaFact]
    public async Task Once_anything_else_is_done_Escape_goes_back_to_closing_and_going_up()
    {
        var (temp, _, window, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.GoTo("shop");
        Settle(window);
        await DragWebAsync(window, reader);
        reader.OpenObject("api"); // a click on a box
        Assert.False(reader.CanUndoMove);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.False(reader.HasPanel); // it closed the panel
        Assert.True(reader.CanUndo); // and the drag is still there to undo with Ctrl+Z
        Assert.Equal("shop", reader.View);
    }

    [AvaloniaFact]
    public async Task Escape_in_the_middle_of_a_drag_puts_the_box_back_and_saves_nothing()
    {
        var (temp, dir, window, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.GoTo("shop");
        Settle(window);
        var layout = File.ReadAllText(Path.Combine(dir, "layout.yaml"));
        var before = reader.Canvas.RectOf("web")!.Value;
        var start = Where(window, reader.Canvas, "web", 100, 25);
        window.MouseDown(start, MouseButton.Left);
        window.MouseMove(new Point(start.X + 20, start.Y + 10), RawInputModifiers.LeftMouseButton);
        window.MouseMove(new Point(start.X + 80, start.Y + 40), RawInputModifiers.LeftMouseButton);
        Assert.NotEqual(before.X, reader.Canvas.RectOf("web")!.Value.X);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Equal(before, reader.Canvas.RectOf("web")!.Value);
        window.MouseUp(new Point(start.X + 80, start.Y + 40), MouseButton.Left);
        await Task.Delay(150);
        Assert.Equal(layout, File.ReadAllText(Path.Combine(dir, "layout.yaml")));
        Assert.False(reader.CanUndo);
        Assert.Equal("shop", reader.View);
    }

    [AvaloniaFact]
    public void Outside_edit_mode_a_box_does_not_drag_and_has_no_handle()
    {
        var (temp, dir, window, reader) = Open();
        using var _ = temp;
        reader.GoTo("shop");
        Settle(window);
        var layout = File.ReadAllText(Path.Combine(dir, "layout.yaml"));
        var start = Where(window, reader.Canvas, "web", 100, 25);
        window.MouseDown(start, MouseButton.Left);
        window.MouseMove(new Point(start.X + 60, start.Y + 30), RawInputModifiers.LeftMouseButton);
        window.MouseUp(new Point(start.X + 60, start.Y + 30), MouseButton.Left);
        Assert.Equal(layout, File.ReadAllText(Path.Combine(dir, "layout.yaml")));
    }

    [AvaloniaFact]
    public async Task An_empty_model_says_to_press_Add_and_the_first_box_creates_model_yaml()
    {
        var (temp, dir, _, reader) = Open(empty: true);
        using var _ = temp;
        Assert.True(reader.ShowsEmptyNote);
        reader.SetEditing(true);
        Assert.True(reader.ShowsEmptyNote);
        Assert.False(File.Exists(Path.Combine(dir, "model.yaml")));
        Assert.True(await reader.EditAsync(d => EditOps.PutObject(d, new ObjectInput("shop", "system", "Shop"))));
        Assert.True(File.Exists(Path.Combine(dir, "model.yaml")));
        Assert.False(reader.ShowsEmptyNote);
        Assert.False(File.Exists(Path.Combine(dir, "layout.yaml"))); // nothing else was created
    }

    [AvaloniaFact]
    public async Task In_edit_mode_an_empty_system_opens_so_its_first_child_can_be_added()
    {
        var (temp, _, _, reader) = Open(empty: true);
        using var _ = temp;
        reader.SetEditing(true);
        await reader.EditAsync(d => EditOps.PutObject(d, new ObjectInput("shop", "system", "Shop")));
        reader.OpenBox("shop");
        await Until(() => !reader.IsMoving && reader.View == "shop");
        Assert.Equal("shop", reader.View);
        Assert.True(reader.ShowsEmptyNote);
    }

    [AvaloniaFact]
    public async Task The_line_style_picker_saves_the_projects_style_in_edit_mode()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        Assert.Equal("curved", reader.LineStyle); // lines: curved in the file
        reader.LinePicker.SelectedIndex = 2; // right-angled
        await Until(() => Model(dir).Contains("lines: angled"));
        await Until(() => reader.LineStyle == "angled");
    }

    [AvaloniaFact]
    public async Task Tidy_lays_this_view_out_again_and_saves_every_box_of_it()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        await reader.TidyForTestAsync();
        var layout = File.ReadAllText(Path.Combine(dir, "layout.yaml"));
        Assert.DoesNotContain("customer: [10, 20]", layout);
        Assert.Contains("shop: [", layout);
        Assert.Contains("customer: [", layout);
        await reader.TidyForTestAsync(); // nothing dragged any more: it still lays the view out, and never says there is nothing to tidy
        Assert.False(reader.NoticeText?.StartsWith("Nothing to tidy") ?? false);
    }
}
