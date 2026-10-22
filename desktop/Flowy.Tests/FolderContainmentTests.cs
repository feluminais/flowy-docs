using System.Diagnostics;
using System.Runtime.CompilerServices;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>A test that needs the OS to make a link to a folder. Without the right to (Windows without developer mode or a junction), it is skipped, with the reason.</summary>
public sealed class DirectoryLinkFactAttribute : FactAttribute
{
    public DirectoryLinkFactAttribute([CallerFilePath] string? sourceFilePath = null, [CallerLineNumber] int sourceLineNumber = -1) : base(sourceFilePath, sourceLineNumber)
    {
        if (!LinkMaker.CanLinkDirectories) Skip = "this OS or account can't create a symbolic link or a junction to a folder";
    }
}

/// <summary>As <see cref="DirectoryLinkFactAttribute"/>, for a link to a file. Windows junctions are for folders only, so this needs the symbolic link right there.</summary>
public sealed class FileLinkFactAttribute : FactAttribute
{
    public FileLinkFactAttribute([CallerFilePath] string? sourceFilePath = null, [CallerLineNumber] int sourceLineNumber = -1) : base(sourceFilePath, sourceLineNumber)
    {
        if (!LinkMaker.CanLinkFiles) Skip = "this OS or account can't create a symbolic link to a file";
    }
}

internal static class LinkMaker
{
    public static bool CanLinkDirectories { get; } = Probe(false);

    public static bool CanLinkFiles { get; } = Probe(true);

    /// <summary>Makes <paramref name="link"/> a link to the folder <paramref name="target"/>: a symbolic link, or a junction where Windows won't make that.</summary>
    public static void ToDirectory(string link, string target)
    {
        try
        {
            Directory.CreateSymbolicLink(link, target);
        }
        catch (Exception e) when (OperatingSystem.IsWindows() && e is UnauthorizedAccessException or IOException)
        {
            using var mklink = Process.Start(new ProcessStartInfo("cmd.exe") { ArgumentList = { "/c", "mklink", "/J", link, target }, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true })!;
            mklink.StandardOutput.ReadToEnd();
            mklink.WaitForExit();
            if (mklink.ExitCode != 0) throw new IOException($"mklink /J failed with {mklink.ExitCode}");
        }
    }

    public static void ToFile(string link, string target) => File.CreateSymbolicLink(link, target);

    private static bool Probe(bool file)
    {
        using var temp = new TempDir();
        try
        {
            var target = file ? temp.Write("target.txt", "x") : Directory.CreateDirectory(Path.Combine(temp.Dir, "target")).FullName;
            if (file) ToFile(Path.Combine(temp.Dir, "link"), target);
            else ToDirectory(Path.Combine(temp.Dir, "link"), target);
            return true;
        }
        catch (Exception e) when (e is UnauthorizedAccessException or IOException or PlatformNotSupportedException or System.ComponentModel.Win32Exception)
        {
            return false;
        }
    }
}

