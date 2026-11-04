using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;
using CorePt = Flowy.Core.Pt;

namespace Flowy.App.Tests;

/// <summary>
/// How the desktop draws a pair with more lines than fit across its shapes (desktop/fixtures/cases/trunks): trunks with their hairlines and chip, the line a click on one picks, the lines a selected
/// pair opens its trunks into, the line a step rides, and the two key items. The folding, the slots and the scene are core's, which the fixtures pin against the browser; these hold what the app does
/// with them. Headless: no window opens, and nothing here plays an animation or drives a whole reader.
/// </summary>
public class TrunksViewTests
{
    private static Folder Load() => FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "trunks", "flowy"));

    private static Scene SceneOf(Folder folder, string style = "straight", string? opened = null, Playing? playing = null, Focus? focus = null) =>
        SceneBuilder.Build(folder.Model, "root", playing, folder.Problems, focus ?? new Focus(), new SceneDrawing(style, opened));

    private static BackLayer Layer(Scene scene, string style = "straight")
    {
        var layer = new BackLayer(new LaneStore()) { Viewport = new Viewport(0, 0, 1) };
        layer.SetScene(scene, style);
        return layer;
    }

    private static LaneBox BoxOf(Scene scene, string id)
    {
        var b = scene.Boxes.First(x => x.Id == id);
        return new LaneBox(id, b.Rect, Look.DefOf(b.Object).Edge);
    }

    /// <summary>The middle of a line as the canvas draws it: where its chip sits, and where a pointer means it.</summary>
    private static CorePt Middle(Scene scene, SceneEdge e)
    {
        LaneEnd End(string id) => new(id, BoxOf(scene, id).Rect, BoxOf(scene, id).Edge);
        return new LaneStore().PathFor(e.Id, "straight", End(e.From), End(e.To), LanePose.Rest, e.Slot).Path.Label;
    }

    [AvaloniaFact]
    public void A_pair_with_too_many_lines_is_drawn_as_trunks_with_their_chips_and_a_pair_that_fits_keeps_its_lines()
    {
        var scene = SceneOf(Load());
        var trunks = scene.Edges.Where(e => e.Trunk is not null).ToList();
        Assert.True(trunks.Count >= 8);
        Assert.All(trunks, e => Assert.Contains(Trunks.Mark, e.Id));
        Assert.All(trunks, e => Assert.Equal(e.Trunk!.Members.Count, e.Trunk.Size)); // one connection to a line in this case
        // Hub and Store: six lines one way, a trunk of six alone on its pair.
        var store = Assert.Single(scene.Edges, e => e.Pair == Views.LineKey("hub", "store"));
        Assert.Equal(6, store.Trunk!.Size);
        Assert.Equal(1, store.Lanes);
        // Hub and Cloud: three and two lines, which fit across 72 px with a trunk each.
        Assert.Equal(2, scene.Edges.Count(e => e.Pair == Views.LineKey("hub", "cloud")));
        var layer = Layer(scene);
        Assert.All(trunks, e => Assert.NotNull(layer.PathOf(e.Id)));
    }

    [AvaloniaFact]
    public void A_click_on_a_trunk_means_the_trunk_and_picks_the_first_of_its_lines()
    {
        var scene = SceneOf(Load());
        var layer = Layer(scene);
        // Hub and UI: two trunks side by side, so a pointer is asked of the lanes (the core's nearest line), at the middle of each.
        var pair = scene.Edges.Where(e => e.Pair == Views.LineKey("hub", "ui")).ToList();
        Assert.Equal(2, pair.Count);
        Assert.All(pair, e => Assert.NotNull(e.Trunk));
        foreach (var e in pair)
        {
            var at = Middle(scene, e);
            Assert.Equal(e.Id, layer.EdgeAt(new Point(at.X, at.Y)));
            Assert.Equal(e.Trunk!.Members[0], e.PickedId);
        }
        // A line that is no trunk picks itself. (Across the diamond the curved style has more room than the straight one, so the seven lines of Diamond and Hub are lanes there and a trunk here.)
        Assert.Single(scene.Edges, e => e.Pair == Views.LineKey("diam", "hub") && e.Trunk is not null);
        var curved = SceneOf(Load(), "curved");
        var lanes = curved.Edges.Where(e => e.Pair == Views.LineKey("diam", "hub")).ToList();
        Assert.Equal(7, lanes.Count);
        Assert.All(lanes, e => Assert.Equal(e.Id, e.PickedId));
    }

    [AvaloniaFact]
    public void Picking_a_line_of_a_trunk_opens_its_pair_into_lines_and_a_step_playing_on_the_pair_keeps_it_shut()
    {
        var folder = Load();
        var closed = SceneOf(folder);
        var store = closed.Edges.Single(e => e.Pair == Views.LineKey("hub", "store"));
        var picked = store.PickedId;

        var opened = SceneOf(folder, opened: picked, focus: new Focus(Line: picked));
        var lines = opened.Edges.Where(e => e.Pair == store.Pair).ToList();
        Assert.Equal(6, lines.Count);
        Assert.All(lines, e => Assert.Null(e.Trunk));
        Assert.All(lines, e => Assert.Equal(6, e.Lanes));
        Assert.All(lines, e => Assert.True(e.Spread)); // the pair is selected, so its lines spread to show their labels
        Assert.Equal([0, 1, 2, 3, 4, 5], lines.Select(e => e.Slot!.Value.Within!.Value));
        Assert.Contains(lines, e => e.Selected);
        // The other pairs stay as they were.
        Assert.Equal(closed.Edges.Count(e => e.Pair != store.Pair), opened.Edges.Count(e => e.Pair != store.Pair));

        // The lines are in the layer, each pickable where it is.
        var layer = Layer(opened);
        foreach (var e in lines) Assert.NotNull(layer.PathOf(e.Id));

        // A step playing on the pair wins: the trunk stays a trunk, lit.
        var model = folder.Model;
        var flow = model.Flows["tour"];
        var playing = FlowStage.PlayingAt(model, "root", flow, Structure.Stops(flow), 2);
        var playedOn = SceneOf(folder, opened: picked, playing: playing, focus: new Focus(Line: picked));
        var trunk = Assert.Single(playedOn.Edges, e => e.Pair == store.Pair);
        Assert.NotNull(trunk.Trunk);
        Assert.True(trunk.Flags.HasFlag(EdgeFlags.Active));
    }

    [AvaloniaFact]
    public void A_step_that_rides_a_line_in_a_trunk_rides_the_trunk()
    {
        var folder = Load();
        var model = folder.Model;
        var flow = model.Flows["tour"];
        var stops = Structure.Stops(flow);
        var playing = FlowStage.PlayingAt(model, "root", flow, stops, 0);
        Assert.Equal(Views.LineKey("hub", "ui") + "|hub>ui|" + Trunks.Mark + "publish", playing.Strands![0]); // "Event 2" is one of four lines of a trunk
        var scene = SceneOf(folder, playing: playing);
        Assert.Equal([playing.Strands[0]], scene.Edges.Where(e => e.Flags.HasFlag(EdgeFlags.Active)).Select(e => e.Id));
        Assert.DoesNotContain(scene.Edges, e => e.Id.StartsWith("step"));
        // The other line of the pair is its kin; the pair's lanes are the lanes as drawn, shut.
        Assert.Contains(scene.Edges, e => e.Pair == Views.LineKey("hub", "ui") && e.Flags.HasFlag(EdgeFlags.Kin));

        // What the stop asks of the pair: the trunk is lit, in its place among the lanes as drawn.
        var plans = FlowStage.PartsAt(model, "root", flow, stops, 0, playing);
        var plan = Assert.Single(plans, p => p.Key == Views.LineKey("hub", "ui")).Value;
        Assert.Equal(2, plan.Lit.Count);
        Assert.Equal(1, plan.Lit.Count(l => l == 1));
        Assert.Equal(1, plan.Lit.Count(l => l == 0));

        // And the run the canvas plays along it.
        var moving = flow with { Steps = [.. flow.Steps.Select(s => s with { Animation = "send" })] };
        var run = Assert.Single(FlowStage.RunsOf(model, "root", moving, Structure.Stops(moving), 0, FlowStage.PlayingAt(model, "root", moving, Structure.Stops(moving), 0)));
        Assert.Equal(playing.Strands[0], run.Strand);
        Assert.Equal(2, run.Slot!.Value.Lanes);
        Assert.Equal(new[] { 0, 1 }, run.Slot.Value.Stack);
    }

    [AvaloniaFact]
    public void Pointing_at_a_connection_in_a_panel_lights_the_trunk_that_stands_for_it()
    {
        var folder = Load();
        var closed = SceneOf(folder);
        var trunk = closed.Edges.Single(e => e.Pair == Views.LineKey("hub", "store"));
        var scene = SceneOf(folder, focus: new Focus(Hover: trunk.Trunk!.Members[2]));
        var lit = scene.Edges.Single(e => e.Id == trunk.Id);
        Assert.True(lit.Flags.HasFlag(EdgeFlags.Hover));
        Assert.Equal(1, scene.Edges.Count(e => e.Flags.HasFlag(EdgeFlags.Hover)));
        var selected = SceneOf(folder, focus: new Focus(Line: trunk.Trunk.Members[0]));
        Assert.True(selected.Edges.Single(e => e.Id == trunk.Id).Selected);
        Assert.DoesNotContain(selected.Edges, e => e.Id != trunk.Id && e.Selected);
    }

    [AvaloniaFact]
    public void The_lane_store_makes_another_lane_for_a_slot_with_trunks_or_an_open_one()
    {
        var folder = Load();
        var scene = SceneOf(folder);
        var (a, b) = (BoxOf(scene, "hub"), BoxOf(scene, "ui"));
        var store = new LaneStore();
        LaneEnd End(LaneBox box) => new(box.Id, box.Rect, box.Edge);
        var plain = store.PathFor("x", "straight", End(a), End(b), null, new LaneSlot(0, 2, 1));
        var stacked = store.PathFor("x", "straight", End(a), End(b), null, new LaneSlot(0, 2, 1, [0, 1]));
        var fanned = store.PathFor("x", "straight", End(a), End(b), null, new LaneSlot(0, 2, 1, [0, 1], [3, 1], 2));
        Assert.NotSame(plain, stacked);
        Assert.NotSame(stacked, fanned);
        Assert.NotEqual(plain.Path.Data, fanned.Path.Data);
        Assert.Equal(stacked, store.PathFor("x", "straight", End(a), End(b), null, new LaneSlot(0, 2, 1, new List<int> { 0, 1 }))); // the same numbers, the same lane
        // A lane alone with a trunk in it is a line like any other, drawn as a lone line is; a lane of an open trunk is a lane beside the others.
        Assert.Null(store.PathFor("y", "straight", End(a), End(b), null, new LaneSlot(0, 1, 0, [0])).Points);
        Assert.NotNull(store.PathFor("z", "straight", End(a), End(b), null, new LaneSlot(0, 1, 0, [0], [3], 1)).Points);
    }

    [AvaloniaFact]
    public void The_key_has_stacked_lines_where_a_trunk_is_drawn_and_a_lane_in_use_where_a_step_plays_among_lanes()
    {
        Assert.Equal(["Stacked lines"], KindKeyView.Words([], true, stacked: true));
        Assert.Equal(["Request and reply", "Plain line", "Stacked lines", "In use"], KindKeyView.Words(["request"], true, true, true));
        Assert.Equal(["In use"], KindKeyView.Words([], false, inUse: true));
        Assert.Empty(KindKeyView.Words([], true)); // a plain line alone is no key
        Assert.Null(KindKeyView.Of([], true));
        Assert.NotNull(KindKeyView.Of([], false, stacked: true));
        var swatch = new LookSwatch(null, inUse: true);
        Assert.True(swatch.InUse);
        Assert.Equal(Kinds.PlainLook, swatch.Look);
        Assert.False(new LookSwatch(null).InUse);

        var folder = Load();
        var canvas = new CanvasView();
        var window = new Window { Width = 1000, Height = 700, Content = canvas };
        window.Show();
        canvas.SetScene(SceneOf(folder), "straight", []);
        window.UpdateLayout();
        Dispatcher.UIThread.RunJobs();
        Assert.Contains("Stacked lines", canvas.KindKeyWords);
        Assert.DoesNotContain("In use", canvas.KindKeyWords); // nothing plays
        Assert.True(canvas.KindKeyHost.IsVisible);

        // A step that plays on a lane among others of its pair: the lane is in use. (The trunks case's pairs are all trunks or lone lines, so the open pair supplies lanes.)
        var model = folder.Model;
        var flow = model.Flows["tour"];
        var playing = FlowStage.PlayingAt(model, "root", flow, Structure.Stops(flow), 1);
        canvas.SetScene(SceneOf(folder, playing: playing), "straight", []);
        Assert.Contains("In use", canvas.KindKeyWords);
        canvas.SetScene(SceneOf(folder, playing: FlowStage.PlayingAt(model, "root", flow, Structure.Stops(flow), 2)), "straight", []);
        Assert.DoesNotContain("In use", canvas.KindKeyWords); // a trunk alone on its pair is not among lanes
    }
}
