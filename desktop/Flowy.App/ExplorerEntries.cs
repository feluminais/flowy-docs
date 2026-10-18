using System.Runtime.Versioning;
using Microsoft.Win32;

namespace Flowy.App;

/// <summary>
/// "Open with Flowy Docs" in Explorer's right-click menu: on a folder, and on the empty background of a folder you are in. Written for the
/// current user only (no administrator rights) by the installer's hooks, and taken away again when the app is uninstalled. On Windows 11 the
/// entries are under "Show more options". Other systems have no such entries yet; they open a folder from the command line or by dropping it.
/// </summary>
[SupportedOSPlatform("windows")]
internal static class ExplorerEntries
{
    /// <summary>Where the entries go. FLOWY_CLASSES_ROOT names another key, which is how the tests avoid the real Explorer ones.</summary>
    public static string Root => Environment.GetEnvironmentVariable("FLOWY_CLASSES_ROOT") is { Length: > 0 } custom ? custom : @"Software\Classes";

    private const string Name = "FlowyDocs";
    private const string ForFolder = @"Directory\shell";
    private const string ForBackground = @"Directory\Background\shell";

    /// <summary>Adds both entries, each running <paramref name="exe"/> on the folder.</summary>
    public static void Install(string exe, string? root = null)
    {
        root ??= Root;
        Write(root, ForFolder, exe, "%1"); // the folder that was right-clicked
        Write(root, ForBackground, exe, "%V"); // the folder whose empty space was right-clicked
    }

    private static void Write(string root, string where, string exe, string argument)
    {
        using var key = Registry.CurrentUser.CreateSubKey($@"{root}\{where}\{Name}");
        key.SetValue("", "Open with Flowy Docs");
        key.SetValue("Icon", $"\"{exe}\"");
        using var command = key.CreateSubKey("command");
        command.SetValue("", $"\"{exe}\" \"{argument}\"");
    }

    /// <summary>Takes both entries away. Nothing happens if they aren't there.</summary>
    public static void Remove(string? root = null)
    {
        root ??= Root;
        Registry.CurrentUser.DeleteSubKeyTree($@"{root}\{ForFolder}\{Name}", throwOnMissingSubKey: false);
        Registry.CurrentUser.DeleteSubKeyTree($@"{root}\{ForBackground}\{Name}", throwOnMissingSubKey: false);
    }

    /// <summary>The command an entry runs, or null if there is no such entry.</summary>
    public static string? CommandOf(bool background, string? root = null)
    {
        using var key = Registry.CurrentUser.OpenSubKey($@"{root ?? Root}\{(background ? ForBackground : ForFolder)}\{Name}\command");
        return key?.GetValue("") as string;
    }
}
