using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Input.Platform;
using Avalonia.Layout;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;

namespace Flowy.App;

/// <summary>A window for one model folder (or, before one is chosen, a welcome). Everything about which windows exist is the <see cref="Shell"/>'s.</summary>
public partial class MainWindow : Window
{
    private readonly Shell _shell;
    private readonly ReaderView _reader = new();
    private readonly DockPanel _frame = new();
    private readonly NativeMenuItem _recentMenu = new("Open Recent") { Menu = new NativeMenu() };
    private FolderWatcher? _watcher;
    private int _loads;
    private bool _watchFailed;
    private Size _normal; // the size when not maximized, which is what a restart should open at
    private readonly List<NativeMenuItem> _needsModel = [];

    internal MainWindow(Shell shell)
    {
        InitializeComponent();
        Icon = new WindowIcon(Avalonia.Platform.AssetLoader.Open(new Uri("avares://FlowyDocs/Assets/icon.png")));
        _shell = shell;
        var options = Program.Options;
        if (options.Size is { } size)
        {
            Width = size.Width;
            Height = size.Height;
        }
        else if (shell.State.Window is { } saved)
        {
            Width = saved.Width;
            Height = saved.Height;
            if (saved.Maximized) WindowState = WindowState.Maximized;
        }
        _normal = new Size(Width, Height);
        Resized += (_, e) =>
        {
            if (WindowState == WindowState.Normal) _normal = e.ClientSize;
        };
        Closing += (_, _) =>
        {
            if (Dir is not null) _shell.RememberWindow(new WindowSize(_normal.Width, _normal.Height, WindowState == WindowState.Maximized));
        };
        BuildMenu();
        Content = _frame;
        _frame.Children.Add(Welcome());
        _reader.LinesPicked += _shell.RememberLines;
        _shell.RecentChanged += RebuildRecent;
        Closed += (_, _) =>
        {
            _watcher?.Dispose();
            _shell.RecentChanged -= RebuildRecent;
        };

        // A folder dropped on the window opens in a window of its own.
        DragDrop.SetAllowDrop(this, true);
        AddHandler(DragDrop.DragOverEvent, (_, e) => e.DragEffects = e.DataTransfer.TryGetFiles() is { Length: > 0 } ? DragDropEffects.Copy : DragDropEffects.None);
        AddHandler(DragDrop.DropEvent, async (_, e) =>
        {
            foreach (var item in e.DataTransfer.TryGetFiles() ?? [])
                if (item.TryGetLocalPath() is { } path && Directory.Exists(path)) await _shell.OpenAsync(path, this);
        });
    }

    /// <summary>The model folder shown, or null before one is chosen.</summary>
    internal string? Dir { get; private set; }

    internal ReaderView Reader => _reader;

    // ---- the menu ----------------------------------------------------------------------------------------------

    private static KeyModifiers Command => OperatingSystem.IsMacOS() ? KeyModifiers.Meta : KeyModifiers.Control;

