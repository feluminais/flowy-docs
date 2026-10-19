using System.Diagnostics;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class LinkOpeningTests
{
    private static readonly string[] Files =
    [
        "docs/readme.md", "docs/README.MD", "docs/notes.markdown", "docs/n.txt", "docs/d.pdf", "docs/a.png", "docs/b.jpg", "docs/c.jpeg", "docs/d.gif", "docs/e.webp",
        "docs/run.bat", "docs/run.exe", "docs/run.ps1", "docs/run.lnk", "docs/run.js", "docs/page.html", "docs/pic.svg", "docs/doc.docx", "docs/run.sh", "docs/noextension",
        "docs/archive/note.txt",
    ];

    /// <summary>A repo folder with those files, and an <c>outside</c> folder beside it with a secret in it.</summary>
    private static (TempDir Temp, string Root) NewRepo()
    {
        var temp = new TempDir();
        foreach (var file in Files) temp.Write("repo/" + file, "x");
        temp.Write("outside/secret.md", "x");
        return (temp, Path.Combine(temp.Dir, "repo"));
    }

    /// <summary>A folder link: a symbolic link, or on Windows without the right to make one, a junction.</summary>
    private static void MakeLink(string link, string target)
    {
        try
        {
            Directory.CreateSymbolicLink(link, target);
            return;
        }
        catch (Exception e) when (e is UnauthorizedAccessException or IOException && OperatingSystem.IsWindows()) { }
        using var process = Process.Start(new ProcessStartInfo("cmd.exe", ["/c", "mklink", "/J", link, target]) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true })!;
        process.WaitForExit();
        Assert.Equal(0, process.ExitCode);
    }

    [Fact]
    public void A_web_address_opens_in_the_browser()
    {
        var (temp, root) = NewRepo();
        using var _ = temp;
        Assert.Equal(new LinkAction(LinkKind.Web, "https://status.example.com/a?x=1"), LinkOpening.Decide("https://status.example.com/a?x=1", root, null));
    }

    [Theory]
    [InlineData("file:///etc/passwd")]
    [InlineData("mailto:a@b.c")]
    [InlineData("javascript:alert(1)")]
    [InlineData("https://")]
    [InlineData("../up")]
    [InlineData("/etc/passwd")]
    [InlineData("C:/x")]
    [InlineData("docs\\readme.md")]
    [InlineData("docs/missing.md")]
    [InlineData("docs/readme.md/extra")]
    public void Anything_that_is_not_a_web_address_or_a_real_path_in_the_repo_is_refused(string url)
    {
        var (temp, root) = NewRepo();
        using var _ = temp;
        Assert.Equal(LinkKind.Refused, LinkOpening.Decide(url, root, null).Kind);
    }

    [Theory]
    [InlineData("docs/readme.md")]
    [InlineData("docs/README.MD")]
    [InlineData("docs/notes.markdown")]
    [InlineData("docs/n.txt")]
    [InlineData("docs/d.pdf")]
    [InlineData("docs/a.png")]
    [InlineData("docs/b.jpg")]
    [InlineData("docs/c.jpeg")]
    [InlineData("docs/d.gif")]
    [InlineData("docs/e.webp")]
    public void A_document_type_opens_in_the_default_app(string url)
    {
        var (temp, root) = NewRepo();
        using var _ = temp;
        Assert.Equal(new LinkAction(LinkKind.DefaultApp, Path.Combine(root, url.Replace('/', Path.DirectorySeparatorChar))), LinkOpening.Decide(url, root, null));
    }

    [Theory]
    [InlineData("docs/run.bat")]
    [InlineData("docs/run.exe")]
    [InlineData("docs/run.ps1")]
    [InlineData("docs/run.lnk")]
    [InlineData("docs/run.js")]
    [InlineData("docs/page.html")]
    [InlineData("docs/pic.svg")]
    [InlineData("docs/doc.docx")]
    [InlineData("docs/run.sh")]
    [InlineData("docs/noextension")]
    public void Anything_else_is_shown_in_its_folder_and_not_run(string url)
    {
        var (temp, root) = NewRepo();
        using var _ = temp;
        Assert.Equal(new LinkAction(LinkKind.ShowInFolder, Path.Combine(root, url.Replace('/', Path.DirectorySeparatorChar))), LinkOpening.Decide(url, root, null));
    }

    [Theory]
    [InlineData("docs")]
    [InlineData("docs/")]
    [InlineData("docs/archive/")]
    public void A_folder_opens_in_the_file_explorer(string url)
    {
        var (temp, root) = NewRepo();
        using var _ = temp;
        var action = LinkOpening.Decide(url, root, null);
        Assert.Equal(LinkKind.Folder, action.Kind);
        Assert.Equal(Path.Combine(root, url.TrimEnd('/').Replace('/', Path.DirectorySeparatorChar)), action.Target);
    }

    [Fact]
    public void A_chosen_app_opens_any_file_in_the_repo_and_a_missing_app_is_ignored()
    {
        var (temp, root) = NewRepo();
        using var _ = temp;
        var app = temp.Write("editor.exe", "");
        Assert.Equal(new LinkAction(LinkKind.CustomApp, Path.Combine(root, "docs", "run.bat"), app), LinkOpening.Decide("docs/run.bat", root, app));
        Assert.Equal(LinkKind.ShowInFolder, LinkOpening.Decide("docs/run.bat", root, Path.Combine(temp.Dir, "gone.exe")).Kind);
        Assert.Equal(LinkKind.Folder, LinkOpening.Decide("docs/", root, app).Kind);
        Assert.Equal(LinkKind.Refused, LinkOpening.Decide("../outside/secret.md", root, app).Kind);
    }

    [Fact]
    public void A_folder_link_inside_the_repo_is_followed_to_the_real_file()
    {
        var (temp, root) = NewRepo();
        using var _ = temp;
        var link = Path.Combine(root, "docs-link");
        MakeLink(link, Path.Combine(root, "docs"));
        try
        {
            Assert.Equal(new LinkAction(LinkKind.DefaultApp, Path.Combine(root, "docs", "readme.md")), LinkOpening.Decide("docs-link/readme.md", root, null));
        }
        finally
        {
            Directory.Delete(link); // the link itself: a recursive delete of the temp folder stumbles on a Windows junction
        }
    }

    [Fact]
    public void A_folder_link_that_leaves_the_repo_is_refused()
    {
        var (temp, root) = NewRepo();
        using var _ = temp;
        var link = Path.Combine(root, "escape");
        MakeLink(link, Path.Combine(temp.Dir, "outside"));
        try
        {
            Assert.Equal(LinkKind.Refused, LinkOpening.Decide("escape/secret.md", root, null).Kind);
            Assert.Equal(LinkKind.Refused, LinkOpening.Decide("escape/", root, null).Kind);
            Assert.Null(LinkOpening.Locate(root, "escape/secret.md"));
        }
        finally
        {
            Directory.Delete(link);
        }
    }

    [Fact]
    public void Locate_gives_the_real_path_of_a_file_or_folder_and_null_for_the_rest()
    {
        var (temp, root) = NewRepo();
        using var _ = temp;
        Assert.Equal(Path.Combine(root, "docs", "run.bat"), LinkOpening.Locate(root, "docs/run.bat"));
        Assert.Equal(Path.Combine(root, "docs"), LinkOpening.Locate(root, "docs/"));
        Assert.Null(LinkOpening.Locate(root, "docs/missing.md"));
        Assert.Null(LinkOpening.Locate(root, "https://example.com"));
    }
}
