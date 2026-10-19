using Avalonia.Controls;
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

    private static Traffic Load(Folder folder, string run, double load, string view = "shop") => Perf.TrafficFor(folder.Model, folder.Runs![run], load, view);

    [AvaloniaFact]
    public void A_picked_or_lit_line_keeps_the_thickness_its_traffic_gives_it_as_in_the_browser()
    {
        Assert.Equal(1.5, BackLayer.ThicknessOf(false, false, null)); // no load: as always
        Assert.Equal(2, BackLayer.ThicknessOf(false, true, null));
        Assert.Equal(3, BackLayer.ThicknessOf(true, false, null));
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
}
