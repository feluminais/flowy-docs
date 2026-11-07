using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Platform;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Flowy.Core;

namespace Flowy.App;

/// <summary>A window with a tab for each model and sketch open in it (or, before one is chosen, a welcome). Everything about which windows exist is the <see cref="Shell"/>'s.</summary>
public partial class MainWindow : Window, IDisposable
{
    private readonly Shell _shell;
    private readonly DockPanel _frame = new();
    private readonly DocTabsBar _strip = new() { IsVisible = false };
    private readonly Panel _stage = new(); // every tab's reader, of which only the one on show is visible: going back to a tab costs no styling and it is as it was left
    private readonly Control _welcome;
    private readonly Button _openFolder = new() { HorizontalAlignment = HorizontalAlignment.Center };
    private readonly List<DocTab> _tabs = [];
    private readonly MainMenu _menu;
    private readonly LaunchScript _script;
    private DocTab? _active;
    private ReaderView? _blank; // stands in for a reader while no tab is open, so the menu always has one to talk to; nothing shows it
    private Size _normal; // the size when not maximized, which is what a restart should open at
    private bool _discarding; // the reader said to discard the notes nobody saved: the window closes without asking again

    /// <param name="launch">What the command line asked for; the window opens at the size it names, if it names one.</param>
    internal MainWindow(Shell shell, LaunchOptions? launch = null)
    {
        InitializeComponent();
        Icon = new WindowIcon(Avalonia.Platform.AssetLoader.Open(new Uri("avares://FlowyDocs/Assets/icon.png")));
        // On Windows the menu shares the title bar (see TitleRow). A --shot picture is of the window's inside, which keeps the menu on a row of its own.
        ExtendClientAreaToDecorationsHint = OperatingSystem.IsWindows() && Program.Options.Shot is null;
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
            if (!_discarding && e.CloseReason != WindowCloseReason.OSShutdown && AsksAboutNotes(0, () =>
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
        _menu = new MainMenu(this, shell, () => Reader, _frame, () => Dir, ReloadOrReopenAsync);
        _script = new LaunchScript(this, () => Reader);
        _welcome = Welcome();
        DockPanel.SetDock(_strip, Dock.Top);
        _frame.Children.Add(_strip);
        _stage.Children.Add(_welcome);
        _frame.Children.Add(_stage);
        Content = _frame;
        _strip.Picked += Pick;
        _strip.CloseAsked += CloseTab;
        _strip.CloseOthersAsked += CloseOthers;
        _strip.MoveAsked += Move;
        _strip.OpenAsked += async () => await _shell.ChooseAsync(this);
        // Ctrl+Tab has to be taken on its way down: on its way up the window's Tab moves the keyboard to the next control.
        AddHandler(KeyDownEvent, OnTabKey, Avalonia.Interactivity.RoutingStrategies.Tunnel);
        Closed += (_, _) => Dispose();

        // A folder dropped on the window opens in a tab of it.
        DragDrop.SetAllowDrop(this, true);
        AddHandler(DragDrop.DragOverEvent, (_, e) => e.DragEffects = e.DataTransfer.TryGetFiles() is { Length: > 0 } ? DragDropEffects.Copy : DragDropEffects.None);
        AddHandler(DragDrop.DropEvent, async (_, e) =>
        {
            foreach (var item in e.DataTransfer.TryGetFiles() ?? [])
                if (item.TryGetLocalPath() is { } path && Directory.Exists(path)) await _shell.OpenAsync(path, this);
        });
    }

    /// <summary>The model folder on show, or null while no tab is open.</summary>
    internal string? Dir => _active?.Dir;

    /// <summary>The reader on show.</summary>
    internal ReaderView Reader => _active?.Reader ?? (_blank ??= new ReaderView());

    internal IReadOnlyList<DocTab> Tabs => _tabs;

    internal DocTabsBar Strip => _strip;

    internal bool WelcomeShown => _welcome.IsVisible;

    private List<TabPlace> Places => [.. _tabs.Select(t => t.Place)];

    // ---- what the window shows ---------------------------------------------------------------------------------

    private Control Welcome()
    {
        _openFolder.Classes.Add("tool");
        _openFolder.Classes.Add("primary");
        Chrome.Fill(_openFolder, Flowy.App.Canvas.Icons.Folder, "Open folder…");
        _openFolder.Click += async (_, _) => await _shell.ChooseAsync(this);
        return new StackPanel
        {
            VerticalAlignment = VerticalAlignment.Center,
            HorizontalAlignment = HorizontalAlignment.Center,
            Spacing = 16,
            Children =
            {
                new TextBlock { Text = "Flowy Docs", FontSize = 22, FontWeight = Avalonia.Media.FontWeight.SemiBold, HorizontalAlignment = HorizontalAlignment.Center },
                new TextBlock { Text = "Open or drop a repo, or the flowy folder inside it.", Classes = { "muted" }, HorizontalAlignment = HorizontalAlignment.Center },
                _openFolder,
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

    /// <summary>Lets go of what the window holds on to: the tabs and the menu. Runs when the window closes.</summary>
    public void Dispose()
    {
        foreach (var tab in _tabs) tab.Dispose();
        _blank?.Dispose();
        _menu.Dispose();
    }

    // ---- the tabs ----------------------------------------------------------------------------------------------

    /// <summary>Shows a model folder in a tab of this window, a new one unless it has one, and reads it. <paramref name="options"/> are the command line's flags, carried out on the tab.</summary>
    internal void Open(string dir, LaunchOptions? options = null)
    {
        var key = ModelFolders.Key(dir);
        if (_tabs.Find(t => t.Key == key) is { } tab) Activate(tab);
        else Adopt(tab = new DocTab(_shell, dir));
        tab.Read();
        DrawStrip();
        if (options is not null) Dispatcher.UIThread.Post(async () => await RunAsync(options));
    }

    /// <summary>--sketch names sketches of the model on show (separated by commas), each opened beside it; the rest of the flags then act on the last. It is how a picture of the tabs is taken.</summary>
    private async Task RunAsync(LaunchOptions options)
    {
        if (options.Value("--sketch") is { } sketches && Dir is { } dir)
            foreach (var id in sketches.Split(',')) _shell.Show(Sketches.DirOf(dir, id.Trim()), null, this);
        await _script.RunAsync(options);
    }

    /// <summary>Takes a tab in: a new one, or one from another window.</summary>
    internal void Adopt(DocTab tab)
    {
        _tabs.Insert(TabGroups.InsertAt(Places, tab.Place), tab);
        _stage.Children.Add(tab.Reader);
        tab.Renamed = DrawStrip;
        Activate(tab);
    }

    /// <summary>Lets a tab go, to another window or for good. The tab beside it takes over; with none left the welcome comes back.</summary>
    internal void Release(DocTab tab)
    {
        var at = _tabs.IndexOf(tab);
        var heir = TabGroups.Heir(Places, at) is >= 0 and var i ? _tabs[i] : null;
        if (tab == _active) tab.Reader.LeaveTab();
        _tabs.RemoveAt(at);
        _stage.Children.Remove(tab.Reader);
        tab.Reader.IsVisible = true;
        tab.Renamed = null;
        if (tab == _active)
        {
            _active = null;
            if (heir is not null) Activate(heir);
            else ShowWelcome();
        }
        DrawStrip();
    }

    private void ShowWelcome()
    {
        _welcome.IsVisible = true;
        _strip.IsVisible = false;
        Title = "Flowy Docs";
        _menu.ModelClosed();
        _openFolder.Focus();
    }

    /// <summary>A press on a tab: the keyboard goes to it too, also when it was on show already, or the next Space would press the tab again.</summary>
    private void Pick(DocTab tab)
    {
        Activate(tab);
        tab.Reader.Focus();
    }

    /// <summary>Puts a tab on show.</summary>
    private void Activate(DocTab tab)
    {
        if (_active == tab) return;
        _active?.Reader.LeaveTab();
        _active = tab;
        foreach (var other in _tabs) other.Reader.IsVisible = other == tab;
        _welcome.IsVisible = false;
        _strip.IsVisible = true;
        Title = $"{ModelFolders.Title(tab.Dir)} - Flowy Docs";
        DrawStrip();
        _menu.ModelOpened();
        if (IsVisible) tab.Reader.Focus(); // the keyboard goes with the tab: it was in the reader that has gone out of sight
    }

    private void DrawStrip() => _strip.Show(_tabs, _active);

    /// <summary>The folder was asked for again: its tab comes on show, and is read afresh if it stopped being watched.</summary>
    internal void ShowTab(string key)
    {
        if (_tabs.Find(t => t.Key == key) is not { } tab) return;
        Activate(tab);
        tab.Reopen();
    }

    /// <summary>Goes <paramref name="by"/> tabs along the row, round the end.</summary>
    internal void NextTab(int by)
    {
        if (_active is { } tab) Activate(_tabs[(_tabs.IndexOf(tab) + by + _tabs.Count) % _tabs.Count]);
    }

    private void OnTabKey(object? sender, KeyEventArgs e)
    {
        if (e.Key != Key.Tab || !e.KeyModifiers.HasFlag(KeyModifiers.Control)) return;
        e.Handled = true;
        NextTab(e.KeyModifiers.HasFlag(KeyModifiers.Shift) ? -1 : 1);
    }

    /// <summary>Closes the tab on show.</summary>
    internal void CloseActiveTab()
    {
        if (_active is { } tab) CloseTab(tab);
    }

    /// <summary>Closes a tab. A note nobody saved asks first, on that tab, and Keep leaves it open.</summary>
    internal void CloseTab(DocTab tab)
    {
        if (tab.Reader.UnlessNotesKept(() => Drop(tab))) Activate(tab);
        else Drop(tab);
    }

    private void Drop(DocTab tab)
    {
        Release(tab);
        tab.Dispose();
        _shell.TabClosed(tab.Key);
        if (IsVisible) _active?.Reader.Focus(); // the keyboard may have been on the cross of the tab that has gone
    }

    private void CloseOthers(DocTab keep)
    {
        foreach (var tab in _tabs.Where(t => t != keep).ToList()) CloseTab(tab);
    }

    /// <summary>Moves a tab to a new window: a model takes its sketches with it, a sketch goes alone. Two windows are how a model and its sketch are seen side by side.</summary>
    private void Move(DocTab tab) => _shell.MoveToNewWindow(this, [.. _tabs.Where(t => TabGroups.TravelsWith(tab.Place, t.Place))]);

    /// <summary>The first tab from <paramref name="from"/> on that holds a note nobody saved asks about it, on show; Discard goes on to the next, and past the last does <paramref name="leave"/>. False when no tab asks.</summary>
    private bool AsksAboutNotes(int from, Action leave)
    {
        for (var i = from; i < _tabs.Count; i++)
        {
            var next = i + 1;
            if (!_tabs[i].Reader.UnlessNotesKept(() =>
            {
                if (!AsksAboutNotes(next, leave)) leave();
            })) continue;
            Activate(_tabs[i]);
            return true;
        }
        return false;
    }

    /// <summary>Reload in the menu: read the folder on show again, or open it afresh when it is no longer watched.</summary>
    private Task ReloadOrReopenAsync() => _active?.ReloadAsync() ?? Task.CompletedTask;

    /// <summary>The command line's flags, carried out on this window (see <see cref="LaunchScript"/>).</summary>
    internal Task ApplyAndShootAsync(LaunchOptions options) => _script.RunAsync(options);
}