    private void BuildMenu()
    {
        var open = new NativeMenuItem("Open Folder…") { Gesture = new KeyGesture(Key.O, Command) };
        open.Click += async (_, _) => await _shell.ChooseAsync(this);
        var reload = new NativeMenuItem("Reload") { Gesture = new KeyGesture(Key.F5) };
        reload.Click += async (_, _) =>
        {
            if (Dir is not { } dir) return;
            if (_watchFailed) Open(dir);
            else await ReloadAsync();
        };
        var showFolder = new NativeMenuItem(OperatingSystem.IsMacOS() ? "Show in Finder" : OperatingSystem.IsWindows() ? "Show in Explorer" : "Show Folder");
        showFolder.Click += async (_, _) =>
        {
            if (Dir is { } dir && Directory.Exists(dir)) await Launcher.LaunchDirectoryInfoAsync(new DirectoryInfo(dir));
        };
        _needsModel.AddRange([reload, showFolder]);
        var close = new NativeMenuItem("Close Window") { Gesture = new KeyGesture(Key.W, Command) };
        close.Click += (_, _) => Close();
        var quit = new NativeMenuItem(OperatingSystem.IsMacOS() ? "Quit Flowy Docs" : "Exit") { Gesture = new KeyGesture(Key.Q, Command) };
        quit.Click += (_, _) => _shell.Quit();
        var file = new NativeMenuItem("File") { Menu = new NativeMenu { Items = { open, _recentMenu, new NativeMenuItemSeparator(), reload, showFolder, new NativeMenuItemSeparator(), close, quit } } };

        var fit = new NativeMenuItem("Fit the View");
        fit.Click += (_, _) => _reader.FitNow();
        var shortcuts = new NativeMenuItem("Keyboard Shortcuts");
        shortcuts.Click += (_, _) => _reader.ShowShortcuts();
        var editMode = new NativeMenuItem("Edit Mode");
        editMode.Click += (_, _) => _reader.SetEditing(!_reader.Editing);
        _needsModel.Add(editMode);
        var mermaid = new NativeMenuItem("Copy as Mermaid");
        mermaid.Click += async (_, _) => await CopyMermaidAsync();
        var picture = new NativeMenuItem("Save Picture…");
        picture.Click += async (_, _) => await SavePictureAsync();
        _needsModel.AddRange([mermaid, picture]);
        var view = new NativeMenuItem("View") { Menu = new NativeMenu { Items = { editMode, new NativeMenuItemSeparator(), fit, shortcuts, new NativeMenuItemSeparator(), mermaid, picture } } };

        var demo = new NativeMenuItem("Open the Demo (Plum)") { IsEnabled = Shell.DemoDir is not null };
        demo.Click += (_, _) => _shell.OpenDemo();
        var guide = new NativeMenuItem("Flowy Docs Guide");
        guide.Click += (_, _) => _ = Launcher.LaunchUriAsync(new Uri("https://github.com/feluminais/flowy-docs/blob/main/docs/guide.md"));
        var about = new NativeMenuItem("About Flowy Docs");
        about.Click += async (_, _) => await MessageDialog.ShowAsync(this, "About Flowy Docs",
            $"Flowy Docs {typeof(MainWindow).Assembly.GetName().Version?.ToString(3)}\n\nAvalonia {typeof(Avalonia.Application).Assembly.GetName().Version?.ToString(3)} on .NET {Environment.Version}");
        var check = new NativeMenuItem("Check for Updates…");
        check.Click += async (_, _) => await Updates.CheckAsync(this, true);
        var auto = new NativeMenuItem("Check for updates automatically") { ToggleType = MenuItemToggleType.CheckBox, IsChecked = _shell.State.CheckForUpdates };
        auto.Click += (_, _) => _shell.RememberCheckForUpdates(auto.IsChecked);
        var help = new NativeMenuItem("Help") { Menu = new NativeMenu { Items = { demo, guide, new NativeMenuItemSeparator(), check, auto, new NativeMenuItemSeparator(), about } } };

        var menu = new NativeMenu { Items = { file, view, help } };
        NativeMenu.SetMenu(this, menu);
        // Windows and Linux draw it inside the window; macOS has it in the screen's menu bar and hides this.
        var bar = new NativeMenuBar();
        DockPanel.SetDock(bar, Dock.Top);
        _frame.Children.Insert(0, bar);
        RebuildRecent();
        foreach (var item in _needsModel) item.IsEnabled = false; // until a folder is open
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
            item.Click += async (_, _) => await _shell.OpenAsync(target, this);
            items.Add(item);
        }
        if (recent.Count > 0) items.Add(new NativeMenuItemSeparator());
        var clear = new NativeMenuItem("Clear Recent") { IsEnabled = recent.Count > 0 };
        clear.Click += (_, _) => _shell.ClearRecent();
        items.Add(clear);
    }

    // ---- what the window shows ---------------------------------------------------------------------------------

    private Control Welcome()
    {
        var button = new Button { HorizontalAlignment = HorizontalAlignment.Center };
        button.Classes.Add("tool");
        button.Classes.Add("primary");
        Chrome.Fill(button, Flowy.App.Canvas.Icons.Folder, "Open folder…");
        button.Click += async (_, _) => await _shell.ChooseAsync(this);
        return new StackPanel
        {
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            Spacing = 16,
            Children =
            {
                new TextBlock { Text = "Flowy Docs", FontSize = 22, FontWeight = Avalonia.Media.FontWeight.SemiBold, HorizontalAlignment = HorizontalAlignment.Center },
                new TextBlock { Text = "Open a repo, or the flowy folder inside it. You can also drop a folder here.", Classes = { "muted" }, HorizontalAlignment = HorizontalAlignment.Center },
                button,
                Demo(),
            },
        };
    }

    private Control Demo()
    {
        var demo = new Button { HorizontalAlignment = HorizontalAlignment.Center, IsVisible = Shell.DemoDir is not null };
        demo.Classes.Add("tool");
        Chrome.Fill(demo, Flowy.App.Canvas.Icons.Play, "Open the demo");
        demo.Click += (_, _) => _shell.OpenDemo();
        return demo;
    }

    /// <summary>Shows a model folder in this window and keeps watching it. A file that can't be read gives an empty view and a banner saying which, until it is fixed.</summary>
    internal void Open(string dir, LaunchOptions? options = null)
    {
        Dir = dir;
        Title = $"{ModelFolders.Title(dir)} — Flowy Docs";
        var folder = new Folder(new Model(), []);
        string? problem = null;
        try
        {
            folder = FolderLoader.Load(dir);
        }
        catch (ParseError e)
        {
            problem = e.Message;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            problem = $"Can't read the folder: {e.Message}";
        }
        if (_frame.Children[^1] != _reader)
        {
            _frame.Children.RemoveAt(_frame.Children.Count - 1);
            _frame.Children.Add(_reader);
        }
        // The sample that ships with the app sits in the install folder, which is not for writing.
        var demo = Shell.DemoDir;
        _reader.CanEdit = demo is null || !string.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(dir)), Path.TrimEndingDirectorySeparator(Path.GetFullPath(demo)), StringComparison.OrdinalIgnoreCase);
        _reader.Load(folder, dir);
        foreach (var item in _needsModel) item.IsEnabled = true;
        if (_shell.State.Lines is { } lines) _reader.PickLines(lines);
        if (problem is not null) _reader.SetBanner(problem);

        _watcher?.Dispose();
        _watcher = null;
        _watchFailed = false;
        try
        {
            _watcher = new FolderWatcher(dir);
            _watcher.Changed += () => Dispatcher.UIThread.Post(async () => await ReloadAsync());
            _watcher.Failed += e => Dispatcher.UIThread.Post(() =>
            {
                _watchFailed = true;
                _reader.SetBanner($"Can't watch the folder any more ({e.Message}). Open it again to get live updates.");
            });
        }
        catch (Exception e) when (e is ArgumentException or IOException or UnauthorizedAccessException)
        {
            _watchFailed = true;
            _reader.SetBanner($"Can't watch the folder ({e.Message}). Open it again to read it afresh.");
        }
        if (options is not null) Dispatcher.UIThread.Post(async () => await ApplyAndShootAsync(options));
    }

    /// <summary>The folder was asked for again while it is open here: if it stopped being watched (it was deleted, or came back), read it afresh.</summary>
    internal void Reopen()
    {
        if (Dir is { } dir && _watchFailed) Open(dir);
    }

    /// <summary>A file changed: read the folder again. While a file can't be read the last good model stays, with the reason in a banner.</summary>
    private async Task ReloadAsync()
    {
        if (Dir is not { } dir || _watchFailed) return; // a watch that failed has already said so, and reading now would clear that
        if (!Directory.Exists(dir))
        {
            _watchFailed = true;
            _reader.SetBanner("The folder is gone. Open it again when it is back.");
            return;
        }
        var load = ++_loads;
        try
        {
            var folder = await Task.Run(() => FolderLoader.Load(dir));
            if (load == _loads) _reader.Reload(folder);
        }
        catch (ParseError e)
        {
            if (load == _loads) _reader.SetBanner(e.Message);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            if (load == _loads) _reader.SetBanner($"Can't read the folder: {e.Message}");
        }
    }

    private async Task CopyMermaidAsync()
    {
        if (_reader.MermaidText() is not { } text || Clipboard is not { } clipboard) return;
        await clipboard.SetTextAsync(text);
        _reader.ShowNotice(_reader.PlayingFlowId is null
            ? "Copied this view as a Mermaid diagram. Paste it into a README or a pull request."
            : "Copied this flow as a Mermaid sequence diagram. Paste it into a README or a pull request.", 4);
    }

    private async Task SavePictureAsync()
    {
        if (Dir is not { } dir) return;
        var file = await StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
        {
            Title = "Save a picture of this view",
            SuggestedFileName = _reader.PictureName(ModelFolders.Title(dir)),
            DefaultExtension = "png",
            FileTypeChoices = [FilePickerFileTypes.ImagePng],
        });
        if (file?.TryGetLocalPath() is not { } path) return;
        try
        {
            _reader.SavePicture(path);
            _reader.ShowNotice($"Saved {Path.GetFileName(path)}.", 4);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            _reader.ShowNotice($"Couldn't save the picture: {e.Message}");
        }
    }

    // ---- the command line's own flags: set up a state, take a picture -----------------------------------------

    internal async Task ApplyAndShootAsync(LaunchOptions options)
    {
        // Let the first layout happen, so the camera knows the canvas's size before it is asked to move.
        await Task.Delay(150);
        Apply(options);
        if (options.Shot is not { } shot) return;
        // On the dispatcher's clock rather than Task.Delay's, so the picture is taken when asked even while an animation is running.
        var wait = TimeSpan.FromMilliseconds(int.TryParse(options.Value("--delay"), out var delay) ? delay : 700);
        DispatcherTimer.RunOnce(() =>
        {
            var scale = double.TryParse(options.Value("--scale"), out var s) && s is >= 1 and <= 4 ? s : 1;
            // --picture is File > Save Picture: the diagram alone, without the bar and the panel.
            if (options.Has("--picture")) _reader.SavePicture(shot, scale);
            else Save(shot, scale);
            Close();
        }, wait, DispatcherPriority.Render);
    }

    private void Apply(LaunchOptions options)
    {
        if (_reader.Folder is null) return;
        if (options.Has("--edit")) _reader.SetEditing(true);
        if (options.Value("--lines") is { } lines) _reader.PickLines(lines);
        if (options.Value("--view") is { } view) _reader.GoTo(view);
        if (options.Value("--flow") is { } flow) _reader.Play(flow, int.TryParse(options.Value("--step"), out var step) ? step : 0);
        if (options.Value("--select") is { } select) _reader.Select(select);
        if (options.Has("--add")) _reader.OpenAddPanel();
        if (options.Value("--edit-flow") is { } editFlow) _reader.OpenFlowEditor(editFlow);
        if (options.Value("--line") is { } line && line.Split(' ') is [var from, var to]) _reader.OpenLine(from, to);
        if (options.Value("--hover") is { } hover) _reader.SetHover(hover);
        if (options.Value("--search") is { } search) _reader.OpenSearch(search);
        if (options.Has("--shortcuts")) _reader.ShowShortcuts();
        if (options.Value("--zoom") is { } zoom) _reader.OpenBox(zoom);
    }

    private void Save(string path, double scale)
    {
        // Rendering a picture does not lay anything out first: do it, so controls added a moment ago are in place.
        UpdateLayout();
        // A card's drop shadow comes out wrong when a bitmap is drawn at more than its own size: the card is blank. Cards are drawn flat for it.
        var shadowed = scale > 1 ? this.GetVisualDescendants().OfType<Border>().Where(b => b.BoxShadow.Count > 0).Select(b => (Border: b, b.BoxShadow)).ToList() : [];
        foreach (var (border, _) in shadowed) border.BoxShadow = default;
        try
        {
            using var bitmap = new RenderTargetBitmap(new PixelSize((int)(Bounds.Width * scale), (int)(Bounds.Height * scale)), new Vector(96 * scale, 96 * scale));
            bitmap.Render(this);
            bitmap.Save(path, PngBitmapEncoderOptions.Default);
        }
        finally
        {
            foreach (var (border, shadow) in shadowed) border.BoxShadow = shadow;
        }
    }
}