public class FolderContainmentTests
{
    /// <summary>A copy of the crafted edit case in <c>flowy/</c>, an empty <c>outside/</c> next to it, and the copy's <c>flows/</c> replaced by a link to <c>outside/</c>.</summary>
    private static (TempDir Temp, string Dir, string Outside) WithLinkedFlows()
    {
        var temp = new TempDir();
        var source = Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "edit", "flowy");
        foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
            temp.Write(Path.Combine("flowy", Path.GetRelativePath(source, file)), File.ReadAllText(file));
        var dir = Path.Combine(temp.Dir, "flowy");
        var outside = Directory.CreateDirectory(Path.Combine(temp.Dir, "outside")).FullName;
        foreach (var file in Directory.GetFiles(Path.Combine(dir, "flows"))) File.Copy(file, Path.Combine(outside, Path.GetFileName(file)));
        Directory.Delete(Path.Combine(dir, "flows"), true);
        LinkMaker.ToDirectory(Path.Combine(dir, "flows"), outside);
        foreach (var file in Directory.GetFiles(outside)) File.Delete(file);
        return (temp, dir, outside);
    }

    [DirectoryLinkFact]
    public void A_flows_folder_that_is_a_link_outside_is_not_read_and_the_load_stops_naming_the_file()
    {
        var (temp, dir, outside) = WithLinkedFlows();
        using var _ = temp;
        File.WriteAllText(Path.Combine(outside, "evil.yaml"), "name: Evil\nview: root\nsteps: []\n");
        var e = Assert.Throws<ParseError>(() => FolderLoader.Load(dir));
        Assert.Equal("flows/evil.yaml", e.File);
        Assert.Equal("points outside the folder", e.Reason);
        Assert.Equal("flows/evil.yaml: points outside the folder", e.Message);
    }

    [DirectoryLinkFact]
    public void A_failures_folder_that_is_a_link_outside_is_not_read_and_the_file_is_a_problem()
    {
        var (temp, dir, outside) = WithLinkedFlows();
        using var _ = temp;
        Directory.Delete(Path.Combine(dir, "flows"));
        Directory.CreateDirectory(Path.Combine(dir, "flows"));
        LinkMaker.ToDirectory(Path.Combine(dir, "failures"), outside);
        File.WriteAllText(Path.Combine(outside, "leak.yaml"), "name: Leak\nmodes: {}\n");
        var folder = FolderLoader.Load(dir);
        Assert.Empty(folder.Model.Failures);
        Assert.Contains(new Problem("failures/leak.yaml", null, "points outside the folder"), folder.FailureProblems!);
    }

    [DirectoryLinkFact]
    public void A_save_into_a_flows_folder_that_is_a_link_outside_is_refused_and_writes_nothing()
    {
        var (temp, dir, outside) = WithLinkedFlows();
        using var _ = temp;
        var thrown = Assert.Throws<OpError>(() => FileStore.Save(dir, "flows/pay.yaml", "name: Pay\n", null));
        Assert.Equal("\"flows/pay.yaml\" points outside the folder", thrown.Message);

        var session = new EditSession(dir);
        var result = session.Apply(d => EditOps.PutFlow(d, "pay", "Customer pays", "root", [EditOps.NewStep("customer", "pay", "Pays")]));
        Assert.Contains("flows/pay.yaml", result.Message);
        Assert.Contains("points outside the folder", result.Message);
        Assert.False(session.CanUndo);
        Assert.Empty(Directory.GetFileSystemEntries(outside));
    }

    [DirectoryLinkFact]
    public void A_delete_through_a_link_outside_is_refused_and_the_file_stays()
    {
        var (temp, dir, outside) = WithLinkedFlows();
        using var _ = temp;
        var kept = Path.Combine(outside, "pay.yaml");
        File.WriteAllText(kept, "name: Pay\n");
        var thrown = Assert.Throws<OpError>(() => FileStore.Save(dir, "flows/pay.yaml", null, FileStore.Hash("name: Pay\n")));
        Assert.Equal("\"flows/pay.yaml\" points outside the folder", thrown.Message);
        Assert.True(File.Exists(kept));
    }

    [DirectoryLinkFact]
    public void A_link_that_stays_inside_the_folder_still_works()
    {
        using var temp = new TempDir();
        temp.Write("flowy/model.yaml", "objects:\n  a: { type: actor, name: A }\n");
        temp.Write("flowy/shared/pay.yaml", "name: Pay\nview: root\nsteps:\n  - { from: a, to: a, label: Pays }\n");
        var dir = Path.Combine(temp.Dir, "flowy");
        LinkMaker.ToDirectory(Path.Combine(dir, "flows"), Path.Combine(dir, "shared"));
        var folder = FolderLoader.Load(dir);
        Assert.DoesNotContain(folder.Problems, p => p.Message == "points outside the folder");
        Assert.Equal(["pay"], folder.Model.Flows.Keys);
        Assert.Equal(["pay.yaml"], FileStore.FlowFiles(dir));

        FileStore.Save(dir, "flows/next.yaml", "name: Next\n", null);
        Assert.Equal("name: Next\n", File.ReadAllText(Path.Combine(dir, "shared", "next.yaml")));
    }

    [DirectoryLinkFact]
    public void A_model_folder_opened_through_a_link_still_works()
    {
        using var temp = new TempDir();
        temp.Write("repo/flowy/model.yaml", "objects:\n  a: { type: actor, name: A }\n");
        var viaLink = Path.Combine(temp.Dir, "link-to-repo");
        LinkMaker.ToDirectory(viaLink, Path.Combine(temp.Dir, "repo"));
        var dir = Path.Combine(viaLink, "flowy");
        var folder = FolderLoader.Load(dir);
        Assert.Equal(["a"], folder.Model.Objects.Keys);
        Assert.Empty(folder.Problems);

        Assert.NotNull(FileStore.Save(dir, "flows/new.yaml", "name: New\n", null));
        Assert.True(File.Exists(Path.Combine(temp.Dir, "repo", "flowy", "flows", "new.yaml")));
    }

    [DirectoryLinkFact]
    public void A_link_in_the_middle_of_a_path_is_followed_before_the_check()
    {
        using var temp = new TempDir();
        temp.Write("flowy/model.yaml", "objects:\n  a: { type: actor, name: A }\n");
        temp.Write("elsewhere/inner/x.yaml", "name: X\n");
        var dir = Path.Combine(temp.Dir, "flowy");
        Directory.CreateDirectory(Path.Combine(dir, "flows"));
        LinkMaker.ToDirectory(Path.Combine(dir, "flows", "deep"), Path.Combine(temp.Dir, "elsewhere"));
        Assert.False(FolderContainment.IsInside(dir, "flows/deep/inner/x.yaml"));
        Assert.False(FolderContainment.IsInside(dir, "flows/deep/inner/not-there-yet.yaml"));
        Assert.True(FolderContainment.IsInside(dir, "flows/not-there-yet.yaml"));
    }

    [FileLinkFact]
    public void A_flow_file_that_is_a_link_outside_is_reported_and_not_read_or_written()
    {
        using var temp = new TempDir();
        temp.Write("flowy/model.yaml", "objects:\n  a: { type: actor, name: A }\n");
        var secret = temp.Write("outside/secret.yaml", "name: Secret\nview: root\nsteps: []\n");
        Directory.CreateDirectory(Path.Combine(temp.Dir, "flowy", "flows"));
        LinkMaker.ToFile(Path.Combine(temp.Dir, "flowy", "flows", "pay.yaml"), secret);
        var dir = Path.Combine(temp.Dir, "flowy");

        // As the TypeScript loader does, a flow file that leads out stops the load and names the file.
        var refused = Assert.Throws<ParseError>(() => FolderLoader.Load(dir));
        Assert.Equal("flows/pay.yaml", refused.File);
        Assert.Equal("points outside the folder", refused.Reason);

        var thrown = Assert.Throws<OpError>(() => FileStore.Save(dir, "flows/pay.yaml", "name: Changed\n", FileStore.Hash("name: Secret\nview: root\nsteps: []\n")));
        Assert.Equal("\"flows/pay.yaml\" points outside the folder", thrown.Message);
        Assert.Equal("name: Secret\nview: root\nsteps: []\n", File.ReadAllText(secret));
    }

    [Fact]
    public void A_file_that_is_not_there_yet_is_judged_by_its_nearest_existing_parent()
    {
        using var temp = new TempDir();
        var dir = Directory.CreateDirectory(Path.Combine(temp.Dir, "flowy")).FullName;
        Assert.True(FolderContainment.IsInside(dir, "flows/a.yaml"));
        Assert.True(FolderContainment.IsInside(dir, "model.yaml"));
        Assert.False(FolderContainment.IsInside(dir, "../outside.yaml"));
        // a folder whose name starts the same is not inside it
        Assert.False(FolderContainment.IsInside(dir, "../flowy-other/a.yaml"));
    }
}
