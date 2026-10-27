using System.Diagnostics;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>
/// Going into a system and back out of it is quick: a view that was visited keeps its boxes (hidden), the ones one move away are made while the reader is idle,
/// and the Explorer lights another row without drawing the rows again. Without these, putting 14 boxes on the stage took about 150 ms and the tree another 100.
/// </summary>
[Trait("Weight", "Heavy")]
public class ViewSwapTests
{
    private static string Plum => Path.Combine(Repo.Root, "docs", "demo", "flowy");

    private static (Window Window, ReaderView Reader) Open(bool prewarm = false)
    {
        TestApp.NoMotion();
        Flowy.App.Canvas.Prewarming.On = prewarm;
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(Plum), Plum);
        Dispatcher.UIThread.RunJobs();
        return (window, reader);
    }

    /// <summary>Lets the idle jobs run until the stage stops growing.</summary>
    private static void Idle(ReaderView reader)
    {
        var clock = Stopwatch.StartNew();
        var (last, still) = (-1, 0);
        while (clock.Elapsed < TimeSpan.FromSeconds(15) && still < 20)
        {
            Dispatcher.UIThread.RunJobs();
            Thread.Sleep(10);
            var now = reader.Canvas.ControlsOnStage;
            still = now == last ? still + 1 : 0;
            last = now;
        }
    }

    [AvaloniaFact]
    public void A_view_that_was_left_keeps_its_boxes_hidden_and_they_come_back_as_they_were()
    {
        var (window, reader) = Open();
        reader.GoTo("ordering");
        var api = Assert.IsType<Flowy.App.Canvas.BoxControl>(reader.Canvas.BoxControlFor("order-api"));
        reader.GoTo(Names.Root);
        Assert.False(api.IsVisible);
        Assert.Null(reader.Canvas.BoxControlFor("order-api"));
        reader.GoTo("ordering");
        Assert.Same(api, reader.Canvas.BoxControlFor("order-api"));
        Assert.True(api.IsVisible);
    }

    [AvaloniaFact]
    public void A_box_put_away_loses_what_the_canvas_had_put_on_it()
    {
        var (window, reader) = Open();
        reader.GoTo("ordering");
        var api = (Flowy.App.Canvas.BoxControl)reader.Canvas.BoxControlFor("order-api")!;
        api.SetSquash(1);
        api.Presence = 0.3;
        reader.GoTo(Names.Root);
        Assert.Null(api.RenderTransform);
        Assert.Equal(1, api.Presence);
        Assert.Null(api.State);
    }

    [AvaloniaFact]
    public void The_views_one_move_away_are_made_while_idle_so_the_first_visit_puts_no_new_boxes_on_the_stage()
    {
        var (window, reader) = Open(prewarm: true);
        try
        {
            Idle(reader);
            var before = reader.Canvas.ControlsOnStage;
            reader.GoTo("ordering");
            Assert.Equal(before, reader.Canvas.ControlsOnStage);
            Assert.True(reader.Canvas.BoxControlFor("order-api")!.IsVisible);
        }
        finally
        {
            Flowy.App.Canvas.Prewarming.On = false;
        }
    }

    [AvaloniaFact]
    public void Visiting_a_view_before_it_is_made_finishes_the_set_and_does_not_double_it()
    {
        var (window, reader) = Open(prewarm: true);
        try
        {
            reader.GoTo("ordering"); // straight away: the idle jobs have not run
            Idle(reader);
            var settled = reader.Canvas.ControlsOnStage;
            reader.GoTo(Names.Root);
            reader.GoTo("ordering");
            Idle(reader);
            Assert.Equal(settled, reader.Canvas.ControlsOnStage);
        }
        finally
        {
            Flowy.App.Canvas.Prewarming.On = false;
        }
    }

    [AvaloniaFact]
    public void A_zoom_puts_the_new_level_on_the_canvas_halfway_and_brings_the_Explorer_up_when_it_lands()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Explorer);
        window.UpdateLayout();
        Dispatcher.UIThread.RunJobs();
        var explorer = reader.Navigator.Explorer;
        Assert.Equal(["shape:root"], explorer.CanvasKeys);
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0"); // the other tests turn motion off
        var halfway = false;
        try
        {
            reader.OpenBox("ordering");
            var clock = Stopwatch.StartNew();
            while (clock.Elapsed < TimeSpan.FromSeconds(5) && reader.IsMoving)
            {
                Avalonia.Headless.AvaloniaHeadlessPlatform.ForceRenderTimerTick(); // a headless window draws no frames of its own
                Dispatcher.UIThread.RunJobs();
                if (reader.IsMoving && reader.View == "ordering")
                {
                    halfway = true;
                    Assert.Equal(["shape:root"], explorer.CanvasKeys); // the tree waits: building its rows here stopped the zoom
                }
                Thread.Sleep(5);
            }
        }
        finally
        {
            Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        }
        Assert.True(halfway);
        Assert.False(reader.IsMoving);
        window.UpdateLayout();
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(["shape:ordering"], explorer.CanvasKeys);
    }

    [AvaloniaFact]
    public void Moving_between_views_lights_another_Explorer_row_and_draws_the_same_rows_once()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Explorer);
        reader.GoTo("ordering");
        window.UpdateLayout();
        Dispatcher.UIThread.RunJobs();
        var explorer = reader.Navigator.Explorer;
        var rows = explorer.GetVisualDescendants().OfType<Border>().Where(b => b.Classes.Contains("treerow")).ToList();
        Assert.NotEmpty(rows);
        Assert.Equal(["shape:ordering"], explorer.CanvasKeys);

        reader.GoTo(Names.Root); // the tree only ever opens rows, so these are the rows it had
        window.UpdateLayout();
        Dispatcher.UIThread.RunJobs();
        var after = explorer.GetVisualDescendants().OfType<Border>().Where(b => b.Classes.Contains("treerow")).ToList();
        Assert.Equal(rows.Count, after.Count);
        Assert.All(rows, r => Assert.Contains(r, after));
        Assert.Equal(["shape:root"], explorer.CanvasKeys);
        Assert.Single(after, b => b.Classes.Contains("sel"));
    }
}
