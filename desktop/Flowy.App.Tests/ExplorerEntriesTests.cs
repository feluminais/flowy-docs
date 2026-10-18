using System.Runtime.Versioning;
using Microsoft.Win32;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>
/// The Explorer entries are written into a throwaway key (HKCU\Software\FlowyDocsTests\…), never the real Software\Classes, so running
/// the tests changes nothing about the machine's right-click menu.
/// </summary>
[SupportedOSPlatform("windows")]
public class ExplorerEntriesTests
{
    private const string Exe = @"C:\Users\someone\AppData\Local\FlowyDocs\current\Flowy.App.exe";

    private static string NewRoot() => $@"Software\FlowyDocsTests\{Guid.NewGuid():N}\Classes";

    private static void Forget(string root) => Registry.CurrentUser.DeleteSubKeyTree(root.Split('\\')[..2].Aggregate((a, b) => a + '\\' + b), throwOnMissingSubKey: false);

    [Fact]
    public void Both_entries_are_written_with_the_label_the_icon_and_a_command_that_passes_the_folder()
    {
        if (!OperatingSystem.IsWindows()) return;
        var root = NewRoot();
        try
        {
            ExplorerEntries.Install(Exe, root);
            Assert.Equal($"\"{Exe}\" \"%1\"", ExplorerEntries.CommandOf(false, root));
            Assert.Equal($"\"{Exe}\" \"%V\"", ExplorerEntries.CommandOf(true, root));
            using var folder = Registry.CurrentUser.OpenSubKey($@"{root}\Directory\shell\FlowyDocs");
            Assert.Equal("Open with Flowy Docs", folder!.GetValue(""));
            Assert.Equal($"\"{Exe}\"", folder.GetValue("Icon"));
        }
        finally
        {
            Forget(root);
        }
    }

    [Fact]
    public void Installing_again_after_an_update_replaces_the_command()
    {
        if (!OperatingSystem.IsWindows()) return;
        var root = NewRoot();
        try
        {
            ExplorerEntries.Install(@"C:\old\Flowy.App.exe", root);
            ExplorerEntries.Install(Exe, root);
            Assert.Equal($"\"{Exe}\" \"%1\"", ExplorerEntries.CommandOf(false, root));
        }
        finally
        {
            Forget(root);
        }
    }

    [Fact]
    public void Uninstalling_takes_both_entries_away_and_leaves_other_keys_alone_and_doing_it_twice_is_fine()
    {
        if (!OperatingSystem.IsWindows()) return;
        var root = NewRoot();
        try
        {
            using (var other = Registry.CurrentUser.CreateSubKey($@"{root}\Directory\shell\SomeoneElse")) other.SetValue("", "Not ours");
            ExplorerEntries.Install(Exe, root);
            ExplorerEntries.Remove(root);
            Assert.Null(ExplorerEntries.CommandOf(false, root));
            Assert.Null(ExplorerEntries.CommandOf(true, root));
            using var kept = Registry.CurrentUser.OpenSubKey($@"{root}\Directory\shell\SomeoneElse");
            Assert.Equal("Not ours", kept!.GetValue(""));
            ExplorerEntries.Remove(root);
        }
        finally
        {
            Forget(root);
        }
    }

    [Fact]
    public void The_entries_go_to_the_key_the_environment_names_when_it_names_one()
    {
        if (!OperatingSystem.IsWindows()) return;
        Assert.Equal(@"Software\Classes", ExplorerEntries.Root);
        var root = NewRoot();
        Environment.SetEnvironmentVariable("FLOWY_CLASSES_ROOT", root);
        try
        {
            Assert.Equal(root, ExplorerEntries.Root);
        }
        finally
        {
            Environment.SetEnvironmentVariable("FLOWY_CLASSES_ROOT", null);
        }
    }
}
