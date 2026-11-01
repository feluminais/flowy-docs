namespace Flowy.App.Canvas;

/// <summary>
/// A time that can stand still and run at a speed: what a flow's drawing reads in place of the wall clock, so a pause or a speed reaches it. <see cref="Now"/> only
/// goes on; <see cref="Changed"/> is said on a pause, a play, a speed or a jump, so a drawing that stopped asking for frames while paused draws again.
/// </summary>
internal interface ITimeSource
{
    double Now();

    bool Paused { get; }

    event Action? Changed;
}

/// <summary>
/// The time of a flow player: how far into the stop on show it is (<see cref="Elapsed"/>, in milliseconds of player time). It runs at a speed, stands still while
/// paused and can be set to any moment, so whatever is drawn from it (a step's motion, the rest between steps, a channel coming in) pauses, scrubs and speeds up
/// together. One belongs to each canvas: the reader's, and each pane of a comparison. The browser's (ui/src/clock.ts) works the same way.
/// </summary>
internal sealed class PlayerClock : ITimeSource
{
    /// <summary>How fast a flow can play: half, normal and double speed.</summary>
    public static readonly double[] Speeds = [0.5, 1, 2];

    private sealed class Wait(double left, Action then)
    {
        public double Left = left;
        public readonly Action Then = then;
        public IDisposable? Timer;
        public double Armed;
    }

    private sealed class Undo(Action undo) : IDisposable
    {
        private Action? _undo = undo;

        public void Dispose()
        {
            _undo?.Invoke();
            _undo = null;
        }
    }

    private readonly Func<double> _wall;
    private readonly Func<double, Action, IDisposable> _timer;
    private double _base; // the stop's player time at the last change
    private double _run; // the running time then
    private double _since; // the wall time of that change
    private string _key = "";
    private (double Fraction, string Key)? _pending; // a seek waiting for its step to begin and say how long it is
    private readonly Dictionary<object, double> _totals = [];
    private readonly HashSet<Wait> _waits = [];

    /// <summary>A clock on <paramref name="wall"/> (the machine's, through <see cref="Anim.Now"/>, when left out); <paramref name="timer"/> calls back after so many wall ms.</summary>
    public PlayerClock(Func<double>? wall = null, Func<double, Action, IDisposable>? timer = null)
    {
        _wall = wall ?? Anim.Now;
        _timer = timer ?? ((_, _) => throw new InvalidOperationException("This clock has no timer: give it one to wait on."));
        _since = _wall();
    }

    public event Action? Changed;

    public bool Paused { get; private set; }

    public double Rate { get; private set; } = 1;

    /// <summary>How long the stop's motion lasts: its longest motion, or 0 while none has said.</summary>
    public double Length => _totals.Count == 0 ? 0 : _totals.Values.Max();

    public double Elapsed => Paused ? _base : _base + (_wall() - _since) * Rate;

    /// <summary>The time the player has run, at its speeds and not while paused; a seek or a restart leaves it be. Loops that never end (a stream's dots, a state's outline) go round on it.</summary>
    public double Now() => Paused ? _run : _run + (_wall() - _since) * Rate;

    /// <summary>The step (and replay) now on show, by its key: a new one restarts the clock, the same one again does nothing. A seek meant for this step stays to land on it.</summary>
    public void Begin(string key)
    {
        if (key == _key) return;
        _key = key;
        var kept = _pending is { } p && p.Key == key ? _pending : null;
        Restart();
        _pending = kept;
    }

    /// <summary>A new stop, or the same one again: it begins now. Paused stays paused, at its first moment.</summary>
    public void Restart()
    {
        _pending = null;
        Set(0);
    }

    public void Pause()
    {
        if (Paused) return;
        Mark(Elapsed);
        Paused = true;
        foreach (var w in _waits) Hold(w);
        Changed?.Invoke();
    }

    public void Play()
    {
        if (!Paused) return;
        _since = _wall();
        Paused = false;
        foreach (var w in _waits) Arm(w);
        Changed?.Invoke();
    }

    public void SetRate(double rate)
    {
        Mark(Elapsed);
        foreach (var w in _waits) Hold(w);
        Rate = rate;
        if (!Paused) foreach (var w in _waits) Arm(w);
        Changed?.Invoke();
    }

    /// <summary>Goes to a moment of the stop, kept inside its motion once its length is known.</summary>
    public void Seek(double ms)
    {
        _pending = null;
        var length = Length;
        Set(Math.Max(0, length > 0 ? Math.Min(ms, length) : ms));
    }

    /// <summary>
    /// Goes to a fraction of the way through the stop: now if it is the step on show and its length is known, else as soon as <paramref name="key"/>'s step has begun
    /// and a motion of it says how long it is (a drag onto a step that has not been drawn yet).
    /// </summary>
    public void SeekFraction(double fraction, string? key = null)
    {
        key ??= _key;
        if (key == _key && Length > 0) Seek(fraction * Length);
        else _pending = (fraction, key);
    }

    /// <summary>A motion of this stop lasts <paramref name="total"/>; disposing the result takes it back (the motion is gone).</summary>
    public IDisposable Declare(double total)
    {
        var key = new object();
        _totals[key] = total;
        if (_pending is { } p && p.Key == _key && Length > 0) Seek(p.Fraction * Length);
        else Changed?.Invoke();
        return new Undo(() => _totals.Remove(key));
    }

    /// <summary>Calls <paramref name="then"/> once <paramref name="ms"/> of player time have run: a pause holds it, the speed hurries or slows it, and a seek leaves it be. Disposing cancels it.</summary>
    public IDisposable After(double ms, Action then)
    {
        var wait = new Wait(ms, then);
        _waits.Add(wait);
        if (!Paused) Arm(wait);
        return new Undo(() =>
        {
            wait.Timer?.Dispose();
            _waits.Remove(wait);
        });
    }

    private void Set(double at)
    {
        Mark(at);
        Changed?.Invoke();
    }

    private void Mark(double at)
    {
        _run = Now();
        _base = at;
        _since = _wall();
    }

    private void Arm(Wait w)
    {
        w.Armed = _wall();
        w.Timer = _timer(Math.Max(0, w.Left / Rate), () =>
        {
            _waits.Remove(w);
            w.Then();
        });
    }

    /// <summary>Stops a wait's timer and keeps what is left of it.</summary>
    private void Hold(Wait w)
    {
        if (w.Timer is null) return;
        w.Timer.Dispose();
        w.Timer = null;
        w.Left -= (_wall() - w.Armed) * Rate;
    }
}
