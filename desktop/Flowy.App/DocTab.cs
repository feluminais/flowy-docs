using Avalonia.Controls;
using Avalonia.Threading;
using Flowy.Core;

namespace Flowy.App;

/// <summary>Where a tab belongs: its folder's key, and the key of the model it is a sketch of (null for a model).</summary>
internal readonly record struct TabPlace(string Key, string? Owner)
{
    /// <summary>The model's key for it and all its sketches: tabs with the same group sit side by side, inside one outline.</summary>
    public string Group => Owner ?? Key;
}

/// <summary>Where the tabs of a window go. A sketch stays beside its model, so the eye can tell whose it is.</summary>
internal static class TabGroups
{
    /// <summary>Where a new tab goes: a sketch after the last tab of its model's group, a model in front of its sketches that are already open, anything else at the end.</summary>
    public static int InsertAt(IReadOnlyList<TabPlace> tabs, TabPlace tab)
    {
        var group = tabs.Select((t, i) => (t, i)).Where(x => x.t.Group == tab.Group).Select(x => x.i).ToList();
        if (group.Count == 0) return tabs.Count;
        return tab.Owner is null ? group[0] : group[^1] + 1;
    }

    /// <summary>Which tab takes over when the one at <paramref name="closing"/> goes: the one before it in its group, else the next, else the one before. -1 when it was the only one.</summary>
    public static int Heir(IReadOnlyList<TabPlace> tabs, int closing)
    {
        if (closing > 0 && tabs[closing - 1].Group == tabs[closing].Group) return closing - 1;
        return closing + 1 < tabs.Count ? closing + 1 : closing - 1;
    }

    /// <summary>Whether <paramref name="other"/> moves when <paramref name="tab"/> moves to another window: a model takes its sketches, a sketch goes alone.</summary>
    public static bool TravelsWith(TabPlace tab, TabPlace other) => other.Key == tab.Key || other.Owner == tab.Key;
}

/// <summary>
/// One model or sketch open in a window: its reader and the watch on its folder. A tab that is not on show keeps its reader as it was left, and it can move to another window with all of that.
/// </summary>
internal sealed class DocTab : IDisposable
{
    private readonly Shell _shell;
    private readonly string? _ownerDir; // the model this is a sketch of
    private FolderSession? _disk;

    public DocTab(Shell shell, string dir)
    {
        _shell = shell;
        Dir = dir;
        _ownerDir = Sketches.ModelOf(dir);
        Place = new TabPlace(ModelFolders.Key(dir), _ownerDir is null ? null : ModelFolders.Key(_ownerDir));
        Name = Fallback;
        Reader = new ReaderView();
        Reader.LinesPicked += shell.RememberLines;
        Reader.ChangesPicked += shell.RememberChanges;
        Reader.ShowChanges = shell.State.ShowChanges;
        Reader.ModelPicked += picked => shell.Show(picked, null, TopLevel.GetTopLevel(Reader) as MainWindow);
        Reader.NavigatorChanged += navigator => shell.RememberNavigator(Dir, navigator);
        Reader.CustomApp = () => shell.State.OpenFilesWith;
    }

    public string Dir { get; }

    public ReaderView Reader { get; }

    public TabPlace Place { get; }

    public string Key => Place.Key;

    public bool IsSketch => _ownerDir is not null;

    /// <summary>The name in the tab: the <c>name:</c> of its model.yaml, as the Sketches list shows it.</summary>
    public string Name { get; private set; }

    /// <summary>The name of the model this is a sketch of, or null for a model.</summary>
    public string? OwnerName { get; private set; }

    /// <summary>Who to tell when the name changed: the window it is in.</summary>
    public Action? Renamed { get; set; }

    /// <summary>The name for a tab with no <c>name:</c>: a sketch's id, or the repo.</summary>
    private string Fallback => IsSketch ? Path.GetFileName(Path.TrimEndingDirectorySeparator(Dir)) : ModelFolders.Title(Dir);

    private void TakeName(Folder folder)
    {
        var name = folder.Model.ProjectName is { Length: > 0 } own ? own : Fallback;
        if (name == Name) return;
        Name = name;
        Renamed?.Invoke();
    }

    /// <summary>Reads the folder and keeps watching it. A file that can't be read gives an empty view and a banner saying which, until it is fixed.</summary>
    public void Read()
    {
        _disk?.Dispose();
        var disk = _disk = new FolderSession(Dir);
        var folder = disk.Read(out var problem);
        // The sample that ships with the app sits in the install folder, which is not for writing, and so does a sketch of it.
        var demo = Shell.DemoDir;
        var own = _ownerDir ?? Dir;
        Reader.CanEdit = demo is null || !string.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(own)), Path.TrimEndingDirectorySeparator(Path.GetFullPath(demo)), StringComparison.OrdinalIgnoreCase);
        OwnerName = _ownerDir is null ? null : Sketches.NameOfModel(_ownerDir) is { Length: > 0 } theirs ? theirs : ModelFolders.Title(_ownerDir);
        Reader.Load(folder, Dir);
        Reader.RestoreNavigator(_shell.NavigatorFor(Dir));
        if (_shell.State.Lines is { } lines) Reader.PickLines(lines);
        if (problem is not null) Reader.SetBanner(problem);
        TakeName(folder);

        disk.Loaded += read =>
        {
            Reader.Reload(read);
            TakeName(read);
        };
        disk.Failed += Reader.SetBanner;
        disk.Watch(work => Dispatcher.UIThread.Post(work));
    }

    /// <summary>The tab was asked for again: if its folder stopped being watched (it was deleted, or came back), read it afresh.</summary>
    public void Reopen()
    {
        if (_disk?.WatchFailed == true) Read();
    }

    /// <summary>Reload in the menu: read the folder again, or open it afresh when it is no longer watched.</summary>
    public async Task ReloadAsync()
    {
        if (_disk?.WatchFailed == true) Read();
        else if (_disk is { } disk) await disk.RefreshAsync();
    }

    /// <summary>Lets go of what the tab holds on to: the folder's watcher and the reader's.</summary>
    public void Dispose()
    {
        _disk?.Dispose();
        Reader.Dispose();
    }
}
