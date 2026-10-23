using System.Diagnostics;
using System.Text;
using Flowy.Core;

if (args.Length > 0 && args[0] == "canvas")
{
    Flowy.Bench.CanvasBench.Run(args.Length > 1 ? int.Parse(args[1]) : 300);
    return;
}

// dotnet run -c Release --project desktop/Flowy.Bench -- [systems apps components lines flows levels runObjects runLines]
int Arg(int i, int d) => args.Length > i ? int.Parse(args[i]) : d;
int systems = Arg(0, 10), apps = Arg(1, 10), components = Arg(2, 20), lines = Arg(3, 4000), flows = Arg(4, 200), levels = Arg(5, 20), runObjects = Arg(6, 400), runLines = Arg(7, 400);

var rnd = new Random(42);
var root = Path.Combine(Path.GetTempPath(), $"flowy-bench-{Environment.ProcessId}");
var dir = Path.Combine(root, "flowy");
Directory.CreateDirectory(Path.Combine(dir, "flows"));
Directory.CreateDirectory(Path.Combine(dir, "perf"));
try
{
    var comps = new List<string>();
    var sb = new StringBuilder("objects:\n");
    for (var s = 0; s < systems; s++)
    {
        sb.Append($"  s{s}:\n    type: system\n    name: System {s}\n");
        for (var a = 0; a < apps; a++)
        {
            sb.Append($"  s{s}-a{a}:\n    type: app\n    in: s{s}\n    name: App {s}.{a}\n");
            for (var c = 0; c < components; c++)
            {
                sb.Append($"  s{s}-a{a}-c{c}:\n    type: component\n    in: s{s}-a{a}\n    name: Component {s}.{a}.{c}\n");
                comps.Add($"s{s}-a{a}-c{c}");
            }
        }
    }
    sb.Append("connections:\n");
    var pairs = new List<(string, string)>();
    var seen = new HashSet<(string, string)>();
    while (pairs.Count < lines)
    {
        var f = comps[rnd.Next(comps.Count)];
        var t = comps[rnd.Next(comps.Count)];
        if (f == t || !seen.Add((f, t))) continue;
        pairs.Add((f, t));
        sb.Append($"  - {{ from: {f}, to: {t} }}\n");
    }
    File.WriteAllText(Path.Combine(dir, "model.yaml"), sb.ToString());
    for (var i = 0; i < flows; i++)
    {
        var fs = new StringBuilder($"name: Flow {i}\nview: root\nsteps:\n");
        for (var k = 0; k < 20; k++)
        {
            var (f, t) = pairs[rnd.Next(pairs.Count)];
            fs.Append($"  - {{ from: {f}, to: {t}, text: Step {k} }}\n");
        }
        File.WriteAllText(Path.Combine(dir, "flows", $"flow-{i}.yaml"), fs.ToString());
    }
    var rs = new StringBuilder("name: Big run\nunit: req/s\nlevels:\n");
    for (var l = 0; l < levels; l++)
    {
        rs.Append($"  - load: {100 * (l + 1)}\n    overall: {{ rate: {10 * l + 1}, p50: 40, p95: 100, errors: 0 }}\n    objects:\n");
        foreach (var o in comps.Take(runObjects)) rs.Append($"      {o}: {{ util: {Math.Min(0.99, 0.02 * l + rnd.NextDouble() * 0.05):0.###}, errors: 0 }}\n");
        rs.Append("    connections:\n");
        foreach (var (f, t) in pairs.Take(runLines)) rs.Append($"      - {{ from: {f}, to: {t}, rate: {rnd.Next(1, 300)}, p50: {rnd.Next(1, 90)}, p95: {rnd.Next(90, 400)}, errors: 0 }}\n");
    }
    File.WriteAllText(Path.Combine(dir, "perf", "big.yaml"), rs.ToString());
    Console.WriteLine($"{systems * (1 + apps * (1 + components))} shapes, {lines} lines, {flows} flows, one run of {levels} levels x {runObjects} shapes x {runLines} lines");

    double Once(Action act) { var sw = Stopwatch.StartNew(); act(); return sw.Elapsed.TotalMilliseconds; }
    double Median(Action act, int runs = 7)
    {
        act();
        var times = Enumerable.Range(0, runs).Select(_ => Once(act)).Order().ToList();
        return times[times.Count / 2];
    }
    void Row(string what, double ms) => Console.WriteLine($"{what,-62}{ms,10:0.00} ms");

    Console.WriteLine("\nreading the folder");
    Folder folder = null!;
    Row("first read", Once(() => folder = FolderLoader.Load(dir)));
    Row("read again, nothing changed", Median(() => FolderLoader.Load(dir), 5));
    var flow = Path.Combine(dir, "flows", "flow-0.yaml");
    var flip = false;
    Row("read after one flow file changed", Median(() => { File.AppendAllText(flow, flip ? "\n" : "\n# x\n"); flip = !flip; FolderLoader.Load(dir); }, 5));
    Row("is one file inside the folder", Median(() => { for (var i = 0; i < 100; i++) FolderContainment.IsInside(dir, "flows/flow-1.yaml"); }) / 100);

    var model = folder.Model;
    var runsMap = folder.Runs!;
    var run = runsMap["big"];
    Console.WriteLine("\nthe Performance tab");
    var at = 100.0 * levels / 2 + 33;
    Row("Interpolate at a load (each frame of a ramp)", Median(() => Perf.Interpolate(run, at)));
    Row("RollUp of a level the tab has not asked for before", Median(() => Perf.RollUp(model, run.Levels[0] with { }, Names.Root)));
    Row("select a shape: its readings, drawn twice", Median(() => { for (var i = 0; i < 2; i++) foreach (var k in new[] { "util", "queue", "errors" }) PerfView.BoxSeries(model, run, Names.Root, comps[0], k); }));
    Row("CheckRun", Median(() => Perf.CheckRun("big", run, model)));

    Console.WriteLine("\nthe canvas");
    var view = "s0-a0";
    var saved = new Dictionary<string, IReadOnlyDictionary<string, LayoutPoint>>
    {
        [view] = Views.Compute(model, view).Members.Select((id, i) => (id, new LayoutPoint(i % 10 * 220, i / 10 * 100))).ToDictionary(p => p.id, p => p.Item2),
    };
    var withLayout = new Model { Objects = model.Objects, Connections = model.Connections, Meta = model.Meta, Flows = model.Flows, Failures = model.Failures, Layout = saved };
    Row($"Build a view of {Views.Compute(model, view).Members.Count} shapes, every box saved", Median(() => SceneBuilder.Build(withLayout, view)));
    var newWith = new Model { Objects = model.Objects, Connections = model.Connections.Append(new Connection("s1", "s0-a0", null)).ToList(), Meta = model.Meta, Flows = model.Flows, Failures = model.Failures, Layout = saved };
    Row("Build the same view when its layout has to be worked out", Once(() => SceneBuilder.Build(newWith, view)));
}
finally
{
    Directory.Delete(root, true);
}
