using System.Diagnostics;
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
/// The ways a request can end, as the canvas plays them: what is drawn at chosen moments of a step (a puff and a cross where a request is lost, the bar at the door of a rejected
/// one, the marker of whoever takes one, the two copies of a duplicated one), what stays when it is over, what a still picture holds with motion reduced, and what the card says.
/// These use desktop/fixtures/cases/outcomes, whose flow "ends" has a step for each outcome in the order lost (30 percent), rejected, intercepted by a name, intercepted by a shape,
/// duplicated, delayed, failing (half) and an event lost.
/// </summary>
public class OutcomesTests
{
    private static string Folder => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "outcomes", "flowy");

    private static (Window Window, ReaderView Reader) Open(string motion)
    {
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", motion);
        var reader = new ReaderView();
        var window = new Window { Width = 1100, Height = 700, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(Folder), Folder);
        reader.GoTo("shop");
        return (window, reader);
    }

    private static void Finish() => Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1"); // the other tests turn motion off

    /// <summary>Lets frames and timers run until <paramref name="done"/>, or a few seconds pass. A headless window draws no frames of its own.</summary>
    private static void Run(Func<bool> done, double seconds = 20)
    {
        var clock = Stopwatch.StartNew();
        while (clock.Elapsed < TimeSpan.FromSeconds(seconds) && !done())
        {
            AvaloniaHeadlessPlatform.ForceRenderTimerTick();
            Dispatcher.UIThread.RunJobs();
            Thread.Sleep(5);
        }
    }

    private static List<string> Words(ReaderView reader) => reader.Card.Laid().GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text ?? "").ToList();

    /// <summary>The first beat of a kind, played where the step has it, and the canvas shown a moment into it.</summary>
    private static Beat Find(ReaderView reader, Func<Beat, bool> which) => reader.Canvas.PlayingBeats.First(which);

    private static IReadOnlyList<Beat> At(ReaderView reader, double t)
    {
        reader.Canvas.ShowMotionAt(t);
        return reader.Canvas.DrawnBeats;
    }

    [AvaloniaFact]
    public void A_lost_request_pops_where_it_vanishes_leaves_a_cross_and_never_squashes_the_receiver()
    {
        var (_, reader) = Open("0");
        try
        {
            reader.Play("ends", 7); // an event lost at 0.4 of its line
            var pop = Find(reader, b => b.Do == "pop");
            Assert.Equal(0.4, pop.Along);
            var during = At(reader, pop.At + 100);
            Assert.Contains(during, b => b.Do == "pop");
            Assert.DoesNotContain(during, b => b.On == "to");
            Assert.DoesNotContain(reader.Canvas.PlayingBeats, b => b.Do == "flash" && b.On == "to");
            Run(() => !reader.StepMoving);
            Assert.Equal(["pop"], reader.Canvas.DrawnBeats.Select(b => b.Do)); // the cross stays, nothing else
            Assert.Null(reader.Canvas.BoxControlFor("db")!.RenderTransform);
            Assert.Equal(1.0, reader.Canvas.LitFade);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void A_rejected_request_stops_at_the_bar_and_comes_back_in_the_danger_tone()
    {
        var (_, reader) = Open("0");
        try
        {
            reader.Play("ends", 1);
            var bar = Find(reader, b => b.Do == "bar");
            Assert.Contains(At(reader, bar.At + 60), b => b.Do == "bar");
            Assert.DoesNotContain(At(reader, bar.At + 60), b => b.Do == "gulp" && b.On == "to");
            var back = Find(reader, b => b.Do == "blob" && b.Dir == "back");
            Assert.Equal("fail", back.Tone);
            var returning = At(reader, back.At + back.Dur / 2).Where(b => b.Do == "blob").ToList();
            Assert.Equal(["fail"], returning.Select(b => b.Tone));
            Run(() => !reader.StepMoving);
            Assert.Contains(reader.Canvas.DrawnBeats, b => b.Do == "bar"); // the bar stays at the door
            Assert.DoesNotContain(reader.Canvas.DrawnBeats, b => b.Do == "blob");
            Assert.Equal(1.0, reader.Canvas.LitFade);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void An_intercepted_request_leaves_the_line_for_a_marker_or_a_shape_which_lights()
    {
        var (_, reader) = Open("0");
        try
        {
            reader.Play("ends", 2); // taken by a party that is not in the model
            var marker = Find(reader, b => b.Do == "marker");
            Assert.Equal("Café wifi proxy", marker.Text);
            Assert.Contains(At(reader, 20), b => b.Do == "marker"); // there for the whole step, from the first moment
            var leaves = Find(reader, b => b.Do == "blob" && b.On == "by");
            Assert.Contains(At(reader, leaves.At + 100), b => b.Do == "blob" && b.On == "by");
            var lights = Find(reader, b => b.Do == "flash" && b.On == "by");
            Assert.Contains(At(reader, lights.At + 50), b => b.Do == "flash" && b.On == "by");
            Run(() => !reader.StepMoving);
            Assert.Equal(["marker"], reader.Canvas.DrawnBeats.Select(b => b.Do));

            reader.Play("ends", 3); // taken by the shape "cache", which is on the canvas
            Assert.NotNull(reader.Canvas.BoxControlFor("cache"));
            var around = Find(reader, b => b.Do == "marker");
            Assert.Null(around.Text); // its own name is already on it
            Assert.Contains(At(reader, 20), b => b.Do == "marker");
            Run(() => !reader.StepMoving);
            Assert.Equal(["marker"], reader.Canvas.DrawnBeats.Select(b => b.Do));
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void A_duplicated_request_shows_two_blobs_that_carry_the_same_word_and_the_receiver_takes_it_in_twice()
    {
        var (_, reader) = Open("0");
        try
        {
            reader.Play("ends", 4);
            var blobs = reader.Canvas.PlayingBeats.Where(b => b.Do == "blob").ToList();
            Assert.Equal(2, blobs.Count);
            Assert.Equal(["order", "order"], blobs.Select(b => b.Label));
            Assert.Equal(blobs[0].Tint, blobs[1].Tint);
            var both = At(reader, blobs[1].At + 100).Where(b => b.Do == "blob").ToList();
            Assert.Equal(2, both.Count);
            Assert.Equal(2, reader.Canvas.PlayingBeats.Count(b => b.Do == "gulp" && b.On == "to"));
            Run(() => !reader.StepMoving);
            Assert.Empty(reader.Canvas.DrawnBeats);
            Assert.Null(reader.Canvas.BoxControlFor("db")!.RenderTransform);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void A_delayed_request_waits_at_a_clock_and_then_lands()
    {
        var (_, reader) = Open("0");
        try
        {
            reader.Play("ends", 5);
            var clock = Find(reader, b => b.Do == "clock");
            var drawn = At(reader, clock.At + 200).Select(b => b.Do).Distinct().ToList();
            Assert.Contains("blob", drawn);
            Assert.Contains("clock", drawn);
            Assert.Contains("note", drawn);
            Assert.Equal("Cold start", Find(reader, b => b.Do == "note").Text);
            Run(() => !reader.StepMoving);
            Assert.Empty(reader.Canvas.DrawnBeats); // the clock is gone once the request goes on
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void A_share_plays_a_burst_whose_hits_are_named_ringed_and_tinted_and_the_rest_are_plain()
    {
        var (_, reader) = Open("0");
        try
        {
            reader.Play("ends", 0); // 30 percent lost
            var blobs = reader.Canvas.PlayingBeats.Where(b => b.Do == "blob").ToList();
            Assert.Equal(10, blobs.Count);
            Assert.Equal(["r1", "r2", "r3"], blobs.Where(b => b.Label is not null).Select(b => b.Label));
            Assert.Equal([0, 1, 2], blobs.Where(b => b.Label is not null).Select(b => b.Tint));
            Assert.All(blobs.Where(b => b.Label is not null), b => Assert.True(b.Ring));
            Assert.All(blobs.Where(b => b.Label is null), b => Assert.Null(b.Tint));
            var first = blobs.First(b => b.Label == "r1");
            var drawn = At(reader, first.At + 200).Where(b => b.Do == "blob").ToList();
            Assert.Contains(drawn, b => b.Label == "r1" && b.Tint == 0 && b.Ring == true);
            Assert.Contains(drawn, b => b.Label is null);
            Run(() => !reader.StepMoving);
            Assert.Equal(3, reader.Canvas.DrawnBeats.Count(b => b.Do == "pop")); // a cross for each, one over another
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void With_motion_reduced_nothing_moves_and_the_marks_an_outcome_leaves_are_drawn_until_the_step_is_left()
    {
        var (window, reader) = Open("1");
        reader.Play("ends", 1); // rejected, with a reason
        Assert.False(reader.StepMoving);
        Assert.Equal(["bar", "note"], reader.Canvas.DrawnBeats.Select(b => b.Do).Order());
        Assert.Equal("Rate limit", reader.Canvas.DrawnBeats.First(b => b.Do == "note").Text);
        reader.Play("ends", 2);
        Assert.Equal(["marker"], reader.Canvas.DrawnBeats.Select(b => b.Do));
        reader.Play("ends", 5); // delayed: the clock as a still picture
        Assert.Equal(["clock", "note"], reader.Canvas.DrawnBeats.Select(b => b.Do).Order());
        reader.Play("ends", 6); // a share of failing requests leaves nothing to draw
        Assert.Empty(reader.Canvas.DrawnBeats);
        reader.Play("ends", 0);
        Assert.Contains(reader.Canvas.DrawnBeats, b => b.Do == "pop");
        window.KeyPress(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);
        Assert.Empty(reader.Canvas.DrawnBeats);
    }

    [AvaloniaFact]
    public void The_card_says_how_the_request_ended_in_the_words_every_other_place_uses()
    {
        var (_, reader) = Open("1");
        var expected = new[] { "30% lost: Packet dropped", "Rejected: Rate limit", "Taken by Café wifi proxy", "Taken by Edge cache: Serves a stale copy", "Sent twice", "Delayed: Cold start", "50% fail", "Lost" };
        for (var i = 0; i < expected.Length; i++)
        {
            reader.Play("ends", i);
            Assert.Contains(expected[i], Words(reader));
        }
        // The same fragment Core gives, so the browser, the desktop app and Mermaid cannot differ.
        var flow = FolderLoader.Load(Folder).Model.Flows["ends"];
        for (var i = 0; i < expected.Length; i++)
            Assert.Equal(expected[i], Animations.OutcomeLine(Animations.Read(flow.Steps[i])!, id => Views.NameOf(FolderLoader.Load(Folder).Model, id)));
    }

    private static (TempFolder Temp, string Dir, ReaderView Reader) OpenEditing(string flow)
    {
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        var source = Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "edit", "flowy");
        foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            var target = Path.Combine(dir, Path.GetRelativePath(source, file));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.WriteAllText(target, File.ReadAllText(file));
        }
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        reader.SetEditing(true);
        reader.OpenFlowById(flow);
        window.UpdateLayout();
        Dispatcher.UIThread.RunJobs();
        return (temp, dir, reader);
    }

    private static async Task Until(Func<bool> done)
    {
        for (var i = 0; i < 500 && !done(); i++) await Task.Delay(10);
        Assert.True(done(), "gave up waiting");
    }

    private static string FlowFile(string dir, string id) => File.ReadAllText(Path.Combine(dir, "flows", $"{id}.yaml")).Replace("\r\n", "\n");

    [AvaloniaFact]
    public async Task Picking_how_a_step_travels_and_ends_is_one_edit_each_and_keeps_the_rest_of_the_step()
    {
        var (temp, dir, reader) = OpenEditing("order");
        using var _ = temp;
        var recorder = reader.Panel.CurrentRecorder!;
        Assert.True(await recorder.StepKinds[0].Choose("call"));
        await Until(() => FlowFile(dir, "order").Contains("animation: call"));
        Assert.Contains("  - from: customer\n    to: shop\n    text: Places an order\n    note: x\n    animation: call\n", FlowFile(dir, "order")); // the step's own extra key stays, and the animation comes last

        recorder = reader.Panel.CurrentRecorder!;
        Assert.True(await recorder.StepOutcomes[0].Choose("rejected"));
        await Until(() => FlowFile(dir, "order").Contains("outcome: rejected"));
        recorder = reader.Panel.CurrentRecorder!;
        recorder.StepReasons[0].Text = "Rate limit";
        await recorder.StepReasons[0].Commit();
        await Until(() => FlowFile(dir, "order").Contains("reason: Rate limit"));
        var step = reader.Folder!.Model.Flows["order"].Steps[0];
        var animation = (OrderedDictionary<string, object?>)step.Animation!;
        Assert.Equal(["kind", "outcome", "reason"], animation.Keys);
        Assert.Equal("rejected", animation["outcome"]);
        Assert.Contains("owner: product", FlowFile(dir, "order")); // the flow's own extra key
        Assert.Equal("Takes payment", reader.Folder.Model.Flows["order"].Steps[1].Text); // the other step is as it was

        // Taking the outcome away takes its reason with it, and None takes the animation away.
        Assert.True(await reader.Panel.CurrentRecorder!.StepOutcomes[0].Choose(""));
        await Until(() => FlowFile(dir, "order").Contains("animation: call"));
        Assert.DoesNotContain("reason", FlowFile(dir, "order"));
        Assert.True(await reader.Panel.CurrentRecorder!.StepKinds[0].Choose(""));
        await Until(() => !FlowFile(dir, "order").Contains("animation"));
    }

    [AvaloniaFact]
    public async Task What_a_step_cannot_have_is_dimmed_with_the_reason_and_the_form_keeps_its_shape()
    {
        var (temp, dir, reader) = OpenEditing("order");
        using var _ = temp;
        var recorder = reader.Panel.CurrentRecorder!;
        // A step on one shape does not travel: only None is open, and no outcome.
        Assert.False(recorder.StepKinds[1].Allowed("call"));
        Assert.True(recorder.StepKinds[1].Allowed(""));
        Assert.False(recorder.StepOutcomes[1].Allowed("lost"));
        // A step with no kind has no outcome.
        Assert.False(recorder.StepOutcomes[0].Allowed("lost"));
        Assert.True(recorder.StepOutcomes[0].Allowed(""));
        Assert.False(recorder.StepShares[0].IsEnabled);
        Assert.False(recorder.StepReasons[0].IsEnabled);
        Assert.False(recorder.StepTakerNames[0].IsEnabled);

        await recorder.StepKinds[0].Choose("send");
        await Until(() => FlowFile(dir, "order").Contains("animation: send"));
        recorder = reader.Panel.CurrentRecorder!;
        Assert.True(recorder.StepOutcomes[0].Allowed("lost"));
        Assert.True(recorder.StepOutcomes[0].Allowed("fail"));
        Assert.False(recorder.StepOutcomes[0].Allowed("timeout")); // needs a call
        await recorder.StepKinds[0].Choose("callback");
        await Until(() => FlowFile(dir, "order").Contains("animation: callback"));
        Assert.False(reader.Panel.CurrentRecorder!.StepOutcomes[0].Allowed("lost")); // a callback has none
        Assert.Equal(8, reader.Panel.CurrentRecorder!.StepOutcomes[0].Ids.Count); // the seven outcomes and "arrives" are all still there
    }

    [AvaloniaFact]
    public async Task An_interception_is_valid_the_moment_it_is_picked_and_names_a_shape_or_a_party()
    {
        var (temp, dir, reader) = OpenEditing("order");
        using var _ = temp;
        var recorder = reader.Panel.CurrentRecorder!;
        await recorder.StepKinds[0].Choose("call");
        await Until(() => FlowFile(dir, "order").Contains("animation: call"));
        await reader.Panel.CurrentRecorder!.StepOutcomes[0].Choose("intercepted");
        await Until(() => FlowFile(dir, "order").Contains("outcome: intercepted"));
        Assert.Contains("name: Third party", FlowFile(dir, "order")); // a placeholder, so the step is never left without someone
        recorder = reader.Panel.CurrentRecorder!;
        Assert.True(recorder.StepTakerNames[0].IsEnabled);
        Assert.False(recorder.StepTakers[0].Allowed("customer")); // an end of the step
        Assert.False(recorder.StepTakers[0].Allowed("shop"));
        Assert.True(recorder.StepTakers[0].Allowed("pay"));

        await recorder.StepTakers[0].Choose("pay");
        await Until(() => FlowFile(dir, "order").Contains("by: pay"));
        Assert.DoesNotContain("Third party", FlowFile(dir, "order"));
        recorder = reader.Panel.CurrentRecorder!;
        recorder.StepTakerNames[0].Text = "Café wifi proxy";
        await recorder.StepTakerNames[0].Commit();
        await Until(() => FlowFile(dir, "order").Contains("name: Café wifi proxy"));
        Assert.DoesNotContain("by: pay", FlowFile(dir, "order"));
        // Another outcome drops the taker.
        await reader.Panel.CurrentRecorder!.StepOutcomes[0].Choose("lost");
        await Until(() => FlowFile(dir, "order").Contains("outcome: lost"));
        Assert.DoesNotContain("by:", FlowFile(dir, "order"));
        Assert.DoesNotContain(reader.Folder!.Problems, p => p.Message.Contains("animation"));
    }

    [AvaloniaFact]
    public async Task A_share_out_of_range_is_refused_with_the_checks_words_and_nothing_is_saved()
    {
        var (temp, dir, reader) = OpenEditing("order");
        using var _ = temp;
        await reader.Panel.CurrentRecorder!.StepKinds[0].Choose("send");
        await Until(() => FlowFile(dir, "order").Contains("animation: send"));
        await reader.Panel.CurrentRecorder!.StepOutcomes[0].Choose("lost");
        await Until(() => FlowFile(dir, "order").Contains("outcome: lost"));
        var recorder = reader.Panel.CurrentRecorder!;
        recorder.StepShares[0].Text = "30";
        await recorder.StepShares[0].Commit();
        await Until(() => FlowFile(dir, "order").Contains("share: 30"));
        var before = FlowFile(dir, "order");
        recorder = reader.Panel.CurrentRecorder!;
        recorder.StepShares[0].Text = "150";
        await recorder.StepShares[0].Commit();
        Assert.Equal(before, FlowFile(dir, "order")); // refused, nothing saved
        Assert.Equal("30", recorder.StepShares[0].Text); // and the saved text is back in the box
    }

    [AvaloniaFact]
    public void A_step_that_ends_in_an_outcome_still_settles_for_Autoplay()
    {
        var (window, reader) = Open("0");
        try
        {
            reader.Play("ends", 4);
            Assert.True(reader.StepMoving);
            window.KeyPress(Key.P, RawInputModifiers.None, PhysicalKey.P, null);
            Run(() => reader.PlayingStep >= 5);
            Assert.True(reader.PlayingStep >= 5, "Autoplay went on to the next step by itself");
        }
        finally
        {
            Finish();
        }
    }
}
