using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>The room a fit leaves at the foot of the canvas for the flow player's card (the browser's roomForCard and Camera).</summary>
public class CanvasFitRoomTests
{
    private static string Shop => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "perf", "flowy");

    private static CanvasView Open()
    {
        var folder = FolderLoader.Load(Shop);
        var canvas = new CanvasView();
        new Window { Width = 1000, Height = 700, Content = canvas }.Show();
        canvas.SetScene(SceneBuilder.Build(folder.Model, "shop", null, folder.Problems, new Focus()), "straight", []);
        Dispatcher.UIThread.RunJobs();
        return canvas;
    }

    [AvaloniaFact]
    public void A_fit_leaves_the_room_it_is_asked_for_at_the_foot_and_fits_again_when_the_card_grows()
    {
        var canvas = Open();
        var room = 200.0;
        canvas.PlayerRoom = () => room;
        canvas.Fit(0, true);
        var first = canvas.Viewport;

        // A taller card asks for more room: the same fit, again, to the room as it is now. The diagram is smaller, or higher, never lower.
        room = 480;
        canvas.Refit();
        var taller = canvas.Viewport;
        Assert.NotEqual(first, taller);
        Assert.True(taller.Zoom <= first.Zoom + 1e-9);
        Assert.True(taller.Zoom < first.Zoom || taller.Y < first.Y);

        // The room back to what it was: the fit is what it was.
        room = 200;
        canvas.Refit();
        Assert.Equal(first.Zoom, canvas.Viewport.Zoom, 9);
    }

    [AvaloniaFact]
    public void A_view_the_reader_has_zoomed_is_theirs_and_a_card_that_changes_size_does_not_fit_it_again()
    {
        var canvas = Open();
        canvas.PlayerRoom = () => 200;
        canvas.Fit(0, true);
        canvas.ZoomBy(1.2);
        var zoomed = canvas.Viewport;
        canvas.PlayerRoom = () => 400;
        canvas.Refit();
        Assert.Equal(zoomed, canvas.Viewport);
    }
}
