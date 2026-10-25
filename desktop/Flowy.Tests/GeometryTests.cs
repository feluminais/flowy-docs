using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class GeometryTests
{
    private static readonly Rect Top = new(0, 0, 200, 72);

    [Fact]
    public void A_straight_line_runs_from_border_to_border()
    {
        var (from, to) = BoxGeometry.LineEnds(Top, new Rect(0, 200, 200, 72));
        Assert.Equal(new Pt(100, 72), from);
        Assert.Equal(new Pt(100, 200), to);
    }

    [Fact]
    public void A_line_between_boxes_in_one_place_starts_at_the_centre()
    {
        var (from, _) = BoxGeometry.LineEnds(Top, Top);
        Assert.Equal(new Pt(100, 36), from);
    }

    [Fact]
    public void A_point_is_as_deep_inside_the_shape_drawn_in_a_box_as_it_is_far_from_its_outline()
    {
        // A box with no outline is the rectangle: the depth is the distance from the nearest side, negative outside.
        Assert.Equal(36, BoxGeometry.DepthIn(Top, null, 100, 36));
        Assert.Equal(10, BoxGeometry.DepthIn(Top, [], 10, 36));
        Assert.Equal(0, BoxGeometry.DepthIn(Top, null, 0, 36));
        Assert.Equal(-4, BoxGeometry.DepthIn(Top, null, -4, 36));
        // A diamond leaves the corners of its box bare, so a point there is outside it.
        double[] diamond = [100, 1, 199, 36, 100, 71, 1, 36];
        var toSide = 99.0 * 35 / Math.Sqrt(99.0 * 99 + 35 * 35);
        Assert.Equal(toSide, BoxGeometry.DepthIn(Top, diamond, 100, 36), 9);
        Assert.True(BoxGeometry.DepthIn(Top, diamond, 5, 5) < 0);
        Assert.Equal(0, BoxGeometry.DepthIn(Top, diamond, 100, 1), 9); // the tip is on the outline
        // It does not matter which way the outline is listed, or where the box is.
        double[] reversed = [1, 36, 100, 71, 199, 36, 100, 1];
        var moved = new Rect(300, 50, 200, 72);
        Assert.Equal(toSide, BoxGeometry.DepthIn(moved, reversed, 400, 86), 9);
        Assert.True(BoxGeometry.DepthIn(moved, reversed, 305, 55) < 0);
    }

    [Fact]
    public void Curved_and_angled_lines_leave_from_the_middle_of_the_facing_side()
    {
        var p = BoxGeometry.PortsBetween(Top, new Rect(0, 200, 200, 72));
        Assert.Equal((new Pt(100, 72), Side.Bottom, new Pt(100, 200), Side.Top), (p.From, p.FromSide, p.To, p.ToSide));
        var beside = BoxGeometry.PortsBetween(Top, new Rect(400, 0, 200, 72));
        Assert.Equal((Side.Right, Side.Left), (beside.FromSide, beside.ToSide));
    }

    [Fact]
    public void A_frame_is_the_bounding_box_plus_padding()
    {
        Assert.Equal(new Rect(-28, -28, 556, 328), BoxGeometry.FrameAround([Top, new Rect(300, 200, 200, 72)]));
        Assert.Equal(new Rect(-10, -10, 220, 92), BoxGeometry.FrameAround([Top], 10));
    }

    [Fact]
    public void A_straight_path_ends_with_an_arrow_pointing_along_it()
    {
        var path = LinePaths.Build("straight", Top, new Rect(400, 0, 200, 72));
        Assert.Equal(new Pt(400, 36), path.End);
        Assert.Equal(new Pt(1, 0), path.Direction);
        Assert.Equal(new Pt(300, 36), path.Label);
    }

    [Fact]
    public void A_curved_path_ends_pointing_into_the_target_side()
    {
        var path = LinePaths.Build("curved", Top, new Rect(0, 200, 200, 72));
        Assert.Equal(new Pt(0, 1), path.Direction);
        Assert.StartsWith("M100,72 C", path.Data);
    }

    [Fact]
    public void An_angled_path_is_made_of_straight_pieces_and_rounded_bends()
    {
        var path = LinePaths.Build("angled", Top, new Rect(350, 230, 200, 72));
        Assert.Contains("Q", path.Data);
        Assert.Equal(new Pt(350 + 100, 230), path.End);
    }

    [Fact]
    public void A_view_that_fits_is_shown_whole_and_centred_and_never_zoomed_past_one()
    {
        var v = Camera.Fit(new Rect(0, 0, 1000, 600), 1100, 700, Camera.FitPadding(0, false));
        Assert.Equal(new Viewport(50, 50, 1), v);
        var small = Camera.Fit(new Rect(0, 0, 200, 72), 1100, 700, Camera.FitPadding(0, false));
        Assert.Equal(1, small.Zoom);
        Assert.Equal(450, small.X);
    }

    [Fact]
    public void A_view_too_big_to_fit_is_zoomed_out_but_not_below_the_minimum()
    {
        var v = Camera.Fit(new Rect(0, 0, 2000, 1000), 1000, 600, Camera.FitPadding(0, false));
        Assert.Equal((1000 - 80) / 2000.0, v.Zoom, 9);
        Assert.Equal(Camera.MinZoom, Camera.Fit(new Rect(0, 0, 90000, 90000), 1000, 600, Camera.FitPadding(0, false)).Zoom);
    }

    [Fact]
    public void Room_is_kept_for_the_side_panels_and_the_player_as_wide_as_they_are()
    {
        Assert.Equal(new Padding(40, 420, 40, 40), Camera.FitPadding(Camera.Panel, false));
        Assert.Equal(new Padding(40, 40, 200, 40), Camera.FitPadding(0, true));
        Assert.Equal(new Padding(40, 540, 40, 300), Camera.FitPadding(500, false, 260));
    }

    [Fact]
    public void A_box_already_in_sight_is_left_alone_and_one_under_the_panel_is_moved_clear()
    {
        var view = new Viewport(0, 0, 1);
        Assert.Null(Camera.PanIntoView(new Rect(100, 100, 200, 72), view, 1100, 700));
        var moved = Camera.PanIntoView(new Rect(900, 100, 200, 72), view, 1100, 700)!.Value;
        Assert.Equal(-404, moved.X);
        Assert.Equal(0, moved.Y);
    }

    [Fact]
    public void A_box_under_the_navigator_on_the_left_is_moved_clear_too()
    {
        var view = new Viewport(0, 0, 1);
        Assert.Null(Camera.PanIntoView(new Rect(100, 100, 200, 72), view, 1100, 700, Camera.Panel, 24, 0));
        Assert.Equal(244, Camera.PanIntoView(new Rect(100, 100, 200, 72), view, 1100, 700, Camera.Panel, 24, 320)!.Value.X);
    }

    [Fact]
    public void Zooming_about_a_point_keeps_the_world_under_it_in_place()
    {
        var view = new Viewport(30, 40, 1);
        var screen = new Pt(500, 300);
        var world = view.ToWorld(screen);
        var zoomed = Camera.ZoomAt(view, screen, 1.5);
        Assert.Equal(1.5, zoomed.Zoom);
        var after = zoomed.ToScreen(world);
        Assert.Equal(screen.X, after.X, 9);
        Assert.Equal(screen.Y, after.Y, 9);
        Assert.Equal(2, Camera.ZoomAt(view, screen, 100).Zoom);
        Assert.Equal(Camera.MinZoom, Camera.ZoomAt(view, screen, 0.0001).Zoom);
    }
}

