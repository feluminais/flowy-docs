using System.Collections.Concurrent;
using System.Runtime.CompilerServices;

namespace Flowy.Core;

/// <summary>
/// Who sits in whom, worked out once per <see cref="Model"/>: each object's parent, each view's members in object
/// order, how many each holds, and (on first ask) each object's chain up to the top level. <see cref="Views"/> reads
/// these instead of scanning every object per question. Get one with <see cref="Of"/>; it is cached against the model's identity.
/// </summary>
public sealed class ModelIndex
{
    // Keyed by reference, so a model is indexed once however often it is asked. The index is rebuilt if objects were added since.
    private static readonly ConditionalWeakTable<Model, ModelIndex> Cache = new();

    private readonly int _objectCount;
    private readonly Dictionary<string, string> _parent = [];
    private readonly Dictionary<string, List<string>> _children = [];
    private readonly Dictionary<string, int> _counts = [];
    private readonly ConcurrentDictionary<string, string[]> _chains = new();

    private ModelIndex(Model model)
    {
        _objectCount = model.Objects.Count;
        foreach (var id in model.Objects.Keys)
        {
            if (model.GetObject(id) is null) continue;
            var parent = ParentFromModel(model, id);
            _parent[id] = parent;
            if (!_children.TryGetValue(parent, out var members)) _children[parent] = members = [];
            members.Add(id);
            _counts[parent] = members.Count;
        }
    }

    public static ModelIndex Of(Model model)
    {
        if (Cache.TryGetValue(model, out var index) && index._objectCount == model.Objects.Count) return index;
        index = new ModelIndex(model);
        Cache.AddOrUpdate(model, index);
        return index;
    }

    private static string ParentFromModel(Model model, string id)
    {
        var parent = model.GetObject(id)?.In;
        return parent is not null && parent != id && model.GetObject(parent) is not null ? parent : Names.Root;
    }

    /// <summary>The view an object sits in: its parent, or root when it has none, a broken one, or the id is no object.</summary>
    public string ParentOf(string id) => _parent.GetValueOrDefault(id, Names.Root);

    /// <summary>The objects directly inside a view, in object order. A new list each call.</summary>
    public List<string> MemberIds(string view) => _children.TryGetValue(view, out var members) ? [.. members] : [];

    public bool HasChildren(string id) => _children.ContainsKey(id);

    /// <summary>How many objects each object holds directly, for every object that holds any. A new dictionary each call.</summary>
    public Dictionary<string, int> ChildCounts() => new(_counts);

    /// <summary>[id, parent, grandparent, ..., root], stopping at a cycle. Shared: do not change it.</summary>
    internal IReadOnlyList<string> ChainOf(string id) => _chains.GetOrAdd(id, Walk);

    private string[] Walk(string id)
    {
        var chain = new List<string> { id };
        var seen = new HashSet<string> { id };
        var current = id;
        while (current != Names.Root)
        {
            current = ParentOf(current);
            if (!seen.Add(current)) break;
            chain.Add(current);
        }
        if (chain[^1] != Names.Root) chain.Add(Names.Root);
        return [.. chain];
    }
}
