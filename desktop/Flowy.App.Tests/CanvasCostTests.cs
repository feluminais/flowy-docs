using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Media;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>What the canvas does not do: work that a shape or line that did not change would only repeat.</summary>
public class CanvasCostTests
{
    private static string Shop => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "perf", "flowy");

    private static (CanvasView Canvas, Folder Folder, Window Window) Open()
    {
        var folder = FolderLoader.Load(Shop);
        var canvas = new CanvasView();
        var window = new Window { Width = 1000, Height = 700, Content = canvas };
        window.Show();
        canvas.SetScene(SceneBuilder.Build(folder.Model, "shop", null, folder.Problems, new Focus()), "straight", []);
        Dispatcher.UIThread.RunJobs();
        return (canvas, folder, window);
    }

    [AvaloniaFact]
    public void A_plain_shape_is_made_of_what_it_shows_and_the_rest_is_made_when_it_is_needed()
    {
        var (canvas, _, _) = Open();
        var box = (BoxControl)canvas.BoxControlFor("web")!;
        var plain = box.PartCount;
        Assert.True(plain <= 10, $"{plain} parts"); // the outlines, the words, the tile: not the marks of a load, a state, a failure, a change or a problem
        canvas.ShowLoad(null);
        Assert.Equal(plain, box.PartCount); // taking away what was never there makes nothing
        box.SetState(null);
        box.SetChange(null);
        box.SetFailure(null, FailLight.None);
        Assert.Equal(plain, box.PartCount);
        box.SetPerf(new BoxTraffic(0.5, 3));
        Assert.True(box.PartCount > plain);
        Assert.True(box.PerfShown.Strained);
        Assert.Equal((true, "3"), box.PerfShown);
    }

    [AvaloniaFact]
    public void A_mark_made_late_sits_where_it_always_did_in_the_stack()
    {
        var (canvas, _, _) = Open();
        var box = (BoxControl)canvas.BoxControlFor("web")!;
        box.SetPerf(new BoxTraffic(0.5, 3));
        box.SetChange(Change.New);
        box.SetFailure(new FailureMark(RiskBand.High, 2), FailLight.Fails);
        var z = box.GetVisualChildren().OfType<Control>().Where(c => c.Classes.Count > 0).ToDictionary(c => c.Classes[0], c => c.ZIndex);
        Assert.True(z["outline"] < z["strain"]); // the strain colour is over the shape's own outline
        Assert.True(z["strain"] < z["failline"]);
        Assert.True(z["failline"] < z["changering"]);
        Assert.True(z["changering"] < z["queue"]);
        Assert.True(z["queue"] < z["failbadge"]);
        Assert.True(z["failbadge"] < z["changebadge"]);
    }

    [AvaloniaFact]
    public void A_tooltip_is_built_when_the_pointer_comes_and_not_before()
    {
        var (canvas, _, _) = Open();
        var web = canvas.Scene!.Boxes.First(b => b.Id == "web");
        var box = (BoxControl)canvas.BoxControlFor("web")!;
        box.Update(web with { Object = web.Object with { Description = "Takes the orders." } });
        Assert.Null(ToolTip.GetTip(box)); // nobody has pointed at it
        box.PrepareTip();
        Assert.NotNull(ToolTip.GetTip(box));
        box.Update(web with { Object = web.Object with { Description = "Takes the orders, and now more." } });
        Assert.Null(ToolTip.GetTip(box)); // what it says now is built when the pointer comes next, so a stale tooltip is never shown
    }

    [AvaloniaFact]
    public void A_shape_updated_with_what_it_already_says_is_left_alone_and_one_that_moved_moves()
    {
        var (canvas, folder, _) = Open();
        var scene = canvas.Scene!;
        var web = scene.Boxes.First(b => b.Id == "web");
        var box = (BoxControl)canvas.BoxControlFor("web")!;
        box.Classes.Add("probe"); // a class Update does not know: it is not put right when nothing changed
        box.Update(web with { });
        Assert.Contains("probe", box.Classes);
        box.Update(web with { Rect = web.Rect with { X = web.Rect.X + 40 } });
        Assert.Equal(web.Rect.X + 40, Avalonia.Controls.Canvas.GetLeft(box));
        box.Update(web);
        Assert.Equal(web.Rect.X, Avalonia.Controls.Canvas.GetLeft(box));
        box.Update(web with { Mode = BoxMode.Dim }); // a change in what it says is drawn
        Assert.Contains("dim", box.Classes);
        Assert.NotNull(folder);
    }

    [AvaloniaFact]
    public void A_box_put_somewhere_by_hand_is_put_back_by_the_next_update_of_the_same_scene()
    {
        var (canvas, _, _) = Open();
        var web = canvas.Scene!.Boxes.First(b => b.Id == "web");
        canvas.PlaceBox("web", 500, 500); // a swap glides boxes like this
        canvas.SetScene(canvas.Scene!, "straight", []);
        var box = (BoxControl)canvas.BoxControlFor("web")!;
        Assert.Equal(web.Rect.X, Avalonia.Controls.Canvas.GetLeft(box));
        Assert.Equal(web.Rect.Y, Avalonia.Controls.Canvas.GetTop(box));
    }

    [AvaloniaFact]
    public void A_line_whose_boxes_stayed_keeps_its_geometry_when_the_scene_is_made_again()
    {
        var (canvas, folder, _) = Open();
        var before = canvas.LineGeometry("web", "db");
        Assert.NotNull(before);
        canvas.SetScene(SceneBuilder.Build(folder.Model, "shop", null, folder.Problems, new Focus("worker")), "straight", ["worker"]); // a pick draws the scene again
        Assert.Same(before, canvas.LineGeometry("web", "db"));
        canvas.SetScene(canvas.Scene!, "curved", []); // another style is another path
        Assert.NotSame(before, canvas.LineGeometry("web", "db"));
    }
}
