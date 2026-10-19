using System.Diagnostics;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>
/// A flow's groups in the player: stops, the card, the steps of a parallel stop moving together, marks on the lines, and Open flow with its trail.
/// These use desktop/fixtures/cases/groups, whose flow "ok" repeats two steps, branches into two lanes and ends on a parallel stop of two lanes.
/// </summary>
public class GroupsTests
{
    private static string Groups => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "groups", "flowy");

    private static (Window Window, ReaderView Reader) Open(string motion)
    {
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", motion);
        var reader = new ReaderView();
        var window = new Window { Width = 1100, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(Groups), Groups);
        reader.GoTo("shop");
        return (window, reader);
    }

    /// <summary>Lets frames and timers run until <paramref name="done"/>, or a few seconds pass. A headless window draws no frames of its own.</summary>
    private static void Run(Func<bool> done, double seconds = 10)
    {
        var clock = Stopwatch.StartNew();
        while (clock.Elapsed < TimeSpan.FromSeconds(seconds) && !done())
        {
            AvaloniaHeadlessPlatform.ForceRenderTimerTick();
            Dispatcher.UIThread.RunJobs();
            Thread.Sleep(5);
        }
    }

    private static void Press(Window w, Key key, PhysicalKey physical) => w.KeyPress(key, RawInputModifiers.None, physical, null);

    private static void Finish() => Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1"); // the other tests turn motion off

    private static CanvasView.StepRun Run(string animation, string from, string to) => new(new StepAnimation(animation, "inside", null), from, to, false);

    [AvaloniaFact]
    public void The_steps_of_a_stop_play_together_share_a_box_by_the_largest_squash_and_leave_nothing_squashed()
    {
        var (_, reader) = Open("0");
        try
        {
            var done = 0;
            Assert.True(reader.Canvas.PlaySteps([Run("send", "api", "billing"), Run("call", "api", "dispatch")], () => done++));
            Assert.True(reader.Canvas.StepMoving);
            Run(() => !reader.Canvas.StepMoving);
            Assert.Equal(1, done);
            foreach (var id in new[] { "api", "billing", "dispatch" }) Assert.Null(reader.Canvas.BoxControlFor(id)!.RenderTransform);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void Cutting_a_stop_off_mid_motion_calls_nothing_and_puts_every_box_back()
    {
        var (_, reader) = Open("0");
        try
        {
            var done = 0;
            Assert.True(reader.Canvas.PlaySteps([Run("call", "api", "billing"), Run("call", "api", "dispatch")], () => done++));
            Run(() => false, 0.4); // somewhere in the first gulp and the blobs
            reader.Canvas.StopStep();
            Run(() => false, 0.3);
            Assert.Equal(0, done);
            Assert.False(reader.Canvas.StepMoving);
            foreach (var id in new[] { "api", "billing", "dispatch" }) Assert.Null(reader.Canvas.BoxControlFor(id)!.RenderTransform);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void A_step_with_an_end_off_the_canvas_is_left_out_and_reduced_motion_plays_nothing()
    {
        var (_, reader) = Open("0");
        try
        {
            Assert.True(reader.Canvas.PlaySteps([Run("send", "api", "nowhere"), Run("send", "api", "billing")], null));
            reader.Canvas.StopStep();
            Assert.False(reader.Canvas.PlaySteps([Run("send", "api", "nowhere")], null));
        }
        finally
        {
            Finish();
        }
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        Assert.False(reader.Canvas.PlaySteps([Run("send", "api", "billing")], null));
    }

    [AvaloniaFact]
    public void Marks_can_be_set_and_cleared_without_moving_anything()
    {
        var (_, reader) = Open("1");
        reader.Canvas.SetMarks([new CanvasView.Mark("api", "billing", "Billing", "parallel"), new CanvasView.Mark("api", "api", "up to 3", "repeat"), new CanvasView.Mark("api", "nowhere", "x", "branch")]);
        reader.Canvas.SetMarks([]);
        Assert.False(reader.Canvas.StepMoving);
    }
}
