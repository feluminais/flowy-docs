using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>The canvas flying from one level to the next: the old level flies off, then the new one settles in. It holds the animation that runs, and goes to the level through the reader when it ends.</summary>
internal sealed class LevelMotion(Control host, CanvasView canvas, IReader reader)
{
    // Opening a box: the old level flies off, the new one settles in. The browser version takes 220 and 320 ms, but there the browser's
    // compositor runs it; here every frame is the UI thread's work, and a shorter move hides any hitch in it.
    private const double LeaveMilliseconds = 140;
    private const double ArriveMilliseconds = 230;

    private IDisposable? _motion;

    internal bool Moving { get; private set; }

    /// <summary>Ends a move on its way and puts the canvas back as it was.</summary>
    internal void Stop()
    {
        _motion?.Dispose();
        Moving = false;
        canvas.RenderTransform = null;
        canvas.Opacity = 1;
    }

    /// <summary>
    /// The old view flies off, then the new one settles in. A second move on the way, reduced motion, or <paramref name="instant"/> (the comparison is not the canvas that would fly off)
    /// goes straight there.
    /// </summary>
    internal void Zoom(string view, Move direction, Pt origin, bool instant)
    {
        if (Moving || MotionSettings.Reduced || instant)
        {
            reader.GoTo(view);
            return;
        }
        Moving = true;
        // Laying out a big view takes a moment: do it now, behind the old view flying off, so the new one doesn't wait for it.
        if (reader.Folder is { } folder) _ = Task.Run(() => SceneBuilder.Prewarm(folder.Model, view));
        var size = canvas.Bounds.Size;
        var (ux, uy) = (origin.X - size.Width / 2, origin.Y - size.Height / 2);
        var length = Math.Sqrt(ux * ux + uy * uy);
        var slide = length == 0 ? new Vector(0, 0) : new Vector(ux / length * 0.25 * size.Width, uy / length * 0.25 * size.Height);
        canvas.RenderTransformOrigin = new RelativePoint(origin.X, origin.Y, RelativeUnit.Absolute);
        _motion = Anim.Run(host, LeaveMilliseconds, Anim.EaseIn, t => Apply(direction, true, t, slide), () =>
        {
            var wasMoving = Moving;
            reader.GoTo(view);
            if (!wasMoving) return;
            Moving = true;
            canvas.RenderTransformOrigin = new RelativePoint(origin.X, origin.Y, RelativeUnit.Absolute);
            _motion = Anim.Run(host, ArriveMilliseconds, Anim.EaseOut, t => Apply(direction, false, t, slide), () =>
            {
                Moving = false;
                canvas.RenderTransform = null;
                canvas.Opacity = 1;
            });
        });
    }

    private void Apply(Move direction, bool leaving, double t, Vector slide)
    {
        static double Lerp(double a, double b, double t) => a + (b - a) * t;
        canvas.Opacity = leaving ? 1 - t : t;
        if (direction == Move.Across)
        {
            var k = leaving ? -t : 1 - t;
            canvas.RenderTransform = new TranslateTransform(slide.X * k, slide.Y * k);
            return;
        }
        var scale = direction == Move.In ? (leaving ? Lerp(1, 4, t) : Lerp(0.25, 1, t)) : (leaving ? Lerp(1, 0.25, t) : Lerp(2.5, 1, t));
        canvas.RenderTransform = new ScaleTransform(scale, scale);
    }
}
