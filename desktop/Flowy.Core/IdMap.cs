using System.Collections;
using System.Globalization;

namespace Flowy.Core;

/// <summary>
/// Ids to values, listed the way JavaScript lists an object's keys: ids that look like array indexes ("2", "10")
/// first, in ascending order, then the rest in file order. The browser canvas gets this from its plain objects;
/// without it a model with numeric ids would be walked in a different order here.
/// </summary>
public sealed class IdMap<T> : IEnumerable<KeyValuePair<string, T>>
{
    private readonly Dictionary<string, T> _values = [];
    private readonly List<string> _added = [];
    private List<string>? _ordered;

    public int Count => _values.Count;

    public IReadOnlyList<string> Keys => _ordered ??= Order(_added);

    public bool Contains(string id) => _values.ContainsKey(id);

    public bool TryGetValue(string id, out T value)
    {
        var found = _values.TryGetValue(id, out var v);
        value = v!;
        return found;
    }

    public T this[string id] => _values[id];

    public void Add(string id, T value)
    {
        _values.Add(id, value);
        _added.Add(id);
        _ordered = null;
    }

    public IEnumerator<KeyValuePair<string, T>> GetEnumerator()
    {
        foreach (var id in Keys) yield return new KeyValuePair<string, T>(id, _values[id]);
    }

    IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();

    private static bool IsIndex(string s, out uint n) =>
        uint.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out n) && n != uint.MaxValue && (s.Length == 1 || s[0] != '0');

    private static List<string> Order(List<string> added)
    {
        var indexes = new List<(uint N, string Id)>();
        var rest = new List<string>();
        foreach (var id in added)
        {
            if (IsIndex(id, out var n)) indexes.Add((n, id));
            else rest.Add(id);
        }
        indexes.Sort((a, b) => a.N.CompareTo(b.N));
        return [.. indexes.Select(i => i.Id), .. rest];
    }
}
