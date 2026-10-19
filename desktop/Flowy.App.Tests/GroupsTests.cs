using System.Diagnostics;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
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

    /// <summary>A scratch folder that deletes itself.</summary>
    private sealed class Scratch : IDisposable
    {
        public string Dir { get; } = Directory.CreateTempSubdirectory("flowy-groups-test-").FullName;

        public void Write(string rel, string text)
        {
            var path = Path.Combine(Dir, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, text);
        }

        public void Dispose() => Directory.Delete(Dir, true);
    }

    private static List<string> Words(ReaderView reader) => reader.Card.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text ?? "").ToList();

    private static List<Border> Borders(ReaderView reader, string cls) => reader.Card.GetVisualDescendants().OfType<Border>().Where(b => b.Classes.Contains(cls)).ToList();

    private static Button? Named(ReaderView reader, string name) =>
        reader.Card.GetVisualDescendants().OfType<Button>().FirstOrDefault(b => Avalonia.Automation.AutomationProperties.GetName(b) == name);

    private static void Click(Button button) => button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));

    [AvaloniaFact]
    public void A_flow_with_no_groups_has_the_card_it_always_had()
    {
        var (_, reader) = Open("1");
        reader.Play("capture-payment");
        Assert.Contains("Step 1 of 2", Words(reader));
        Assert.Equal(2, Borders(reader, "seg").Count);
        Assert.DoesNotContain(Borders(reader, "bracket"), _ => true);
        Assert.DoesNotContain(Borders(reader, "tab"), _ => true);
        Assert.DoesNotContain(Borders(reader, "laneblock"), _ => true);
        Assert.NotNull(Named(reader, "Back"));
        Assert.Null(Named(reader, "Replay this step"));
    }

    [AvaloniaFact]
    public void A_parallel_stop_shows_both_lanes_a_chip_a_bracket_for_each_group_and_a_way_to_open_the_linked_flow()
    {
        var (window, reader) = Open("1");
        reader.Play("ok", 5);
        Assert.Equal(5, reader.PlayingStep);
        var words = Words(reader);
        Assert.Contains("Step 6 of 6", words);
        Assert.Contains("At the same time, 2 lanes", words);
        Assert.Contains("Billing", words);
        Assert.Contains("Dispatch", words);
        Assert.Equal(2, Borders(reader, "laneblock").Count);
        Assert.Equal(3, Borders(reader, "bracket").Count);
        Assert.Equal(6, Borders(reader, "seg").Count); // a cell for each stop
        Assert.NotNull(Named(reader, "Open flow: Capture a payment"));
        Assert.False(Named(reader, "Next")!.IsEnabled);
        Press(window, Key.Left, PhysicalKey.ArrowLeft);
        Assert.Equal(4, reader.PlayingStep);
    }

    [AvaloniaFact]
    public void A_branch_shows_its_lanes_as_tabs_with_the_current_one_marked()
    {
        var (_, reader) = Open("1");
        reader.Play("ok", 4); // the lone step of the second lane
        var tabs = Borders(reader, "tab");
        Assert.Equal(2, tabs.Count);
        Assert.Equal(["Card declined"], tabs.Where(t => t.Classes.Contains("on")).Select(t => ((TextBlock)t.Child!).Text).ToList());
        Assert.Contains("One of 2", Words(reader));
    }

    [AvaloniaFact]
    public void A_file_step_inside_a_parallel_group_plays_at_the_stop_that_holds_it()
    {
        var (_, reader) = Open("1");
        reader.Play("ok", 6); // Tells Dispatch: the second lane of the last stop
        Assert.Equal(5, reader.PlayingStep);
        reader.Play("ok", 99); // no such step: the first stop
        Assert.Equal(0, reader.PlayingStep);
    }

    [AvaloniaFact]
    public void Open_flow_goes_to_the_other_flow_and_the_trail_bar_goes_back_to_the_stop_that_was_left()
    {
        var (window, reader) = Open("1");
        reader.Play("ok", 5);
        Click(Named(reader, "Open flow: Capture a payment")!);
        Assert.Equal("capture-payment", reader.PlayingFlowId);
        Assert.Equal(0, reader.PlayingStep);
        var back = reader.Card.GetVisualDescendants().OfType<Button>().Single(b => b.Classes.Contains("trail"));
        Assert.Contains("Back to “Customer pays for an order”, step 6", Words(reader).Concat([Avalonia.Automation.AutomationProperties.GetName(back)]));
        Click(back);
        Assert.Equal("ok", reader.PlayingFlowId);
        Assert.Equal(5, reader.PlayingStep);
        Assert.DoesNotContain(reader.Card.GetVisualDescendants().OfType<Button>(), b => b.Classes.Contains("trail"));
        // Esc leaves the player, and the trail with it.
        Click(Named(reader, "Open flow: Capture a payment")!);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Null(reader.PlayingFlowId);
        reader.Play("capture-payment");
        Assert.DoesNotContain(reader.Card.GetVisualDescendants().OfType<Button>(), b => b.Classes.Contains("trail"));
    }

    [AvaloniaFact]
    public void A_flow_that_cannot_play_cannot_be_opened_from_a_step()
    {
        using var dir = new Scratch();
        dir.Write("flowy/model.yaml", "objects:\n  a: { type: actor, name: A }\n  b: { type: system, name: B }\nconnections:\n  - { from: a, to: b, label: calls }\n");
        dir.Write("flowy/flows/parent.yaml", "name: Parent\nview: root\nsteps:\n  - { from: a, to: b, text: Starts, flow: child }\n");
        dir.Write("flowy/flows/child.yaml", "name: Child\nview: nowhere\nsteps:\n  - { from: a, to: b, text: Runs }\n");
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        var path = Path.Combine(dir.Dir, "flowy");
        var reader = new ReaderView();
        var window = new Window { Width = 1100, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(path), path);
        reader.Play("parent");
        var open = Named(reader, "Open flow: Child")!;
        Assert.False(open.IsEnabled);
        Click(open);
        Assert.Equal("parent", reader.PlayingFlowId);
    }

    [AvaloniaFact]
    public void Autoplay_settles_a_parallel_stop_only_when_its_longest_motion_has_finished_and_then_ends_at_the_last_stop()
    {
        using var dir = new Scratch();
        var copy = Path.Combine(dir.Dir, "flowy");
        foreach (var file in Directory.EnumerateFiles(Groups, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(Groups, file);
            var text = File.ReadAllText(file);
            if (rel.EndsWith("ok.yaml"))
                text = text.Replace("text: Tells Billing, group: tell, lane: Billing, flow: capture-payment }", "text: Tells Billing, group: tell, lane: Billing, flow: capture-payment, animation: call }")
                    .Replace("text: Tells Dispatch, group: tell, lane: Dispatch }", "text: Tells Dispatch, group: tell, lane: Dispatch, animation: send }");
            dir.Write(Path.Combine("flowy", rel), text);
        }
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0");
        try
        {
            var reader = new ReaderView();
            var window = new Window { Width = 1100, Height = 800, Content = reader };
            window.Show();
            reader.Load(FolderLoader.Load(copy), copy);
            reader.GoTo("shop");
            reader.Play("ok", 4); // the stop before the parallel one, which doesn't move
            Press(window, Key.P, PhysicalKey.P);
            Assert.True(reader.Autoplaying);
            Run(() => reader.PlayingStep == 5);
            Assert.True(reader.StepMoving); // both lanes of the parallel stop, together
            Run(() => !reader.StepMoving);
            Assert.True(reader.Autoplaying); // the motions are over, Autoplay rests a moment before it ends at the last stop
            Run(() => !reader.Autoplaying);
            Assert.False(reader.Autoplaying);
            Assert.Equal(5, reader.PlayingStep);
        }
        finally
        {
            Finish();
        }
    }
}
