using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.LogicalTree;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>
/// How the desktop shows the kind of a connection (desktop/fixtures/cases/kinds): the pattern a line is dashed with, the key at the canvas's foot, the drawing in a line's panel and the
/// tiles of the kind picker. The names and looks are core's (Kinds, KindKey), which the fixtures pin against the browser; these hold what the app does with them. Headless: no window
/// opens, and nothing here plays an animation or drives a whole reader.
/// </summary>
public class KindsViewTests
{
    private static string Dir => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "kinds", "flowy");

    private static Folder Load() => FolderLoader.Load(Dir);

    private static string[] Names => [.. Kinds.All.Select(k => k.Name)];

    private static (CanvasView Canvas, Window Window) Show(Folder folder, string view = "root")
    {
        var canvas = new CanvasView();
        var window = new Window { Width = 1000, Height = 700, Content = canvas };
        window.Show();
        canvas.SetScene(SceneBuilder.Build(folder.Model, view, null, folder.Problems, new Focus()), "straight", []);
        window.UpdateLayout();
        Dispatcher.UIThread.RunJobs();
        return (canvas, window);
    }

    private static List<string> Words(Control root) => root.GetLogicalDescendants().OfType<TextBlock>().Select(t => t.Text ?? "").ToList();

    [Fact]
    public void A_kinds_pattern_shows_on_a_quiet_line_only_and_a_steps_line_and_a_lane_keep_their_own_dashes()
    {
        var extension = Kinds.LookOfKind("extension");
        Assert.Equal([10d, 4, 2, 4], BackLayer.DashesOf(EdgeFlags.None, extension, false));
        Assert.Equal([10d, 4, 2, 4], BackLayer.DashesOf(EdgeFlags.Dim | EdgeFlags.Hover, extension, false)); // hovered or dimmed: the colour changes, not the pattern
        Assert.Null(BackLayer.DashesOf(EdgeFlags.Active, extension, false)); // a lit line is solid, so the dot has a clean base
        Assert.Null(BackLayer.DashesOf(EdgeFlags.None, extension, true)); // under a load's traffic, which paints on top
        Assert.Equal([8d, 5], BackLayer.DashesOf(EdgeFlags.Step, extension, false));
        Assert.Equal([4d, 5], BackLayer.DashesOf(EdgeFlags.Lane, extension, true));
        Assert.Null(BackLayer.DashesOf(EdgeFlags.None, null, false)); // a plain line
        Assert.Null(BackLayer.DashesOf(EdgeFlags.None, Kinds.LookOfKind("stream"), false)); // a solid kind
        Assert.Equal([8d, 5], BackLayer.DashesOf(EdgeFlags.Step, null, false));
    }

    [AvaloniaFact]
    public void The_canvas_keys_the_kinds_it_draws_in_the_order_of_the_list_and_the_plain_line_with_them()
    {
        var (canvas, _) = Show(Load());
        // A mixed pair draws plain, as does a word that is none of the six, so the plain line is on show too.
        Assert.Equal([.. Names, "Plain line"], canvas.KindKeyWords);
        Assert.True(canvas.KindKeyHost.IsVisible);
        Assert.NotNull(canvas.KindKeyHost.Child);
    }

    [AvaloniaFact]
    public void A_view_with_no_kind_has_no_key_and_a_key_that_is_gone_stays_gone()
    {
        var shop = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "perf", "flowy"));
        var (canvas, _) = Show(shop, "shop");
        Assert.Empty(canvas.KindKeyWords);
        Assert.False(canvas.KindKeyHost.IsVisible);
        var folder = Load();
        canvas.SetScene(SceneBuilder.Build(folder.Model, "root", null, folder.Problems, new Focus()), "straight", []);
        Assert.True(canvas.KindKeyHost.IsVisible);
        canvas.SetScene(SceneBuilder.Build(shop.Model, "shop", null, shop.Problems, new Focus()), "straight", []);
        Assert.False(canvas.KindKeyHost.IsVisible);
        Assert.Empty(canvas.KindKeyWords);
    }

    [AvaloniaFact]
    public void The_key_sits_at_the_foot_beside_the_zoom_buttons_and_keeps_to_the_room_left_of_a_flows_card()
    {
        var (canvas, window) = Show(Load());
        var host = canvas.KindKeyHost;
        Assert.Equal(Avalonia.Layout.VerticalAlignment.Bottom, host.VerticalAlignment);
        Assert.Equal(60, host.Margin.Left);
        Assert.Equal(640, host.MaxWidth); // as wide as it needs, up to 640
        canvas.KindKeyLeft = 60 + 300; // the navigator lies over the canvas: the key stands beside it
        Assert.Equal(360, host.Margin.Left);
        canvas.KindKeyLeft = 60;
        canvas.KindKeyBesidePlayer = true;
        window.UpdateLayout();
        Assert.Equal(190, host.MaxWidth); // half of 1000, less the card's 260, less the 16 gap, less the 60 the key starts at, is under the least it is given
        // On a wide canvas the room left of the card is more than the least the key is given, and the navigator takes its width from it as well.
        Assert.Equal(1000 - 260 - 16 - 60, CanvasView.KindKeyMaxWidth(2000, 60, false, true));
        Assert.Equal(1000 - 260 - 16 - 60 - 300, CanvasView.KindKeyMaxWidth(2000, 60 + 300, false, true));
        Assert.Equal(640, CanvasView.KindKeyMaxWidth(2000, 60, false, false));
        canvas.KindKeyBesidePlayer = false;
        Assert.Equal(640, host.MaxWidth);
    }

    [AvaloniaFact]
    public void A_compared_panes_key_sits_at_the_top_left_clear_of_its_zoom_buttons()
    {
        var (canvas, window) = Show(Load());
        canvas.KindKeyAtTop = true;
        window.UpdateLayout();
        Assert.Equal(Avalonia.Layout.VerticalAlignment.Top, canvas.KindKeyHost.VerticalAlignment);
        Assert.Equal(8, canvas.KindKeyHost.Margin.Left);
        Assert.Equal(8, canvas.KindKeyHost.Margin.Top);
        Assert.Equal(1000 - 8 - 60, canvas.KindKeyHost.MaxWidth);
    }

    [Fact]
    public void A_step_line_is_no_connection_so_it_does_not_put_the_plain_line_in_the_key()
    {
        var folder = Load();
        // Nothing runs from Linux to the screen, so that step gets a dashed line of its own.
        var scene = SceneBuilder.Build(folder.Model, "root", new Playing([("linux", "ui")], 0), folder.Problems, new Focus());
        Assert.Contains(scene.Edges, e => SceneBuilder.IsStepLine(e.Id));
        var (without, withStep) = (KindKey.OnScreen(scene.Edges.Where(e => !SceneBuilder.IsStepLine(e.Id))), KindKey.OnScreen(scene.Edges));
        Assert.Equal(without.Kinds, withStep.Kinds);
        Assert.Equal(without.Plain, withStep.Plain);
        var only = new SceneEdge("step", "linux", "ui", null, EdgeFlags.Step, false);
        Assert.Equal((Array.Empty<string>(), false), (KindKey.OnScreen([only]).Kinds.ToArray(), KindKey.OnScreen([only]).Plain));
    }

    [AvaloniaFact]
    public void A_swatch_is_a_line_drawn_small_with_the_look_it_is_given_and_none_is_the_plain_line()
    {
        var swatch = new LookSwatch(Kinds.LookOfKind("cached"));
        Assert.Equal(new LineLook("solid", "open", "ring"), swatch.Look);
        Assert.Equal((56d, 18d), (swatch.Width, swatch.Height));
        var plain = new LookSwatch(null, 44, 24);
        Assert.Equal(Kinds.PlainLook, plain.Look);
        Assert.Equal((44d, 24d), (plain.Width, plain.Height));
        Assert.Equal(Names, KindKeyView.Words(Kinds.All.Select(k => k.Id).ToList(), false));
        Assert.Equal("Plain line", KindKeyView.Words(["stream"], true)[^1]);
        Assert.Empty(KindKeyView.Words([], true)); // a plain line alone is no key
        Assert.Null(KindKeyView.Of([], true));
    }

    [AvaloniaFact]
    public void A_connections_card_names_its_kind_beside_its_drawing_and_a_plain_one_is_the_plain_line()
    {
        Assert.Equal(["Request and reply"], Words(SidePanel.KindRow(new Connection("a", "b", "x") { Kind = "request" })));
        Assert.Equal(["Plain line"], Words(SidePanel.KindRow(new Connection("a", "b", "x"))));
        Assert.Equal(["Plain line"], Words(SidePanel.KindRow(new Connection("a", "b", "x") { Kind = "rpc" }))); // a word that is none of the six draws plain
    }

    [Fact]
    public void A_line_for_several_connections_takes_the_look_they_share_and_a_mixed_one_is_plain()
    {
        List<(int Index, Connection Connection, bool Back)> Lines(params (string? Kind, bool Back)[] spec) =>
            [.. spec.Select((s, i) => (i, new Connection("a", "b", null) { Kind = s.Kind }, s.Back))];
        Assert.Equal(Kinds.LookOfKind("stream"), SidePanel.LookOfLines(Lines(("stream", false)), false));
        Assert.Equal(Kinds.LookOfKind("cached") with { Tail = "none" }, SidePanel.LookOfLines(Lines(("cached", false), ("cached", true)), true)); // both ways: the tails go
        Assert.Null(SidePanel.LookOfLines(Lines(("request", false), ("extension", false)), false));
        Assert.Null(SidePanel.LookOfLines(Lines((null, false)), false));
    }

    [AvaloniaFact]
    public async Task The_kind_tiles_are_the_plain_line_then_the_six_each_drawn_with_its_name_and_a_pick_is_saved_or_taken_back()
    {
        var saved = new List<string>();
        var accept = true;
        var tiles = Pick.LineKinds(id =>
        {
            saved.Add(id);
            return Task.FromResult(accept);
        });
        Assert.Equal(["", .. Kinds.All.Select(k => k.Id)], tiles.Ids);
        Assert.Equal("", tiles.Chosen);
        Assert.Equal("Plain line", tiles.ChosenName);
        Assert.Contains("Publish and subscribe", Words(tiles));
        Assert.Equal(7, tiles.GetLogicalDescendants().OfType<LookSwatch>().Count());
        Assert.True(await tiles.Choose("cached"));
        Assert.Equal(("cached", "Cached publish"), (tiles.Chosen, tiles.ChosenName));
        accept = false;
        Assert.False(await tiles.Choose("object"));
        Assert.Equal("cached", tiles.Chosen); // refused: the ring goes back
        Assert.Equal(["cached", "object"], saved);
    }

    [AvaloniaFact]
    public async Task A_connections_form_offers_the_kinds_ringed_on_its_own_and_a_pick_sets_that_connection_alone()
    {
        var folder = Load();
        var doc = EditDoc.Parse(File.ReadAllText(Path.Combine(Dir, "model.yaml")), null, []);
        var panel = new SidePanel();
        var window = new Window { Width = 400, Height = 900, Content = panel };
        window.Show();
        panel.ShowLineEditor(folder.Model, "root", "management", "linux", [], op =>
        {
            doc = op(doc);
            return Task.FromResult(true);
        }, () => { }, (_, _) => { });
        window.UpdateLayout();
        var form = panel.CurrentLineEditor!;
        Assert.Equal(["request", "extension"], form.KindChoices.Select(c => c.Chosen));
        Assert.True(await form.KindChoices[0].Choose("stream"));
        Assert.Equal(["stream", "extension"], doc.ToModel().Connections.Where(c => c.From == "management" && c.To == "linux").Select(c => c.Kind));
        Assert.True(await form.KindChoices[1].Choose("")); // the plain line takes the kind off
        Assert.Equal(["stream", null], doc.ToModel().Connections.Where(c => c.From == "management" && c.To == "linux").Select(c => c.Kind));
        Assert.Equal("rpc", doc.ToModel().Connections.Single(c => c.Label == "Listens").Kind); // the other connections are as they were
    }

    [AvaloniaFact]
    public void A_lines_panel_header_draws_the_look_its_connections_share_and_the_arrow_when_they_have_none()
    {
        var panel = new SidePanel();
        var model = Load().Model;
        var shared = panel.LineHeader(model, "ui", "management", false, Kinds.LookOfKind("stream"));
        Assert.Equal(Kinds.LookOfKind("stream"), shared.GetLogicalDescendants().OfType<LookSwatch>().Single().Look);
        var none = panel.LineHeader(model, "ui", "management");
        Assert.Empty(none.GetLogicalDescendants().OfType<LookSwatch>());
    }

    [AvaloniaFact]
    public void A_lines_panel_header_draws_heads_at_both_ends_and_no_tail_when_its_connections_run_both_ways()
    {
        var panel = new SidePanel();
        var model = Load().Model;
        var oneWay = panel.LineHeader(model, "ui", "management", false, Kinds.LookOfKind("stream")).GetLogicalDescendants().OfType<LookSwatch>().Single().Marks;
        Assert.False(oneWay.HeadAtStart);
        Assert.Equal(Kinds.LookOfKind("stream").Tail, oneWay.Tail);
        var bothWays = panel.LineHeader(model, "ui", "management", true, Kinds.LookOfKind("stream")).GetLogicalDescendants().OfType<LookSwatch>().Single().Marks;
        Assert.True(bothWays.HeadAtStart);
        Assert.Null(bothWays.Tail);
        Assert.Equal(KindKey.MarksOf(Kinds.LookOfKind("stream"), true), bothWays);
    }
}
