namespace Flowy.Core;

/// <summary>
/// A cache that holds at most <c>capacity</c> entries and, when full, drops the one added first. Safe to use from several threads.
/// The value is made outside the lock (it may be slow). A thread that asks for a key another thread is making waits for that value instead of making
/// it again: the canvas lays a view out in the background ahead of a zoom, and the zoom then waits for what is left of that work, not all of it.
/// A value that fails to be made is not kept, and the next ask tries again.
/// </summary>
public sealed class BoundedCache<TKey, TValue>(int capacity) where TKey : notnull
{
    private readonly OrderedDictionary<TKey, TValue> _entries = [];
    private readonly Dictionary<TKey, Lazy<TValue>> _making = [];
    private readonly object _gate = new();

    public int Count
    {
        get { lock (_gate) return _entries.Count; }
    }

    /// <summary>The value for <paramref name="key"/>, made by <paramref name="make"/> and kept if it was not there yet.</summary>
    public TValue GetOrAdd(TKey key, Func<TKey, TValue> make)
    {
        Lazy<TValue>? making;
        lock (_gate)
        {
            if (_entries.TryGetValue(key, out var cached)) return cached;
            if (!_making.TryGetValue(key, out making)) _making[key] = making = new Lazy<TValue>(() => make(key), LazyThreadSafetyMode.ExecutionAndPublication);
        }
        try
        {
            var made = making.Value;
            lock (_gate)
            {
                if (_making.TryGetValue(key, out var mine) && mine == making)
                {
                    _making.Remove(key);
                    while (_entries.Count >= capacity) _entries.RemoveAt(0);
                    _entries[key] = made;
                }
            }
            return made;
        }
        catch
        {
            lock (_gate)
            {
                if (_making.TryGetValue(key, out var mine) && mine == making) _making.Remove(key);
            }
            throw;
        }
    }
}
