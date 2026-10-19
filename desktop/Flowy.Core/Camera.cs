namespace Flowy.Core;

/// <summary>Where the stage sits on screen: the screen position of the world's origin, and the zoom.</summary>
public readonly record struct Viewport(double X, double Y, double Zoom)
{
    /// <summary>The screen position of a world point.</summary>
    public Pt ToScreen(Pt world) => new(world.X * Zoom + X, world.Y * Zoom + Y);

    /// <summary>The world position under a screen point.</summary>
    public Pt ToWorld(Pt screen) => new((screen.X - X) / Zoom, (screen.Y - Y) / Zoom);
}

/// <summary>Room to keep free around what a fit shows, in screen pixels.</summary>
public readonly record struct Padding(double Top, double Right, double Bottom, double Left);

/// <summary>Camera maths: fitting a view, keeping a box out from under the side panel, zooming about a point.</summary>
public static class Camera
{
    public const double MinZoom = 0.2;
    public const double MaxZoom = 1;

    /// <summary>Width of the details panel (right) to begin with: it can be dragged wider or narrower. Keep in step with the panel's width in the app.</summary>
    public const double Panel = 380;

    /// <summary>Width of the navigator panel (left) to begin with.</summary>
    public const double Nav = 320;

    /// <summary>What a fit is given: room for the details panel (right) and the navigator (left), each as wide as it is or 0 when closed, and for the flow player.</summary>
    public static Padding FitPadding(double panel, bool player, double nav = 0) => new(40, panel > 0 ? panel + 40 : 40, player ? 200 : 40, nav > 0 ? nav + 40 : 40);

    /// <summary>
    /// The viewport that shows <paramref name="bounds"/> centred inside the padding, zoomed as far in as fits, between
    /// <paramref name="minZoom"/> and <paramref name="maxZoom"/>. A port of getViewportForBounds in @xyflow/system.
    /// </summary>
    public static Viewport Fit(Rect bounds, double width, double height, Padding pad, double minZoom = MinZoom, double maxZoom = MaxZoom)
    {
        var px = Math.Floor(pad.Left) + Math.Floor(pad.Right);
        var py = Math.Floor(pad.Top) + Math.Floor(pad.Bottom);
        var zoom = Math.Clamp(Math.Min((width - px) / bounds.Width, (height - py) / bounds.Height), minZoom, maxZoom);
        var x = width / 2 - bounds.Center.X * zoom;
        var y = height / 2 - bounds.Center.Y * zoom;
        // Where the bounds end up: the padding actually left. Asymmetric padding shifts the view by what's missing.
        var left = Math.Floor(bounds.X * zoom + x);
        var top = Math.Floor(bounds.Y * zoom + y);
        var right = Math.Floor(width - (bounds.Right * zoom + x));
        var bottom = Math.Floor(height - (bounds.Bottom * zoom + y));
        var offsetLeft = Math.Min(left - Math.Floor(pad.Left), 0);
        var offsetTop = Math.Min(top - Math.Floor(pad.Top), 0);
        var offsetRight = Math.Min(right - Math.Floor(pad.Right), 0);
        var offsetBottom = Math.Min(bottom - Math.Floor(pad.Bottom), 0);
        return new Viewport(x - offsetLeft + offsetRight, y - offsetTop + offsetBottom, zoom);
    }

    /// <summary>
    /// Where to move the viewport so <paramref name="box"/> shows between the navigator (<paramref name="nav"/> wide, 0 when closed) and
    /// the details panel, or null when it already does. A box wider than the room keeps its left edge in sight.
    /// </summary>
    public static Viewport? PanIntoView(Rect box, Viewport view, double width, double height, double panel = Panel, double margin = 24, double nav = 0)
    {
        var room = width - Math.Min(panel, width);
        var left = box.X * view.Zoom + view.X;
        var top = box.Y * view.Zoom + view.Y;
        double Shift(double from, double to, double limit, double start = 0) => Math.Max(start + margin - from, Math.Min(0, limit - margin - to));
        var dx = Shift(left, left + box.Width * view.Zoom, room, nav);
        var dy = Shift(top, top + box.Height * view.Zoom, height);
        return dx == 0 && dy == 0 ? null : view with { X = view.X + dx, Y = view.Y + dy };
    }

    /// <summary>Zooms by <paramref name="factor"/> about a screen point, so the world under it stays under it.</summary>
    public static Viewport ZoomAt(Viewport view, Pt screen, double factor, double minZoom = MinZoom, double maxZoom = 2)
    {
        var zoom = Math.Clamp(view.Zoom * factor, minZoom, maxZoom);
        var world = view.ToWorld(screen);
        return new Viewport(screen.X - world.X * zoom, screen.Y - world.Y * zoom, zoom);
    }
}
