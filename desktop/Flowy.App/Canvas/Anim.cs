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

    /// <summary>The tests' pumps run frames and jobs but no timers, and they wait on what the player waits on: they ask for a pause to be made of frames, as every other run is.</summary>
    internal static bool WaitsOnFrames { get; set; }

    /// <summary>
    /// Calls <paramref name="done"/> after <paramref name="milliseconds"/> and does nothing meanwhile: a pause, which is no animation and so draws no frames. A test that moves the clock by hand
    /// (<see cref="TestClock"/>) gets it on the animation frames, as every other run. Disposing the result cancels it.
    /// </summary>
    public static IDisposable Wait(Control host, double milliseconds, Action done)
    {
        if (WaitsOnFrames || TestClock is not null || TopLevel.GetTopLevel(host) is null) return Run(host, milliseconds, t => t, _ => host.InvalidateVisual(), done); // a headless window delivers frames only while something is dirty
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
    public static IDisposable Run(Control host, double milliseconds, Func<double, double> ease, Action<double> frame, Action? done = null) =>
        Run(host, milliseconds, null, ease, frame, done);

    /// <summary>
    /// Like <see cref="Run(Control, double, Func{double, double}, Action{double}, Action?)"/>, measured on <paramref name="time"/> (a flow player's clock) instead of the
    /// wall: while it is paused the animation stands where it is and asks for no frames, and at another speed it runs at it. Null is the wall clock.
    /// </summary>
    public static IDisposable Run(Control host, double milliseconds, ITimeSource? time, Func<double, double> ease, Action<double> frame, Action? done = null)
    {
        var run = new Runner(TopLevel.GetTopLevel(host), milliseconds, ease, frame, done, time);
        run.Start();
        return run;
    }

    /// <summary>
    /// Draws from a flow player's clock: <paramref name="frame"/> on every animation frame while the clock runs and the frame asks for another (it returns true), and
    /// once more whenever the clock changes (a pause, a play, a seek, a speed), so a paused step is drawn at the moment it is set to. Disposing the result stops it.
    /// </summary>
    public static IDisposable Follow(Control host, PlayerClock clock, Func<bool> frame)
    {
        var follow = new Follower(TopLevel.GetTopLevel(host), clock, frame);
        follow.Ask();
        return follow;
    }

    /// <summary>
    /// Calls <paramref name="step"/> on every animation frame with the milliseconds since the one before (0 on the first) for as long as it returns true: an animation that has no fixed end,
    /// like a pair of lines that is turned round half way. Disposing the result stops it.
    /// </summary>
    public static IDisposable Frames(Control host, Func<double, bool> step)
    {
        var loop = new FrameLoop(TopLevel.GetTopLevel(host), step);
        loop.Ask();
        return loop;
    }

    private sealed class FrameLoop(TopLevel? top, Func<double, bool> step) : IDisposable
    {
        private double? _last;
        private bool _stopped;

        public void Ask() => NextFrame(top, Tick);

        private void Tick()
        {
            if (_stopped) return;
            var now = Now();
            var ms = _last is { } last ? Math.Max(0, now - last) : 0;
            _last = now;
            if (step(ms) && !_stopped) Ask();
            else _stopped = true;
        }

        public void Dispose() => _stopped = true;
    }

    /// <summary>Asks for one frame: the window's next, or a timer's for a control that isn't in a window.</summary>
    private static void NextFrame(TopLevel? top, Action step)
    {
        if (top is not null) top.RequestAnimationFrame(_ => step());
        else DispatcherTimer.RunOnce(step, TimeSpan.FromMilliseconds(15), DispatcherPriority.Render);
    }

    private sealed class Follower : IDisposable
    {
        private readonly TopLevel? _top;
        private readonly PlayerClock _clock;
        private readonly Func<bool> _frame;
        private bool _asked;
        private bool _stopped;

        public Follower(TopLevel? top, PlayerClock clock, Func<bool> frame)
        {
            (_top, _clock, _frame) = (top, clock, frame);
            _clock.Changed += Ask;
        }

        public void Ask()
        {
            if (_asked || _stopped) return;
            _asked = true;
            NextFrame(_top, Step);
        }

        private void Step()
        {
            _asked = false;
            if (_stopped) return;
            var more = _frame();
            if (more && !_clock.Paused) Ask();
        }

        public void Dispose()
        {
            _stopped = true;
            _clock.Changed -= Ask;
        }
    }

    private sealed class Runner(TopLevel? top, double milliseconds, Func<double, double> ease, Action<double> frame, Action? done, ITimeSource? time = null) : IDisposable
    {
        private double? _started;
        private DispatcherTimer? _timer;
        private bool _stopped;
        private bool _held; // paused: no frames asked for until the time goes on

        private double Clock() => time?.Now() ?? Now();

        public void Start()
        {
            if (time is not null) time.Changed += Resume;
            if (top is not null) top.RequestAnimationFrame(_ => Step());
            else
            {
                _timer = new DispatcherTimer(TimeSpan.FromMilliseconds(15), DispatcherPriority.Render, (_, _) => Step());
                _timer.Start();
            }
        }

        private void Resume()
        {
            if (!_held || _stopped || time is { Paused: true }) return;
            _held = false;
            top?.RequestAnimationFrame(_ => Step());
        }

        private void Step()
        {
            if (_stopped || _held) return;
            // The clock starts with the first frame, so work done before it (a view laid out for the new level) isn't taken out of the motion.
            _started ??= Clock();
            var t = milliseconds <= 0 ? 1 : Math.Min(1, (Clock() - _started.Value) / milliseconds);
            frame(ease(t));
            if (_stopped) return; // the frame itself may have stopped it
            if (t < 1)
            {
                if (time is { Paused: true } && top is not null) _held = true;
                else top?.RequestAnimationFrame(_ => Step());
                return;
            }
            Dispose();
            done?.Invoke();
        }

        public void Dispose()
        {
            _stopped = true;
            _timer?.Stop();
            if (time is not null) time.Changed -= Resume;
        }
    }
}
