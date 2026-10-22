using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>The one write a run file takes: its <c>compare</c> tag, in place, through a temporary file and only if the file is still as it was read.</summary>
public class RunCompareWriteTests
{
    private const string Run = "# a run\nname: Run\nunit: req/s\nlevels:\n  - { load: 1 }\n  - { load: 2 }\n";

    private static (TempDir Temp, string Dir) Folder()
    {
        var temp = new TempDir();
        temp.Write(Path.Combine("flowy", "perf", "now.yaml"), Run);
        temp.Write(Path.Combine("flowy", "perf", "before.yaml"), Run);
        return (temp, Path.Combine(temp.Dir, "flowy"));
    }

    private static string Text(string dir, string id) => File.ReadAllText(Path.Combine(dir, "perf", id + ".yaml"));

    [Fact]
    public void A_tag_goes_in_as_a_line_of_its_own_and_everything_else_stays()
    {
        var (temp, dir) = Folder();
        using var _ = temp;
        var version = FileStore.Read(dir, "perf/now.yaml").Version;
        var next = FileStore.SaveRunCompare(dir, "now", new CompareTag("before"), version);
        Assert.Equal(Run + "compare: before\n", Text(dir, "now"));
        Assert.Equal(FileStore.Hash(Text(dir, "now")), next);
        Assert.Equal(Run, Text(dir, "before")); // the other run is not touched
        Assert.Empty(Directory.GetFiles(dir, "*.tmp", SearchOption.AllDirectories));
    }

    [Fact]
    public void Taking_the_tag_out_gives_back_the_text_that_was_there_before()
    {
        var (temp, dir) = Folder();
        using var _ = temp;
        var version = FileStore.SaveRunCompare(dir, "now", new CompareTag("before", "Faster"), FileStore.Read(dir, "perf/now.yaml").Version);
        FileStore.SaveRunCompare(dir, "now", null, version);
        Assert.Equal(Run, Text(dir, "now"));
    }

    [Fact]
    public void A_file_that_moved_on_since_it_was_read_is_not_written()
    {
        var (temp, dir) = Folder();
        using var _ = temp;
        var version = FileStore.Read(dir, "perf/now.yaml").Version;
        File.WriteAllText(Path.Combine(dir, "perf", "now.yaml"), Run + "about: edited elsewhere\n");
        var conflict = Assert.Throws<VersionConflict>(() => FileStore.SaveRunCompare(dir, "now", new CompareTag("before"), version));
        Assert.Contains("perf/now.yaml", conflict.Message);
        Assert.Equal(Run + "about: edited elsewhere\n", Text(dir, "now"));
    }

    [Fact]
    public void A_run_that_is_gone_is_a_conflict_and_a_file_that_cannot_be_read_is_left_alone()
    {
        var (temp, dir) = Folder();
        using var _ = temp;
        Assert.Throws<VersionConflict>(() => FileStore.SaveRunCompare(dir, "nope", new CompareTag("before"), null));
        File.WriteAllText(Path.Combine(dir, "perf", "now.yaml"), "- a\n- b\n");
        var version = FileStore.Read(dir, "perf/now.yaml").Version;
        Assert.Throws<ParseError>(() => FileStore.SaveRunCompare(dir, "now", new CompareTag("before"), version));
        Assert.Equal("- a\n- b\n", Text(dir, "now"));
    }

    [Fact]
    public void Only_a_valid_run_id_is_written()
    {
        var (temp, dir) = Folder();
        using var _ = temp;
        Assert.Throws<InvalidOperationException>(() => FileStore.SaveRunCompare(dir, "../model", new CompareTag("before"), null));
    }
}
