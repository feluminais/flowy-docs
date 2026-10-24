namespace Flowy.Core;

/// <summary>
/// What was made of some text, kept by the text, for as much text as fits in a budget (in characters): when it is over, what was added first goes. A count would not do, since one
/// entry can be a megabyte of YAML and another a few lines. Safe to use from several threads; the value is made outside the lock, as in <see cref="BoundedCache{TKey, TValue}"/>.
/// </summary>
internal sealed class TextCache(long budget)
{
    private readonly OrderedDictionary<(char Kind, string Id, string Folder, string Text), object> _entries = [];
    private readonly object _gate = new();
    private long _chars;

    public object GetOrAdd((char Kind, string Id, string Folder, string Text) key, Func<object> make)
    {
        lock (_gate)
        {
            if (_entries.TryGetValue(key, out var cached)) return cached;
        }
        var made = make();
        lock (_gate)
        {
            if (_entries.TryGetValue(key, out var raced)) return raced;
            _entries.Add(key, made);
            _chars += key.Text.Length;
            while (_chars > budget && _entries.Count > 1)
            {
                _chars -= _entries.GetAt(0).Key.Text.Length;
                _entries.RemoveAt(0);
            }
            return made;
        }
    }
}
