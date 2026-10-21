namespace Flowy.Core;

/// <summary>
/// A cache that holds at most <c>capacity</c> entries and, when full, drops the one added first. Safe to use from several threads.
/// The value is made outside the lock (it may be slow), so two threads asking for the same new key can both make it; the first to finish is kept
/// and both get that one back, as <see cref="System.Collections.Concurrent.ConcurrentDictionary{TKey,TValue}.GetOrAdd(TKey, Func{TKey, TValue})"/> does.
/// </summary>
public sealed class BoundedCache<TKey, TValue>(int capacity) where TKey : notnull
{
    private readonly OrderedDictionary<TKey, TValue> _entries = [];
    private readonly object _gate = new();

    public int Count
    {
        get { lock (_gate) return _entries.Count; }
    }

    /// <summary>The value for <paramref name="key"/>, made by <paramref name="make"/> and kept if it was not there yet.</summary>
    public TValue GetOrAdd(TKey key, Func<TKey, TValue> make)
    {
        lock (_gate)
        {
            if (_entries.TryGetValue(key, out var cached)) return cached;
        }
        var made = make(key);
        lock (_gate)
        {
            if (_entries.TryGetValue(key, out var raced)) return raced;
            while (_entries.Count >= capacity) _entries.RemoveAt(0);
            _entries.Add(key, made);
            return made;
        }
    }
}
