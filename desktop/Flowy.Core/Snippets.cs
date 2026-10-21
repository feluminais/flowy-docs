using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>
/// A language a snippet can be coloured as. <see cref="Id"/> is what the file holds, <see cref="Name"/> is what a reader sees, and
/// <see cref="Aliases"/> are the other names people write for it. <c>text</c> is not a language: it says "no colours".
/// </summary>
public sealed record Language(string Id, string Name, IReadOnlyList<string> Aliases);

/// <summary>One well-formed entry of an object's <c>snippets</c>: a few lines of code, with a title and a language if there are any. Without a language, it is worked out from the code.</summary>
public sealed record Snippet(string Text, string? Title, string? Language);

/// <summary>An object's <c>snippets</c>: the C# twin of src/core/snippets.ts, with the same languages, rules and words.</summary>
public static partial class Snippets
{
    /// <summary>How much code a shape holds, so the panel stays a picture of a few lines that matter and never a copy of the repo.</summary>
    public const int MaxSnippets = 6, MaxLines = 40, MaxChars = 8000;

    public static readonly IReadOnlyList<Language> Languages =
    [
        new("typescript", "TypeScript", ["ts", "tsx"]),
        new("javascript", "JavaScript", ["js", "jsx", "mjs", "cjs", "node"]),
        new("json", "JSON", ["jsonc", "json5"]),
        new("yaml", "YAML", ["yml"]),
        new("csharp", "C#", ["cs", "c#", "dotnet"]),
        new("java", "Java", []),
        new("kotlin", "Kotlin", ["kt", "kts"]),
        new("python", "Python", ["py"]),
        new("go", "Go", ["golang"]),
        new("rust", "Rust", ["rs"]),
        new("sql", "SQL", ["postgres", "postgresql", "mysql", "sqlite", "tsql", "plsql"]),
        new("bash", "Shell", ["sh", "shell", "zsh", "console", "terminal"]),
        new("powershell", "PowerShell", ["ps1", "pwsh", "ps"]),
        new("html", "HTML", ["htm"]),
        new("xml", "XML", ["xsd", "xsl", "svg", "csproj"]),
        new("css", "CSS", ["scss", "less"]),
        new("dockerfile", "Dockerfile", ["docker"]),
        new("markdown", "Markdown", ["md"]),
        new("c", "C", ["h"]),
        new("cpp", "C++", ["c++", "cc", "cxx", "hpp"]),
        new("php", "PHP", []),
        new("ruby", "Ruby", ["rb"]),
        new("swift", "Swift", []),
        new("text", "Plain text", ["txt", "plain", "plaintext", "none"]),
    ];

    /// <summary>A language by the id, the name or any alias, in any case. Null for anything else, which the checks report.</summary>
    public static Language? LanguageOf(object? tag)
    {
        if (tag is not string s) return null;
        var key = JsCompat.JsTrim(s).ToLowerInvariant();
        if (key == "") return null;
        return Languages.FirstOrDefault(l => l.Id == key || l.Name.ToLowerInvariant() == key || l.Aliases.Contains(key));
    }

    [GeneratedRegex(@"^(?:[\t ]*\n)+")]
    private static partial Regex LeadingBlankLines();

    // The line and paragraph separators and NEL: a YAML reader takes them for line breaks, so they are line breaks here too.
    private const char LineSeparator = (char)0x2028, ParagraphSeparator = (char)0x2029, NextLine = (char)0x85;

