using Avalonia;
using Velopack;

namespace Flowy.App;

/// <summary>
/// What the command line asked for. An argument that isn't a flag is a folder to open (the first one that is a folder wins). The other flags
/// exist so a change can be checked without a person looking: <c>--shot out.png</c> saves a picture of the window and exits, and the rest set
/// up what the picture shows.
/// </summary>
internal sealed record LaunchOptions(IReadOnlyList<string> Arguments, IReadOnlyDictionary<string, string> Values, IReadOnlySet<string> Flags)
{
    private static readonly HashSet<string> WithValue = ["--shot", "--view", "--select", "--tab", "--size", "--theme", "--lines", "--flow", "--step", "--search", "--hover", "--line", "--zoom", "--delay", "--scale", "--edit-flow"];

    public static LaunchOptions Parse(string[] args)
    {
        var arguments = new List<string>();
        var values = new Dictionary<string, string>();
        var flags = new HashSet<string>();
        for (var i = 0; i < args.Length; i++)
        {
            if (WithValue.Contains(args[i]) && i + 1 < args.Length) values[args[i]] = args[++i];
            else if (args[i].StartsWith("--")) flags.Add(args[i]);
            else if (!args[i].StartsWith('-')) arguments.Add(args[i]);
        }
        return new LaunchOptions(arguments, values, flags);
    }

    public string? Value(string name) => Values.GetValueOrDefault(name);

    public bool Has(string flag) => Flags.Contains(flag);

    public string? Shot => Value("--shot");

    /// <summary>The window size asked for with <c>--size 1100x700</c>.</summary>
    public (double Width, double Height)? Size =>
        Value("--size")?.Split('x') is [var w, var h] && double.TryParse(w, out var width) && double.TryParse(h, out var height) ? (width, height) : null;
}

internal static class Program
{
    public static LaunchOptions Options { get; private set; } = LaunchOptions.Parse([]);

    /// <summary>Explorer's "Open with Flowy Docs" goes in when the installer has run and when an update has, and comes out when the app is uninstalled. A hook that fails must not fail the install.</summary>
    private static void ExplorerEntry(bool add)
    {
        if (!OperatingSystem.IsWindows()) return;
        try
        {
            if (add) ExplorerEntries.Install(Environment.ProcessPath!);
            else ExplorerEntries.Remove();
        }
        catch (Exception e) when (e is UnauthorizedAccessException or System.Security.SecurityException or IOException)
        {
            // No entry in Explorer's menu: the app still opens folders from the command line and by drop.
        }
    }

    [STAThread]
    public static int Main(string[] args)
    {
        // First of all: when the installer or an update runs the program to say so, these run and the program ends.
        var velopack = VelopackApp.Build();
        if (OperatingSystem.IsWindows()) // these hooks exist on Windows only
            velopack.OnAfterInstallFastCallback(_ => ExplorerEntry(true)).OnAfterUpdateFastCallback(_ => ExplorerEntry(true)).OnBeforeUninstallFastCallback(_ => ExplorerEntry(false));
        velopack.Run();

        Options = LaunchOptions.Parse(args);

        // One Flowy Docs per user: a second launch hands over what it was asked to open and ends. A picture-taking run, or --new, stands alone.
        IDisposable? owner = null;
        if (Options.Shot is null && !Options.Has("--new"))
        {
            for (var attempt = 0; attempt < 20; attempt++)
            {
                owner = SingleInstance.Own("main", (arguments, cwd) =>
                    Avalonia.Threading.Dispatcher.UIThread.Post(async () =>
                    {
                        if (Shell.Current is { } shell) await shell.LaunchAsync(arguments.Where(a => !a.StartsWith('-')).ToList(), cwd);
                    }));
                if (owner is not null) break;
                if (SingleInstance.TryHandOver(args, Environment.CurrentDirectory)) return 0;
                Thread.Sleep(100); // the other is starting up and not listening yet
            }
        }
        try
        {
            return BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
        }
        finally
        {
            owner?.Dispose();
        }
    }

    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>().UsePlatformDetect().LogToTrace();
}
