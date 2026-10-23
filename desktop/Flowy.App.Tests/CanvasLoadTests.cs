using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>What the canvas draws for a load (desktop/fixtures/cases/perf): strain outlines and queue numbers on shapes, thickness on lines, and particles.</summary>
public class CanvasLoadTests
{
    private static string Shop => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "perf", "flowy");

    /// <summary>Motion on for as long as it is held: the tests run on one thread and share the environment.</summary>
    private sealed class Motion : IDisposable
    {
        private Motion() => Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0");

        public static Motion On() => new();

        public void Dispose() => Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
    }

    private static (CanvasView Canvas, Folder Folder) Open(string view = "shop")
    {
        var folder = FolderLoader.Load(Shop);
        var canvas = new CanvasView();
        new Window { Width = 1000, Height = 700, Content = canvas }.Show();
        canvas.SetScene(SceneBuilder.Build(folder.Model, view, null, folder.Problems, new Focus()), "straight", []);
        Dispatcher.UIThread.RunJobs();
        return (canvas, folder);
    }

    /// <summary>The run with every call that has a rate weighing 1000 bytes: the blobs count the data, so a run with no sizes has none, and with these the data a second is the calls a second.</summary>
    private static LoadRun Sized(LoadRun run) => run with { Levels = [.. run.Levels.Select(l => l with { Connections = [.. l.Connections.Select(c => c.Rate is not null && c.Bytes is null ? c with { Bytes = 1000 } : c)] })] };

    private static Traffic Blobs(Model model, LoadRun run, double load, string view) => Perf.TrafficFor(model, Sized(run), load, view, LoadMeasure.Data, 1000);

    private static Traffic Load(Folder folder, string run, double load, string view = "shop") => Blobs(folder.Model, folder.Runs![run], load, view);

    [AvaloniaFact]
    public void A_picked_or_lit_line_keeps_the_thickness_its_traffic_gives_it_as_in_the_browser()
    {
        Assert.Equal(1.5, BackLayer.ThicknessOf(false, false, null)); // no load: as always
        Assert.Equal(2, BackLayer.ThicknessOf(false, true, null));
        Assert.Equal(2.5, BackLayer.ThicknessOf(true, false, null)); // a lit line is a little bolder, with no halo
        Assert.Equal(6, BackLayer.ThicknessOf(false, false, 6));
        Assert.Equal(6, BackLayer.ThicknessOf(false, true, 6)); // picked or hovered: still as thick as its calls make it
        Assert.Equal(1.2, BackLayer.ThicknessOf(false, true, 1.2)); // a quiet line stays thin
        Assert.Equal(6, BackLayer.ThicknessOf(true, false, 6));
    }

    [AvaloniaFact]
    public void A_load_outlines_the_shapes_it_measured_and_numbers_the_queue_and_leaves_the_rest_plain()
    {
        var (canvas, folder) = Open();
        canvas.ShowLoad(Load(folder, "ramp", 100));
        Assert.Equal((true, null), ((BoxControl)canvas.BoxControlFor("worker")!).PerfShown);
        Assert.Equal((true, "3"), ((BoxControl)canvas.BoxControlFor("web")!).PerfShown); // a shape can be strained and have a queue
        Assert.Equal((false, "40"), ((BoxControl)canvas.BoxControlFor("queue")!).PerfShown); // measured by its length only: a number and no colour
        Assert.Equal((false, null), ((BoxControl)canvas.BoxControlFor("customer")!).PerfShown); // nobody measured it
        Assert.Equal((false, null), ((BoxControl)canvas.BoxControlFor("gateway")!).PerfShown);
        canvas.ShowLoad(null);
        Assert.Equal((false, null), ((BoxControl)canvas.BoxControlFor("worker")!).PerfShown);
        Assert.Equal((false, null), ((BoxControl)canvas.BoxControlFor("queue")!).PerfShown);
        Assert.Null(canvas.Load);
    }

    [AvaloniaFact]
    public void Busy_lines_are_drawn_thicker_than_quiet_ones_and_a_line_with_no_traffic_is_as_usual()
    {
        var (canvas, folder) = Open();
        canvas.ShowLoad(Load(folder, "ramp", 100));
        var busy = canvas.LineWidth("web", "db");
        Assert.True(busy is > 1.5);
        Assert.True(canvas.LineWidth("queue", "worker") < busy); // 5 calls a second against 140
        canvas.ShowLoad(null);
        Assert.Null(canvas.LineWidth("web", "db"));
    }

    [AvaloniaFact]
    public void Particles_go_faint_under_a_label_and_behind_a_shape_their_line_does_not_end_at()
    {
        var label = new Flowy.Core.Rect(100, 50, 40, 16);
        IReadOnlyList<Flowy.Core.Rect> labels = [label];
        Assert.Equal(1, TrafficLayer.BehindOf([], labels, 120, 58, 3)); // well inside the label
        Assert.Equal(0, TrafficLayer.BehindOf([], labels, 90, 58, 3)); // clear of it
        var edge = TrafficLayer.BehindOf([], labels, 100, 58, 3); // on its edge: half way, and it grows as the particle goes in
        Assert.Equal(0.5, edge, 9);
        Assert.True(TrafficLayer.BehindOf([], labels, 102, 58, 3) > edge);
        var shape = new TrafficLayer.ShapeCover("a", new Flowy.Core.Rect(0, 0, 80, 40), null);
        Assert.Equal(1, TrafficLayer.BehindOf([shape], [], 40, 20, 3));
        Assert.Equal(0, TrafficLayer.BehindOf([shape], [], 120, 20, 3));
        Assert.Equal(1, TrafficLayer.BehindOf([shape], labels, 120, 58, 3)); // the most of any
    }

    [AvaloniaFact]
    public void The_labels_showing_are_the_ones_traffic_runs_under()
    {
        var (canvas, folder) = Open();
        Assert.Empty(canvas.LabelRects); // no label shows until a shape or a line is picked
        canvas.SetScene(SceneBuilder.Build(folder.Model, "shop", null, folder.Problems, new Focus(Box: "worker")), "straight", []);
        Dispatcher.UIThread.RunJobs();
        Assert.NotEmpty(canvas.LabelRects); // the worker's lines show theirs
        Assert.All(canvas.LabelRects, r => Assert.True(r.Width > 8 && r.Height > 4));
        canvas.SetScene(SceneBuilder.Build(folder.Model, "shop", null, folder.Problems, new Focus()), "straight", []);
        Dispatcher.UIThread.RunJobs();
        Assert.Empty(canvas.LabelRects);
    }

    [AvaloniaFact]
    public void Particles_run_along_the_lines_with_motion_and_stop_when_the_load_goes()
    {
        using var motion = Motion.On();
        var (canvas, folder) = Open();
        canvas.ShowLoad(Load(folder, "ramp", 100));
        var (particles, running) = canvas.TrafficNow;
        Assert.True(running);
        Assert.True(particles > 10, $"{particles} particles"); // a new line starts with its particles spread along it
        canvas.ShowLoad(null);
        Assert.Equal((0, false), canvas.TrafficNow);
    }

    [AvaloniaFact]
    public void Particles_wait_while_the_window_is_minimised_and_run_again_when_it_is_back()
    {
        using var motion = Motion.On();
        var (canvas, folder) = Open();
        var window = (Window)TopLevel.GetTopLevel(canvas)!;
        canvas.ShowLoad(Load(folder, "ramp", 100));
        Assert.True(canvas.TrafficNow.Running);
        window.WindowState = WindowState.Minimized;
        AvaloniaHeadlessPlatform.ForceRenderTimerTick(); // the next frame finds it minimised and stops asking for more
        Dispatcher.UIThread.RunJobs();
        Assert.False(canvas.TrafficNow.Running);
        Assert.True(canvas.TrafficNow.Particles > 10); // what runs on the lines is kept
        canvas.ShowLoad(Load(folder, "ramp", 200)); // a load that changes meanwhile does not start it either
        Assert.False(canvas.TrafficNow.Running);
        window.WindowState = WindowState.Normal;
        Assert.True(canvas.TrafficNow.Running);
    }

    [AvaloniaFact]
    public void Without_motion_there_are_no_particles_but_the_outline_and_thickness_stay()
    {
        var (canvas, folder) = Open();
        canvas.ShowLoad(Load(folder, "ramp", 100));
        Assert.Equal((0, false), canvas.TrafficNow);
        Assert.True(((BoxControl)canvas.BoxControlFor("worker")!).PerfShown.Strained);
        Assert.True(canvas.LineWidth("web", "db") > 1.5);
    }

    [AvaloniaFact]
    public void A_scene_drawn_again_keeps_the_load_and_one_for_another_view_takes_the_load_for_that_view()
    {
        using var motion = Motion.On();
        var (canvas, folder) = Open();
        canvas.ShowLoad(Load(folder, "ramp", 100));
        canvas.SetScene(SceneBuilder.Build(folder.Model, "shop", null, folder.Problems, new Focus("worker")), "straight", ["worker"]); // a pick redraws the scene
        Assert.True(((BoxControl)canvas.BoxControlFor("worker")!).PerfShown.Strained);
        Assert.True(canvas.TrafficNow.Running);
        canvas.SetScene(SceneBuilder.Build(folder.Model, Names.Root, null, folder.Problems, new Focus()), "straight", []);
        canvas.ShowLoad(Load(folder, "ramp", 100, Names.Root));
        Assert.True(((BoxControl)canvas.BoxControlFor("shop")!).PerfShown.Strained); // a system takes the worst of what it holds
        Assert.Null(canvas.LineWidth("web", "db")); // that line is not drawn at the top
    }

    [AvaloniaFact]
    public void A_failing_line_gets_failing_particles()
    {
        using var motion = Motion.On();
        var (canvas, folder) = Open();
        var load = Load(folder, "errors", 400);
        Assert.Contains(load.Lines, l => l.Failed > 0.2);
        canvas.ShowLoad(load);
        Assert.True(canvas.TrafficNow.Particles > 0);
    }

    private static Traffic Source(Folder folder, string source, string connection, string view = "shop")
    {
        var text = $"name: S\nsource: {source}\nlevels:\n  - {{ load: 1, connections: [{connection}] }}\n  - {{ load: 2, connections: [{connection}] }}\n";
        return Blobs(folder.Model, Perf.ParseRun("s", text).Run, 1, view);
    }

    [AvaloniaFact]
    public void A_line_draws_the_number_of_dots_its_formula_says_and_never_more_than_the_cap_asks_for()
    {
        using var motion = Motion.On();
        var (canvas, folder) = Open();
        canvas.ShowLoad(Source(folder, "{ color: blue, dot: rate / 50 }", "{ from: customer, to: web, rate: 1000, p50: 10 }"));
        Assert.InRange(canvas.TrafficNow.Particles, 19, 21); // 1,000 calls a second at one dot for 50 is 20 dots on the line
        canvas.ShowLoad(null); // a line that is new starts with its particles spread along it
        canvas.ShowLoad(Source(folder, "{ color: blue, dot: rate / 50 }", "{ from: customer, to: web, rate: 100000, p50: 10 }"));
        Assert.InRange(canvas.TrafficNow.Particles, Perf.AtOnce - 2, Perf.AtOnce + 1); // the count is scaled down to what the screen can hold
        canvas.ShowLoad(null);
        canvas.ShowLoad(Source(folder, "{ dot: \"rate * 1000000\" }", "{ from: customer, to: web, rate: 100000, p50: 10 }"));
        Assert.True(canvas.TrafficNow.Particles <= Particles.Most);
        canvas.ShowLoad(null);
    }

    [AvaloniaFact]
    public void Lost_and_rejected_lines_keep_their_particles_alive_until_the_pop_or_the_way_back_is_over()
    {
        using var motion = Motion.On();
        var (canvas, folder) = Open();
        canvas.ShowLoad(Source(folder, "{ color: red }", "{ from: customer, to: web, rate: 40, p50: 10, errors: 0.5, failure: lost }"));
        Assert.True(canvas.TrafficNow.Particles > 0);
        canvas.ShowLoad(Source(folder, "{ color: red }", "{ from: customer, to: web, rate: 40, p50: 10, errors: 0.5, failure: rejected }"));
        Assert.True(canvas.TrafficNow.Particles > 0);
        canvas.ShowLoad(null);
    }
}
