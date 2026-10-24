using System.Diagnostics;
using System.Text;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Flowy.App;
using Flowy.Core;

namespace Flowy.Bench;

/// <summary>dotnet run -c Release --project desktop/Flowy.Bench -- panels [shapes]: what the side panels and the folder cost for a big model: code colours, an edit, long lists, a big table.</summary>
internal static class PanelsBench
{
    public static void Run(int shapes)
    {
        var root = Path.Combine(Path.GetTempPath(), $"flowy-panels-bench-{Environment.ProcessId}");
        var dir = Path.Combine(root, "flowy");
        Directory.CreateDirectory(Path.Combine(dir, "flows"));
        Directory.CreateDirectory(Path.Combine(dir, "failures"));
        try
        {
            var model = new StringBuilder("objects:\n  sys-0:\n    type: system\n    name: Big system\n");
            for (var i = 0; i < shapes; i++)
            {
                model.Append($"  app-{i}:\n    type: app\n    in: sys-0\n    name: App {i}\n");
                if (i == 1) AppendSnippets(model);
            }
            model.Append("  big-db:\n    type: store\n    in: sys-0\n    name: Big DB\n    data:\n      - name: events\n        columns: [id, kind, who, what]\n        rows:\n");
            for (var r = 0; r < 4000; r++) model.Append($"          - [e{r}, kind{r % 7}, user{r % 50}, \"something happened to {r}\"]\n");
            model.Append("connections:\n");
            for (var i = 0; i + 1 < shapes; i += 2) model.Append($"  - {{ from: app-{i}, to: app-{i + 1} }}\n");
            // Lines to shapes that are not there: each is a problem in the list.
            var problems = shapes;
            for (var i = 0; i < problems; i++) model.Append($"  - {{ from: app-{i}, to: ghost-{i} }}\n");
            File.WriteAllText(Path.Combine(dir, "model.yaml"), model.ToString());
            for (var f = 0; f < 100; f++)
            {
                var flow = new StringBuilder($"name: Flow {f}\nview: sys-0\nsteps:\n");
                for (var k = 0; k < 10; k++) flow.Append($"  - {{ from: app-{k * 2}, to: app-{k * 2 + 1}, text: Step {k} }}\n");
                File.WriteAllText(Path.Combine(dir, "flows", $"flow-{f}.yaml"), flow.ToString());
            }
            File.WriteAllText(Path.Combine(dir, "failures", "ordering.yaml"),
                "name: Ordering\nscope: sys-0\nmodes:\n  one:\n    mode: It breaks\n    on: app-0\n    severity: 5\n    occurrence: 3\n    detection: 4\n  two:\n    mode: It breaks too\n    on: app-2\n    severity: 6\n    occurrence: 3\n    detection: 4\n");

            using var session = HeadlessUnitTestSession.StartNew(typeof(BenchApp));
            session.Dispatch(() => Measure(dir, shapes), CancellationToken.None).GetAwaiter().GetResult();
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }

    private static void AppendSnippets(StringBuilder model)
    {
        model.Append("    snippets:\n");
        for (var s = 0; s < 6; s++)
        {
            model.Append($"      - title: Snippet {s}\n        language: csharp\n        text: |\n");
            for (var line = 0; line < 130; line++) model.Append($"          public static decimal Fee{s}_{line}(decimal km, string name) => name.Length > {line} ? km * {line}m + Rate : Math.Max(Min, Base + km);\n");
        }
    }

    private static void Measure(string dir, int shapes)
    {
        Console.WriteLine($"{shapes} shapes, {shapes} problems, 100 flows, a 4,000-row table, six 8,000-character snippets");
        double Time(Action act) { var sw = Stopwatch.StartNew(); act(); return sw.Elapsed.TotalMilliseconds; }
        void Row(string what, double ms, string? more = null) => Console.WriteLine($"{what,-62}{ms,9:0.00} ms{(more is null ? "" : "   " + more)}");
        double Median(Func<double> measure, int runs = 5) { var all = Enumerable.Range(0, runs).Select(_ => measure()).Order().ToList(); return all[all.Count / 2]; }

        var code = string.Join('\n', Enumerable.Range(0, 55).Select(line => $"public static decimal Fee{line}(decimal km, string name) => name.Length > {line} ? km * {line}m + Rate : Math.Max(Min, Base + km);"));
        Row($"colour {code.Length} characters of code, the first time", Time(() => Flowy.App.CodeInk.Runs(code, "csharp")));
        Row("  the same code again", Median(() => Time(() => Flowy.App.CodeInk.Runs(code, "csharp"))));

        Folder folder = null!;
        Row("read the folder", Time(() => folder = FolderLoader.Load(dir)));
        Row("read it again", Median(() => Time(() => FolderLoader.Load(dir)), 3));
        var edits = new EditSession(dir);
        var flip = false;
        Row("one edit (rename a shape): the whole pipeline", Median(() =>
        {
            flip = !flip;
            return Time(() => edits.Apply(d => EditOps.PutObject(d, new ObjectInput("app-3", Name: flip ? "App three" : "App 3"))));
        }, 3));

        var reader = new ReaderView();
        var window = new Window { Width = 1400, Height = 900, Content = reader };
        window.Show();
        void Settle() { Dispatcher.UIThread.RunJobs(); AvaloniaHeadlessPlatform.ForceRenderTimerTick(); Dispatcher.UIThread.RunJobs(); }
        Row("open the model in the reader: Load", Time(() => reader.Load(folder, dir)));
        Row("  and what it leaves to do (layout, first frame)", Time(Settle));
        Row("  go into the big system", Time(() => reader.GoTo("sys-0")));
        Row("  and what that leaves to do", Time(Settle));
        Row("a step in the reader (select a shape)", Median(() => Time(() => { reader.Select("app-5"); Settle(); reader.Select("app-6"); Settle(); }) / 2));
        Row("open the shape with six snippets", Time(() => { reader.OpenObject("app-1"); Settle(); }));
        Row("  select another shape and come back", Median(() => Time(() => { reader.OpenObject("app-9"); Settle(); reader.OpenObject("app-1"); Settle(); }) / 2, 3));
        Row("open the store with a 4,000-row table", Time(() => { reader.OpenObject("big-db"); Settle(); }));

        window.KeyPress(Key.M, RawInputModifiers.None, PhysicalKey.M, null);
        Settle();
        var panel = reader.FailuresPanelNow;
        var left = panel.Buttons.FirstOrDefault(b => (Avalonia.Automation.AutomationProperties.GetName(b) ?? "").StartsWith("Not analysed"));
        if (left is not null) Row("show the shapes not analysed", Time(() => { left.RaiseEvent(new RoutedEventArgs(Button.ClickEvent)); Settle(); }), Avalonia.Automation.AutomationProperties.GetName(left));
        window.KeyPress(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);
        Settle();
    }
}
