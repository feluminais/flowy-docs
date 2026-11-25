using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>One entry of a <c>code</c> list, read: a file or folder in the repo, relative to the folder that holds flowy/, and for a file the line to open it at.</summary>
public sealed record CodeRef(string Path, int? Line)
{
    /// <summary>The entry as a <c>code</c> list writes it: <c>path</c> or <c>path:line</c>.</summary>
    public override string ToString() => Line is { } n ? $"{Path}:{n}" : Path;
}

/// <summary>
/// The <c>code</c> lists of a model: shapes, connections, flows, flow steps, failure modes and payloads each take one, written as text, <c>path</c> or
/// <c>path:line</c>. The twin of src/core/code.ts, word for word in its problems.
/// </summary>
public static partial class CodeRefs
{
    // [^...] where JavaScript's "." stops (\p{Zl} and \p{Zp} are U+2028 and U+2029): it never matches a line break, so a path with one in it can't take a line.
    [GeneratedRegex(@"^([^\n\r\p{Zl}\p{Zp}]+):([1-9][0-9]{0,6})\z", RegexOptions.CultureInvariant)]
    private static partial Regex WithLine();

    [GeneratedRegex(@"^([^\n\r\p{Zl}\p{Zp}]+):[0-9]+\z", RegexOptions.CultureInvariant)]
    private static partial Regex AnyLine();

    /// <summary>The largest line an entry may name: seven digits, more than any file a person would link to.</summary>
    public const int MaxLine = 9_999_999;

    /// <summary>An entry read as a path and a line, or null when it is neither a path in the repo nor one with <c>:line</c> after a file.</summary>
    public static CodeRef? Read(string entry)
    {
        var cut = WithLine().Match(entry);
        if (cut.Success && Checks.IsRepoPath(cut.Groups[1].Value) && !cut.Groups[1].Value.EndsWith('/')) return new CodeRef(cut.Groups[1].Value, int.Parse(cut.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture));
        return Checks.IsRepoPath(entry) ? new CodeRef(entry, null) : null;
    }

    /// <summary>The entries of a <c>code</c> list that read as paths, in the order written. Anything else in it is left to the checks.</summary>
    public static List<CodeRef> Of(object? code) =>
        code is List<object?> list ? [.. list.OfType<string>().Select(Read).OfType<CodeRef>()] : [];

    /// <summary>What is wrong with a <c>code</c> list, one message each, without the name of what holds it.</summary>
    public static List<string> Problems(object? code, ISet<string> absent)
    {
        if (code is null) return [];
        if (code is not List<object?> list || list.Any(c => c is not string)) return ["code must be a list of paths"];
        var found = new List<string>();
        foreach (var entry in list.Cast<string>())
        {
            if (Read(entry) is not { } r)
            {
                var cut = AnyLine().Match(entry);
                if (cut.Success && Checks.IsRepoPath(cut.Groups[1].Value))
                    found.Add(cut.Groups[1].Value.EndsWith('/') ? $"code path \"{entry}\" is a folder, which has no lines" : $"code path \"{entry}\": the line must be a whole number from 1 to {MaxLine}");
                else found.Add($"code path \"{entry}\" must be relative, with / between folders and no \".\" or \"..\" parts");
            }
            else if (absent.Contains(r.Path)) found.Add($"code path \"{entry}\" doesn't exist");
        }
        return found;
    }

    private static IEnumerable<object?> InPlace(object? reference) =>
        reference is OrderedDictionary<string, object?> map ? [map.GetValueOrDefault("code")] : [];

    /// <summary>Every <c>code</c> list in the model, as codeLists in src/core/code.ts gathers them.</summary>
    public static IEnumerable<object?> Lists(Model model)
    {
        var named = model.Meta.TryGetValue("payloads", out var all) && all is OrderedDictionary<string, object?> map ? map.Values.SelectMany(InPlace) : [];
        return model.Objects.Select(o => o.Value.Code)
            .Concat(model.Connections.SelectMany(c => new[] { c.Code }.Concat(c.Payloads is List<object?> list ? list.SelectMany(InPlace) : [])))
            .Concat(model.Flows.Select(kv => kv.Value).SelectMany(f => new[] { f.Code }.Concat(f.Steps.SelectMany(s => new[] { s.Code }.Concat(InPlace(s.Payload)).Concat(InPlace(s.Reply))))))
            .Concat(model.Failures.SelectMany(a => a.Value.Modes.Select(m => m.Value.Code)))
            .Concat(named)
            .Where(list => list is not null);
    }

    /// <summary>The paths every <c>code</c> list in the model names (lines left off), each once.</summary>
    public static HashSet<string> Paths(Model model) => [.. Lists(model).SelectMany(Of).Select(r => r.Path)];
}
