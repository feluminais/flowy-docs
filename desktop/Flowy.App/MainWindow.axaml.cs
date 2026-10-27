using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Platform;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Flowy.Core;

namespace Flowy.App;

/// <summary>A window for one model folder (or, before one is chosen, a welcome). Everything about which windows exist is the <see cref="Shell"/>'s.</summary>
public partial class MainWindow : Window, IDisposable
{
    private readonly Shell _shell;
    private readonly ReaderView _reader = new();
    private readonly DockPanel _frame = new();
    private readonly MainMenu _menu;
    private readonly LaunchScript _script;
    private FolderSession? _disk;
    private Size _normal; // the size when not maximized, which is what a restart should open at
    private bool _discarding; // the reader said to discard the notes nobody saved: the window closes without asking again

    /// <param name="launch">What the command line asked for; the window opens at the size it names, if it names one.</param>
    internal MainWindow(Shell shell, LaunchOptions? launch = null)
    {
        InitializeComponent();
        Icon = new WindowIcon(Avalonia.Platform.AssetLoader.Open(new Uri("avares://FlowyDocs/Assets/icon.png")));
        _shell = shell;
        if (launch?.Size is { } size)
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
        Closing += (_, e) =>
        {
            // A note nobody saved asks first, as every other way out of it does: the window stays until the reader says Discard (then it closes for real) or Keep. The system ending the session
            // can't be held back.
            if (!_discarding && e.CloseReason != WindowCloseReason.OSShutdown && _reader.UnlessNotesKept(() =>
            {
                _discarding = true;
                Close();
            }))
            {
                e.Cancel = true;
                return;
            }
            if (Dir is not null) _shell.RememberWindow(new WindowSize(_normal.Width, _normal.Height, WindowState == WindowState.Maximized));
        };
        _menu = new MainMenu(this, shell, _reader, _frame, () => Dir, ReloadOrReopenAsync);
        _script = new LaunchScript(this, _reader);
        Content = _frame;
        _frame.Children.Add(Welcome());
        _reader.LinesPicked += _shell.RememberLines;
        _reader.ChangesPicked += _shell.RememberChanges;
        _reader.ShowChanges = _shell.State.ShowChanges;
        _reader.ModelPicked += dir => _shell.Show(dir);
        _reader.NavigatorChanged += navigator =>
        {
            if (Dir is not null) _shell.RememberNavigator(Dir, navigator);
        };
        _reader.CustomApp = () => _shell.State.OpenFilesWith;
        Closed += (_, _) => Dispose();

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
                new TextBlock { Text = "Open or drop a repo, or the flowy folder inside it.", Classes = { "muted" }, HorizontalAlignment = HorizontalAlignment.Center },
                button,
                Demo(),
            },
        };
    }

    private Control Demo()
    {
        var there = Shell.DemoDir is not null;
        var demo = new Button { HorizontalAlignment = HorizontalAlignment.Center, IsEnabled = there };
        demo.Classes.Add("tool");
        if (!there) ToolTip.SetTip(demo, "The demo is missing from this install");
        Chrome.Fill(demo, Flowy.App.Canvas.Icons.Play, "Open the demo");
        demo.Click += (_, _) => _shell.OpenDemo();
        return demo;
    }

    /// <summary>Lets go of what the window holds on to: the folder watchers and the menu. Runs when the window closes.</summary>
    public void Dispose()
    {
        _disk?.Dispose();
        _reader.Dispose();
        _menu.Dispose();
    }

    /// <summary>Shows a model folder in this window and keeps watching it. A file that can't be read gives an empty view and a banner saying which, until it is fixed.</summary>
    internal void Open(string dir, LaunchOptions? options = null)
    {
        // Another folder in a window that holds a note nobody saved asks first; the same folder read again keeps its notes (they are by pair).
        if (Dir is { } shown && ModelFolders.Key(shown) != ModelFolders.Key(dir) && _reader.UnlessNotesKept(() => Open(dir, options))) return;
        Dir = dir;
        Title = $"{ModelFolders.Title(dir)} — Flowy Docs";
        _disk?.Dispose();
        _disk = new FolderSession(dir);
        var folder = _disk.Read(out var problem);
        if (_frame.Children[^1] != _reader)
        {
            _frame.Children.RemoveAt(_frame.Children.Count - 1);
            _frame.Children.Add(_reader);
        }
        // The sample that ships with the app sits in the install folder, which is not for writing.
        var demo = Shell.DemoDir;
        _reader.CanEdit = demo is null || !string.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(dir)), Path.TrimEndingDirectorySeparator(Path.GetFullPath(demo)), StringComparison.OrdinalIgnoreCase);
        _reader.Load(folder, dir);
        _reader.RestoreNavigator(_shell.NavigatorFor(dir));
        _menu.ModelOpened();
        if (_shell.State.Lines is { } lines) _reader.PickLines(lines);
        if (problem is not null) _reader.SetBanner(problem);

        _disk.Loaded += _reader.Reload;
        _disk.Failed += _reader.SetBanner;
        _disk.Watch(work => Dispatcher.UIThread.Post(work));
        if (options is not null) Dispatcher.UIThread.Post(async () => await _script.RunAsync(options));
    }

    /// <summary>The folder was asked for again while it is open here: if it stopped being watched (it was deleted, or came back), read it afresh.</summary>
    internal void Reopen()
    {
        if (Dir is { } dir && _disk?.WatchFailed == true) Open(dir);
    }

    /// <summary>A file changed: read the folder again. While a file can't be read the last good model stays, with the reason in a banner.</summary>
    private async Task ReloadAsync()
    {
        if (_disk is { } disk) await disk.RefreshAsync();
    }

    /// <summary>Reload in the menu: read the folder again, or open it afresh when it is no longer watched.</summary>
    private async Task ReloadOrReopenAsync()
    {
        if (Dir is not { } dir) return;
        if (_disk?.WatchFailed == true) Open(dir);
        else await ReloadAsync();
    }

    /// <summary>The command line's flags, carried out on this window (see <see cref="LaunchScript"/>).</summary>
    internal Task ApplyAndShootAsync(LaunchOptions options) => _script.RunAsync(options);
}
