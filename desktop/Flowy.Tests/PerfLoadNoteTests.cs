using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>The note beside a load number, which the browser writes in Performance.tsx: "Tested", or "Between 600 and 900, estimated".</summary>
public class PerfLoadNoteTests
{
    private static readonly Folder Loaded = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "perf", "flowy"));

    private static LoadRun Run() => Loaded.Runs!.Select(kv => kv.Value).First(r => r.Levels.Count >= 3 && !r.IsTime);

    [Fact]
    public void A_tested_level_says_tested()
    {
        var run = Run();
        Assert.Equal("Tested", PerfView.LoadNote(run, 0));
        Assert.Equal("Tested", PerfView.LoadNote(run, 1));
        Assert.Equal("Tested", PerfView.LoadNote(run, PerfView.Top(run)));
    }

    [Fact]
    public void Between_two_levels_it_names_both_in_the_loads_they_were_tested_at()
    {
        var run = Run();
        Assert.Equal($"Between {run.Levels[0].Load} and {run.Levels[1].Load}, estimated", PerfView.LoadNote(run, 0.5));
        Assert.Equal($"Between {run.Levels[1].Load} and {run.Levels[2].Load}, estimated", PerfView.LoadNote(run, 1.25));
    }

    [Fact]
    public void A_dial_says_the_same_in_its_own_loads()
    {
        var dial = new Dial("orders", "Orders", "orders/min", [600, 900, 1200.5], null, "");
        Assert.Equal("Tested", PerfView.LoadNote(dial, 1));
        Assert.Equal("Between 600 and 900, estimated", PerfView.LoadNote(dial, 0.4));
        Assert.Equal("Between 900 and 1200.5, estimated", PerfView.LoadNote(dial, 1.5));
        Assert.Equal("Tested", PerfView.LoadNote(dial, 99)); // past the end it stays on the last level
    }
}
