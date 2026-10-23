namespace Flowy.Core;

/// <summary>What a run says that the rest of the model doesn't back up. Twin of src/core/perf/check.ts.</summary>
public static partial class Perf
{
    /// <summary>
    /// What a run says about other runs, which one run alone can't see: each run an adder lists must be a load run of its own (not missing, not a run over time, not another adder, not
    /// tested with several sources), and two of them may not draw in one colour. A <c>compare</c> must name another run that is there. An adder with fewer than two runs it can add can't be played: the loader leaves it out (see
    /// <see cref="DialsOf"/>). Each problem names the run it is about.
    /// </summary>
    public static IReadOnlyList<Problem> CheckRuns(IdMap<LoadRun> runs)
    {
        var problems = new List<Problem>();
        foreach (var (id, run) in runs)
        {
            void Add(string message) => problems.Add(new Problem(FolderLayout.PerfFile(id), null, message));
            if (run.Compare is { } tag)
            {
                if (tag.With == id) Add("compare points at this run itself");
                else if (!runs.Contains(tag.With)) Add($"compare \"{Brief(tag.With)}\" is not a run");
            }
            if (run.Adds is not { } adds) continue;
            var good = new List<string>();
            foreach (var part in adds)
            {
                if (WhyNotAdded(runs, part) is { } why) Add($"adds \"{Brief(part)}\", {why}");
                else good.Add(part);
            }
            if (good.Count < 2) Add("can't be played: fewer than two of the runs it adds can be added");
            else SharedColors([.. good.Select(part => runs[part].Source?.Color)], [.. good.Select(part => runs[part].Name)], Add);
        }
        return problems;
    }

    /// <summary>Why a run can't be one of those an adder adds, or null when it can: it is a load run with levels of its own, and one source.</summary>
    private static string? WhyNotAdded(IdMap<LoadRun> runs, string id)
    {
        if (!runs.TryGetValue(id, out var run)) return "which is not a run";
        if (run.Adds is not null) return "which adds runs itself";
        if (run.Sources is not null) return "which is tested with several sources";
        if (run.IsTime) return "which is a run over time";
        return null;
    }

    /// <summary>
    /// What a run says that the model doesn't back up: an <c>entry</c> or an object that isn't there, a connection that isn't one of the model's.
    /// Each is reported once, however many levels repeat it.
    /// </summary>
    public static IReadOnlyList<Problem> CheckRun(string id, LoadRun run, Model model)
    {
        var file = FolderLayout.PerfFile(id);
        var problems = new List<Problem>();
        var said = new HashSet<string>();
        void Once(string message)
        {
            if (said.Add(message)) problems.Add(new Problem(file, null, message));
        }
        if (run.Entry is { } entry && model.GetObject(entry) is null) Once($"entry \"{entry}\" is not an object");
        foreach (var (sid, info) in run.Sources ?? new IdMap<SourceInfo>())
            if (info.Entry is { } sourceEntry && model.GetObject(sourceEntry) is null) Once($"source {sid}: entry \"{sourceEntry}\" is not an object");
        foreach (var level in run.Levels)
        {
            foreach (var oid in level.Objects.Keys)
                if (model.GetObject(oid) is null) Once($"unknown object \"{oid}\"");
            foreach (var c in level.Connections)
            {
                var unknown = new[] { c.From, c.To }.Where(end => model.GetObject(end) is null).ToList();
                foreach (var end in unknown) Once($"unknown object \"{end}\"");
                if (unknown.Count == 0 && !HasConnection(model, c.From, c.To)) Once($"{c.From} → {c.To} is not a connection in the model");
            }
        }
        // A shape deleted after the run was written shows up here at the next load, never as a crash: runs are outside the edit pipeline.
        foreach (var e in run.Events)
            if (model.GetObject(e.On) is null) Once($"unknown object \"{e.On}\"");
        return problems;
    }
}
