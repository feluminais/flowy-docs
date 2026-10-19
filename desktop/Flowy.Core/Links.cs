namespace Flowy.Core;

/// <summary>One entry of a box's <c>links</c>: a web address or a path in the repo, and the text a reader sees for it.</summary>
public sealed record BoxLink(string Url, string? Title);

public static class Links
{
    /// <summary>
    /// The well-formed entries of a box's <c>links</c>: a mapping with a text <c>url</c> and, if it has one, a text <c>title</c>.
    /// <see cref="Checks"/> reports anything else. The C# twin of <c>linksOf</c> in src/core/model.ts.
    /// </summary>
    public static IReadOnlyList<BoxLink> Of(FlowyObject o)
    {
        if (o.Links is not List<object?> list) return [];
        var result = new List<BoxLink>();
        foreach (var entry in list)
        {
            if (entry is not OrderedDictionary<string, object?> map || !map.TryGetValue("url", out var url) || url is not string address) continue;
            if (map.TryGetValue("title", out var title) && title is not string) continue;
            result.Add(new BoxLink(address, title as string));
        }
        return result;
    }
}
