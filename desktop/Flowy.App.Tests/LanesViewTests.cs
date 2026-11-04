using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Interactivity;
using Avalonia.LogicalTree;
using Avalonia.Threading;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;
using CorePt = Flowy.Core.Pt;
using CoreRect = Flowy.Core.Rect;

namespace Flowy.App.Tests;

/// <summary>
/// How the desktop draws a project that draws a line for each connection (desktop/fixtures/cases/draft-lanes): the lines of a pair side by side, which one a pointer means, where their labels
/// go, the panel that lists them with Move up and Move down, and the line a step rides. The geometry, the scene and the strands are core's, which the fixtures pin against the browser; these hold
/// what the app does with them. Headless: no window opens, and nothing here plays an animation or drives a whole reader.
/// </summary>
public class LanesViewTests
{
    private static string Dir => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "draft-lanes", "flowy");

    private static Folder Load() => FolderLoader.Load(Dir);

    private static Scene SceneOf(Folder folder, Focus? focus = null, Playing? playing = null) => SceneBuilder.Build(folder.Model, "root", playing, folder.Problems, focus ?? new Focus());

    /// <summary>A line as the canvas makes it: from the places of the boxes of the scene, in the pose the scene gives its pair.</summary>
    private static LaneLine Lane(Scene scene, SceneEdge e)
    {
        LaneBox Box(string id)
        {
            var b = scene.Boxes.First(x => x.Id == id);
            return new LaneBox(id, b.Rect, Look.DefOf(b.Object).Edge);
        }
        return Lanes.LaneGeometry(Box(e.From), Box(e.To), e.Slot!.Value, e.Spread ? LanePose.Spread : LanePose.Rest);
    }

    private static CorePt Middle(LaneLine lane) => new(lane.X, lane.Y);

    private static BackLayer Layer(Scene scene, double zoom = 1)
    {
        var layer = new BackLayer(new LaneStore()) { Viewport = new Viewport(0, 0, zoom) };
        layer.SetScene(scene, "straight");
        return layer;
    }

    private static Point Screen(CorePt world, double zoom = 1) => new(world.X * zoom, world.Y * zoom);

    [AvaloniaFact]
    public void A_line_is_drawn_for_each_connection_with_its_pair_and_its_place_among_the_lines_of_the_pair()
    {
        var folder = Load();
        var scene = SceneOf(folder);
        // The lines as drawn: the nine connections of Management and Sensor are more than a pair draws side by side, so they are folded into trunks (see TrunksViewTests).
        var strands = Trunks.Draw(folder.Model, "root").View.Strands!;
        Assert.Equal(strands.Select(s => s.Id), scene.Edges.Select(e => e.Id));
        Assert.Equal(Views.Compute(folder.Model, "root").Strands!.Count(s => s.Pair != Views.LineKey("management", "sensor")), scene.Edges.Count(e => e.Pair != Views.LineKey("management", "sensor")));
        Assert.All(scene.Edges.Where(e => e.Pair == Views.LineKey("management", "sensor")), e => Assert.NotNull(e.Trunk));
        Assert.All(scene.Edges, e => Assert.NotNull(e.Pair));
        var pair = scene.Edges.Where(e => e.Pair == Views.LineKey("ui", "management")).ToList();
        Assert.Equal(5, pair.Count);
        Assert.All(pair, e => Assert.Equal(5, e.Lanes));
        Assert.Equal([0, 1, 2, 3, 4], pair.Select(e => e.Slot!.Value.Lane));
        Assert.All(scene.Edges, e => Assert.Null(e.Label));
        Assert.All(scene.Edges, e => Assert.Equal(e.Pair, SceneBuilder.PairOf(e)));
    }

    [AvaloniaFact]
    public void A_pointer_on_a_line_means_that_line_and_one_between_two_means_the_nearer()
    {
        var scene = SceneOf(Load());
        var layer = Layer(scene);
        var lanes = scene.Edges.Where(e => e.Lanes > 1).ToList();
        Assert.True(lanes.Count > 10);
        foreach (var e in lanes) Assert.Equal(e.Id, layer.EdgeAt(Screen(Middle(Lane(scene, e)))));

        // The three lines of Management and Cloud run one way, 12 px apart: 5.9 px from one towards the next is still the first.
        var cloud = scene.Edges.Where(e => e.Pair == Views.LineKey("cloud", "management")).OrderBy(e => e.Slot!.Value.Lane).ToList();
        Assert.Equal(3, cloud.Count);
        var (a, b) = (Middle(Lane(scene, cloud[0])), Middle(Lane(scene, cloud[1])));
        var gap = Math.Sqrt((b.X - a.X) * (b.X - a.X) + (b.Y - a.Y) * (b.Y - a.Y));
        Assert.InRange(gap, 11.9, 12.1);
        CorePt Towards(double px) => new(a.X + (b.X - a.X) / gap * px, a.Y + (b.Y - a.Y) / gap * px);
        Assert.Equal(cloud[0].Id, layer.EdgeAt(Screen(Towards(5.9))));
        Assert.Equal(cloud[1].Id, layer.EdgeAt(Screen(Towards(6.1))));
        Assert.Null(layer.EdgeAt(new Point(-900, -900)));
    }

    [AvaloniaFact]
    public void The_pointer_is_measured_in_screen_pixels_so_zoomed_out_lines_stay_pickable()
    {
        var scene = SceneOf(Load());
        const double zoom = 0.5;
        var layer = Layer(scene, zoom);
        foreach (var e in scene.Edges.Where(e => e.Lanes > 1)) Assert.Equal(e.Id, layer.EdgeAt(Screen(Middle(Lane(scene, e)), zoom)));
        var cloud = scene.Edges.Where(e => e.Pair == Views.LineKey("cloud", "management")).OrderBy(e => e.Slot!.Value.Lane).ToList();
        var (a, b) = (Screen(Middle(Lane(scene, cloud[0])), zoom), Screen(Middle(Lane(scene, cloud[1])), zoom));
        var gap = Math.Sqrt((b.X - a.X) * (b.X - a.X) + (b.Y - a.Y) * (b.Y - a.Y));
        Assert.InRange(gap, 5.9, 6.1); // the lines are 6 px apart on the screen now
        Point Towards(double px) => new(a.X + (b.X - a.X) / gap * px, a.Y + (b.Y - a.Y) / gap * px);
        Assert.Equal(cloud[0].Id, layer.EdgeAt(Towards(2.9)));
        Assert.Equal(cloud[1].Id, layer.EdgeAt(Towards(3.1)));
    }

    [AvaloniaFact]
    public void Zoomed_in_the_reach_is_still_seven_screen_pixels_so_the_same_click_means_the_same_line_as_in_the_browser()
    {
        var scene = SceneOf(Load());
        const double zoom = 2;
        var layer = Layer(scene, zoom);
        foreach (var e in scene.Edges.Where(e => e.Lanes > 1)) Assert.Equal(e.Id, layer.EdgeAt(Screen(Middle(Lane(scene, e)), zoom)));
        var cloud = scene.Edges.Where(e => e.Pair == Views.LineKey("cloud", "management")).OrderBy(e => e.Slot!.Value.Lane).ToList();
        var (a, b) = (Screen(Middle(Lane(scene, cloud[0])), zoom), Screen(Middle(Lane(scene, cloud[1])), zoom));
        var gap = Math.Sqrt((b.X - a.X) * (b.X - a.X) + (b.Y - a.Y) * (b.Y - a.Y));
        Assert.InRange(gap, 23.9, 24.1); // the lines are 24 px apart on the screen now
        Point Towards(double px) => new(a.X + (b.X - a.X) / gap * px, a.Y + (b.Y - a.Y) / gap * px);
        Assert.Equal(cloud[0].Id, layer.EdgeAt(Towards(6.9)));
        Assert.Null(layer.EdgeAt(Towards(7.1))); // 7 px is the reach on the screen, 3.5 canvas units here, and the next line is far
    }

    [Fact]
    public void The_badge_of_a_pair_of_lines_sits_above_its_middle_as_in_the_browser()
    {
        var rect = BackLayer.PairBadgeRect(new CorePt(100, 200), 24);
        Assert.Equal(new Avalonia.Rect(88, 170, 24, 20), rect); // translate(-50%, -150%) of the badge: its bottom 10 px above the middle
    }

    [AvaloniaFact]
    public void A_pair_that_is_picked_spreads_and_the_pointer_follows_its_lines_where_they_are_now()
    {
        var folder = Load();
        var pair = Views.LineKey("ui", "management");
        var rest = SceneOf(folder);
        var scene = SceneOf(folder, new Focus(Line: pair));
        var lanes = scene.Edges.Where(e => e.Pair == pair).ToList();
        Assert.All(lanes, e => Assert.True(e.Spread));
        Assert.All(lanes, e => Assert.True(e.Selected)); // all its lines are picked
        Assert.All(scene.Edges.Where(e => e.Pair != pair), e => Assert.False(e.Spread));
        var layer = Layer(scene);
        foreach (var e in lanes)
        {
            var spread = Lane(scene, e);
            Assert.Equal(25, spread.Points.Count); // moved sideways in the middle: 24 short curves
            Assert.Equal(e.Id, layer.EdgeAt(Screen(Middle(spread))));
            Assert.NotEqual(Middle(Lane(rest, rest.Edges.First(r => r.Id == e.Id))), Middle(spread)); // the middle moved, the ends did not
        }
    }

    /// <summary>Motion on, and the animations' clock held still, for as long as it is held: a test moves the ease by hand (the tests run on one thread and share the environment, which has motion off).</summary>
    private sealed class EaseByHand : IDisposable
    {
        public EaseByHand()
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

    [AvaloniaFact]
    public void A_pair_that_is_picked_eases_to_spread_over_160_ms_and_eases_back_and_a_pair_seen_first_starts_where_it_is_going()
    {
        using var _ = new EaseByHand();
        var folder = Load();
        var pair = Views.LineKey("ui", "management");
        var rest = SceneOf(folder);
        var picked = SceneOf(folder, new Focus(Line: pair));
        var edge = picked.Edges.Where(e => e.Pair == pair).OrderBy(e => e.Slot!.Value.Lane).First(); // the outermost lane moves most
        LaneLine At(double s) => Lanes.LaneGeometry(Box(picked, edge.From), Box(picked, edge.To), edge.Slot!.Value, new LanePose(s, []));

        // A layer that opens on a picked pair shows it spread: nothing moves when a view opens.
        Assert.Equal(1, Layer(picked).SpreadOf(edge.Id));

        var layer = Layer(rest);
        Assert.Equal(0, layer.SpreadOf(edge.Id));
        layer.SetScene(picked, "straight");
        Assert.Equal(0, layer.SpreadOf(edge.Id)); // picked, and not there yet: no jump
        layer.Ease(80);
        Assert.Equal(0.5, layer.SpreadOf(edge.Id)); // half the time is half of the ease at the middle
        var half = At(0.5);
        Assert.Equal(edge.Id, layer.EdgeAt(Screen(Middle(half)))); // the pointer follows the lane where it is now
        Assert.NotEqual(Middle(At(0)), Middle(half));
        Assert.NotEqual(Middle(At(1)), Middle(half));
        layer.Ease(80);
        Assert.Equal(1, layer.SpreadOf(edge.Id));
        layer.Ease(80); // it stays
        Assert.Equal(1, layer.SpreadOf(edge.Id));

        // Back to rest at the same speed, and turned round half way it goes back from where it is.
        layer.SetScene(rest, "straight");
        layer.Ease(80);
        Assert.Equal(0.5, layer.SpreadOf(edge.Id));
        layer.SetScene(picked, "straight");
        layer.Ease(40);
        Assert.Equal(0.84375, layer.SpreadOf(edge.Id)); // progress 0.75, eased: 0.75 squared times (3 less 1.5), at 27 of 32 steps
        layer.Ease(40);
        Assert.Equal(1, layer.SpreadOf(edge.Id));

        // A line alone between its shapes has nothing to spread.
        Assert.Equal(0, layer.SpreadOf(picked.Edges.First(e => e.Lanes == 1).Id));
    }

    [AvaloniaFact]
    public void With_reduced_motion_a_pair_snaps_to_spread_and_back()
    {
        var folder = Load();
        var pair = Views.LineKey("ui", "management");
        var picked = SceneOf(folder, new Focus(Line: pair));
        var id = picked.Edges.First(e => e.Pair == pair).Id;
        var layer = Layer(SceneOf(folder)); // the tests run with motion off
        layer.SetScene(picked, "straight");
        Assert.Equal(1, layer.SpreadOf(id));
        layer.SetScene(SceneOf(folder), "straight");
        Assert.Equal(0, layer.SpreadOf(id));
    }

    private static LaneBox Box(Scene scene, string id)
    {
        var b = scene.Boxes.First(x => x.Id == id);
        return new LaneBox(id, b.Rect, Look.DefOf(b.Object).Edge);
    }

    [AvaloniaFact]
    public void The_line_pointed_at_among_the_lines_of_its_pair_is_drawn_last_and_the_others_of_the_pair_fade_to_85_percent()
    {
        var folder = Load();
        var pair = Views.LineKey("ui", "management");
        var lanes = SceneOf(folder).Edges.Where(e => e.Pair == pair).OrderBy(e => e.Slot!.Value.Lane).Select(e => e.Id).ToList();
        Assert.Equal(5, lanes.Count);
        var others = SceneOf(folder).Edges.Where(e => e.Pair != pair).Select(e => e.Id).ToList();

        // The first lane pointed at: it is under its neighbours in the order of the file, and now on top of everything.
        var layer = Layer(SceneOf(folder, new Focus(Hover: lanes[0])));
        Assert.Equal(lanes[0], layer.DrawOrder().Last());
        Assert.Equal(1, layer.OpacityOf(lanes[0]));
        Assert.All(lanes.Skip(1), id => Assert.Equal(Lanes.SiblingOpacity, layer.OpacityOf(id)));
        Assert.Equal(0.85, Lanes.SiblingOpacity);
        Assert.All(others, id => Assert.Equal(1, layer.OpacityOf(id))); // other pairs are as they were
        Assert.Equal(layer.DrawOrder().Where(id => id != lanes[0]), Layer(SceneOf(folder)).DrawOrder().Where(id => id != lanes[0])); // nothing else moved in the order

        // The pointer moving away puts everything back.
        layer.SetScene(SceneOf(folder), "straight");
        Assert.All(lanes, id => Assert.Equal(1, layer.OpacityOf(id)));
        Assert.Equal(Layer(SceneOf(folder)).DrawOrder(), layer.DrawOrder());

        // The whole pair pointed at (its row in a panel) raises none of its lines and fades none.
        layer.SetScene(SceneOf(folder, new Focus(Hover: pair)), "straight");
        Assert.All(lanes, id => Assert.Equal(1, layer.OpacityOf(id)));
        Assert.Equal(Layer(SceneOf(folder)).DrawOrder(), layer.DrawOrder());
    }

    [AvaloniaFact]
    public void The_labels_of_a_pair_that_is_spread_each_start_with_a_sample_of_their_line()
    {
        var folder = Load();
        var pair = Views.LineKey("ui", "management");
        var scene = SceneOf(folder, new Focus(Line: pair));
        var layer = Layer(scene);
        var labels = layer.LabelRects;
        var shown = scene.Edges.Where(e => e.Label is not null).ToList();
        Assert.Equal(5, shown.Count);
        Assert.Equal(5, labels.Count);
        Assert.All(labels, r => Assert.True(r.Width > LineLabels.Sample + 8));
        // Each label slides along its own line (it is never stacked above or below the middle, where another line is), so no two sit on the same spot. Where the shapes are close the
        // five do not all fit clear of one another, in the browser too: the algorithm takes the least bad place for each.
        Assert.Equal(5, labels.Select(l => (Math.Round(l.Center.X), Math.Round(l.Center.Y))).Distinct().Count());
    }

    [AvaloniaFact]
    public void A_line_among_others_is_asked_for_by_its_slot_and_a_line_on_its_own_is_as_it_always_was()
    {
        var store = new LaneStore();
        var a = new LaneEnd("a", new CoreRect(0, 0, 200, 72), null);
        var b = new LaneEnd("b", new CoreRect(400, 120, 200, 72), null);
        var slot = new LaneSlot(1, 3, 0);
        var lane = store.PathFor("a>b|x", "curved", a, b, null, slot);
        var made = Lanes.LaneGeometry(new LaneBox("a", a.Rect, null), new LaneBox("b", b.Rect, null), slot, null, "curved");
        Assert.Equal(made.Path, lane.Path.Data); // the lane it is among them, in the project's style
        Assert.Contains('C', made.Path);
        Assert.NotEqual(Lanes.LaneGeometry(new LaneBox("a", a.Rect, null), new LaneBox("b", b.Rect, null), slot).Path, made.Path);
        Assert.Equal(Lanes.LaneGeometry(new LaneBox("a", a.Rect, null), new LaneBox("b", b.Rect, null), slot).Path, store.PathFor("a>b|s", "straight", a, b, null, slot).Path.Data);
        Assert.Equal(made.Points, lane.Points);
        Assert.Same(lane, store.PathFor("a>b|x", "curved", a, b, null, slot));
        Assert.NotSame(lane, store.PathFor("a>b|y", "curved", a, b, null, new LaneSlot(2, 3, 0)));
        var spread = store.PathFor("a>b|z", "curved", a, b, LanePose.Spread, new LaneSlot(2, 3, 0));
        Assert.Equal(Lanes.Samples + 1, spread.Points!.Count);
        Assert.NotSame(lane, spread);
        Assert.Same(spread, store.PathFor("a>b|z", "curved", a, b, new LanePose(1, []), new LaneSlot(2, 3, 0)));
        Assert.Equal(lane.Path.Data, store.PathFor("a>b|x", "curved", a, b, LanePose.Spread, slot).Path.Data); // the middle one of three is on the line between the shapes: spreading leaves it where it is
        // Alone between its two shapes, a line has no slot of two lanes or more: the pose changes nothing, and the style is the style.
        var alone = store.PathFor("a>b", "curved", a, b, LanePose.Spread, new LaneSlot(0, 1, 0));
        Assert.Equal(LinePaths.Build("curved", a.Rect, b.Rect), alone.Path);
        Assert.Null(alone.Points);
    }

    [AvaloniaFact]
    public void A_step_rides_the_line_it_names_and_the_pipe_of_its_motion_runs_along_that_line()
    {
        var folder = Load();
        var model = folder.Model;
        var flow = model.Flows["scan"];
        var stops = Structure.Stops(flow);
        var view = Views.Compute(model, "root");
        var playing = FlowStage.PlayingAt(model, "root", flow, stops, 0);
        Assert.NotNull(playing.Strands);
        Assert.Equal("management ui|ui>management|Start scan", playing.Strands![0]); // the step names it with via
        var scene = SceneOf(folder, playing: playing);
        Assert.Equal(["management ui|ui>management|Start scan"], scene.Edges.Where(e => e.Flags.HasFlag(EdgeFlags.Active)).Select(e => e.Id));
        Assert.All(scene.Edges.Where(e => e.Flags.HasFlag(EdgeFlags.Dim)), e => Assert.NotEqual(playing.Strands[0], e.Id));
        Assert.DoesNotContain(scene.Edges, e => e.Id.StartsWith("step")); // it rides a line, so it needs no dashed one
        Assert.All(scene.Edges.Where(e => e.Flags.HasFlag(EdgeFlags.Active)), e => Assert.False(e.Spread)); // a step wins over a pair spreading

        // A step on a pair of one line rides that line.
        var last = FlowStage.PlayingAt(model, "root", flow, Structure.Stops(flow), 5);
        Assert.Equal("bus management|management>bus|Events", last.Strands![5]);

        // What RunsOf hands the canvas: the line the step rides and its place among its pair's lines.
        var moving = flow with { Steps = [.. flow.Steps.Select(s => s with { Animation = "send" })] };
        var runs = FlowStage.RunsOf(model, "root", moving, Structure.Stops(moving), 0, FlowStage.PlayingAt(model, "root", moving, Structure.Stops(moving), 0));
        var run = Assert.Single(runs);
        Assert.Equal(playing.Strands[0], run.Strand);
        Assert.Equal(Lanes.SlotsOf(view.Strands!)[run.Strand!], run.Slot);
    }

    [AvaloniaFact]
    public async Task The_panel_of_a_picked_line_rings_its_connection_and_in_edit_mode_moves_connections_up_and_down_in_the_order_of_the_lines()
    {
        var folder = Load();
        var model = folder.Model;
        var doc = EditDoc.Parse(File.ReadAllText(Path.Combine(Dir, "model.yaml")), null, []);
        var panel = new SidePanel();
        var window = new Window { Width = 420, Height = 1400, Content = panel };
        window.Show();
        var strand = "management ui|management>ui|Radio state";

        panel.ShowLine(model, "root", "management", "ui", folder.Problems, strand);
        window.UpdateLayout();
        var ringed = panel.GetLogicalDescendants().OfType<Border>().Where(b => b.Classes.Contains("current")).ToList();
        var card = Assert.Single(ringed); // only the connection that is the picked line
        Assert.Contains(card.GetLogicalDescendants().OfType<TextBlock>(), t => t.Text == "Radio state");
        Assert.Equal(5, panel.GetLogicalDescendants().OfType<LookSwatch>().Count(s => s.Width == 44)); // each card says what its own kind is, kind or none

        Task<bool> Run(Func<EditDoc, EditDoc> op)
        {
            doc = op(doc);
            return Task.FromResult(true);
        }
        panel.ShowLineEditor(model, "root", "management", "ui", [], Run, () => { }, (_, _) => { }, strand);
        window.UpdateLayout();
        var form = panel.CurrentLineEditor!;
        Assert.Equal([3], form.CurrentConnections.Select(i => i)); // Radio state is the fourth connection of the file
        var moves = form.MoveButtons;
        Assert.Equal(5, moves.Count);
        Assert.All(moves, m => Assert.True(m.Shown));
        // The three lines that run one way, then the two that run the other: the first of each cannot go up and the last cannot go down.
        // (The form lists the two that run from Management to UI first, as the panel does, then the three that run the other way.)
        Assert.Equal([false, true, false, true, true], moves.Select(m => m.Up.IsEnabled));
        Assert.Equal([true, false, true, true, false], moves.Select(m => m.Down.IsEnabled));
        Assert.Equal(Lanes.AlreadyFirst, ToolTip.GetTip(moves[0].Up));
        Assert.Equal(Lanes.AlreadyLast, ToolTip.GetTip(moves[1].Down));
        // A greyed-out button takes no pointer, so the reason only shows if the tip is allowed on a disabled control.
        Assert.All(moves, m => { Assert.True(ToolTip.GetShowOnDisabled(m.Up)); Assert.True(ToolTip.GetShowOnDisabled(m.Down)); });

        // Move down on the first of the three: it goes after the second, and nothing else about any connection changes.
        moves[2].Down.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        await Task.Yield();
        Dispatcher.UIThread.RunJobs();
        var labels = doc.ToModel().Connections.Take(5).Select(c => c.Label).ToList();
        Assert.Equal(["Start scan", "Request and reply", "Scan results", "Radio state", "Set country"], labels);
        Assert.Equal(model.Connections.Count, doc.ToModel().Connections.Count);

        // A connection with no other going its way keeps the buttons and greys both out with the reason: they are never hidden where each connection has a line of its own.
        panel.ShowLineEditor(model, "root", "management", "linux", [], Run, () => { }, (_, _) => { });
        window.UpdateLayout();
        var lone = panel.CurrentLineEditor!.MoveButtons; // Management and Linux: one connection each way, so each is the only one going its way
        Assert.Equal(2, lone.Count);
        Assert.All(lone, m =>
        {
            Assert.True(m.Shown);
            Assert.False(m.Up.IsEnabled);
            Assert.False(m.Down.IsEnabled);
            Assert.Equal(Lanes.OnlyLineThisWay, ToolTip.GetTip(m.Up));
            Assert.Equal(Lanes.OnlyLineThisWay, ToolTip.GetTip(m.Down));
        });

        // In a project that draws one line for each pair there are no lanes to order, and the buttons are not there.
        var merged = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "edit", "flowy")).Model;
        panel.ShowLineEditor(merged, "shop", "web", "api", [], Run, () => { }, (_, _) => { });
        window.UpdateLayout();
        Assert.All(panel.CurrentLineEditor!.MoveButtons, m => Assert.False(m.Shown));
    }

    [AvaloniaFact]
    public void Pointing_at_a_connection_in_a_boxs_panel_lights_its_own_line_where_each_connection_has_one()
    {
        var model = Load().Model;
        var drawn = SidePanel.StrandsOf(model, "root")!;
        var sensor = model.Connections.Where(c => c.From == "sensor" || c.To == "sensor").ToList();
        Assert.Equal(sensor.Count, sensor.Select(c => drawn[c]).Distinct().Count()); // two connections, two lines, even with equal ends
        Assert.Equal("management ui|ui>management|Start scan", drawn[model.Connections[1]]);
        var merged = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "edit", "flowy")).Model;
        Assert.Null(SidePanel.StrandsOf(merged, "shop"));
    }
}
