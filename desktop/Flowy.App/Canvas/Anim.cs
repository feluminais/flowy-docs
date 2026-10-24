using System.Diagnostics;
using Avalonia.Controls;
using Avalonia.Threading;

namespace Flowy.App.Canvas;

/// <summary>
/// Frame-by-frame animation on the UI thread: calls <c>frame</c> with the eased progress from 0 to 1 over a time, then <c>done</c>. Frames come
/// from the window's own animation-frame callback, one per screen refresh, so they are evenly spaced; a timer is only the fallback for a
/// control that isn't in a window. (A <see cref="DispatcherTimer"/> alone ticks unevenly and is starved while the thread is busy.)
/// </summary>
internal static class Anim
{
    public static double EaseOut(double t) => 1 - Math.Pow(1 - t, 3);

    public static double EaseIn(double t) => t * t * t;

    public static double EaseInOut(double t) => t < 0.5 ? 4 * t * t * t : 1 - Math.Pow(-2 * t + 2, 3) / 2;

    /// <summary>
    /// Milliseconds now, for the tests to take over: an animation measured on the wall clock ends when the machine says, so a test that asks "is it still
    /// under way" after a sleep is a race. A test sets this to a clock it moves by hand and puts it back to null.
    /// </summary>
    internal static Func<double>? TestClock { get; set; }

    internal static double Now() => TestClock?.Invoke() ?? Stopwatch.GetTimestamp() * 1000.0 / Stopwatch.Frequency;

    /// <summary>
    /// Calls <paramref name="done"/> after <paramref name="milliseconds"/> and does nothing meanwhile: a pause, which is no animation and so draws no frames. A test that moves the clock by hand
    /// (<see cref="TestClock"/>) gets it on the animation frames, as every other run. Disposing the result cancels it.
    /// </summary>
    public static IDisposable Wait(Control host, double milliseconds, Action done)
    {
        if (TestClock is not null || TopLevel.GetTopLevel(host) is null) return Run(host, milliseconds, t => t, _ => { }, done);
        DispatcherTimer? timer = null;
        timer = new DispatcherTimer(TimeSpan.FromMilliseconds(Math.Max(1, milliseconds)), DispatcherPriority.Normal, (_, _) =>
        {
            timer!.Stop();
            done();
        });
        timer.Start();
        return new Stopper(timer);
    }

    private sealed class Stopper(DispatcherTimer timer) : IDisposable
    {
        public void Dispose() => timer.Stop();
    }

    /// <summary>Starts it. Disposing the result stops it where it is, without calling <c>done</c>.</summary>
    public static IDisposable Run(Control host, double milliseconds, Func<double, double> ease, Action<double> frame, Action? done = null)
    {
        var run = new Runner(TopLevel.GetTopLevel(host), milliseconds, ease, frame, done);
        run.Start();
        return run;
    }

    private sealed class Runner(TopLevel? top, double milliseconds, Func<double, double> ease, Action<double> frame, Action? done) : IDisposable
    {
        private double? _started;
        private DispatcherTimer? _timer;
        private bool _stopped;

        public void Start()
        {
            if (top is not null) top.RequestAnimationFrame(_ => Step());
            else
            {
                _timer = new DispatcherTimer(TimeSpan.FromMilliseconds(15), DispatcherPriority.Render, (_, _) => Step());
                _timer.Start();
            }
        }

        private void Step()
        {
            if (_stopped) return;
            // The clock starts with the first frame, so work done before it (a view laid out for the new level) isn't taken out of the motion.
            _started ??= Now();
            var t = milliseconds <= 0 ? 1 : Math.Min(1, (Now() - _started.Value) / milliseconds);
            frame(ease(t));
            if (_stopped) return; // the frame itself may have stopped it
            if (t < 1)
            {
                top?.RequestAnimationFrame(_ => Step());
                return;
            }
            Dispose();
            done?.Invoke();
        }

        public void Dispose()
        {
            _stopped = true;
            _timer?.Stop();
        }
    }
}
