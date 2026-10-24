using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

[Trait("Weight", "Heavy")]
public class ShellTests
{
    private static string Plum => Path.Combine(Repo.Root, "docs", "demo", "flowy");

    private static string Example => Path.Combine(Repo.Root, "example");

    [AvaloniaFact]
    public void Opening_a_folder_gives_it_a_window_titled_after_the_repo()
    {
        var shell = new Shell(null);
        var window = shell.Show(Plum);
        Assert.Equal(Plum, window.Dir);
        Assert.Equal("demo — Flowy Docs", window.Title);
        Assert.NotNull(window.Reader.Folder);
        window.Close();
    }

    [AvaloniaFact]
    public void Opening_a_folder_that_is_already_open_brings_its_window_forward_instead_of_adding_one()
    {
        var shell = new Shell(null);
        var first = shell.Show(Plum);
        var again = shell.Show(Plum + Path.DirectorySeparatorChar);
        var other = shell.Show(Example);
        Assert.Same(first, again);
        Assert.NotSame(first, other);
        Assert.Equal(2, shell.Windows.Count());
        first.Close();
        other.Close();
        Assert.Empty(shell.Windows);
    }

    [AvaloniaFact]
    public async Task A_repo_path_opens_the_flowy_folder_inside_it()
    {
        var shell = new Shell(null);
        var window = await shell.OpenAsync(Path.Combine(Repo.Root, "docs", "demo"), null);
        Assert.Equal(Plum, window!.Dir);
        window.Close();
    }

    [AvaloniaFact]
    public void The_recent_folders_are_newest_first_and_remembered_between_runs()
    {
        using var temp = new TempFolder();
        var store = new UserStateStore(Path.Combine(temp.Path, "state.json"));
        var shell = new Shell(store);
        shell.Show(Plum).Close();
        shell.Show(Example).Close();
        shell.Show(Plum).Close();
        Assert.Equal([Plum, Example], shell.Recent);
        Assert.Equal([Plum, Example], new Shell(new UserStateStore(store.File)).Recent);

        shell.ClearRecent();
        Assert.Empty(shell.Recent);
        Assert.Empty(new Shell(new UserStateStore(store.File)).Recent);
    }

    [AvaloniaFact]
    public void What_each_projects_navigator_remembers_comes_back_and_is_read_with_care()
    {
        using var temp = new TempFolder();
        var store = new UserStateStore(Path.Combine(temp.Path, "state.json"));
        var shell = new Shell(store);
        shell.RememberNavigator(Plum, new NavigatorState("explorer", ["root", "ordering"], 300, 450));
        shell.RememberNavigator(Example, new NavigatorState(null, ["root"]));
        var again = new Shell(new UserStateStore(store.File));
        Assert.Equal("explorer", again.NavigatorFor(Plum)!.Tab);
        Assert.Equal(["root", "ordering"], again.NavigatorFor(Plum)!.Expanded);
        Assert.Equal((300.0, 450.0), (again.NavigatorFor(Plum)!.NavWidth, again.NavigatorFor(Plum)!.DetailsWidth));
        Assert.Null(again.NavigatorFor(Example)!.Tab);
        Assert.Null(again.NavigatorFor(Example)!.NavWidth); // never dragged: the panel begins at its usual width
        Assert.Null(again.NavigatorFor(Path.Combine(temp.Path, "never-opened")));

        // A hand-edited file: a tab that is not one, ids that are not text, and far too many ids are all cut down.
        var ids = new object?[] { "x", 1, null }.Concat(Enumerable.Range(0, 3000).Select(i => (object?)$"s{i}")).ToArray();
        File.WriteAllText(store.File, System.Text.Json.JsonSerializer.Serialize(new { navigators = new Dictionary<string, object> { ["a"] = new { tab = "details", expanded = ids, navWidth = 5, detailsWidth = 99999 }, ["b"] = 5, ["c"] = new { navWidth = "wide", detailsWidth = 333.4 } } }));
        var loaded = store.Load().Navigators!;
        Assert.Equal(2, loaded.Count);
        Assert.Null(loaded["a"].Tab);
        Assert.Equal(NavigatorState.MaxExpanded, loaded["a"].Expanded.Count);
        Assert.Equal("x", loaded["a"].Expanded[0]);
        // A width is kept between the narrowest and the widest a panel gets, and one that is not a number is dropped.
        Assert.Equal((NavigatorState.MinWidth, NavigatorState.MaxWidth), (loaded["a"].NavWidth, loaded["a"].DetailsWidth));
        Assert.Equal((null, 333.0), (loaded["c"].NavWidth, loaded["c"].DetailsWidth));
    }

    [AvaloniaFact]
    public void Recent_folders_that_are_gone_are_not_listed()
    {
        using var temp = new TempFolder();
        var store = new UserStateStore(Path.Combine(temp.Path, "state.json"));
        store.Save(new UserState([Path.Combine(temp.Path, "deleted"), Plum], null, true));
        Assert.Equal([Plum], new Shell(store).Recent);
    }

    [AvaloniaFact]
    public void The_line_style_the_reader_picked_is_kept_and_applied_to_the_next_window()
    {
        using var temp = new TempFolder();
        var store = new UserStateStore(Path.Combine(temp.Path, "state.json"));
        var shell = new Shell(store);
        var window = shell.Show(Plum);
        window.Reader.PickLines("curved");
        shell.RememberLines("curved");
        window.Close();
        var next = new Shell(new UserStateStore(store.File)).Show(Plum);
        Assert.Equal("curved", next.Reader.LineStyle);
        next.Close();
    }

