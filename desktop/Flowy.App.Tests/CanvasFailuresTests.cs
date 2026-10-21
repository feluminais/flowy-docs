using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>What the canvas draws for the Failures tab (desktop/fixtures/cases/failures): badges on shapes and lines, and a picked mode's part outlined with the rest faded.</summary>
public class CanvasFailuresTests
{
    private static string Shop => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "failures", "flowy");

    private static (CanvasView Canvas, Folder Folder) Open(string view = "shop")
    {
        var folder = FolderLoader.Load(Shop);
        var canvas = new CanvasView();
        new Window { Width = 1000, Height = 700, Content = canvas }.Show();
        canvas.SetScene(SceneBuilder.Build(folder.Model, view, null, folder.Problems, new Focus()), "straight", []);
        Dispatcher.UIThread.RunJobs();
        return (canvas, folder);
    }

    private static FailureOverlay Overlay(Folder folder, string view, string? mode = null)
    {
        var analysis = folder.Model.Failures["ordering"];
        return FailureOverlay.For(folder.Model, analysis, view, mode is null ? null : analysis.Modes[mode]);
    }

    [AvaloniaFact]
    public void A_shape_wears_the_count_of_its_modes_in_the_colour_of_the_worst()
    {
        var (canvas, folder) = Open();
        canvas.ShowFailures(Overlay(folder, "shop"));
        Assert.Equal((new FailureMark(RiskBand.High, 2), FailLight.None), canvas.FailureOnBox("db")); // the database going down is severity 10; the other mode there is Low
        Assert.Equal((new FailureMark(RiskBand.Low, 1), FailLight.None), canvas.FailureOnBox("web"));
        Assert.Equal(RiskBand.High, canvas.FailureOnBox("api").Mark!.Band); // Auth lock is 150: the worst mode under it, and the components roll up into the shape the view draws
        Assert.Equal(3, canvas.FailureOnBox("api").Mark!.Count);
        Assert.Null(canvas.FailureOnBox("mail").Mark); // an outsider is drawn beside the view, but its own modes are marked where it is a shape of the view
    }

    [AvaloniaFact]
    public void The_overview_rolls_every_mode_up_into_the_system_that_holds_it()
    {
        var (canvas, folder) = Open(Names.Root);
        canvas.ShowFailures(Overlay(folder, Names.Root));
        Assert.Equal(new FailureMark(RiskBand.High, 6), canvas.FailureOnBox("shop").Mark);
        Assert.Equal(new FailureMark(RiskBand.High, 1), canvas.FailureOnBox("mail").Mark);
        Assert.Null(canvas.FailureOnBox("customer").Mark);
        Assert.Equal(new FailureMark(RiskBand.Medium, 1), canvas.FailureOnLine("shop", "mail").Mark);
    }

    [AvaloniaFact]
    public void A_line_wears_the_count_of_the_modes_it_carries()
    {
        var (canvas, folder) = Open();
        canvas.ShowFailures(Overlay(folder, "shop"));
        Assert.Equal(new FailureMark(RiskBand.Medium, 1), canvas.FailureOnLine("api", "mail").Mark); // Receipts arrive late, from Orders to the Mail service, drawn from API to it
        Assert.Null(canvas.FailureOnLine("web", "api").Mark);
    }

    [AvaloniaFact]
    public void Taking_the_marks_away_leaves_the_shapes_and_lines_as_they_were()
    {
        var (canvas, folder) = Open();
        canvas.ShowFailures(Overlay(folder, "shop", "db-down"));
        canvas.ShowFailures(null);
        Assert.Null(canvas.FailuresShown);
        foreach (var id in new[] { "web", "api", "db", "mail" }) Assert.Equal((null, FailLight.None), canvas.FailureOnBox(id));
        Assert.Equal((null, FailLight.None), canvas.FailureOnLine("api", "mail"));
    }

    [AvaloniaFact]
    public void A_picked_mode_outlines_its_shape_outlines_what_it_hurts_lighter_and_fades_the_rest()
    {
        var (canvas, folder) = Open();
        canvas.ShowFailures(Overlay(folder, "shop", "db-down"));
        Assert.Equal(FailLight.Fails, canvas.FailureOnBox("db").Light);
        Assert.Equal(FailLight.Affects, canvas.FailureOnBox("web").Light); // it names Web app and API as hurt
        Assert.Equal(FailLight.Affects, canvas.FailureOnBox("api").Light);
        Assert.Equal(FailLight.Dim, canvas.FailureOnBox("mail").Light);
        Assert.Equal(FailLight.Dim, canvas.FailureOnLine("api", "mail").Light);
        Assert.Equal(new FailureMark(RiskBand.High, 2), canvas.FailureOnBox("db").Mark); // the badges stay while a mode is picked
    }

    [AvaloniaFact]
    public void A_picked_mode_on_a_line_outlines_the_line_and_the_shapes_at_its_ends()
    {
        var (canvas, folder) = Open();
        canvas.ShowFailures(Overlay(folder, "shop", "mail-timeout"));
        Assert.Equal(FailLight.Fails, canvas.FailureOnLine("api", "mail").Light);
        Assert.Equal(FailLight.Fails, canvas.FailureOnLine("api", "mail").Light);
        Assert.Equal(FailLight.Dim, canvas.FailureOnLine("web", "api").Light);
        Assert.Equal(FailLight.Fails, canvas.FailureOnBox("api").Light);
        Assert.Equal(FailLight.Fails, canvas.FailureOnBox("mail").Light);
        Assert.Equal(FailLight.Affects, canvas.FailureOnBox("web").Light);
        Assert.Equal(FailLight.Dim, canvas.FailureOnBox("db").Light);
    }

    [AvaloniaFact]
    public void The_marks_come_back_after_the_scene_is_drawn_again_and_after_a_shape_is_moved()
    {
        var (canvas, folder) = Open();
        canvas.ShowFailures(Overlay(folder, "shop", "db-down"));
        canvas.SetScene(SceneBuilder.Build(folder.Model, "shop", null, folder.Problems, new Focus()), "straight", []);
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(FailLight.Fails, canvas.FailureOnBox("db").Light);
        Assert.Equal(2, canvas.FailureOnBox("db").Mark!.Count);
        Assert.Equal(FailLight.Dim, canvas.FailureOnLine("api", "mail").Light);
    }

    [AvaloniaFact]
    public void A_shape_has_a_badge_with_the_count_and_the_band_in_words_for_the_screen_reader()
    {
        Assert.Equal("1 failure, High", BoxControl.FailureLabel(new FailureMark(RiskBand.High, 1)));
        Assert.Equal("3 failures, Not rated", BoxControl.FailureLabel(new FailureMark(RiskBand.Unrated, 3)));
        Assert.Equal("2 failures, Low", BoxControl.FailureLabel(new FailureMark(RiskBand.Low, 2)));
    }
}
