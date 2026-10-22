using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;
using static Flowy.App.Tests.EditModeTests;

namespace Flowy.App.Tests;

/// <summary>The Used by panel: what a delete that others depend on shows, the choices, the keys, the outlines on the canvas, and the one edit that settles it all.</summary>
public class UsedByPanelTests
{
    /// <summary>A reader on a copy of desktop/fixtures/cases/delete: flows with steps and groups, states, and a failure analysis on several shapes.</summary>
    private static (TempFolder Temp, string Dir, Window Window, ReaderView Reader) OpenDelete(string view = "shop")
    {
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        var source = Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "delete", "flowy");
        foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            var target = Path.Combine(dir, Path.GetRelativePath(source, file));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.WriteAllText(target, File.ReadAllText(file));
        }
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        reader.SetEditing(true);
        reader.GoTo(view);
        Settle(window);
        return (temp, dir, window, reader);
    }

    private static string Files(string dir) => string.Join("\n", Directory.GetFiles(dir, "*.yaml", SearchOption.AllDirectories).OrderBy(f => f, StringComparer.Ordinal).Select(f => Path.GetRelativePath(dir, f) + "\n" + File.ReadAllText(f)));

    [AvaloniaFact]
    public async Task Deleting_a_shape_that_flows_and_modes_use_lists_a_row_for_each_and_outlines_the_shape_going_and_the_one_a_row_names()
    {
        var (temp, dir, window, reader) = OpenDelete();
        using var _ = temp;
        reader.OpenObject("db");
        var before = Files(dir);
        await reader.DeleteSelectedAsync();
        var used = reader.UsedByNow!;
        Assert.Equal(["step:checkout:3", "mode:ordering:db-down:on"], used.RowKeys);
        Assert.Equal([("step:checkout:3", "Customer checks out", "Step 3: API → Orders DB"), ("mode:ordering:db-down:on", "Ordering", "The database is unreachable: On")], used.RowWords);
        Assert.Contains("2 lines, 1 affected shape", used.AlongText);
        Assert.Equal(UsedMark.Going, ((BoxControl)reader.Canvas.BoxControlFor("db")!).UsedShown);
        Assert.Equal(UsedMark.None, ((BoxControl)reader.Canvas.BoxControlFor("api")!).UsedShown);
        Assert.False(used.CanDelete);
        Assert.Equal("Choose for 2 more", used.Reason);

        used.Focus();
        Press(window, Key.Down, PhysicalKey.ArrowDown);
        Assert.Equal("step:checkout:3", used.ActiveKey);
        Assert.Equal(UsedMark.Flagged, ((BoxControl)reader.Canvas.BoxControlFor("api")!).UsedShown); // the row names API and Orders DB; Orders DB is going
        Assert.Equal(UsedMark.Going, ((BoxControl)reader.Canvas.BoxControlFor("db")!).UsedShown);
        Assert.Equal(before, Files(dir));
    }

    [AvaloniaFact]
    public async Task X_removes_the_row_in_focus_R_asks_where_to_Enter_removes_all_and_then_deletes_and_Esc_goes_back_a_step_at_a_time()
    {
        var (temp, dir, window, reader) = OpenDelete();
        using var _ = temp;
        reader.OpenObject("db");
        var before = Files(dir);
        await reader.DeleteSelectedAsync();
        var used = reader.UsedByNow!;
        used.Focus();

        Press(window, Key.Down, PhysicalKey.ArrowDown);
        Press(window, Key.X, PhysicalKey.X);
        Assert.Equal("removeStep", used.ChoiceOf("step:checkout:3")!.Action);
        Assert.Equal(["mode:ordering:db-down:on"], used.OpenKeys);

        Press(window, Key.Down, PhysicalKey.ArrowDown);
        Press(window, Key.R, PhysicalKey.R); // the mode can be repointed, so R asks where
        Assert.True(used.Choosing);
        Press(window, Key.Escape, PhysicalKey.Escape); // closes the list, not the panel
        Assert.False(used.Choosing);
        Assert.Same(used, reader.UsedByNow);

        Press(window, Key.Enter, PhysicalKey.Enter); // everything still open is removed
        Assert.Empty(used.OpenKeys);
        Assert.True(used.CanDelete);
        Assert.Equal(before, Files(dir));
        Press(window, Key.Enter, PhysicalKey.Enter); // and now it deletes
        await Until(() => reader.Folder!.Model.GetObject("db") is null);
        var model = reader.Folder!.Model;
        Assert.Equal(3, model.Flows["checkout"].Steps.Count);
        Assert.DoesNotContain("db-down", model.Failures["ordering"].Modes.Keys);
        Assert.Contains("Deleted Orders DB.", reader.NoticeText);
        Assert.Contains("Went with it: 2 lines", reader.NoticeText);

        reader.NoticeNow!.PressAction();
        await Until(() => reader.Folder!.Model.GetObject("db") is not null);
        Assert.Equal(before, Files(dir)); // one undo, byte for byte
    }

    [AvaloniaFact]
    public async Task Esc_in_the_panel_cancels_and_brings_back_what_was_picked()
    {
        var (temp, dir, window, reader) = OpenDelete();
        using var _ = temp;
        reader.OpenObject("db");
        var before = Files(dir);
        await reader.DeleteSelectedAsync();
        reader.UsedByNow!.Focus();
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Null(reader.UsedByNow);
        Assert.Equal("db", reader.SelectedBoxId);
        Assert.Equal(UsedMark.None, ((BoxControl)reader.Canvas.BoxControlFor("db")!).UsedShown);
        Assert.Equal(before, Files(dir));
    }

    [AvaloniaFact]
    public async Task Reroute_all_sends_steps_and_modes_to_one_shape_and_the_notice_says_so()
    {
        var (temp, _, _, reader) = OpenDelete();
        using var _ = temp;
        reader.OpenObject("db");
        await reader.DeleteSelectedAsync();
        var used = reader.UsedByNow!;
        used.PressRerouteAll("web");
        Assert.Equal(new Choice("reroute", "web"), used.ChoiceOf("step:checkout:3"));
        Assert.Equal(new Choice("repoint", "web"), used.ChoiceOf("mode:ordering:db-down:on"));
        Assert.True(await used.PressDeleteAsync());
        await Until(() => reader.Folder!.Model.GetObject("db") is null);
        var model = reader.Folder!.Model;
        Assert.Equal(("api", "web"), (model.Flows["checkout"].Steps[2].From, model.Flows["checkout"].Steps[2].To));
        Assert.Equal("web", model.Failures["ordering"].Modes["db-down"].On);
        Assert.Contains("1 step rerouted, 1 mode repointed", reader.NoticeText);
    }

    [AvaloniaFact]
    public async Task A_shape_nothing_depends_on_goes_at_once_with_what_went_along_in_the_notice_and_an_Undo_button()
    {
        var (temp, dir, _, reader) = OpenDelete("api");
        using var _ = temp;
        reader.OpenObject("auth");
        var before = Files(dir);
        await reader.DeleteSelectedAsync();
        await Until(() => reader.Folder!.Model.GetObject("auth") is null);
        Assert.Null(reader.UsedByNow);
        Assert.Equal("Deleted Auth. Went with it: 1 line.", reader.NoticeText);
        reader.NoticeNow!.PressAction();
        await Until(() => reader.Folder!.Model.GetObject("auth") is not null);
        Assert.Equal(before, Files(dir));
    }

    [AvaloniaFact]
    public async Task Deleting_a_line_a_mode_needs_asks_about_the_mode()
    {
        var (temp, _, _, reader) = OpenDelete();
        using var _ = temp;
        await reader.AskDeleteAsync([new Target(Line: new LineTarget("api", "mail", "sends receipts"))]); // the other line to mail is still there
        await Until(() => reader.Folder!.Model.Connections.Count == 6);
        Assert.Null(reader.UsedByNow);
        await reader.AskDeleteAsync([new Target(Line: new LineTarget("api", "mail", "second"))]);
        var used = reader.UsedByNow!;
        Assert.Equal(["mode:ordering:mail-late:line"], used.RowKeys);
        Assert.Equal([("mode:ordering:mail-late:line", "Ordering", "The receipt arrives late: Line")], used.RowWords);
        used.PressRemoveAll();
        Assert.True(await used.PressDeleteAsync());
        await Until(() => reader.Folder!.Model.Connections.Count == 5);
        Assert.DoesNotContain("mail-late", reader.Folder!.Model.Failures["ordering"].Modes.Keys);
        Assert.Contains("Deleted the line.", reader.NoticeText);
    }

    [AvaloniaFact]
    public async Task Several_shapes_deleted_together_share_one_panel_and_shapes_inside_can_go_with_them()
    {
        var (temp, dir, _, reader) = OpenDelete("root");
        using var _ = temp;
        var before = Files(dir);
        await reader.AskDeleteAsync([new Target(Object: "shop")]);
        var used = reader.UsedByNow!;
        Assert.Equal(["view:checkout", "view:pay", "scope:ordering", "child:web", "child:api", "child:db", "child:cache"], used.RowKeys);
        used.PressRemoveAll(); // shapes inside go too, and then what depends on them is settled in turn
        Assert.True(used.CanDelete);
        Assert.Equal("deleteWith", used.ChoiceOf("child:auth")!.Action); // auth is inside api, which goes
        Assert.True(await used.PressDeleteAsync());
        await Until(() => reader.Folder!.Model.GetObject("shop") is null);
        Assert.Null(reader.Folder!.Model.GetObject("auth"));
        Assert.DoesNotContain(reader.Folder.Model.Flows, f => f.Value.View == "shop");
        reader.NoticeNow!.PressAction();
        await Until(() => reader.Folder!.Model.GetObject("shop") is not null);
        Assert.Equal(before, Files(dir));
    }
}
