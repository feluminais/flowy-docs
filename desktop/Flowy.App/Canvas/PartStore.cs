using Flowy.Core;

namespace Flowy.App.Canvas;

/// <summary>
/// How far the lines of each pair are parted around the lit one while a flow plays, drawn from the player's clock: the twin of <c>createPartStore</c> in ui/src/parts.ts. Where a project draws a line
/// for each connection, a step that rides one line of a pair of several opens the others away from it (<see cref="Lanes.Parting"/>, <see cref="Lanes.PoseAt"/>). The lines of the pair ask this store
/// how lit each of their lanes is, and the store answers with <see cref="Lanes.PoseAt"/> of the clock, so a pause holds the pose, a scrub sets it and the speed hurries it, the way the step's motion does.
///
/// A new stop hands the store a plan (<see cref="Set"/>): for each pair, which lanes it lights, and when its <c>part</c> beat starts. The store starts from the pose each pair is in at that moment, so a
/// stop reached in the middle of another's change goes on from there with no jump. While a pair is changing and the clock runs it asks for frames; at rest it asks for none. The value of a lane is cut
/// to <see cref="Parts.Steps"/> steps, which is what the lane store keeps a path for, so a change is a handful of paths made once and not one for each frame.
///
/// Unlike the browser's, the desktop's clock is begun by <see cref="Playback"/> before the stop is drawn, so the store listens for <see cref="PlayerClock.Beginning"/> to take the poses of the stop
/// it is leaving while the clock still stands where they were. One store belongs to one canvas and is used from the UI thread only.
/// </summary>
internal sealed class PartStore : IDisposable
{
    private sealed record Motion(Lanes.Parting Parting, double Origin);

    private readonly PlayerClock _clock;
    private readonly Func<Action, IDisposable> _frames;
    private readonly OrderedDictionary<string, Motion> _motions = [];
    private Dictionary<string, IReadOnlyList<double>> _current = [];
    private Dictionary<string, IReadOnlyList<double>>? _beforeBegin; // the poses of the stop being left, taken as the clock was about to begin the next
    private (string Flow, int Stop)? _last;
    private IReadOnlyDictionary<string, PartPlan> _plans = new Dictionary<string, PartPlan>(); // what the stop on show asked for, to tell a new ask from the same one again
    private bool _still;
    private bool _fresh; // the clock has begun a stop that Set has not seen yet
    private IDisposable? _cancel;
    private bool _muted; // while the clock is being begun on a new stop, its change is no news: the store takes the new plan next

    /// <summary>A store on <paramref name="clock"/>; <paramref name="frames"/> asks for a call at the next frame, and the result takes the ask back (a canvas asks the window for its animation frame).</summary>
    public PartStore(PlayerClock clock, Func<Action, IDisposable> frames)
    {
        (_clock, _frames) = (clock, frames);
        _clock.Changed += Update;
        _clock.Beginning += OnBeginning;
    }

    /// <summary>Said when the lanes of a pair have moved: the lines that read the store draw again.</summary>
    public event Action? Changed;

    /// <summary>How lit each lane of the pair is now (1 for a lane a step rides), or null for a pair at rest. The same list while it does not change.</summary>
    public IReadOnlyList<double>? Lam(string pair) => _current.TryGetValue(pair, out var lam) ? lam : null;

    /// <summary>Whether any pair is still on its way from one pose to the next (for the tests).</summary>
    internal bool Moving => _motions.Values.Any(m => _clock.Elapsed - m.Origin < m.Parting.At + m.Parting.Dur);

    /// <summary>The pairs that are parted or on their way to it now (for the tests).</summary>
    internal IReadOnlyCollection<string> Pairs => _current.Keys;

    private static bool Same(IReadOnlyList<double> a, IReadOnlyList<double> b) => a.Count == b.Count && a.SequenceEqual(b);

    private static bool SamePlans(IReadOnlyDictionary<string, PartPlan> a, IReadOnlyDictionary<string, PartPlan> b) =>
        a.Count == b.Count && a.All(p => b.TryGetValue(p.Key, out var other) && Same(p.Value.Lit, other.Lit) && p.Value.Beat == other.Beat);

    private static bool Unlit(IReadOnlyList<double> lam) => lam.All(l => l == 0);

