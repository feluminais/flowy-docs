using Avalonia.Controls;
using Velopack;
using Velopack.Sources;

namespace Flowy.App;

/// <summary>
/// The app's one request to the network: whether a newer version has been released on GitHub. It asks the Releases of the repo and nothing
/// else, sends nothing about the reader, and only in an installed copy. The reader can switch the check at start-up off in the Help menu.
/// </summary>
internal static class Updates
{
    public const string Repo = "https://github.com/feluminais/flowy-docs";

    public const string ReleasesPage = Repo + "/releases/latest";

    /// <summary>Windows and Linux builds update themselves. The macOS build isn't signed, so it can't: it points at the download page instead.</summary>
    public static bool UpdatesItself => OperatingSystem.IsWindows() || OperatingSystem.IsLinux();

    /// <summary>Looks for a newer version. <paramref name="asked"/> is true when the reader chose Check for Updates, who wants an answer even when there's nothing new.</summary>
    public static async Task CheckAsync(Window? owner, bool asked)
    {
        if (!UpdatesItself)
        {
            if (asked && owner is not null) _ = TopLevel.GetTopLevel(owner)?.Launcher.LaunchUriAsync(new Uri(ReleasesPage));
            return;
        }
        try
        {
            var manager = new UpdateManager(new GithubSource(Repo, null, false));
            if (!manager.IsInstalled)
            {
                if (asked) await MessageDialog.ShowAsync(owner, "Check for Updates", "Updates are checked only in the installed app.");
                return;
            }
            var update = await manager.CheckForUpdatesAsync();
            if (update is null)
            {
                if (asked) await MessageDialog.ShowAsync(owner, "Check for Updates", $"You're up to date.\n\nFlowy Docs {manager.CurrentVersion}");
                return;
            }
            var version = update.TargetFullRelease.Version;
            if (!await MessageDialog.AskAsync(owner, "Update available", $"Flowy Docs {version} is available. You have {manager.CurrentVersion}.", "Download and restart", "Later")) return;
            await manager.DownloadUpdatesAsync(update);
            manager.ApplyUpdatesAndRestart(update.TargetFullRelease);
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            if (asked) await MessageDialog.ShowAsync(owner, "Check for Updates", $"Could not check for updates: {e.Message}");
        }
    }
}
