using Avalonia;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;
using CorePt = Flowy.Core.Pt;
using CoreRect = Flowy.Core.Rect;

namespace Flowy.App.Tests;

/// <summary>
/// How the desktop plays a flow on a project that draws a line for each connection (desktop/fixtures/cases/draft-lanes): the lines of the pair a step rides part around the lit one by the player's
/// clock, the other lines of the pair are its kin, what runs along the lit line (the dot, a stream, the marks of an outcome) follows it, and a payload card sits beside the dot where it is. The poses,
/// the beats and the plans are core's, which the fixtures pin against the browser (PartsTests); these hold what the app does with them. Headless: no window opens, and a clock the test moves by hand
/// stands in for the player's; nothing here plays in real time.
/// </summary>
public class PartsViewTests
{
    private static string Dir => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "draft-lanes", "flowy");

    private const string Pair = "management ui"; // the pair of five lines: Request and reply, Start scan, Set country (one way), Scan results, Radio state (the other)

    private static (Folder Folder, Flow Flow, IReadOnlyList<Stop> Stops) Scan()
    {
        var folder = FolderLoader.Load(Dir);
        var flow = folder.Model.Flows["scan"];
        return (folder, flow, Structure.Stops(flow));
    }

    private static double Opacity(BackLayer layer, string id) => layer.OpacityOf(id)!.Value;

    private static LaneBox BoxOf(Scene scene, string id)
    {
        var b = scene.Boxes.First(x => x.Id == id);
        return new LaneBox(id, b.Rect, Look.DefOf(b.Object).Edge);
    }

    /// <summary>A line as the canvas makes it from the places of the boxes of the scene, in the pose given.</summary>
    private static LaneLine Lane(Scene scene, SceneEdge e, LanePose pose) => Lanes.LaneGeometry(BoxOf(scene, e.From), BoxOf(scene, e.To), e.Slot!.Value, pose);

    private static (Scene Scene, Playing Shown, IReadOnlyDictionary<string, PartPlan> Plans, BackLayer Layer, PartStoreTests.Rig Rig) Rigged(int stop)
    {
        var (folder, flow, stops) = Scan();
        var shown = FlowStage.PlayingAt(folder.Model, "root", flow, stops, stop);
        var scene = SceneBuilder.Build(folder.Model, "root", shown, folder.Problems);
        var plans = FlowStage.PartsAt(folder.Model, "root", flow, stops, stop, shown);
        var rig = new PartStoreTests.Rig();
        var layer = new BackLayer(new LaneStore()) { Viewport = new Viewport(0, 0, 1), Parts = rig.Store };
        rig.Store.Changed += layer.PartsChanged;
        layer.SetScene(scene, "straight");
        return (scene, shown, plans, layer, rig);
    }

    [AvaloniaFact]
    public void A_stop_on_one_line_of_a_pair_asks_for_that_line_and_a_step_on_a_lone_line_asks_for_nothing()
    {
        var (folder, flow, stops) = Scan();
        var shown = FlowStage.PlayingAt(folder.Model, "root", flow, stops, 0);
        var plans = FlowStage.PartsAt(folder.Model, "root", flow, stops, 0, shown);
        var plan = Assert.Single(plans);
        Assert.Equal(Pair, plan.Key);
        var strands = Views.Compute(folder.Model, "root").Strands!;
        var lit = strands.Single(s => s.Id == shown.Strands![0]); // the step names "Start scan"
        Assert.Equal("Start scan", lit.Label);
        Assert.Equal(Enumerable.Range(0, 5).Select(k => k == lit.Lane ? 1.0 : 0), plan.Value.Lit);
        Assert.Null(plan.Value.Beat); // a step with no motion has no beat: the lines part at once

        var lone = FlowStage.PlayingAt(folder.Model, "root", flow, stops, 5); // Management to the Bus: one line between them
        Assert.Empty(FlowStage.PartsAt(folder.Model, "root", flow, stops, 5, lone));
        // And in a project that draws one line for each pair, no pair is parted.
        var merged = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "edit", "flowy")).Model;
        var mergedFlow = merged.Flows["browse"];
        var mergedStops = Structure.Stops(mergedFlow);
        Assert.Empty(FlowStage.PartsAt(merged, "root", mergedFlow, mergedStops, 0, FlowStage.PlayingAt(merged, "root", mergedFlow, mergedStops, 0)));
    }

    [AvaloniaFact]
    public void The_lines_of_the_pair_part_around_the_lit_one_and_the_rest_are_its_kin()
    {
        var (scene, shown, plans, layer, rig) = Rigged(0);
        var lit = shown.Strands![0]!;
        var ofPair = scene.Edges.Where(e => e.Pair == Pair).OrderBy(e => e.Slot!.Value.Lane).ToList();
        Assert.Equal(5, ofPair.Count);
        var rest = ofPair.ToDictionary(e => e.Id, e => layer.PathOf(e.Id));
        foreach (var e in ofPair) Assert.Equal(Lane(scene, e, LanePose.Rest).Path, rest[e.Id]); // nothing is parted before the stop begins

        rig.Begin("scan:0:0", "scan", 0, plans);
        rig.Move(112.5);
        var half = rig.Store.Lam(Pair)!;
        Assert.Contains(half, l => l > 0 && l < 1);
        foreach (var e in ofPair) Assert.Equal(Lane(scene, e, new LanePose(0, half)).Path, layer.PathOf(e.Id)); // each line is where the core puts it at the pose of the clock
        rig.Move(200);
        var settled = rig.Store.Lam(Pair)!;
        Assert.Equal(1.0, settled.Single(l => l > 0));
        foreach (var e in ofPair)
        {
            var path = layer.PathOf(e.Id);
            Assert.Equal(Lane(scene, e, new LanePose(0, settled)).Path, path);
            if (e.Id == lit) Assert.Equal(rest[e.Id], path); // the lit line keeps its slot: only its neighbours move away
            else Assert.NotEqual(rest[e.Id], path);
        }
        // Nothing crosses: in the middle the lines are at least a pitch apart, and the open space beside the lit one is wider than that.
        var middles = ofPair.Select(e => Lane(scene, e, new LanePose(0, settled))).Select(l => new CorePt(l.X, l.Y)).ToList();
        var apart = Enumerable.Range(0, 4).Select(i => Math.Sqrt(Math.Pow(middles[i + 1].X - middles[i].X, 2) + Math.Pow(middles[i + 1].Y - middles[i].Y, 2))).ToList();
        Assert.All(apart, d => Assert.True(d >= Lanes.Pitch - 1e-6, $"the lines are a pitch apart in the middle ({d})"));
        var litLane = ofPair.Single(e => e.Id == lit).Slot!.Value.Lane;
        Assert.True(apart[litLane - 1] > Lanes.Pitch + 5 && apart[litLane] > Lanes.Pitch + 5, "the lit line has room on both sides");
        Assert.Equal(1.0, Opacity(layer, lit)); // lit
        Assert.All(ofPair.Where(e => e.Id != lit), e => Assert.Equal(Lanes.KinOpacity, Opacity(layer, e.Id))); // kin
        Assert.All(scene.Edges.Where(e => e.Pair != Pair), e => Assert.Equal(0.15, Opacity(layer, e.Id))); // the lines of other pairs
    }

    [AvaloniaFact]
    public void A_scrub_a_pause_and_leaving_the_stop_move_the_lines_with_the_clock()
    {
        var (scene, _, plans, layer, rig) = Rigged(0);
        var ofPair = scene.Edges.Where(e => e.Pair == Pair).ToList();
        var rest = ofPair.ToDictionary(e => e.Id, e => layer.PathOf(e.Id));
        rig.Begin("scan:0:0", "scan", 0, plans);
        rig.Move(400);
        var parted = ofPair.ToDictionary(e => e.Id, e => layer.PathOf(e.Id));
        Assert.Contains(ofPair, e => rest[e.Id] != parted[e.Id]);

        rig.Clock.Pause();
        rig.Clock.Seek(0); // dragged to the start of the stop: the lines are where they were before the step
        Assert.All(ofPair, e => Assert.Equal(rest[e.Id], layer.PathOf(e.Id)));
        rig.Clock.Seek(300);
        Assert.All(ofPair, e => Assert.Equal(parted[e.Id], layer.PathOf(e.Id)));

        rig.Clock.Play();
        rig.Begin("", null, 0, FlowStage.NoPlans); // the flow is left: the lines close again
        rig.Move(300);
        Assert.All(ofPair, e => Assert.Equal(rest[e.Id], layer.PathOf(e.Id)));
    }

    [AvaloniaFact]
    public void A_pointer_means_the_line_where_it_is_now_that_the_pair_has_parted()
    {
        var (scene, _, plans, layer, rig) = Rigged(0);
        rig.Begin("scan:0:0", "scan", 0, plans);
        rig.Move(500);
        var settled = rig.Store.Lam(Pair)!;
        foreach (var e in scene.Edges.Where(e => e.Pair == Pair))
        {
            var middle = Lane(scene, e, new LanePose(0, settled)); // its anchor is the middle of the line
            Assert.Equal(e.Id, layer.EdgeAt(new Point(middle.X, middle.Y)));
        }
    }

    [AvaloniaFact]
    public void A_lit_line_among_others_fades_to_half_when_its_step_times_out_and_a_lone_one_to_a_quarter()
    {
        var (_, shown, _, layer, _) = Rigged(0);
        layer.LitFade = 0.25;
        layer.LitFadeSeveral = Lanes.LitFloorLanes;
        Assert.Equal(Lanes.LitFloorLanes, Opacity(layer, shown.Strands![0]!)); // one of five lines

        var (_, lone, _, loneLayer, _) = Rigged(5);
        loneLayer.LitFade = 0.25;
        loneLayer.LitFadeSeveral = Lanes.LitFloorLanes;
        Assert.Equal(0.25, Opacity(loneLayer, lone.Strands![5]!)); // alone between its shapes
    }

    private static MotionLayer.RunSpec Run(Scene scene, SceneEdge e, StepAnimation animation, IReadOnlyList<double>? lit)
    {
        var (from, to) = (BoxOf(scene, e.From), BoxOf(scene, e.To));
        return new MotionLayer.RunSpec(animation, false, "straight", e.From, e.To, from.Rect, to.Rect, from.Edge, to.Edge, Strand: e.Id, Slot: e.Slot, Lit: lit);
    }

    private static SceneEdge Edge(Scene scene, string label) => scene.Edges.Single(e => e.Pair == Pair && e.Id.EndsWith("|" + label));

    private static double DistanceTo(IReadOnlyList<CorePt> polyline, double x, double y) => Lanes.DistanceTo(polyline, new CorePt(x, y));

    [AvaloniaFact]
    public void A_dot_runs_along_its_line_as_it_stands_once_the_pair_has_parted_and_the_beat_is_there()
    {
        var (scene, _, _, _, _) = Rigged(0);
        var scanResults = Edge(scene, "Scan results");
        var radio = Edge(scene, "Radio state"); // the last two lines of the pair, lit together: they part from each other
        var lit = Enumerable.Range(0, 5).Select(k => k >= 3 ? 1.0 : 0).ToList();
        var layer = new MotionLayer(new LaneStore());
        var send = new StepAnimation("send", "inside", null);
        var started = layer.Start([Run(scene, scanResults, send, lit), Run(scene, radio, send, lit)]);
        Assert.All(started, s => Assert.Contains(s.Beats, b => b.Do == "part" && b.At == 0 && b.Dur == Animations.PartMs)); // five lines: the pair parts
        layer.Show(850);
        var dots = layer.Dots;
        Assert.Equal(2, dots.Count);
        foreach (var (run, edge) in new[] { (0, scanResults), (1, radio) })
        {
            var parted = Lane(scene, edge, new LanePose(0, lit)).Points;
            var atRest = Lane(scene, edge, LanePose.Rest).Points;
            var dot = dots.Single(d => d.Run == run);
            Assert.True(DistanceTo(parted, dot.X, dot.Y) < 0.5, "the dot is on the lane as it will stand");
            Assert.True(DistanceTo(atRest, dot.X, dot.Y) > 5, "and not on the lane at rest");
        }
        // A step on a lone line, or in a project with one line to a pair, has no part beat at all.
        var alone = new MotionLayer(new LaneStore());
        var plain = alone.Start([new MotionLayer.RunSpec(send, false, "straight", scanResults.From, scanResults.To, BoxOf(scene, scanResults.From).Rect, BoxOf(scene, scanResults.To).Rect)]);
        Assert.DoesNotContain(plain[0].Beats, b => b.Do == "part");
    }

    [AvaloniaFact]
    public void The_marks_of_an_outcome_keep_to_the_gap_beside_their_line_and_a_marker_hangs_below_the_bundle()
    {
        var (scene, _, _, _, _) = Rigged(0);
        var edge = Edge(scene, "Scan results");
        var lit = Enumerable.Range(0, 5).Select(k => k == edge.Slot!.Value.Lane ? 1.0 : 0).ToList();
        var layer = new MotionLayer(new LaneStore());
        var rejected = new StepAnimation("call", "inside", null, "rejected");
        layer.Start([Run(scene, edge, rejected, lit)]);
        var bar = layer.AllBeats.Single(b => b.Do == "bar");
        var kept = layer.KeptOf(0);
        var (a, b) = (BoxOf(scene, edge.From), BoxOf(scene, edge.To));
        var gap = Lanes.GapBeside(a, b, edge.Slot!.Value, new LanePose(0, lit), bar.Along!.Value);
        Assert.Equal(Math.Min(1, Lanes.MarkReach(22, gap) / 22), kept[bar], 9); // the 44 px bar is held to the gap beside the lit line there
        Assert.True(kept[bar] < 1);
        Assert.True(kept[bar] > 0.25);

        // A marker for whoever takes an intercepted request hangs below the whole bundle: it stands the bundle's reach further out than it would for a line on its own.
        var intercepted = new StepAnimation("send", "inside", null, "intercepted", By: new Interceptor(Name: "Tap"));
        var among = new MotionLayer(new LaneStore());
        among.Start([Run(scene, edge, intercepted, lit)]);
        var reach = Lanes.BundleReach(a, b, edge.Slot.Value);
        Assert.True(reach > 30);
        var lone = new MotionLayer(new LaneStore());
        var plain = lone.Start([Run(scene, edge, intercepted, lit) with { Slot = null, Strand = null, Lit = null }]);
        // (The headless platform cannot measure a geometry, so the spot on the line the marker hangs from is the origin with the line running right, for both layers: the bundle's reach is the
        // only difference between them, and it is along the lower side of the line, which is straight down there.)
        var (withBundle, onItsOwn) = (among.TakerBoxOf(0)!.Value, lone.TakerBoxOf(0)!.Value);
        Assert.Equal(reach, (withBundle.Y + withBundle.Height / 2) - (onItsOwn.Y + onItsOwn.Height / 2), 6);
        Assert.Equal(onItsOwn.X + onItsOwn.Width / 2, withBundle.X + withBundle.Width / 2, 6);
        Assert.DoesNotContain(plain[0].Beats, beat => beat.Do == "part");
        Assert.Empty(lone.KeptOf(0)); // a line on its own keeps every mark whole
    }

    [AvaloniaFact]
    public void A_stream_runs_along_the_line_of_its_step_and_starts_out_of_step_with_its_neighbours()
    {
        var (scene, _, _, _, rig) = Rigged(0);
        var edge = Edge(scene, "Start scan");
        var (a, b) = (BoxOf(scene, edge.From), BoxOf(scene, edge.To));
        var channel = new Channel(0, "stream", "Rows", edge.From, edge.To, "to", false, false);
        var layer = new ChannelLayer(new LaneStore()) { Parts = rig.Store };
        var spec = new ChannelLayer.Spec("stream|0", channel, edge.From, edge.To, a.Rect, b.Rect, a.Edge, b.Edge, edge.To, 0, edge.Id, edge.Slot, edge.Pair);
        Assert.True(spec.Among);
        layer.Set([spec], "straight");
        Assert.Equal(Lanes.LaneGeometry(a, b, edge.Slot!.Value).Path, layer.LinePaths.Single()); // the stream's line is its own lane, not the pair's middle

        // The pair parts around another lane: the lane the stream is on is moved, and the stream follows it.
        var plans = new Dictionary<string, PartPlan> { [Pair] = new(Enumerable.Range(0, 5).Select(k => k == 4 ? 1.0 : 0).ToList()) };
        rig.Store.Changed += layer.Reroute;
        rig.Begin("k", "scan", 0, plans);
        rig.Move(400);
        var parted = new LanePose(0, rig.Store.Lam(Pair)!);
        Assert.Equal(Lanes.LaneGeometry(a, b, edge.Slot.Value, parted).Path, layer.LinePaths.Single());
        Assert.NotEqual(Lanes.LaneGeometry(a, b, edge.Slot.Value).Path, layer.LinePaths.Single());

        // The dots of neighbouring streams do not march in step; a lone line's dots start where they always did.
        Assert.Equal(0, Lanes.DashPhase(0, 5));
        var ahead = Lanes.DashPhase(edge.Slot.Value.Lane, 5);
        Assert.NotEqual(0, ahead);
        Assert.Equal(ahead, ChannelDraw.DotsAt(100, 0, false, false, ahead).First(), 9);
        Assert.Equal(ChannelDraw.Pitch - ahead, ChannelDraw.DotsAt(100, 0, true, false, ahead).First(), 9);
        Assert.Equal(0, ChannelDraw.DotsAt(100, 0, false, true, ahead).First()); // motion reduced: they stand where they began
        Assert.Equal(0, ChannelDraw.DotsAt(100, 0, false, false).First());
        Assert.True(ChannelDraw.BundledTetherRadius > 1); // the dotted line of a listener is thicker among its neighbours
    }

    [AvaloniaFact]
    public void A_channel_a_step_opens_belongs_to_the_line_the_step_names()
    {
        var temp = Directory.CreateTempSubdirectory("flowy-parts").FullName;
        try
        {
            File.Copy(Path.Combine(Dir, "model.yaml"), Path.Combine(temp, "model.yaml"));
            Directory.CreateDirectory(Path.Combine(temp, "flows"));
            File.WriteAllText(Path.Combine(temp, "flows", "rows.yaml"), """
                name: Rows
                view: root
                steps:
                  - { from: ui, to: management, text: Starts a scan, via: Start scan, animation: { kind: call, opens: stream, name: Rows } }
                  - { from: management, to: ui, text: Results, via: Scan results, animation: send }
                  - { from: management, to: bus, text: Publishes, animation: { kind: send, opens: listener, name: Events } }
                """);
            var folder = FolderLoader.Load(temp);
            var flow = folder.Model.Flows["rows"];
            var stops = Structure.Stops(flow);
            var open = FlowStage.OpenAt(folder.Model, "root", flow, stops, 1);
            var stream = Assert.Single(open, o => o.Channel.Kind == "stream");
            Assert.Equal("management ui|ui>management|Start scan", stream.StrandId);
            Assert.Equal(Pair, stream.Pair);
            Assert.Equal(new LaneSlot(1, 5, 3), stream.Slot);
            // A channel between two shapes that have one line between them is on that line, which is alone: no lane to follow.
            var listener = Assert.Single(FlowStage.OpenAt(folder.Model, "root", flow, stops, 2), o => o.Channel.Kind == "listener");
            Assert.Equal("bus management|management>bus|Events", listener.StrandId);
            Assert.Equal(new LaneSlot(0, 1, 1), listener.Slot); // one line, and it runs from the pair's later id to its earlier

            // And the steps that move carry the lit lanes of their pair for the motion layer.
            var shown = FlowStage.PlayingAt(folder.Model, "root", flow, stops, 0);
            var runs = FlowStage.RunsOf(folder.Model, "root", flow, stops, 0, shown);
            var run = Assert.Single(runs);
            Assert.Equal("management ui|ui>management|Start scan", run.Strand);
            Assert.Equal(Enumerable.Range(0, 5).Select(k => k == run.Slot!.Value.Lane ? 1.0 : 0), run.Lit);
        }
        finally
        {
            Directory.Delete(temp, true);
        }
    }

    /// <summary>Motion on, and the animations' clock held still, for as long as it is held: a test moves the player's clock by hand (the tests run on one thread and share the environment, which has motion off).</summary>
    private sealed class ByHand : IDisposable
    {
        public ByHand()
        {
            Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0");
            Anim.TestClock = () => 0;
        }

        public void Dispose()
        {
            Anim.TestClock = null;
            Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        }
    }

    private static string WithRowsFlow(string name)
    {
        var temp = Directory.CreateTempSubdirectory(name).FullName;
        File.Copy(Path.Combine(Dir, "model.yaml"), Path.Combine(temp, "model.yaml"));
        Directory.CreateDirectory(Path.Combine(temp, "flows"));
        File.WriteAllText(Path.Combine(temp, "flows", "rows.yaml"), """
            name: Rows
            view: root
            steps:
              - { from: ui, to: management, text: Starts a scan, via: Start scan, animation: { kind: call, opens: stream, name: Rows } }
              - { from: management, to: ui, text: Results, via: Scan results, animation: send }
            """);
        return temp;
    }

    /// <summary>Closes a window when the test is done, so nothing it was drawing goes on asking for frames while other tests run.</summary>
    private sealed class Closing(Avalonia.Controls.Window window) : IDisposable
    {
        public void Dispose() => window.Close();
    }

    [AvaloniaFact]
    public void The_canvas_parts_the_lines_by_the_players_clock_and_the_stream_follows_its_line()
    {
        var temp = WithRowsFlow("flowy-parts-canvas");
        try
        {
            var folder = FolderLoader.Load(temp);
            var flow = folder.Model.Flows["rows"];
            var stops = Structure.Stops(flow);
            var shown = FlowStage.PlayingAt(folder.Model, "root", flow, stops, 1);
            var scene = SceneBuilder.Build(folder.Model, "root", shown, folder.Problems);
            var plans = FlowStage.PartsAt(folder.Model, "root", flow, stops, 1, shown);
            var ofPair = scene.Edges.Where(e => e.Pair == Pair).ToList();
            var stream = ofPair.Single(e => e.Id.EndsWith("|Start scan"));
            string Expected(SceneEdge e, IReadOnlyList<double> lam) => Lane(scene, e, new LanePose(0, lam)).Path;

            using var _ = new ByHand();
            var canvas = new CanvasView();
            var window = new Avalonia.Controls.Window { Width = 1000, Height = 700, Content = canvas };
            window.Show();
            using var __ = new Closing(window); // its channel runs on the window's frames for as long as the window is there
            canvas.SetScene(scene, "straight", []);
            canvas.ShowChannels(FlowStage.OpenAt(folder.Model, "root", flow, stops, 1));
            Dispatcher.UIThread.RunJobs();
            Assert.All(ofPair, e => Assert.Equal(Expected(e, []), canvas.LinePath(e.Id))); // nothing is parted until the stop begins
            Assert.Equal(Expected(stream, []), canvas.ChannelLinePaths.Single());

            canvas.Clock.Begin("rows:1:0");
            canvas.PartStop("rows", 1, plans);
            canvas.Clock.Seek(300);
            var lam = canvas.Parts.Lam(Pair)!;
            Assert.Equal(1.0, Assert.Single(lam, l => l > 0)); // the line the step rides is lit, and the pair has finished parting
            Assert.All(ofPair, e => Assert.Equal(Expected(e, lam), canvas.LinePath(e.Id)));
            Assert.Equal(Expected(stream, lam), canvas.ChannelLinePaths.Single()); // the stream moved with its line
            Assert.NotEqual(Expected(stream, []), canvas.ChannelLinePaths.Single());

            canvas.Clock.Seek(0); // dragged back to the start of the stop
            Assert.All(ofPair, e => Assert.Equal(Expected(e, []), canvas.LinePath(e.Id)));
            Assert.Equal(Expected(stream, []), canvas.ChannelLinePaths.Single());
            canvas.Clock.Seek(112.5);
            var half = canvas.Parts.Lam(Pair)!;
            Assert.All(ofPair, e => Assert.Equal(Expected(e, half), canvas.LinePath(e.Id)));
            Assert.Contains(half, l => l > 0 && l < 1);
        }
        finally
        {
            Directory.Delete(temp, true);
        }
    }

    [AvaloniaFact]
    public void With_motion_reduced_the_canvas_parts_the_pair_at_once_and_leaving_the_flow_closes_it()
    {
        var (folder, flow, stops) = Scan();
        var shown = FlowStage.PlayingAt(folder.Model, "root", flow, stops, 0);
        var scene = SceneBuilder.Build(folder.Model, "root", shown, folder.Problems);
        var plans = FlowStage.PartsAt(folder.Model, "root", flow, stops, 0, shown);
        var ofPair = scene.Edges.Where(e => e.Pair == Pair).ToList();
        var canvas = new CanvasView();
        var window = new Avalonia.Controls.Window { Width = 1000, Height = 700, Content = canvas };
        window.Show();
        using var _ = new Closing(window);
        canvas.SetScene(scene, "straight", []); // the tests run with motion off
        canvas.Clock.Begin("scan:0:0");
        canvas.PartStop("scan", 0, plans);
        var lam = canvas.Parts.Lam(Pair)!;
        Assert.Equal(1.0, Assert.Single(lam, l => l > 0));
        Assert.All(ofPair, e => Assert.Equal(Lane(scene, e, new LanePose(0, lam)).Path, canvas.LinePath(e.Id)));
        Assert.Contains(ofPair, e => canvas.LinePath(e.Id) != Lane(scene, e, LanePose.Rest).Path);

        canvas.Clock.Begin(""); // no flow plays
        canvas.PartStop(null, 0, FlowStage.NoPlans);
        Assert.Null(canvas.Parts.Lam(Pair)); // reduced motion: closed at once too
        Assert.All(ofPair, e => Assert.Equal(Lane(scene, e, LanePose.Rest).Path, canvas.LinePath(e.Id)));
    }

    [AvaloniaFact]
    public void The_reader_parts_the_pair_each_stop_rides_moves_the_lit_line_with_the_step_and_closes_the_pair_for_a_step_elsewhere()
    {
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1"); // the stops settle at once: nothing here waits on the clock
        var reader = new ReaderView();
        var window = new Avalonia.Controls.Window { Width = 1280, Height = 800, Content = reader };
        window.Show();
        using var _ = new Closing(window);
        reader.Load(FolderLoader.Load(Dir), Dir);
        reader.GoTo("root");
        Dispatcher.UIThread.RunJobs();
        var (folder, _, _) = Scan();
        var scene = SceneBuilder.Build(folder.Model, "root", null, folder.Problems);
        var ofPair = scene.Edges.Where(e => e.Pair == Pair).ToList();

        (int Stop, string Label)[] lit = [(0, "Start scan"), (1, "Scan results"), (2, "Radio state")];
        foreach (var (stop, label) in lit)
        {
            reader.Play("scan", stop);
            var lam = reader.Canvas.Parts.Lam(Pair)!;
            var edge = ofPair.Single(e => e.Id.EndsWith("|" + label));
            Assert.Equal(1.0, lam[edge.Slot!.Value.Lane]); // the line the step rides is the one lit: the step names it, or its way and the order of the file do
            Assert.Equal(1, lam.Count(l => l > 0));
            Assert.All(ofPair, e => Assert.Equal(Lane(scene, e, new LanePose(0, lam)).Path, reader.Canvas.LinePath(e.Id)));
        }
        reader.Play("scan", 3); // Management to Linux: another pair
        Assert.Null(reader.Canvas.Parts.Lam(Pair));
        Assert.All(ofPair, e => Assert.Equal(Lane(scene, e, LanePose.Rest).Path, reader.Canvas.LinePath(e.Id)));
        Assert.NotNull(reader.Canvas.Parts.Lam(Views.LineKey("management", "linux")));
        reader.Play("scan", 5); // Management to the Bus: a line on its own has no lanes to part
        Assert.Empty(reader.Canvas.Parts.Pairs);
    }
}
