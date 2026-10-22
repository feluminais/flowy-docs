namespace Flowy.Core;

/// <summary>
/// A box's links as the one-per-line text an edit field holds ("Title | address", or just an address), and back. The C# twin of
/// <c>linkLine</c> and <c>parseLinks</c> in ui/src/Panel.tsx.
/// </summary>
public static class LinkText
{
    public static string Format(FlowyObject o) =>
        string.Join("\n", Links.Of(o).Select(l => string.IsNullOrEmpty(l.Title) ? l.Url : $"{l.Title} | {l.Url}"));

    /// <summary>
    /// One link per line. The last " | " splits title from address, so a title may hold a bar and an address may too. A link keeps the extra
    /// keys it had (<paramref name="existing"/> is the list the file held), found by its address, and comes out with its title first.
    /// </summary>
    public static List<OrderedDictionary<string, object?>> Parse(string text, object? existing)
    {
        var byUrl = new Dictionary<string, OrderedDictionary<string, object?>>();
        if (existing is List<object?> list)
            foreach (var entry in list)
                if (entry is OrderedDictionary<string, object?> map && map.TryGetValue("url", out var u) && u is string address) byUrl[address] = map;
        var result = new List<OrderedDictionary<string, object?>>();
        foreach (var raw in text.Split('\n'))
        {
            var line = JsCompat.JsTrim(raw);
            if (line == "") continue;
            var cut = line.LastIndexOf(" | ", StringComparison.Ordinal);
            var title = cut == -1 ? "" : JsCompat.JsTrim(line[..cut]);
            var url = JsCompat.JsTrim(cut == -1 ? line : line[(cut + 3)..]);
            var link = new OrderedDictionary<string, object?>();
            if (title != "") link["title"] = title;
            link["url"] = url;
            if (byUrl.TryGetValue(url, out var old))
                foreach (var (key, value) in old)
                    if (key is not ("title" or "url")) link[key] = value;
            result.Add(link);
        }
        return result;
    }
}
