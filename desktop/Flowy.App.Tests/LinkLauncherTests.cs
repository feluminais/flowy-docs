using Xunit;

namespace Flowy.App.Tests;

public class LinkLauncherTests
{
    [Fact]
    public void A_chosen_app_gets_the_file_as_one_argument_and_no_shell()
    {
        var start = LinkLauncher.CustomAppStart(@"C:\Apps\Code.exe", @"C:\repo\docs\a & b (1).md");
        Assert.Equal(@"C:\Apps\Code.exe", start.FileName);
        Assert.False(start.UseShellExecute);
        Assert.Equal([@"C:\repo\docs\a & b (1).md"], start.ArgumentList);
        Assert.Equal("", start.Arguments);
    }

    [Fact]
    public void Explorer_is_asked_to_select_the_file_and_Finder_to_reveal_it()
    {
        var windows = LinkLauncher.ShowInFolderStart(@"C:\repo\docs\run.bat", LinkLauncher.Os.Windows)!;
        Assert.Equal("explorer.exe", windows.FileName);
        Assert.Equal("/select,\"C:\\repo\\docs\\run.bat\"", windows.Arguments);
        Assert.False(windows.UseShellExecute);

        var mac = LinkLauncher.ShowInFolderStart("/repo/docs/run.sh", LinkLauncher.Os.MacOs)!;
        Assert.Equal("open", mac.FileName);
        Assert.Equal(["-R", "/repo/docs/run.sh"], mac.ArgumentList);

        Assert.Null(LinkLauncher.ShowInFolderStart("/repo/docs/run.sh", LinkLauncher.Os.Other));
    }

    [Fact]
    public void A_launcher_that_says_no_is_told_to_the_reader_and_one_that_says_yes_is_silent()
    {
        Assert.Null(LinkLauncher.Told(true));
        Assert.Equal("Couldn't open it: no app took it", LinkLauncher.Told(false));
    }
}