    private bool Settled(Motion m, double now) => now - m.Origin >= m.Parting.At + m.Parting.Dur;

    /// <summary>The pose of every pair that has a motion at the clock's moment, cut to steps.</summary>
    private Dictionary<string, IReadOnlyList<double>> PosesNow() =>
        _motions.ToDictionary(m => m.Key, m => Parts.Cut(Lanes.PoseAt(m.Value.Parting, _clock.Elapsed - m.Value.Origin).Lam));

    private void OnBeginning()
    {
        _beforeBegin = PosesNow();
        _muted = true;
        _fresh = true;
    }

    /// <summary>Works out the pose of every pair at the clock's moment, tells the lines that changed, and asks for the next frame if a pair is still on its way.</summary>
    private void Update()
    {
        if (_muted) return;
        _cancel?.Dispose();
        _cancel = null;
        var now = _clock.Elapsed;
        var next = new Dictionary<string, IReadOnlyList<double>>();
        var (changed, moving) = (false, false);
        foreach (var (pair, m) in _motions.ToList())
        {
            var lam = Parts.Cut(Lanes.PoseAt(m.Parting, now - m.Origin).Lam);
            var done = Settled(m, now);
            if (done && Unlit(lam)) _motions.Remove(pair); // closed again: the pair is at rest and needs no more watching
            else
            {
                next[pair] = _current.TryGetValue(pair, out var before) && Same(before, lam) ? before : lam;
                if (!done) moving = true;
            }
            if (!Same(_current.GetValueOrDefault(pair) ?? [], next.GetValueOrDefault(pair) ?? [])) changed = true;
        }
        _current = next;
        if (moving && !_clock.Paused) _cancel = _frames(Update);
        if (changed) Changed?.Invoke();
    }

    /// <summary>Draws the pose of the clock's moment now (the store does it on its own on every change of the clock; a test calls it after moving a clock it made).</summary>
    public void Tick() => Update();

    /// <summary>
    /// The stop of <paramref name="flow"/> at <paramref name="stop"/> (null for none: no flow plays) is on show, and the clock has begun on it. The store takes what the stop lights, each pair starting from the
    /// pose it was in just before the clock moved. A flow other than the last, or a stop other than the next or the one before, is a jump. <paramref name="still"/>: reduced motion, no easing.
    /// Asked again for the stop on show with the same plan (a redraw for a hover or a theme) it does nothing; with another plan (the model changed under the step) the pairs go on from where they
    /// are, the way the browser's store does when its plan changes.
    /// </summary>
    public void Set(string? flow, int stop, IReadOnlyDictionary<string, PartPlan> plans, bool still)
    {
        (string Flow, int Stop)? here = flow is null ? null : (flow, stop);
        if (!_fresh && still == _still && _last == here && SamePlans(plans, _plans)) return;
        (_fresh, _still, _plans) = (false, still, plans);
        var jump = _last is { } was && flow is not null && (was.Flow != flow || Math.Abs(was.Stop - stop) > 1);
        _last = here;
        // The pose each pair is in, before the clock went back to the start of the new stop.
        var poses = _beforeBegin ?? PosesNow();
        _beforeBegin = null;
        _muted = false;
        var now = _clock.Elapsed;
        foreach (var pair in plans.Keys.Concat(_motions.Keys).Distinct().ToList())
        {
            var plan = plans.GetValueOrDefault(pair);
            var standing = poses.GetValueOrDefault(pair) ?? [];
            IReadOnlyList<double> lit = plan?.Lit ?? [.. standing.Select(_ => 0.0)];
            IReadOnlyList<double> before = standing.Count > 0 ? standing : [.. lit.Select(_ => 0.0)];
            if (Unlit(before) && Unlit(lit))
            {
                _motions.Remove(pair);
                continue;
            }
            var parting = still ? new Lanes.Parting(lit, lit, 0, 0, Lanes.PartEasing.Out) : Lanes.PartingFor(before, lit, plan?.Beat, jump);
            _motions[pair] = new Motion(parting, now);
        }
        Update();
    }

    public void Dispose()
    {
        _clock.Changed -= Update;
        _clock.Beginning -= OnBeginning;
        _cancel?.Dispose();
        _cancel = null;
        Changed = null;
    }
}
