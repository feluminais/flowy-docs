using System.ComponentModel;
using System.Diagnostics;
using Avalonia.Controls;
using Avalonia.Platform.Storage;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// Carries out what <see cref="LinkOpening"/> decided. The decisions and the checks behind them are Core's; this only starts things, and the
/// descriptions of the processes it starts are built by plain functions so a test can read them.
/// </summary>
internal static class LinkLauncher
{
    internal enum Os { Windows, MacOs, Other }

    internal static Os Current => OperatingSystem.IsWindows() ? Os.Windows : OperatingSystem.IsMacOS() ? Os.MacOs : Os.Other;

    /// <summary>The chosen app with the file as its one argument: no shell, so nothing in the path is read as a command.</summary>
    internal static ProcessStartInfo CustomAppStart(string app, string path) => new(app) { UseShellExecute = false, ArgumentList = { path } };

    /// <summary>Explorer or Finder with the file selected, running nothing. Null where there is no such thing (the caller opens the folder).</summary>
    internal static ProcessStartInfo? ShowInFolderStart(string path, Os os) => os switch
    {
        Os.Windows => new ProcessStartInfo("explorer.exe") { UseShellExecute = false, Arguments = $"/select,\"{path}\"" },
        Os.MacOs => new ProcessStartInfo("open") { UseShellExecute = false, ArgumentList = { "-R", path } },
        _ => null,
    };

    /// <summary>What a launcher that answered "no" says: the system took no part in opening the link.</summary>
    internal const string NotOpened = "Couldn't open it: no app took it";

    /// <summary>What to tell the reader about a launcher's answer: nothing when it started, else <see cref="NotOpened"/>.</summary>
    internal static string? Told(bool started) => started ? null : NotOpened;

    /// <summary>Does it. Returns what went wrong in words, or null when it started.</summary>
    internal static async Task<string?> RunAsync(TopLevel top, LinkAction action)
    {
        try
        {
            switch (action.Kind)
            {
                case LinkKind.Web:
                    return Told(await top.Launcher.LaunchUriAsync(new Uri(action.Target)));
                case LinkKind.Folder:
                    return Told(await top.Launcher.LaunchDirectoryInfoAsync(new DirectoryInfo(action.Target)));
                case LinkKind.DefaultApp:
                    return Told(await top.Launcher.LaunchFileInfoAsync(new FileInfo(action.Target)));
                case LinkKind.CustomApp:
                    Process.Start(CustomAppStart(action.App!, action.Target))?.Dispose();
                    break;
                case LinkKind.ShowInFolder:
                    if (ShowInFolderStart(action.Target, Current) is { } start) Process.Start(start)?.Dispose();
                    else return Told(await top.Launcher.LaunchDirectoryInfoAsync(new DirectoryInfo(Path.GetDirectoryName(action.Target)!)));
                    break;
                default:
                    return "That link doesn't point at anything Flowy can open.";
            }
            return null;
        }
        catch (Exception e) when (e is Win32Exception or InvalidOperationException or IOException or UnauthorizedAccessException)
        {
            return $"Couldn't open it: {e.Message}";
        }
    }
}
