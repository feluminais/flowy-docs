using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Avalonia.Styling;
using Avalonia.Threading;
using Flowy.Core;

namespace Flowy.App;

public partial class App : Application
{
    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
        RequestedThemeVariant = Program.Options.Value("--theme") switch
        {
            "light" => ThemeVariant.Light,
            "dark" => ThemeVariant.Dark,
            _ => ThemeVariant.Default,
        };
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            desktop.ShutdownMode = ShutdownMode.OnLastWindowClose;
            var options = Program.Options;
            // A screenshot run remembers nothing: it must not leave its folder among the reader's recent ones.
            var shell = new Shell(options.Shot is null ? new UserStateStore(UserStateStore.DefaultFile()) : null);
            Shell.Current = shell;
            // A reader must not die for a surprise in one model: say what happened in the newest window and carry on. A screenshot run wants it loud.
            if (options.Shot is null)
                Dispatcher.UIThread.UnhandledException += (_, e) =>
                {
                    e.Handled = true;
                    shell.Windows.LastOrDefault()?.Reader.SetBanner($"Something went wrong: {e.Exception.Message}");
                };
            Dispatcher.UIThread.Post(async () => await shell.LaunchAsync(options.Arguments, Environment.CurrentDirectory, options));
            // A few seconds after start-up, once, unless the reader turned it off. An uninstalled copy (a build, a clone) never asks.
            if (options.Shot is null)
                _ = Task.Delay(TimeSpan.FromSeconds(5)).ContinueWith(_ => Dispatcher.UIThread.Post(async () =>
                {
                    if (shell.State.CheckForUpdates) await Updates.CheckAsync(shell.Windows.LastOrDefault(), false);
                }));
        }
        base.OnFrameworkInitializationCompleted();
    }
}
