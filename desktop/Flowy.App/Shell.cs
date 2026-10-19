using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Layout;
using Avalonia.Threading;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The app as a whole: one window per model folder, the recent folders, and what the app remembers. Opening a folder that is already open
/// brings its window forward. A folder with no Flowy model says so and creates nothing.
/// </summary>
internal sealed class Shell
{
    private readonly Dictionary<string, MainWindow> _windows = [];
    private readonly UserStateStore? _store;
    private UserState _state;

    /// <param name="store">Where to remember things between runs; null remembers nothing (a screenshot run).</param>
    public Shell(UserStateStore? store)
    {
        _store = store;
        _state = store?.Load() ?? UserState.Default;
    }

    public static Shell? Current { get; set; }

    public UserState State => _state;

    public IReadOnlyList<string> Recent => Recents.Existing(_state.Recent);

    public event Action? RecentChanged;

    public IEnumerable<MainWindow> Windows => _windows.Values;

    private void Remember(UserState state)
    {
        _state = state;
        _store?.Save(state);
    }

    public void RememberLines(string? lines) => Remember(_state with { Lines = lines });

    public void RememberCheckForUpdates(bool check) => Remember(_state with { CheckForUpdates = check });

    public void RememberWindow(WindowSize size) => Remember(_state with { Window = size });

    public event Action? OpenFilesWithChanged;

    /// <summary>The app that opens a box's linked files, or null for the system's default. Every window's menu follows.</summary>
    public void RememberOpenFilesWith(string? app)
    {
        Remember(_state with { OpenFilesWith = app });
        OpenFilesWithChanged?.Invoke();
    }

    /// <summary>The sample model that ships with the app (Plum, a made-up delivery service), or null when this build has none beside it.</summary>
    public static string? DemoDir => Path.Combine(AppContext.BaseDirectory, "Demo", "flowy") is var dir && Directory.Exists(dir) ? dir : null;

    /// <summary>Opens what was picked, dropped or typed: a model folder, or a repo with one inside. Says so if there is none.</summary>
    public async Task<MainWindow?> OpenAsync(string picked, Window? owner, LaunchOptions? options = null)
    {
        var dir = ModelFolders.Resolve(picked);
        if (dir is null)
        {
            await MessageDialog.ShowAsync(owner, "No Flowy model here",
                $"“{ModelFolders.Title(picked)}” has no flowy folder, and no model.yaml of its own. Open a repo that has one, or the flowy folder itself.");
            return null;
        }
        return Show(dir, options);
    }

    /// <summary>Shows a model folder's window: the one already open for it, else a new one.</summary>
    public MainWindow Show(string dir, LaunchOptions? options = null)
    {
        var key = ModelFolders.Key(dir);
        if (_windows.TryGetValue(key, out var existing))
        {
            existing.Reopen();
            Bring(existing);
            return existing;
        }
        // A window that has no folder yet (the first one, before a folder was chosen) takes it.
        var window = EmptyWindow() ?? new MainWindow(this);
        window.Open(dir, options);
        _windows[key] = window;
        window.Closed += (_, _) =>
        {
            _windows.Remove(key);
            RecentChanged?.Invoke();
        };
        Remember(_state with { Recent = Recents.Push(_state.Recent, dir) });
        RecentChanged?.Invoke();
        if (!window.IsVisible) window.Show();
        Bring(window);
        return window;
    }

    private MainWindow? EmptyWindow() => (Application.Current?.ApplicationLifetime as IClassicDesktopStyleApplicationLifetime)?.Windows.OfType<MainWindow>().FirstOrDefault(w => w.Dir is null);

    private static void Bring(Window window)
    {
        if (window.WindowState == WindowState.Minimized) window.WindowState = WindowState.Normal;
        window.Activate();
    }

    /// <summary>A folder from the command line (or a second launch), else the newest recent one that still exists, else a window asking for one.</summary>
    public async Task LaunchAsync(IReadOnlyList<string> args, string cwd, LaunchOptions? options = null)
    {
        if (ModelFolders.FromArguments(args, cwd) is { } folder)
        {
            await OpenAsync(folder, _windows.Values.LastOrDefault(), options);
            return;
        }
        if (_windows.Count > 0)
        {
            Bring(_windows.Values.Last());
            return;
        }
        if (Recent.FirstOrDefault() is { } last && ModelFolders.Resolve(last) is { } dir)
        {
            Show(dir, options);
            return;
        }
        var window = EmptyWindow() ?? new MainWindow(this);
        window.Show();
        if (options?.Shot is not null) await window.ApplyAndShootAsync(options); // a picture of the welcome, not a dialog nobody can answer
        else await ChooseAsync(window);
    }

