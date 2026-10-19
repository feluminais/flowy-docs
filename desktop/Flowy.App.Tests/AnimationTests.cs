using System.Diagnostics;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>
/// A tagged step moves, then stands still; arriving somewhere else cuts it off; R plays it again; P steps through the flow on its own and a key
/// of yours takes over. These use desktop/fixtures/cases/animation, whose flow "tags" has good tags on its first five steps and a typo on the sixth.
/// </summary>
public class AnimationTests
{
    private static string Tags => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "animation", "flowy");

    private static string Recursion => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "recurse", "flowy");

    private static (Window Window, ReaderView Reader) Open(string motion, string? folder = null)
    {
        folder ??= Tags;
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", motion);
        var reader = new ReaderView();
        var window = new Window { Width = 1100, Height = 700, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(folder), folder);
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

    [AvaloniaFact]
    public void A_tagged_step_moves_and_then_stands_still_with_its_boxes_put_back()
    {
        var (_, reader) = Open("0");
        try
        {
            reader.Play("tags");
            Assert.True(reader.StepMoving);
            Run(() => !reader.StepMoving);
            Assert.False(reader.StepMoving);
            Assert.Equal(0, reader.PlayingStep);
            Assert.Null(reader.Canvas.BoxControlFor("web")!.RenderTransform);
            Assert.Null(reader.Canvas.BoxControlFor("api")!.RenderTransform);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void Arriving_at_another_step_cuts_the_old_one_off_and_stopping_the_flow_ends_it()
    {
        var (window, reader) = Open("0");
        try
        {
            reader.Play("tags");
            Press(window, Key.Right, PhysicalKey.ArrowRight);
            Assert.Equal(1, reader.PlayingStep);
            Assert.True(reader.StepMoving);
            Press(window, Key.Escape, PhysicalKey.Escape);
            Assert.Null(reader.PlayingFlowId);
            Assert.False(reader.StepMoving);
            Assert.Null(reader.Canvas.BoxControlFor("api")!.RenderTransform);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void A_step_with_a_wrong_tag_does_not_move()
    {
        var (_, reader) = Open("0");
        try
        {
            reader.Play("tags", 5); // "sned"
            Assert.False(reader.StepMoving);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void A_recurse_step_moves_then_stands_still_with_its_counter_left()
    {
        var (window, reader) = Open("0", Recursion);
        try
        {
            reader.Play("recursion"); // "Walks the category tree", a good recurse tag, depth 3
            Assert.True(reader.StepMoving);
            Assert.True(HasReplay(window), "a recursion can be replayed");
            Run(() => !reader.StepMoving);
            Assert.False(reader.StepMoving);
            Assert.Equal(("api", 3), reader.Canvas.Resting!.Value);
            Assert.Null(reader.Canvas.BoxControlFor("api")!.RenderTransform);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void A_recursion_squashes_its_own_box_in_its_first_moments()
    {
        var (_, reader) = Open("0", Recursion);
        try
        {
            reader.Play("recursion");
            Run(() => reader.Canvas.BoxControlFor("api")!.RenderTransform is not null, 2); // the gulp that opens the step: one box at both ends must not wipe it
            Assert.NotNull(reader.Canvas.BoxControlFor("api")!.RenderTransform);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void The_counter_follows_the_step_and_goes_with_it()
    {
        var (window, reader) = Open("0", Recursion);
        try
        {
            reader.Play("recursion");
            Run(() => !reader.StepMoving);
            Press(window, Key.Right, PhysicalKey.ArrowRight); // step 2, depth 4
            Run(() => !reader.StepMoving);
            Assert.Equal(("api", 4), reader.Canvas.Resting!.Value);
            Press(window, Key.Right, PhysicalKey.ArrowRight); // step 3, a wrong tag
            Assert.Null(reader.Canvas.Resting);
            Press(window, Key.Home, PhysicalKey.Home);
            Assert.True(reader.StepMoving);
            Assert.NotNull(reader.Canvas.Resting);
            Press(window, Key.Escape, PhysicalKey.Escape);
            Assert.Null(reader.Canvas.Resting);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void With_motion_reduced_a_recursion_leaves_only_its_counter_and_Autoplay_goes_on()
    {
        var (window, reader) = Open("1", Recursion);
        reader.Play("recursion");
        Assert.False(reader.StepMoving);
        Assert.Equal(("api", 3), reader.Canvas.Resting!.Value);
        Press(window, Key.P, PhysicalKey.P);
        Run(() => reader.PlayingStep >= 1);
        Assert.True(reader.PlayingStep >= 1);
        Assert.Equal(("api", 4), reader.Canvas.Resting!.Value);
    }

    [AvaloniaFact]
    public void The_counter_follows_a_box_that_moves_under_it()
    {
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        var folder = FolderLoader.Load(Recursion);
        var canvas = new CanvasView();
        new Window { Width = 1100, Height = 700, Content = canvas }.Show();
        var scene = SceneBuilder.Build(folder.Model, "shop", null, folder.Problems, new Focus());
        canvas.SetScene(scene, "straight", []);
        canvas.PlayStep(new StepAnimation("recurse", "inside", null, 3), "api", "api", false, null);
        var before = canvas.RestingRect!.Value;
        canvas.SetScene(scene with { Boxes = scene.Boxes.Select(b => b.Id == "api" ? b with { Rect = b.Rect with { X = b.Rect.X + 120 } } : b).ToList() }, "straight", []);
        Assert.Equal(("api", 3), canvas.Resting!.Value);
        Assert.Equal(before.X + 120, canvas.RestingRect!.Value.X);
    }

    [AvaloniaFact]
    public void A_tagged_step_offers_Replay()
    {
        var (window, reader) = Open("0");
        try
        {
            reader.Play("tags");
            Assert.True(HasReplay(window));
        }
        finally
        {
            Finish();
        }
    }

    private static bool HasReplay(Window window) =>
        window.GetVisualDescendants().OfType<Button>().Any(b => AutomationProperties.GetName(b) == "Replay this step");

    [AvaloniaFact]
    public void R_plays_the_step_again()
    {
        var (window, reader) = Open("0");
        try
        {
            reader.Play("tags");
            Run(() => !reader.StepMoving);
            Press(window, Key.R, PhysicalKey.R);
            Assert.True(reader.StepMoving);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void P_steps_through_the_flow_on_its_own_and_an_arrow_key_takes_over()
    {
        var (window, reader) = Open("0");
        try
        {
            reader.Play("tags");
            Press(window, Key.P, PhysicalKey.P);
            Assert.True(reader.Autoplaying);
            Run(() => reader.PlayingStep >= 1);
            Assert.True(reader.PlayingStep >= 1, "it went on by itself");
            Assert.True(reader.Autoplaying);
            Press(window, Key.Right, PhysicalKey.ArrowRight);
            Assert.False(reader.Autoplaying);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void With_motion_reduced_nothing_moves_and_Autoplay_still_goes_on_after_a_moment()
    {
        var (window, reader) = Open("1");
        reader.Play("tags");
        Assert.False(reader.StepMoving);
        Press(window, Key.P, PhysicalKey.P);
        Run(() => reader.PlayingStep >= 1);
        Assert.True(reader.PlayingStep >= 1);
        Assert.False(reader.StepMoving);
    }

    [AvaloniaFact]
    public void P_on_the_last_step_starts_again_from_the_first()
    {
        var (window, reader) = Open("1");
        reader.Play("tags", 14);
        Press(window, Key.P, PhysicalKey.P);
        Assert.Equal(0, reader.PlayingStep);
        Assert.True(reader.Autoplaying);
        Press(window, Key.P, PhysicalKey.P);
        Assert.False(reader.Autoplaying);
    }
}
