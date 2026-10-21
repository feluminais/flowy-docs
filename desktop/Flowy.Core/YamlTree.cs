namespace Flowy.Core;

/// <summary>Reading a parsed YAML mapping without ceremony: the value under a key, or nothing when the key or the right kind of value is not there.</summary>
internal static class YamlTree
{
    /// <summary>The value under <paramref name="key"/>, or null when the key is not there.</summary>
    public static object? Get(OrderedDictionary<string, object?> map, string key) => map.TryGetValue(key, out var v) ? v : null;

    /// <summary>The text under <paramref name="key"/>, or null when the key is not there or holds anything but text.</summary>
    public static string? Text(OrderedDictionary<string, object?> map, string key) => Get(map, key) as string;

    /// <summary>The node as a mapping, or an empty one when it is not a mapping.</summary>
    public static OrderedDictionary<string, object?> Entry(object? node) => node as OrderedDictionary<string, object?> ?? [];
}
