using System.Diagnostics;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using Flowy.App;
using Flowy.Core;

namespace Flowy.Bench;

/// <summary>
/// dotnet run -c Release --project desktop/Flowy.Bench -- zoom [folder]: the longest frame of a zoom into each view of a folder (Plum by default), which is the pause
/// between its two halves, and the frame it lands in, on the first visit and a later one. "Idle" lets the reader sit on the view around it first, as a person does before a double-click; "Straight" goes in at once.
/// EXPLORER=1 opens the Explorer, which follows the canvas. ONLY=idle or ONLY=straight runs one of the two, so its first visits lay the views out.
/// </summary>
internal static class ZoomBench
{
    public static void Run(string? dir)
    {
        dir ??= Path.Combine(FindRepo(), "docs", "demo", "flowy");
        using var session = HeadlessUnitTestSession.StartNew(typeof(BenchApp));
        session.Dispatch(() => Measure(dir), CancellationToken.None).GetAwaiter().GetResult();
    }

    private static string FindRepo()
    {
        var at = new DirectoryInfo(AppContext.BaseDirectory);
        while (at is not null && !File.Exists(Path.Combine(at.FullName, "package.json"))) at = at.Parent;
        return at?.FullName ?? throw new InvalidOperationException("Run it from inside the repository, or name the folder.");
    }

    private static void Measure(string dir)
    {
        double Time(Action act) { var sw = Stopwatch.StartNew(); act(); return sw.Elapsed.TotalMilliseconds; }
        void Settle() { Dispatcher.UIThread.RunJobs(); AvaloniaHeadlessPlatform.ForceRenderTimerTick(); Dispatcher.UIThread.RunJobs(); }
        // What stands between the swap and the next frame: the jobs above Background (layout, render). Idle work (boxes made ahead) waits for gaps between frames.
        void Frame() { Dispatcher.UIThread.RunJobs(DispatcherPriority.Input); AvaloniaHeadlessPlatform.ForceRenderTimerTick(); Dispatcher.UIThread.RunJobs(DispatcherPriority.Input); }
        // What a person waiting a moment gives the app: idle jobs and the background layouts, until the stage has not grown for a second.
        void Idle(ReaderView reader)
        {
            var clock = Stopwatch.StartNew();
            var (last, still) = (-1, 0);
            while (clock.Elapsed < TimeSpan.FromSeconds(10) && still < 200)
            {
                Dispatcher.UIThread.RunJobs();
                Thread.Sleep(5);
                var now = reader.Canvas.ControlsOnStage;
                still = now == last ? still + 1 : 0;
                last = now;
            }
        }

        var folder = FolderLoader.Load(dir);
        var model = folder.Model;
        var views = model.Objects.Keys.Where(id => model.Objects.Any(o => o.Value.In == id)).ToList();
        Console.WriteLine($"{dir}: {views.Count} views{(Environment.GetEnvironmentVariable("EXPLORER") is not null ? ", Explorer open" : "")}");
        Console.WriteLine($"{"",-24}{"",6}{"first visit (ms)",22}{"later visit (ms)",22}");
        Console.WriteLine($"{"",-8}{"view",-16}{"boxes",6}{"longest",12}{"landing",10}{"longest",12}{"landing",10}");
        var only = Environment.GetEnvironmentVariable("ONLY");
        foreach (var idle in new[] { true, false }.Where(i => only is null || only == (i ? "idle" : "straight")))
        {
            // A new reader each round, so the first visit is a first visit; the layouts are kept between rounds, so only the first round lays out.
            var reader = new ReaderView();
            var window = new Window { Width = 1400, Height = 900, Content = reader };
            window.Show();
            using var target = new RenderTargetBitmap(new PixelSize(1400, 900));
            reader.Load(folder, dir);
            if (Environment.GetEnvironmentVariable("EXPLORER") is not null) reader.ClickRail(PanelTab.Explorer);
            reader.GoTo(Names.Root);
            Settle();
            target.Render(window);
            foreach (var v in views)
            {
                // A real zoom (a double-click's OpenBox), driven a frame at a time at about 60 a second. What it gives back is the longest frame while the move is on
                // (the swap between its halves is one of them) and the frame it lands in. Idle work (boxes made ahead) runs in the gaps and is not counted.
                (double Longest, double Landing) Visit()
                {
                    var parent = Views.ParentOf(model, v);
                    reader.GoTo(parent);
                    Settle();
                    target.Render(window);
                    if (idle) Idle(reader);
                    reader.OpenBox(v);
                    var (longest, landing) = (0.0, 0.0);
                    var clock = Stopwatch.StartNew();
                    while (clock.Elapsed < TimeSpan.FromSeconds(5))
                    {
                        var moving = reader.IsMoving;
                        var ms = Time(() => { Frame(); target.Render(window); });
                        if (moving && !reader.IsMoving) landing = ms;
                        else if (moving) longest = Math.Max(longest, ms);
                        else break;
                        var gap = Stopwatch.StartNew();
                        Dispatcher.UIThread.RunJobs();
                        Thread.Sleep(Math.Max(0, 16 - (int)(ms + gap.Elapsed.TotalMilliseconds)));
                    }
                    Settle();
                    return (longest, landing);
                }
                var first = Visit();
                var later = Visit();
                Console.WriteLine($"{(idle ? "Idle" : "Straight"),-8}{v,-16}{SceneBuilder.Build(model, v).Boxes.Count,6}{first.Longest,12:0.0}{first.Landing,10:0.0}{later.Longest,12:0.0}{later.Landing,10:0.0}");
            }
            window.Close();
        }
    }
}