    /// <summary>The Open dialog; opens what was chosen.</summary>
    public async Task ChooseAsync(Window owner)
    {
        var folders = await owner.StorageProvider.OpenFolderPickerAsync(new Avalonia.Platform.Storage.FolderPickerOpenOptions { Title = "Open a repo or its flowy folder", AllowMultiple = false });
        if (folders.Count == 1 && Avalonia.Platform.Storage.StorageProviderExtensions.TryGetLocalPath(folders[0]) is { } path) await OpenAsync(path, owner);
    }

    /// <summary>Opens the sample model that ships with the app.</summary>
    public void OpenDemo()
    {
        if (DemoDir is { } dir) Show(dir);
    }

    public void ClearRecent()
    {
        Remember(_state with { Recent = [] });
        RecentChanged?.Invoke();
    }

    /// <summary>Closes every window, which ends the program.</summary>
    public void Quit()
    {
        foreach (var window in (Application.Current?.ApplicationLifetime as IClassicDesktopStyleApplicationLifetime)?.Windows.ToList() ?? []) window.Close();
    }
}

/// <summary>A small window with a message and an OK button: Avalonia has no message box of its own.</summary>
internal static class MessageDialog
{
    /// <summary>A question with two answers; true for the first.</summary>
    public static async Task<bool> AskAsync(Window? owner, string title, string message, string yes, string no)
    {
        if (owner is { IsVisible: false }) owner = null; // closed while the update check ran: ShowDialog on it would throw
        var answer = false;
        var accept = new Button { Content = yes, IsDefault = true, HorizontalContentAlignment = HorizontalAlignment.Center, MinWidth = 80 };
        var decline = new Button { Content = no, IsCancel = true, HorizontalContentAlignment = HorizontalAlignment.Center, MinWidth = 80 };
        accept.Classes.Add("tool");
        accept.Classes.Add("primary");
        decline.Classes.Add("tool");
        var dialog = new Window
        {
            Title = title,
            Width = 440,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = owner is null ? WindowStartupLocation.CenterScreen : WindowStartupLocation.CenterOwner,
            CanResize = false,
            Content = new StackPanel
            {
                Margin = new Thickness(20),
                Spacing = 16,
                Children =
                {
                    new TextBlock { Text = message, TextWrapping = Avalonia.Media.TextWrapping.Wrap },
                    new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right, Children = { accept, decline } },
                },
            },
        };
        accept.Click += (_, _) =>
        {
            answer = true;
            dialog.Close();
        };
        decline.Click += (_, _) => dialog.Close();
        if (owner is null)
        {
            var done = new TaskCompletionSource();
            dialog.Closed += (_, _) => done.TrySetResult();
            dialog.Show();
            await done.Task;
        }
        else await dialog.ShowDialog(owner);
        return answer;
    }

    public static async Task ShowAsync(Window? owner, string title, string message)
    {
        if (owner is { IsVisible: false }) owner = null;
        var ok =new Button { Content = "OK", HorizontalAlignment = HorizontalAlignment.Right, IsDefault = true, MinWidth = 80, HorizontalContentAlignment = HorizontalAlignment.Center };
        ok.Classes.Add("tool");
        ok.Classes.Add("primary");
        var dialog = new Window
        {
            Title = title,
            Width = 440,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = owner is null ? WindowStartupLocation.CenterScreen : WindowStartupLocation.CenterOwner,
            CanResize = false,
            ShowInTaskbar = owner is null,
            Content = new StackPanel
            {
                Margin = new Thickness(20),
                Spacing = 16,
                Children = { new TextBlock { Text = message, TextWrapping = Avalonia.Media.TextWrapping.Wrap }, ok },
            },
        };
        ok.Click += (_, _) => dialog.Close();
        if (owner is null)
        {
            var done = new TaskCompletionSource();
            dialog.Closed += (_, _) => done.TrySetResult();
            dialog.Show();
            await done.Task;
        }
        else await dialog.ShowDialog(owner);
    }
}