    [AvaloniaFact]
    public void The_app_chosen_for_linked_files_is_remembered_reaches_the_reader_and_is_in_the_File_menu()
    {
        using var temp = new TempFolder();
        var app = Path.Combine(temp.Path, "Editor.exe");
        File.WriteAllText(app, "");
        var store = new UserStateStore(Path.Combine(temp.Path, "state.json"));
        var shell = new Shell(store);
        var window = shell.Show(Plum);
        Assert.Null(window.Reader.CustomApp());
        shell.RememberOpenFilesWith(app);
        Assert.Equal(app, window.Reader.CustomApp());
        Assert.Equal(app, new Shell(new UserStateStore(store.File)).State.OpenFilesWith);

        var file = NativeMenu.GetMenu(window)!.Items.OfType<NativeMenuItem>().Single(i => i.Header == "File");
        var openWith = file.Menu!.Items.OfType<NativeMenuItem>().Single(i => i.Header == "Open Files With");
        var items = openWith.Menu!.Items.OfType<NativeMenuItem>().Where(i => i is not NativeMenuItemSeparator).ToList();
        Assert.Equal(["Default App", "Editor", "Choose App…"], items.Select(i => i.Header));
        Assert.False(items[0].IsChecked);
        Assert.True(items[1].IsChecked);

        shell.RememberOpenFilesWith(null);
        items = openWith.Menu!.Items.OfType<NativeMenuItem>().Where(i => i is not NativeMenuItemSeparator).ToList();
        Assert.Equal(["Default App", "Choose App…"], items.Select(i => i.Header));
        Assert.True(items[0].IsChecked);
        window.Close();
    }

    [AvaloniaFact]
    public void A_folder_that_can_not_be_read_opens_empty_with_the_reason_and_comes_good_when_fixed()
    {
        using var temp = new TempFolder();
        Directory.CreateDirectory(Path.Combine(temp.Path, "flowy"));
        File.WriteAllText(Path.Combine(temp.Path, "flowy", "model.yaml"), "objects:\n  a: { type: actor, name: A }\n<<<<<<< HEAD\n");
        var shell = new Shell(null);
        var window = shell.Show(Path.Combine(temp.Path, "flowy"));
        Assert.Equal(0, window.Reader.Folder!.Model.Objects.Count);
        window.Close();
    }

    [AvaloniaFact]
    public void The_menu_lists_the_recent_folders()
    {
        using var temp = new TempFolder();
        var shell = new Shell(new UserStateStore(Path.Combine(temp.Path, "state.json")));
        shell.Show(Example).Close();
        var window = shell.Show(Plum);
        var menu = Avalonia.Controls.NativeMenu.GetMenu(window)!;
        var recent = ((Avalonia.Controls.NativeMenuItem)((Avalonia.Controls.NativeMenuItem)menu.Items[0]).Menu!.Items[1]).Menu!.Items;
        Assert.Equal([Plum, Example], recent.OfType<Avalonia.Controls.NativeMenuItem>().Where(i => i.Header is not ("Clear Recent" or "-")).Select(i => i.Header));
        window.Close();
    }
}

public class SingleInstanceTests
{
    private static string Key() => "test-" + Guid.NewGuid().ToString("N");

    [Fact]
    public void A_second_launch_hands_its_arguments_to_the_first()
    {
        var key = Key();
        using var received = new ManualResetEventSlim();
        string[]? args = null;
        string? cwd = null;
        using var owner = SingleInstance.Own(key, (a, c) =>
        {
            args = a;
            cwd = c;
            received.Set();
        });
        Assert.NotNull(owner);
        Assert.True(SingleInstance.TryHandOver(["some folder", "--theme", "dark"], @"C:\work", key));
        Assert.True(received.Wait(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken));
        Assert.Equal(["some folder", "--theme", "dark"], args!);
        Assert.Equal(@"C:\work", cwd);
    }

    [Fact]
    public void Only_one_instance_owns_a_key_and_a_new_one_can_take_over_when_it_ends()
    {
        var key = Key();
        var first = SingleInstance.Own(key, (_, _) => { });
        Assert.NotNull(first);
        Assert.Null(SingleInstance.Own(key, (_, _) => { }));
        first.Dispose();
        using var second = SingleInstance.Own(key, (_, _) => { });
        Assert.NotNull(second);
    }

    [Fact]
    public void With_nobody_listening_there_is_nobody_to_hand_over_to() =>
        Assert.False(SingleInstance.TryHandOver(["x"], ".", Key(), timeoutMilliseconds: 200));

    [Fact]
    public void Several_launches_in_a_row_all_arrive()
    {
        var key = Key();
        var seen = new System.Collections.Concurrent.ConcurrentBag<string>();
        using var all = new CountdownEvent(3);
        using var owner = SingleInstance.Own(key, (a, _) =>
        {
            seen.Add(a[0]);
            all.Signal();
        });
        Assert.NotNull(owner);
        foreach (var name in new[] { "one", "two", "three" }) Assert.True(SingleInstance.TryHandOver([name], ".", key));
        Assert.True(all.Wait(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken));
        Assert.Equal(["one", "three", "two"], seen.OrderBy(s => s));
    }
}

internal sealed class TempFolder : IDisposable
{
    public string Path { get; } = Directory.CreateTempSubdirectory("flowy-app-test-").FullName;

    public void Dispose()
    {
        // The reader looks for the repo's git origin in the background when a folder opens, and Windows won't delete a folder a process is still in.
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                Directory.Delete(Path, true);
                return;
            }
            catch (IOException) when (attempt < 20)
            {
                Thread.Sleep(50);
            }
        }
    }
}