    /// <summary>
    /// The lines of some code: every kind of line break as one, control characters left out, and the blank lines before and after it taken off.
    /// Only spaces, tabs and line breaks count as blank. The twin of <c>codeLines</c> in src/core/snippets.ts.
    /// </summary>
    public static IReadOnlyList<string> CodeLines(string text)
    {
        var plain = new System.Text.StringBuilder(text.Length);
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (c == '\r')
            {
                plain.Append('\n');
                if (i + 1 < text.Length && text[i + 1] == '\n') i++;
            }
            else if (c is LineSeparator or ParagraphSeparator or NextLine) plain.Append('\n');
            else if (c == '\t' || c == '\n' || (c >= ' ' && c != (char)0x7f)) plain.Append(c);
        }
        var s = LeadingBlankLines().Replace(plain.ToString(), "").TrimEnd('\t', ' ', '\n');
        return s.Split('\n');
    }

    /// <summary>Whether some code is nothing but blank lines.</summary>
    public static bool IsBlank(string text) => string.Concat(CodeLines(text)) == "";

    /// <summary>The well-formed entries of a box's <c>snippets</c>: a mapping with code in its <c>text</c>. <see cref="Checks"/> reports anything else.</summary>
    public static IReadOnlyList<Snippet> Of(FlowyObject o)
    {
        if (o.Snippets is not List<object?> list) return [];
        var result = new List<Snippet>();
        foreach (var entry in list)
        {
            if (entry is not OrderedDictionary<string, object?> map || !map.TryGetValue("text", out var text) || text is not string code || IsBlank(code)) continue;
            map.TryGetValue("title", out var title);
            map.TryGetValue("language", out var language);
            if ((title is not null and not string) || (language is not null and not string)) continue;
            result.Add(new Snippet(code, title as string, language as string));
        }
        return result;
    }

    /// <summary>
    /// The well-formed entries of a box's <c>snippets</c> as the mappings the file held, copied, so an edit form can change them and write the whole
    /// list back with every extra key kept. Entries <see cref="Of"/> would skip are left out, as <c>snippetsOf</c> does for the browser's form.
    /// </summary>
    public static List<OrderedDictionary<string, object?>> Entries(FlowyObject o)
    {
        var good = Of(o).Count;
        if (o.Snippets is not List<object?> list || good == 0) return [];
        return list.OfType<OrderedDictionary<string, object?>>()
            .Where(map => map.TryGetValue("text", out var text) && text is string code && !IsBlank(code)
                && (!map.TryGetValue("title", out var title) || title is string) && (!map.TryGetValue("language", out var language) || language is string))
            .Select(map => new OrderedDictionary<string, object?>(map))
            .ToList();
    }

    /// <summary>
    /// What an object's <c>snippets</c> hold, as the tree to put in a file: line breaks as <c>\n</c>, no blank lines around the code, a blank title
    /// and a blank language left out, a language written as its id (one that isn't known stays, for the checks to report), and the keys in the order
    /// title, language, text, then the extra ones. Anything that isn't a list is carried through.
    /// </summary>
    public static object? Tidy(object? input)
    {
        if (input is not List<object?> list) return input;
        return list.Select(entry => entry is OrderedDictionary<string, object?> map ? TidyEntry(map) : entry).ToList();
    }

    private static OrderedDictionary<string, object?> TidyEntry(OrderedDictionary<string, object?> entry)
    {
        var result = new OrderedDictionary<string, object?>();
        entry.TryGetValue("title", out var title);
        entry.TryGetValue("language", out var language);
        if (title is string t && JsCompat.JsTrim(t) != "") result["title"] = JsCompat.JsTrim(t);
        if (language is string l && JsCompat.JsTrim(l) != "") result["language"] = LanguageOf(l)?.Id ?? JsCompat.JsTrim(l);
        else if (language is not null and not string) result["language"] = language;
        if (entry.TryGetValue("text", out var text)) result["text"] = text is string code ? string.Join('\n', CodeLines(code)) : text;
        foreach (var (key, value) in entry)
            if (key is not ("title" or "language" or "text")) result[key] = value;
        return result;
    }

    /// <summary>What is wrong with an object's <c>snippets</c>, one message each, without the object's name. The same words as <c>snippetProblems</c> in TypeScript.</summary>
    public static IEnumerable<string> Problems(FlowyObject o)
    {
        if (o.Snippets is null) yield break;
        if (o.Snippets is not List<object?> list)
        {
            yield return "snippets must be a list of entries with text and, if you like, a title and a language";
            yield break;
        }
        for (var i = 0; i < list.Count; i++)
        {
            var at = $"snippet {i + 1}";
            if (list[i] is not OrderedDictionary<string, object?> s)
            {
                yield return $"{at} must be a mapping with text";
                continue;
            }
            s.TryGetValue("text", out var text);
            if (text is null || (text is string raw && IsBlank(raw))) yield return $"{at} has no text";
            else if (text is not string code) yield return $"{at}: text must be plain text";
            else
            {
                var lines = CodeLines(code);
                if (lines.Count > MaxLines) yield return $"{at} is {lines.Count} lines, at most {MaxLines}. Put long code in a file and list it under Source.";
                var chars = string.Join('\n', lines).Length;
                if (chars > MaxChars) yield return $"{at} is {chars} characters, at most {MaxChars}. Put long code in a file and list it under Source.";
            }
            if (s.TryGetValue("title", out var title) && title is not string) yield return $"{at}: title must be plain text";
            if (s.TryGetValue("language", out var language) && language is not "")
            {
                if (language is not string name) yield return $"{at}: language must be plain text";
                else if (LanguageOf(name) is null)
                    yield return $"{at}: unknown language \"{name}\" (use {string.Join(", ", Languages.Select(l => l.Id))}, or leave it out to have it worked out)";
            }
        }
        if (list.Count > MaxSnippets) yield return $"{list.Count} snippets, at most {MaxSnippets}";
    }
}
