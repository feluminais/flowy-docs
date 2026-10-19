using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class ModelFoldersTests
{
    private static readonly string Repo_ = Path.GetFullPath(Path.Combine("work", "shop"));
    private static readonly string Inside = Path.Combine(Repo_, "flowy");

    private static ModelFolders.Disk Fake(string[] dirs, string[] files) =>
        new(p => dirs.Contains(Path.TrimEndingDirectorySeparator(p)), p => files.Contains(p));

    [Fact]
    public void A_folder_called_flowy_opens_as_it_is() =>
        Assert.Equal(Inside, ModelFolders.Resolve(Inside, Fake([Inside], [])));

    [Fact]
    public void A_flowy_folder_beats_a_model_yaml_at_the_repo_root() =>
        Assert.Equal(Inside, ModelFolders.Resolve(Repo_, Fake([Repo_, Inside], [Path.Combine(Repo_, "model.yaml")])));

    [Fact]
    public void A_folder_holding_model_yaml_and_no_flowy_folder_opens_as_it_is() =>
        Assert.Equal(Repo_, ModelFolders.Resolve(Repo_, Fake([Repo_], [Path.Combine(Repo_, "model.yaml")])));

    [Fact]
    public void A_repo_opens_its_flowy_folder_even_an_empty_one() =>
        Assert.Equal(Inside, ModelFolders.Resolve(Repo_, Fake([Repo_, Inside], [])));

    [Fact]
    public void A_repo_with_no_flowy_folder_gives_nothing_and_nothing_is_created()
    {
        Assert.Null(ModelFolders.Resolve(Repo_, Fake([Repo_], [])));
        using var temp = new TempDir();
        Assert.Null(ModelFolders.Resolve(temp.Dir));
        Assert.Empty(Directory.GetFileSystemEntries(temp.Dir));
    }

    [Fact]
    public void Something_that_is_not_a_folder_gives_nothing()
    {
        Assert.Null(ModelFolders.Resolve(Path.Combine(Repo_, "gone"), Fake([Repo_], [])));
        Assert.Null(ModelFolders.Resolve("", Fake([], [])));
    }

    [Fact]
    public void A_trailing_separator_makes_no_difference() =>
        Assert.Equal(Inside, ModelFolders.Resolve(Inside + Path.DirectorySeparatorChar, Fake([Inside], [])));

    [Fact]
    public void The_real_demo_resolves_from_the_repo_root_and_from_its_own_folder()
    {
        var demo = Path.Combine(Repo.Root, "docs", "demo");
        Assert.Equal(Path.Combine(demo, "flowy"), ModelFolders.Resolve(demo));
        Assert.Equal(Path.Combine(demo, "flowy"), ModelFolders.Resolve(Path.Combine(demo, "flowy")));
        Assert.Equal(Path.Combine(Repo.Root, "example"), ModelFolders.Resolve(Path.Combine(Repo.Root, "example"))); // holds model.yaml
    }

    [Fact]
    public void A_window_is_named_after_the_repo_for_a_flowy_folder_and_after_the_folder_otherwise()
    {
        Assert.Equal("shop", ModelFolders.Title(Inside));
        Assert.Equal("shop", ModelFolders.Title(Inside + Path.DirectorySeparatorChar));
        Assert.Equal("docs-model", ModelFolders.Title(Path.Combine(Repo_, "docs-model")));
    }

    [Fact]
    public void The_same_folder_reached_two_ways_has_one_key()
    {
        Assert.Equal(ModelFolders.Key(Inside), ModelFolders.Key(Inside + Path.DirectorySeparatorChar));
        Assert.Equal(ModelFolders.Key(Inside), ModelFolders.Key(Path.Combine(Repo_, "other", "..", "flowy")));
        Assert.NotEqual(ModelFolders.Key(Inside), ModelFolders.Key(Path.Combine(Repo_, "flowy2")));
        if (OperatingSystem.IsWindows()) Assert.Equal(ModelFolders.Key(Inside), ModelFolders.Key(Inside.ToUpperInvariant()));
    }

    [Fact]
    public void The_first_argument_that_is_a_folder_opens_and_flags_and_other_values_are_skipped()
    {
        var cwd = Path.GetFullPath("work");
        bool IsDir(string p) => p == Path.Combine(cwd, "shop") || p == Path.Combine(cwd, "other");
        Assert.Equal(Path.Combine(cwd, "shop"), ModelFolders.FromArguments(["--shot", "a.png", "shop", "other"], cwd, IsDir));
        Assert.Null(ModelFolders.FromArguments(["--theme"], cwd, IsDir));
        Assert.Null(ModelFolders.FromArguments([], cwd, IsDir));
        var absolute = Path.GetFullPath(Path.Combine("elsewhere", "repo"));
        Assert.Equal(absolute, ModelFolders.FromArguments([absolute], cwd, p => p == absolute));
    }

    [Fact]
    public void A_drive_root_from_the_right_click_menu_arrives_with_its_quote_and_still_opens()
    {
        if (!OperatingSystem.IsWindows()) return;
        Assert.Equal(@"D:\", ModelFolders.FromArguments(["D:\""], @"C:\work", p => p == @"D:\"));
    }
}

