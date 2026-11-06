using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Platform.Storage;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The window's menu: File, View and Help, and the Open Recent and Open Files With lists that change as the app remembers more. Windows and Linux draw it
/// inside the window; macOS has it in the screen's menu bar. What needs a folder open is greyed out until <see cref="ModelOpened"/>.
/// </summary>
internal sealed class MainMenu : IDisposable
{
    private readonly MainWindow _window;
    private readonly Shell _shell;
    private readonly Func<ReaderView> _readerOnShow;
    private readonly Func<string?> _dir;
    private readonly NativeMenuItem _recentMenu = new("Open Recent") { Menu = new NativeMenu() };
    private readonly NativeMenuItem _openWithMenu = new("Open Files With") { Menu = new NativeMenu() };
    private readonly List<NativeMenuItem> _needsModel = [];

    /// <param name="window">The window the menu belongs to; it is the owner of every dialog the menu opens.</param>
    /// <param name="frame">Where the menu bar is drawn, at the top, on the platforms that draw it inside the window.</param>
    /// <param name="reader">The reader of the tab on show.</param>
    /// <param name="dir">The model folder on show, or null while no tab is open.</param>
    /// <param name="reload">What Reload does: read the folder again, or open it afresh when it is no longer watched.</param>
    public MainMenu(MainWindow window, Shell shell, Func<ReaderView> reader, DockPanel frame, Func<string?> dir, Func<Task> reload)
    {
        _window = window;
        _shell = shell;
        _readerOnShow = reader;
        _dir = dir;
        Build(frame, reload);
        shell.RecentChanged += RebuildRecent;
        shell.OpenFilesWithChanged += RebuildOpenWith;
    }

    private ReaderView Reader => _readerOnShow();

    private static KeyModifiers Command => OperatingSystem.IsMacOS() ? KeyModifiers.Meta : KeyModifiers.Control;

    /// <summary>A folder is open: the items that need one come on.</summary>
    public void ModelOpened()
    {
        foreach (var item in _needsModel) item.IsEnabled = true;
    }

    /// <summary>The last tab closed: the items that need a folder go grey again.</summary>
    public void ModelClosed()
    {
        foreach (var item in _needsModel) item.IsEnabled = false;
    }

    public void Dispose()
    {
        _shell.RecentChanged -= RebuildRecent;
        _shell.OpenFilesWithChanged -= RebuildOpenWith;
    }

    private void Build(DockPanel frame, Func<Task> reload)
    {
        var open = new NativeMenuItem("Open Folder…") { Gesture = new KeyGesture(Key.O, Command) };
        open.Click += async (_, _) => await _shell.ChooseAsync(_window);
        var reloadItem = new NativeMenuItem("Reload") { Gesture = new KeyGesture(Key.F5) };
        reloadItem.Click += async (_, _) => await reload();
        var showFolder = new NativeMenuItem(OperatingSystem.IsMacOS() ? "Show in Finder" : OperatingSystem.IsWindows() ? "Show in Explorer" : "Show Folder");
        showFolder.Click += async (_, _) =>
        {
            if (_dir() is { } dir && Directory.Exists(dir)) await _window.Launcher.LaunchDirectoryInfoAsync(new DirectoryInfo(dir));
        };
        _needsModel.AddRange([reloadItem, showFolder]);
        var newWindow = new NativeMenuItem("New Window") { Gesture = new KeyGesture(Key.N, Command | KeyModifiers.Shift) };
        newWindow.Click += (_, _) => _shell.NewWindow();
        var closeTab = new NativeMenuItem("Close Tab") { Gesture = new KeyGesture(Key.W, Command) };
        closeTab.Click += (_, _) => _window.CloseActiveTab();
        _needsModel.Add(closeTab);
        var close = new NativeMenuItem("Close Window") { Gesture = new KeyGesture(Key.W, Command | KeyModifiers.Shift) };
        close.Click += (_, _) => _window.Close();
        var quit = new NativeMenuItem(OperatingSystem.IsMacOS() ? "Quit Flowy Docs" : "Exit") { Gesture = new KeyGesture(Key.Q, Command) };
        quit.Click += (_, _) => _shell.Quit();
        var file = new NativeMenuItem("File") { Menu = new NativeMenu { Items = { open, _recentMenu, newWindow, new NativeMenuItemSeparator(), reloadItem, showFolder, _openWithMenu, new NativeMenuItemSeparator(), closeTab, close, quit } } };

        var fit = new NativeMenuItem("Fit the View");
        fit.Click += (_, _) => Reader.FitNow();
        var shortcuts = new NativeMenuItem("Keyboard Shortcuts");
        shortcuts.Click += (_, _) => Reader.ShowShortcuts();
        var editMode = new NativeMenuItem("Edit Mode");
        editMode.Click += (_, _) => Reader.SetEditing(!Reader.Editing);
        _needsModel.Add(editMode);
        var mermaid = new NativeMenuItem("Copy as Mermaid");
        mermaid.Click += async (_, _) => await CopyMermaidAsync();
        var picture = new NativeMenuItem("Save Picture…");
        picture.Click += async (_, _) => await SavePictureAsync();
        _needsModel.AddRange([mermaid, picture]);
        var nextTab = new NativeMenuItem("Next Tab") { Gesture = new KeyGesture(Key.Tab, KeyModifiers.Control) };
        nextTab.Click += (_, _) => _window.NextTab(1);
        var previousTab = new NativeMenuItem("Previous Tab") { Gesture = new KeyGesture(Key.Tab, KeyModifiers.Control | KeyModifiers.Shift) };
        previousTab.Click += (_, _) => _window.NextTab(-1);
        _needsModel.AddRange([nextTab, previousTab]);
        var view = new NativeMenuItem("View") { Menu = new NativeMenu { Items = { editMode, new NativeMenuItemSeparator(), fit, shortcuts, new NativeMenuItemSeparator(), nextTab, previousTab, new NativeMenuItemSeparator(), mermaid, picture } } };

        var demo = new NativeMenuItem("Open the Demo (Plum)") { IsEnabled = Shell.DemoDir is not null };
        demo.Click += (_, _) => _shell.OpenDemo(_window);
        var guide = new NativeMenuItem("Flowy Docs Guide");
        guide.Click += (_, _) => _ = _window.Launcher.LaunchUriAsync(new Uri("https://github.com/feluminais/flowy-docs/blob/main/docs/guide.md"));
        var about = new NativeMenuItem("About Flowy Docs");
        about.Click += async (_, _) => await MessageDialog.ShowAsync(_window, "About Flowy Docs",
            $"Flowy Docs {typeof(MainWindow).Assembly.GetName().Version?.ToString(3)}\n\nAvalonia {typeof(Avalonia.Application).Assembly.GetName().Version?.ToString(3)} on .NET {Environment.Version}");
        var check = new NativeMenuItem("Check for Updates…");
        check.Click += async (_, _) => await Updates.CheckAsync(_window, true);
        var auto = new NativeMenuItem("Check for updates automatically") { ToggleType = MenuItemToggleType.CheckBox, IsChecked = _shell.State.CheckForUpdates };
        auto.Click += (_, _) => _shell.RememberCheckForUpdates(auto.IsChecked);
        var help = new NativeMenuItem("Help") { Menu = new NativeMenu { Items = { demo, guide, new NativeMenuItemSeparator(), check, auto, new NativeMenuItemSeparator(), about } } };

        var menu = new NativeMenu { Items = { file, view, help } };
        NativeMenu.SetMenu(_window, menu);
        // Windows and Linux draw it inside the window (on Windows in the title bar); macOS has it in the screen's menu bar and hides this.
        var bar = new TitleRow(_window, new NativeMenuBar());
        DockPanel.SetDock(bar, Dock.Top);
        frame.Children.Insert(0, bar);
        RebuildRecent();
        RebuildOpenWith();
        foreach (var item in _needsModel) item.IsEnabled = false; // until a folder is open
    }

