namespace Flowy.Core;

/// <summary>
/// The keys that hold nothing (null), each as the path of keys down to it. A port of <c>emptyKeys</c> and <c>emptyKeyMessage</c> in src/core/check.ts.
/// In <c>{ text: Sets the time zone, if it has one }</c> the comma ends the text and <c>if it has one</c> becomes a key with no colon, which reads as null.
/// Every other value reads as text, so null is the only odd one, and it can't be written back.
/// </summary>
public static class EmptyKeys
{
    private static readonly IReadOnlyList<string[]> None = [];

    /// <summary>Every path to a key with no value in <paramref name="value"/>, in the order JavaScript lists keys; list items are written "item N". Nothing for a value that is not a mapping or a list.</summary>
    public static IReadOnlyList<string[]> Of(object? value)
    {
        var found = new List<string[]>();
        Walk(value, [], found);
        return found.Count == 0 ? None : found;
    }

    private static void Walk(object? value, List<string> path, List<string[]> found)
    {
        if (value is List<object?> list)
        {
            for (var i = 0; i < list.Count; i++)
            {
                path.Add($"item {i + 1}");
                Walk(list[i], path, found);
                path.RemoveAt(path.Count - 1);
            }
        }
        else if (value is IReadOnlyDictionary<string, object?> map)
        {
            foreach (var key in JsKeys.Order(map.Keys))
            {
                path.Add(key);
                if (map[key] is null) found.Add([.. path]);
                else Walk(map[key], path, found);
                path.RemoveAt(path.Count - 1);
            }
        }
    }

    public static string Message(string[] path) =>
        $"\"{string.Join(" → ", path)}\" has no value (a comma ends unquoted text: put text that has a comma in double quotes)";
}