public class RecentsTests
{
    [Fact]
    public void The_newest_goes_first_a_repeat_moves_up_and_ten_are_kept()
    {
        Assert.Equal(["c", "a", "b"], Recents.Push(["a", "b"], "c"));
        Assert.Equal(["c", "a", "b"], Recents.Push(["a", "b", "c"], "c"));
        var many = Enumerable.Range(0, 12).Select(i => $"r{i}").ToList();
        var pushed = Recents.Push(many, "new");
        Assert.Equal(Recents.Max, pushed.Count);
        Assert.Equal("new", pushed[0]);
    }

    [Fact]
    public void Folders_that_are_gone_are_left_out() =>
        Assert.Equal(["a", "c"], Recents.Existing(["a", "b", "c"], p => p != "b"));
}

public class UserStateTests
{
    [Fact]
    public void A_missing_broken_or_odd_file_gives_the_defaults_and_valid_parts_are_kept()
    {
        using var temp = new TempDir();
        var store = new UserStateStore(Path.Combine(temp.Dir, "state.json"));
        Assert.Equal(UserState.Default, store.Load());
        temp.Write("state.json", "{ not json");
        Assert.Equal(UserState.Default, store.Load());
        temp.Write("state.json", "{\"recent\": [\"a\", 5, \"b\"], \"lines\": \"wiggly\", \"checkForUpdates\": \"no\"}");
        var odd = store.Load();
        Assert.Equal(["a", "b"], odd.Recent);
        Assert.Null(odd.Lines);
        Assert.True(odd.CheckForUpdates);
        temp.Write("state.json", "[1, 2]");
        Assert.Equal(UserState.Default, store.Load());
    }

    [Fact]
    public void What_is_saved_is_read_back_in_a_folder_that_did_not_exist()
    {
        using var temp = new TempDir();
        var store = new UserStateStore(Path.Combine(temp.Dir, "deeper", "state.json"));
        store.Save(new UserState(["x", "y"], "curved", false));
        Assert.Equal(new[] { "x", "y" }, store.Load().Recent);
        var loaded = store.Load();
        Assert.Equal("curved", loaded.Lines);
        Assert.False(loaded.CheckForUpdates);
    }

    [Fact]
    public void The_window_size_is_remembered_and_a_silly_one_is_forgotten()
    {
        using var temp = new TempDir();
        var store = new UserStateStore(Path.Combine(temp.Dir, "state.json"));
        store.Save(new UserState([], null, true, new WindowSize(1280, 800, true)));
        Assert.Equal(new WindowSize(1280, 800, true), store.Load().Window);
        store.Save(new UserState([], null, true, new WindowSize(1280, 800, false)));
        Assert.Equal(new WindowSize(1280, 800, false), store.Load().Window);
        temp.Write("state.json", "{ \"window\": { \"width\": 20, \"height\": 99999 } }");
        Assert.Null(store.Load().Window);
        temp.Write("state.json", "{ \"window\": \"big\" }");
        Assert.Null(store.Load().Window);
        Assert.Null(UserState.Default.Window);
    }

    [Fact]
    public void A_state_folder_can_be_chosen_with_an_environment_variable()
    {
        using var temp = new TempDir();
        Environment.SetEnvironmentVariable("FLOWY_STATE_DIR", temp.Dir);
        try
        {
            Assert.Equal(Path.Combine(temp.Dir, "state.json"), UserStateStore.DefaultFile());
        }
        finally
        {
            Environment.SetEnvironmentVariable("FLOWY_STATE_DIR", null);
        }
    }

    [Fact]
    public void The_app_chosen_for_linked_files_is_kept_while_it_exists_and_forgotten_when_it_is_gone_or_not_text()
    {
        using var temp = new TempDir();
        var app = temp.Write("editor.exe", "");
        var store = new UserStateStore(Path.Combine(temp.Dir, "state.json"));
        Assert.Null(UserState.Default.OpenFilesWith);
        store.Save(UserState.Default with { OpenFilesWith = app });
        Assert.Equal(app, store.Load().OpenFilesWith);
        File.Delete(app);
        Assert.Null(store.Load().OpenFilesWith);
        temp.Write("state.json", "{ \"openFilesWith\": 5 }");
        Assert.Null(store.Load().OpenFilesWith);
        temp.Write("state.json", "{ \"openFilesWith\": \"\" }");
        Assert.Null(store.Load().OpenFilesWith);
    }
}