    /// <summary>The Open Files With submenu: the system's default, the app that was chosen (marked), and a picker. Rebuilt whenever the choice changes.</summary>
    private void RebuildOpenWith()
    {
        var items = _openWithMenu.Menu!.Items;
        items.Clear();
        var chosen = _shell.State.OpenFilesWith;
        var system = new NativeMenuItem("Default App") { ToggleType = MenuItemToggleType.Radio, IsChecked = chosen is null };
        system.Click += (_, _) => _shell.RememberOpenFilesWith(null);
        items.Add(system);
        if (chosen is not null) items.Add(new NativeMenuItem(Path.GetFileNameWithoutExtension(chosen)) { ToggleType = MenuItemToggleType.Radio, IsChecked = true });
        items.Add(new NativeMenuItemSeparator());
        var choose = new NativeMenuItem("Choose App…");
        choose.Click += async (_, _) => await ChooseOpenWithAsync();
        items.Add(choose);
    }

    private async Task ChooseOpenWithAsync()
    {
        var picked = await _window.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = "Choose the app that opens linked files",
            AllowMultiple = false,
            FileTypeFilter = OperatingSystem.IsWindows() ? [new FilePickerFileType("Programs") { Patterns = ["*.exe"] }] : null,
        });
        if (picked.Count == 1 && picked[0].TryGetLocalPath() is { } path && File.Exists(path)) _shell.RememberOpenFilesWith(path);
    }

    private void RebuildRecent()
    {
        var items = _recentMenu.Menu!.Items;
        items.Clear();
        var recent = _shell.Recent;
        foreach (var dir in recent)
        {
            var item = new NativeMenuItem(dir);
            var target = dir;
            item.Click += async (_, _) => await _shell.OpenAsync(target, _window);
            items.Add(item);
        }
        if (recent.Count > 0) items.Add(new NativeMenuItemSeparator());
        var clear = new NativeMenuItem("Clear Recent") { IsEnabled = recent.Count > 0 };
        clear.Click += (_, _) => _shell.ClearRecent();
        items.Add(clear);
    }

    private async Task CopyMermaidAsync()
    {
        if (Reader.MermaidText() is not { } text || !await Reader.CopyAsync(text)) return;
        Reader.ShowNotice(Reader.PlayingFlowId is null
            ? "Copied this view as Mermaid. Paste it into a README or a PR: GitHub draws it."
            : "Copied this flow as Mermaid. Paste it into a README or a PR: GitHub draws it.", 4);
    }

    private async Task SavePictureAsync()
    {
        if (_dir() is not { } dir) return;
        var file = await _window.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
        {
            Title = "Save a picture of this view",
            SuggestedFileName = Reader.PictureName(ModelFolders.Title(dir)),
            DefaultExtension = "png",
            FileTypeChoices = [FilePickerFileTypes.ImagePng],
        });
        if (file is null) return; // the dialog was cancelled
        if (file.TryGetLocalPath() is not { } path)
        {
            Reader.ShowNotice(ReaderView.PictureNotice(null, false));
            return;
        }
        try
        {
            Reader.ShowNotice(ReaderView.PictureNotice(path, Reader.SavePicture(path)), 4);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            Reader.ShowNotice($"Couldn't save the picture: {e.Message}");
        }
    }
}
