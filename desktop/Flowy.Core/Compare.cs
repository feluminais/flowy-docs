namespace Flowy.Core;

/// <summary>The flow or run a <c>compare</c> names, and maybe a note about the pair. The holder is the newer one.</summary>
public sealed record CompareTag(string With, string? Note = null);

/// <summary>A flow or run paired with another: <c>Side</c> is <c>before</c> for the older one the item tags, <c>after</c> for a newer one that tags the item.</summary>
public sealed record Partner(string Id, string Side, string? Note = null);

/// <summary>
/// The <c>compare</c> tag of a flow or a run: <c>compare: other-id</c>, or <c>compare: { with: other-id, note: "text" }</c>. A port of src/core/compare.ts (reading the tag
/// and finding partners; writing it back belongs to the edit session). The tag only helps people find a pair; it limits nothing.
/// </summary>
public static class Compares
{
    /// <summary>The tag a <c>compare</c> value says: text, or a mapping with text under <c>with</c> and maybe under <c>note</c>. Anything else is no tag (<see cref="Problem"/> says why).</summary>
    public static CompareTag? Of(object? value)
    {
        if (value is string id) return HasText(id) ? new CompareTag(id) : null;
        if (value is not IReadOnlyDictionary<string, object?> map || map.GetValueOrDefault("with") is not string with || !HasText(with)) return null;
        return map.GetValueOrDefault("note") is string note && HasText(note) ? new CompareTag(with, note) : new CompareTag(with);
    }

    /// <summary>What is wrong with a <c>compare</c> value, or null when it is absent or reads. <paramref name="noun"/> is the kind the id names: <c>flow</c> or <c>run</c>.</summary>
    public static string? Problem(object? value, string noun) =>
        value is null || Of(value) is not null ? null : $"compare must be a {noun} id, or {{ with, note }} with text";

    /// <summary>
    /// The partners of <paramref name="id"/> among <paramref name="tags"/> (each item's raw <c>compare</c> value): first what it tags (the older, <c>before</c>), then every item that tags
    /// it (the newer, <c>after</c>), in the order of the keys. A pair that tag each other lists once, as the item's own tag. An item never lists itself. A tag to an item that is not there
    /// is still listed, so a reader can show it greyed out.
    /// </summary>
    public static IReadOnlyList<Partner> Partners(IReadOnlyDictionary<string, object?> tags, string id)
    {
        var found = new List<Partner>();
        void Add(string partner, string side, CompareTag tag)
        {
            if (partner == id || found.Any(p => p.Id == partner)) return;
            found.Add(new Partner(partner, side, tag.Note));
        }
        if (tags.TryGetValue(id, out var own) && Of(own) is { } mine) Add(mine.With, "before", mine);
        foreach (var other in JsCompat.OrderKeys(tags.Keys))
            if (Of(tags[other]) is { } tag && tag.With == id) Add(other, "after", tag);
        return found;
    }

    /// <summary>Every id that tags another item or is tagged by one. A tag to an item that is not there, or to itself, links nothing.</summary>
    public static IReadOnlySet<string> Linked(IReadOnlyDictionary<string, object?> tags)
    {
        var found = new HashSet<string>();
        foreach (var (id, raw) in tags)
        {
            if (Of(raw) is not { } tag || tag.With == id || !tags.ContainsKey(tag.With)) continue;
            found.Add(id);
            found.Add(tag.With);
        }
        return found;
    }

    private static bool HasText(string s) => JsCompat.JsTrim(s) != "";
}
