using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>
/// What a step leaves open, as the desktop player shows it: the marks on the canvas for each stop, the key under the state key, the words on the step card, the pure numbers behind the
/// motion, and the four controls of the edit form (Leaves open, Name, Points at, Closes). These use desktop/fixtures/cases/channels: flow "lifecycle" opens a stream "Orders" at its
/// second step and a job "Charge" at its fourth, and closes them at the sixth and ninth.
/// </summary>
public class ChannelsTests
{
    private static string Case => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "channels", "flowy");

    private static (Window Window, ReaderView Reader) OpenReader()
    {
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        var reader = new ReaderView();
        var window = new Window { Width = 1280, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(Case), Case);
        reader.GoTo("shop");
        Dispatcher.UIThread.RunJobs();
        return (window, reader);
    }

    private static List<string> Words(ReaderView reader) => reader.Card.Laid().GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text ?? "").ToList();

    private static string Marks(ReaderView reader) =>
        string.Join(", ", reader.Canvas.ChannelsShown.Select(m => $"{m.Kind}:{m.Name}@{m.AtBox}{(m.Opening ? "+" : "")}{(m.Closing ? "-" : "")}"));

    [AvaloniaFact]
    public void Each_stop_draws_what_is_open_then_and_the_step_that_opens_or_closes_says_so_on_the_card()
    {
        var (_, reader) = OpenReader();
        reader.Play("lifecycle", 0);
        Assert.Empty(reader.Canvas.ChannelsShown);
        Assert.DoesNotContain("Open stream", Words(reader));
        reader.Play("lifecycle", 1);
        Assert.Equal("stream:Orders@db+", Marks(reader)); // a stream points at the step's "to" unless it says otherwise, and is new at this stop
        Assert.Contains("Opens a stream: Orders", Words(reader));
        Assert.Contains("Open stream", Words(reader));
        reader.Play("lifecycle", 2);
        Assert.Equal("stream:Orders@db", Marks(reader)); // it stays on a step that does nothing to it
        reader.Play("lifecycle", 3);
        Assert.Equal("stream:Orders@db, job:Charge@stripe+", Marks(reader));
        Assert.Equal(["stream", "job"], reader.Canvas.ChannelKindsShown);
        Assert.Equal(["Open stream", "Running job"], ChannelKey.Words(reader.Canvas.ChannelKindsShown));
        Assert.Contains("Starts a job: Charge", Words(reader));
        reader.Play("lifecycle", 5);
        Assert.Equal("stream:Orders@db-, job:Charge@stripe", Marks(reader)); // the step that closes it still shows it, and it goes when the step has played
        Assert.Contains("Closes Orders", Words(reader));
        reader.Play("lifecycle", 6);
        Assert.Equal("job:Charge@stripe", Marks(reader));
        Assert.DoesNotContain("Open stream", Words(reader));
        Assert.Contains("Running job", Words(reader));
        reader.Play("lifecycle", 3); // back needs no undo: the marks are worked out from the start
        Assert.Equal("stream:Orders@db, job:Charge@stripe+", Marks(reader));
        reader.Play("lifecycle", 9); // the job was stopped at step 9, and the stream opened again at 8 runs to the end
        Assert.Equal("stream:Orders@db", Marks(reader));
    }

    [AvaloniaFact]
    public void Which_end_a_mark_points_at_follows_the_step_and_a_listener_sits_on_the_shape_that_asked()
    {
        var (_, reader) = OpenReader();
        reader.Play("unnamed", 4);
        // A listener sits at its "from" (web) and a job at its "to" (db); a stream points at the end it says, and the usual end is "to".
        Assert.Equal("listener:@web, job:@db, stream:@api, stream:@api", Marks(reader));
        Assert.Equal(["stream", "listener", "job"], reader.Canvas.ChannelKindsShown);
        reader.Play("lifecycle", 7); // "Orders" opens again on the same two shapes
        Assert.Equal("job:Charge@stripe, stream:Orders@db+", Marks(reader)); // opened again, it goes to the end of the order
    }

    [AvaloniaFact]
    public void Discs_on_one_shape_stand_side_by_side_in_the_order_they_were_opened_and_a_stream_takes_no_place()
    {
        var (_, reader) = OpenReader();
        reader.Play("lifecycle", 0);
        CanvasView.OpenChannel Job(int step, string name) => new(new Channel(step, "job", name, "web", "api", "to", false, false), "web", "api");
        reader.Canvas.ShowChannels([Job(0, "A"), new(new Channel(1, "stream", "S", "web", "api", "to", false, false), "web", "api"), Job(2, "B"), Job(3, "C")]);
        Assert.Equal([0, 0, 1, 2], reader.Canvas.ChannelsShown.Select(m => m.Slot));
        reader.Canvas.ShowChannels(null);
        Assert.Empty(reader.Canvas.ChannelsShown);
    }

    [AvaloniaFact]
    public void Opening_a_name_again_replaces_the_channel_that_has_it()
    {
        var model = FolderLoader.Load(Case).Model;
        var flow = model.Flows["reopen"];
        var open = FlowStage.OpenAt(model, "shop", flow, Structure.Stops(flow), 1);
        Assert.Equal(["Feed"], open.Select(o => o.Channel.Name));
        Assert.Equal("job", open[0].Channel.Kind);
        Assert.Equal(("api", "stripe"), (open[0].FromBox, open[0].ToBox));
    }

    [AvaloniaFact]
    public void A_view_that_folds_both_ends_of_a_step_into_one_shape_has_nothing_to_draw_for_it()
    {
        var model = FolderLoader.Load(Case).Model;
        var flow = model.Flows["lifecycle"];
        var stops = Structure.Stops(flow);
        Assert.Equal(["stream"], FlowStage.OpenAt(model, "shop", flow, stops, 1).Select(o => o.Channel.Kind)); // web, api and the db are three shapes of the shop view
        Assert.Empty(FlowStage.OpenAt(model, Names.Root, flow, stops, 1)); // at the top, the API and the db are both the shop
        var job = new Flow("x", "shop", [new Step("web", "api", "Folded", null, new OrderedDictionary<string, object?> { ["kind"] = "send", ["opens"] = "job" })]);
        Assert.Empty(FlowStage.OpenAt(model, Names.Root, job, Structure.Stops(job), 0)); // a step the view cannot place has no ends to put a mark on
        Assert.Equal(["job"], FlowStage.OpenAt(model, Names.Root, flow, stops, 3).Select(o => o.Channel.Kind)); // the charge job runs from the API to Stripe, which the top view keeps apart
    }

    [AvaloniaFact]
    public void The_mark_waits_for_the_step_s_motion_to_land_and_a_closing_one_goes_then()
    {
        var (_, reader) = OpenReader();
        reader.Play("lifecycle", 1);
        var after = reader.Canvas.ChannelsShown[0].AfterMs;
        Assert.InRange(after, 1200, 2200 + 2000); // the motion of a call: a blob out, a blob back, with a beat or two between
        Assert.Equal(0, ChannelDraw.Alpha(true, false, after, after - 1, false));
        Assert.Equal(1, ChannelDraw.Alpha(true, false, after, after + ChannelDraw.InMs, false));
        Assert.InRange(ChannelDraw.Alpha(true, false, after, after + ChannelDraw.InMs / 2, false), 0.5, 1);
        Assert.Equal(1, ChannelDraw.Alpha(false, true, after, after - 1, false));
        Assert.Equal(0, ChannelDraw.Alpha(false, true, after, after + ChannelDraw.OutMs, false));
        Assert.Equal(1, ChannelDraw.Alpha(false, false, after, 1e9, false));
        // Motion reduced: it is there, and dimmed once it is closing.
        Assert.Equal(1, ChannelDraw.Alpha(true, false, after, 0, true));
        Assert.Equal(0.4, ChannelDraw.Alpha(false, true, after, 0, true));
    }

    [AvaloniaFact]
    public void A_still_canvas_shows_the_open_channel_and_a_closing_one_dimmed()
    {
        var (_, reader) = OpenReader(); // FLOWY_REDUCE_MOTION=1
        reader.Play("lifecycle", 5);
        Assert.False(reader.Canvas.ChannelLayerNow.Running);
        Assert.Equal(0.4, reader.Canvas.ChannelLayerNow.AlphaOf(0)); // Orders is closing
        Assert.Equal(1, reader.Canvas.ChannelLayerNow.AlphaOf(1)); // Charge runs on
    }

    [AvaloniaFact]
    public void The_open_channels_clock_waits_while_the_window_is_minimised()
    {
        var (window, reader) = OpenReader();
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0");
        try
        {
            reader.Play("lifecycle", 5);
            Assert.True(reader.Canvas.ChannelLayerNow.Running);
            window.WindowState = WindowState.Minimized;
            Avalonia.Headless.AvaloniaHeadlessPlatform.ForceRenderTimerTick(); // the next frame finds it minimised and stops asking for more
            Dispatcher.UIThread.RunJobs();
            Assert.False(reader.Canvas.ChannelLayerNow.Running);
            window.WindowState = WindowState.Normal;
            Assert.True(reader.Canvas.ChannelLayerNow.Running);
        }
        finally
        {
            Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        }
    }

    [AvaloniaFact]
    public void Dots_run_the_way_the_data_goes_and_stand_a_pitch_apart()
    {
        var forward = ChannelDraw.DotsAt(100, 500, false, false).ToList();
        var later = ChannelDraw.DotsAt(100, 600, false, false).ToList();
        Assert.True(later[0] > forward[0]); // on towards the end of the line
        Assert.All(forward.Zip(forward.Skip(1)), p => Assert.Equal(ChannelDraw.Pitch, p.Second - p.First, 6));
        var back = ChannelDraw.DotsAt(100, 500, true, false).ToList();
        var backLater = ChannelDraw.DotsAt(100, 600, true, false).ToList();
        Assert.True(backLater[0] < back[0]); // back towards its start
        Assert.Equal([0, 12, 24], ChannelDraw.DotsAt(30, 0, false, true).Select(d => Math.Round(d))); // a still picture has them at the start of each pitch
    }

    [AvaloniaFact]
    public void The_key_names_each_open_kind_once_in_the_order_of_the_three_and_is_empty_when_nothing_is_open()
    {
        Assert.Equal(["Open stream", "Listening", "Running job"], ChannelKey.Words(["stream", "listener", "job"]));
        Assert.Equal(3, ((Panel)ChannelKey.Of(["job", "stream", "listener"])).Children.Count);
        var (_, reader) = OpenReader();
        reader.Play("lifecycle", 0);
        Assert.DoesNotContain("Listening", Words(reader));
        Assert.DoesNotContain("Running job", Words(reader));
    }

    private static (TempFolder Temp, string Dir, ReaderView Reader) OpenEditing(string flow)
    {
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        foreach (var file in Directory.GetFiles(Case, "*", SearchOption.AllDirectories))
        {
            var target = Path.Combine(dir, Path.GetRelativePath(Case, file));
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
    public void The_form_shows_what_a_step_leaves_open_and_names_what_it_can_close()
    {
        var (temp, _, reader) = OpenEditing("lifecycle");
        using var _ = temp;
        var recorder = reader.Panel.CurrentRecorder!;
        Assert.Equal(["", "stream", "listener", "job"], recorder.StepOpens[1].Ids);
        Assert.Equal("stream", recorder.StepOpens[1].Chosen);
        Assert.Equal("Orders", recorder.StepChannelNames[1].Text);
        Assert.Equal("", recorder.StepOpens[0].Chosen);
        Assert.Equal(["", "from", "to"], recorder.StepTowards[1].Ids);
        // What a step can close is what is open when its stop is reached: the stream once it was opened, and the job once that was.
        Assert.Equal([""], recorder.StepCloses[1].Ids);
        Assert.Equal(["", "Orders"], recorder.StepCloses[2].Ids);
        Assert.Equal(["", "Orders", "Charge"], recorder.StepCloses[5].Ids);
        Assert.Equal("Orders", recorder.StepCloses[5].Chosen);
        Assert.Equal(["", "Charge"], recorder.StepCloses[6].Ids); // Orders is closed by then
    }

    [AvaloniaFact]
    public void What_a_step_cannot_have_is_dimmed_with_the_reason_and_the_two_sets_of_options_grey_each_other_out()
    {
        var (temp, _, reader) = OpenEditing("lifecycle");
        using var _ = temp;
        var recorder = reader.Panel.CurrentRecorder!;
        // A step that opens something has no outcome and closes nothing; a name and an end need something open.
        Assert.False(recorder.StepOutcomes[1].Allowed("lost"));
        Assert.False(recorder.StepCloses[1].Allowed("Orders") && recorder.StepCloses[1].Ids.Contains("Orders"));
        Assert.True(recorder.StepTowards[1].Allowed("from"));
        Assert.False(recorder.StepTowards[0].Allowed("from"));
        Assert.False(recorder.StepChannelNames[0].IsEnabled);
        Assert.True(recorder.StepChannelNames[1].IsEnabled);
        // A step that closes one opens none.
        Assert.False(recorder.StepOpens[5].Allowed("stream"));
        Assert.True(recorder.StepOpens[5].Allowed(""));
        Assert.False(recorder.StepOutcomes[5].Allowed("lost"));
        // A step with no animation has no kind yet, so neither can be picked until it travels as something.
        Assert.False(recorder.StepOpens[2].Allowed("stream"));
        Assert.False(recorder.StepCloses[2].Allowed("Orders"));
        Assert.False(recorder.StepOutcomes[2].Allowed("lost")); // with no kind yet, as before
    }

    private static OrderedDictionary<string, object?>? Animation(ReaderView reader, int step) => reader.Folder!.Model.Flows["lifecycle"].Steps[step].Animation as OrderedDictionary<string, object?>;

    [AvaloniaFact]
    public async Task Each_pick_and_each_field_is_one_edit_through_the_animation()
    {
        var (temp, dir, reader) = OpenEditing("lifecycle");
        using var _ = temp;
        var recorder = reader.Panel.CurrentRecorder!;
        Assert.True(await recorder.StepKinds[9].Choose("send")); // "Done" travels as a send, and now closes the stream that was opened again
        await Until(() => reader.Folder!.Model.Flows["lifecycle"].Steps[9].Animation is "send");
        recorder = reader.Panel.CurrentRecorder!;
        Assert.True(recorder.StepCloses[9].Allowed("Orders"));
        Assert.True(await recorder.StepCloses[9].Choose("Orders"));
        await Until(() => Animation(reader, 9)?.ContainsKey("closes") == true);
        Assert.Equal(["kind", "closes"], Animation(reader, 9)!.Keys);
        recorder = reader.Panel.CurrentRecorder!;
        Assert.False(recorder.StepOpens[9].Allowed("stream")); // and so it leaves nothing open
        Assert.Equal("Orders", recorder.StepCloses[9].Chosen);
        Assert.True(await recorder.StepCloses[9].Choose(""));
        await Until(() => reader.Folder!.Model.Flows["lifecycle"].Steps[9].Animation is "send"); // the key goes, and the animation is its bare kind again

        recorder = reader.Panel.CurrentRecorder!;
        Assert.True(await recorder.StepTowards[7].Choose("from"));
        await Until(() => Animation(reader, 7)?.ContainsKey("towards") == true);
        recorder = reader.Panel.CurrentRecorder!;
        recorder.StepChannelNames[7].Text = "Feed";
        await recorder.StepChannelNames[7].Commit();
        await Until(() => Animation(reader, 7)?["name"] as string == "Feed");
        Assert.True(await reader.Panel.CurrentRecorder!.StepOpens[7].Choose("job"));
        await Until(() => Animation(reader, 7)?["opens"] as string == "job");
        var animation = Animation(reader, 7)!;
        Assert.Equal("Feed", animation["name"]);
        Assert.Equal("from", animation["towards"]);
        Assert.Equal("call", animation["kind"]);
        Assert.Contains("opens: job", FlowFile(dir, "lifecycle"));
        Assert.True(await reader.Panel.CurrentRecorder!.StepOpens[7].Choose("")); // Nothing takes the name and the end with it
        await Until(() => reader.Folder!.Model.Flows["lifecycle"].Steps[7].Animation is "call"); // no name, no end, no opens: the bare kind
    }

    [AvaloniaFact]
    public void A_name_a_step_closes_that_nothing_has_open_stays_on_offer_marked_so()
    {
        var (temp, _, reader) = OpenEditing("bad");
        using var _ = temp;
        var closes = reader.Panel.CurrentRecorder!.StepCloses[0];
        Assert.Equal(["", "Ghost"], closes.Ids);
        Assert.Equal("Ghost", closes.Chosen);
        Assert.Equal("Ghost · not open", closes.ChosenName);
    }
}
