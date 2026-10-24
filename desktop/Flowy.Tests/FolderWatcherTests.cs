using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class FolderWatcherTests
{
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(5);

    /// <summary>
    /// Whether saving <paramref name="file"/> wakes a new watcher. A system can take a moment to start reporting after a watcher is made, and a save before that goes
    /// unheard, so the save is made again, up to five times, a second apart.
    /// </summary>
    private static bool NoticedWhenSaved(TempDir temp, string file)
    {
        using var watcher = new FolderWatcher(temp.Dir, TimeSpan.FromMilliseconds(30));
        using var seen = new ManualResetEventSlim();
        watcher.Changed += seen.Set;
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            temp.Write(file, $"name: Save {attempt}{'\n'}");
            if (seen.Wait(TimeSpan.FromSeconds(1), TestContext.Current.CancellationToken)) return true;
        }
        return false;
    }

    [Fact]
    public void Saving_a_file_in_the_folder_is_noticed()
    {
        using var temp = new TempDir();
        Assert.True(NoticedWhenSaved(temp, "model.yaml"));
    }

    [Fact]
    public void A_file_in_a_folder_below_is_noticed_too()
    {
        using var temp = new TempDir();
        Directory.CreateDirectory(Path.Combine(temp.Dir, "flows"));
        Assert.True(NoticedWhenSaved(temp, "flows/a.yaml"));
    }

    [Fact]
    public void A_flow_saved_in_a_folder_of_flows_is_noticed_too()
    {
        using var temp = new TempDir();
        Directory.CreateDirectory(Path.Combine(temp.Dir, "flows", "billing", "refunds"));
        Assert.True(NoticedWhenSaved(temp, "flows/billing/refunds/refund.yaml"));
    }

    [Fact]
    public void A_load_test_run_saved_in_perf_is_noticed_too()
    {
        using var temp = new TempDir();
        Directory.CreateDirectory(Path.Combine(temp.Dir, "perf"));
        Assert.True(NoticedWhenSaved(temp, "perf/ramp.yaml"));
    }

    [Fact]
    public void A_failure_analysis_saved_in_failures_is_noticed_too()
    {
        using var temp = new TempDir();
        Directory.CreateDirectory(Path.Combine(temp.Dir, "failures"));
        Assert.True(NoticedWhenSaved(temp, "failures/ordering.yaml"));
    }

    [Fact]
    public void Several_saves_in_a_burst_wake_it_once()
    {
        using var temp = new TempDir();
        using var watcher = new FolderWatcher(temp.Dir, TimeSpan.FromMilliseconds(300));
        var count = 0;
        using var seen = new ManualResetEventSlim();
        watcher.Changed += () =>
        {
            Interlocked.Increment(ref count);
            seen.Set();
        };
        for (var i = 0; i < 5; i++) temp.Write($"flows/f{i}.yaml", "name: F\n");
        Assert.True(seen.Wait(Patience, TestContext.Current.CancellationToken));
        Thread.Sleep(600);
        Assert.Equal(1, count);
    }

    [Fact]
    public void The_temporary_files_the_canvas_saves_through_are_not_changes()
    {
        using var temp = new TempDir();
        using var watcher = new FolderWatcher(temp.Dir, TimeSpan.FromMilliseconds(30));
        var count = 0;
        watcher.Changed += () => Interlocked.Increment(ref count);
        temp.Write("model.yaml.1234.tmp", "partial");
        Thread.Sleep(500);
        Assert.Equal(0, count);
    }

    [Fact]
    public void Files_that_are_no_part_of_the_model_are_not_changes()
    {
        using var temp = new TempDir();
        using var watcher = new FolderWatcher(temp.Dir, TimeSpan.FromMilliseconds(30));
        var count = 0;
        watcher.Changed += () => Interlocked.Increment(ref count);
        temp.Write("notes.md", "x");
        temp.Write("build/out.txt", "x");
        Thread.Sleep(500);
        Assert.Equal(0, count);
    }

    [Fact]
    public void A_watcher_that_ran_out_of_room_reads_the_folder_again_and_keeps_watching()
    {
        using var temp = new TempDir();
        using var watcher = new FolderWatcher(temp.Dir, TimeSpan.FromMilliseconds(30));
        using var changed = new ManualResetEventSlim();
        Exception? failed = null;
        watcher.Changed += changed.Set;
        watcher.Failed += e => failed = e;
        watcher.Fault(new InternalBufferOverflowException());
        Assert.True(changed.Wait(Patience, TestContext.Current.CancellationToken)); // some changes were lost, so everything is read again
        Assert.Null(failed); // and the watch is not given up
    }

    [Fact]
    public void Any_other_fault_of_the_watcher_is_a_failure()
    {
        using var temp = new TempDir();
        using var watcher = new FolderWatcher(temp.Dir, TimeSpan.FromMilliseconds(30));
        Exception? failed = null;
        watcher.Failed += e => failed = e;
        var why = new IOException("gone");
        watcher.Fault(why);
        Assert.Same(why, failed);
    }

    [Theory]
    [InlineData("model.yaml", false)]
    [InlineData("layout.yaml", false)]
    [InlineData("flows", true)]
    [InlineData("failures", true)]
    [InlineData("perf", true)]
    public void Renaming_a_model_path_away_is_noticed(string name, bool directory)
    {
        using var temp = new TempDir();
        var from = Path.Combine(temp.Dir, name);
        var to = Path.Combine(temp.Dir, "archived");
        if (directory) Directory.CreateDirectory(from);
        else temp.Write(name, "objects:\n");
        using var watcher = new FolderWatcher(temp.Dir, TimeSpan.FromMilliseconds(30));
        using var seen = new ManualResetEventSlim();
        watcher.Changed += seen.Set;
        if (directory) Directory.Move(from, to);
        else File.Move(from, to);
        Assert.True(seen.Wait(Patience, TestContext.Current.CancellationToken));
    }
}