/// <summary>The geometry must come out as @xyflow/system and ui/src/graph.ts say, on the cases in desktop/fixtures/geometry.ts.</summary>
public class GeometryParityTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "geometry.json")))!;

    private static double D(JsonNode? n) => n!.GetValue<double>();

    private static Rect R(JsonNode n) => new(D(n["x"]), D(n["y"]), D(n["width"]), D(n["height"]));

    private static List<double> Numbers(string path) =>
        Regex.Matches(path, @"-?\d+(?:\.\d+)?(?:e[+-]?\d+)?").Select(m => double.Parse(m.Value, CultureInfo.InvariantCulture)).ToList();

    private static string Commands(string path) => new(path.Where(char.IsLetter).ToArray());

    private static void Same(double expected, double actual, string what) => Assert.True(Math.Abs(expected - actual) < 1e-9, $"{what}: expected {expected}, got {actual}");

    private static void Same(JsonNode expected, Pt actual, string what)
    {
        Same(D(expected["x"] ?? expected[0]), actual.X, what + " x");
        Same(D(expected["y"] ?? expected[1]), actual.Y, what + " y");
    }

    [Fact]
    public void Lines_are_drawn_as_the_browser_canvas_draws_them()
    {
        var paths = Expected()["paths"]!.AsArray();
        Assert.Equal(48, paths.Count);
        foreach (var p in paths) CheckLine(p!, null, null);
    }

    [Fact]
    public void Lines_meet_a_shape_on_its_outline_as_in_the_browser()
    {
        var paths = Expected()["shaped"]!.AsArray();
        Assert.Equal(24, paths.Count);
        foreach (var p in paths) CheckLine(p!, LookData.Shapes[p!["shapeA"]!.GetValue<string>()].Edge, LookData.Shapes[p["shapeB"]!.GetValue<string>()].Edge);
    }

    private static void CheckLine(JsonNode p, double[]? edgeA, double[]? edgeB)
    {
        var (a, b, style) = (R(p["a"]!), R(p["b"]!), p["style"]!.GetValue<string>());
        var what = $"{style} {p["a"]!.ToJsonString()} to {p["b"]!.ToJsonString()}";
        var path = LinePaths.Build(style, a, b, edgeA, edgeB);
        Assert.Equal(Commands(p["data"]!.GetValue<string>()), Commands(path.Data));
        var (want, got) = (Numbers(p["data"]!.GetValue<string>()), Numbers(path.Data));
        Assert.Equal(want.Count, got.Count);
        for (var i = 0; i < want.Count; i++) Same(want[i], got[i], $"{what}, number {i} of the path");
        Same(p["label"]![0]!.GetValue<double>(), path.Label.X, what + " label x");
        Same(p["label"]![1]!.GetValue<double>(), path.Label.Y, what + " label y");

        var (from, to) = BoxGeometry.LineEnds(a, b, edgeA, edgeB);
        Same(p["ends"]![0]!, from, what + " line start");
        Same(p["ends"]![1]!, to, what + " line end");
        var ports = BoxGeometry.PortsBetween(a, b, edgeA, edgeB);
        Assert.Equal(p["ports"]!["fromSide"]!.GetValue<string>(), ports.FromSide.ToString().ToLowerInvariant());
        Assert.Equal(p["ports"]!["toSide"]!.GetValue<string>(), ports.ToSide.ToString().ToLowerInvariant());
        Same(p["ports"]!["from"]!, ports.From, what + " port from");
        Same(p["ports"]!["to"]!, ports.To, what + " port to");
    }

    [Fact]
    public void Line_labels_are_placed_where_the_browser_places_them()
    {
        var cases = Expected()["labels"]!.AsArray();
        Assert.Equal(15, cases.Count);
        foreach (var c in cases)
        {
            var items = c!["items"]!.AsArray().Select(i => new LabelItem(i!["id"]!.GetValue<string>(), i["path"]!.GetValue<string>(),
                new Pt(D(i["mid"]!["x"]), D(i["mid"]!["y"])), D(i["width"]), D(i["height"]), i["pinned"]!.GetValue<bool>())).ToList();
            var spots = LineLabels.Place(items, c["boxes"]!.AsArray().Select(b => R(b!)).ToList());
            var want = c["spots"]!.AsArray();
            for (var i = 0; i < items.Count; i++) Same(want[i]!, spots[items[i].Id], $"{c["style"]} label {items[i].Id} of {items.Count}");
        }
    }

    [Fact]
    public void Long_line_labels_are_cut_short_as_in_the_browser()
    {
        foreach (var c in Expected()["clips"]!.AsArray()) Assert.Equal(c!["clipped"]!.GetValue<string>(), LineLabels.Clip(c["label"]!.GetValue<string>()));
    }

    [Fact]
    public void Frames_are_drawn_around_boxes_as_the_browser_canvas_draws_them()
    {
        foreach (var f in Expected()["frames"]!.AsArray())
        {
            var frame = BoxGeometry.FrameAround(f!["rects"]!.AsArray().Select(r => R(r!)));
            var want = R(f["frame"]!);
            Assert.Equal((want.X, want.Y, want.Width, want.Height), (frame.X, frame.Y, frame.Width, frame.Height));
        }
    }

    [Fact]
    public void Fits_match_getViewportForBounds()
    {
        foreach (var f in Expected()["fits"]!.AsArray())
        {
            var pad = f!["pad"]!.AsArray().Select(D).ToArray();
            var v = Camera.Fit(R(f["bounds"]!), D(f["size"]![0]), D(f["size"]![1]), new Padding(pad[0], pad[1], pad[2], pad[3]));
            Same(D(f["viewport"]!["x"]), v.X, "fit x");
            Same(D(f["viewport"]!["y"]), v.Y, "fit y");
            Same(D(f["viewport"]!["zoom"]), v.Zoom, "fit zoom");
        }
    }

    [Fact]
    public void Panning_a_box_clear_of_the_panel_matches_panIntoView()
    {
        foreach (var p in Expected()["pans"]!.AsArray())
        {
            var view = new Viewport(D(p!["view"]!["x"]), D(p["view"]!["y"]), D(p["view"]!["zoom"]));
            var moved = Camera.PanIntoView(R(p["box"]!), view, D(p["size"]![0]), D(p["size"]![1]), D(p["panel"]));
            if (p["to"] is null)
            {
                Assert.Null(moved);
                continue;
            }
            Assert.NotNull(moved);
            Same(D(p["to"]!["x"]), moved.Value.X, "pan x");
            Same(D(p["to"]!["y"]), moved.Value.Y, "pan y");
        }
    }
}
