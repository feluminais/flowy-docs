using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>
/// Writes a tree of text, lists and ordered maps (what <see cref="YamlText"/> reads) as YAML, the way the <c>yaml</c> package writes it for the
/// TypeScript side with <c>{ schema: 'failsafe', lineWidth: 0 }</c>: block style, two-space indent, sequences indented under their key, text plain
/// unless it can't be, block scalars for text with line breaks, <c>[]</c> and <c>{}</c> for empty collections. A file saved here and a file
/// saved by the browser then look the same, so moving between them never changes lines in git. This is a port of that package's
/// <c>stringifyString</c>, <c>stringifyPair</c> and <c>stringifyCollection</c>; desktop/fixtures/yaml-write.ts writes a corpus of awkward text
/// with the original and the tests compare byte for byte.
/// Comments and blank lines in a hand-written file are dropped, as they are in the browser.
/// </summary>
public static partial class YamlWriter
{
    private const string Step = "  ";
    private const int MaxKeyLength = 1024;

    [GeneratedRegex(@"^[\n\t ,\[\]{}#&*!|>'""%@`]|^[?-]\z|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]\z")]
    private static partial Regex NotPlain();

    [GeneratedRegex(@"\n[\t ]+\z")]
    private static partial Regex EndsInBlankLine();

    // A line of only spaces or tabs among the leading lines. As a block it loses its spaces or cannot be read, so it is quoted; the same rule as quoteBlankFirstLines in yamltext.ts.
    [GeneratedRegex(@"\A\n*[ \t]+\n")]
    private static partial Regex BlankLeadingLine();

    [GeneratedRegex(@"[ \t]\n|\n[ \t]")]
    private static partial Regex SpaceAroundBreak();

    [GeneratedRegex(@"\n+")]
    private static partial Regex Breaks();

    [GeneratedRegex(@"(^|(?<!\n))\n+(?!\n|\z)")]
    private static partial Regex BlockEndBreaks();

    /// <summary>A whole file: the tree as block YAML, with a final newline. <paramref name="flowLists"/> writes every list on one line, as layout.yaml does.</summary>
    public static string Write(object? tree, bool flowLists = false) => Node(tree, "", flowLists) + "\n";

    /// <summary>layout.yaml: view → box → [x, y], with each position on one line.</summary>
    public static string WriteLayout(object? tree) => Write(tree, flowLists: true);

    private static string Node(object? node, string indent, bool flowLists, bool inFlow = false)
    {
        switch (node)
        {
            case string s:
                return Scalar(s, indent, false, inFlow);
            case OrderedDictionary<string, object?> map:
                return Map(map, indent, flowLists);
            case List<object?> list:
                return flowLists ? FlowList(list, indent) : Seq(list, indent, flowLists);
            case FlowSeq flowSeq:
                return FlowItems(flowSeq.Items);
            case FlowMap flowMap:
                return FlowPairs(flowMap.Map);
            default:
                throw new InvalidOperationException($"only text, lists and maps can be written, not {node?.GetType().Name ?? "null"}");
        }
    }

    private static string Map(OrderedDictionary<string, object?> map, string indent, bool flowLists)
    {
        if (map.Count == 0) return "{}";
        var lines = JsCompat.OrderKeys(map.Keys).Select(key => Pair(key, map[key], indent, flowLists)).ToList();
        return string.Join("\n" + indent, lines);
    }

    private static string Seq(List<object?> list, string indent, bool flowLists)
    {
        if (list.Count == 0) return "[]";
        var itemIndent = indent + Step;
        return string.Join("\n" + indent, list.Select(item => "- " + Node(item, itemIndent, flowLists)));
    }

    private static string FlowList(List<object?> list, string indent)
    {
        if (list.Count == 0) return "[]";
        return "[" + string.Join(", ", list.Select(item => Node(item, indent + Step + Step, false, inFlow: true))) + "]";
    }

    // ---- one-line collections (a store's data, see StoreData.Compact) -------------------------------------------------

    /// <summary>The yaml package writes a flow collection one level in, so a value in it never starts at the left edge (where --- would read as a document marker).</summary>
    private const string FlowIndent = "    ";

    private static string FlowItems(IReadOnlyList<object?> items) => items.Count == 0 ? "[]" : "[" + string.Join(", ", items.Select(FlowNode)) + "]";

    private static string FlowPairs(OrderedDictionary<string, object?> map) =>
        map.Count == 0 ? "{}" : "{" + string.Join(", ", JsCompat.OrderKeys(map.Keys).Select(key => Scalar(key, FlowIndent, true, true) + ": " + FlowNode(map[key]))) + "}";

    /// <summary>Inside a flow collection everything is flow: text, then lists and maps on the same line.</summary>
    private static string FlowNode(object? node) => node switch
    {
        string s => FlowScalar(s),
        List<object?> list => FlowItems(list),
        FlowSeq flowSeq => FlowItems(flowSeq.Items),
        OrderedDictionary<string, object?> map => FlowPairs(map),
        FlowMap flowMap => FlowPairs(flowMap.Map),
        _ => throw new InvalidOperationException($"only text, lists and maps can be written, not {node?.GetType().Name ?? "null"}"),
    };

    /// <summary>An empty string is <c>""</c> (<c>[a, , b]</c> does not parse) and text with a line break is double quoted on one line.</summary>
    private static string FlowScalar(string s) =>
        s == "" ? "\"\"" : s.IndexOfAny(['\r', '\n']) >= 0 ? DoubleQuoted(s, "", true) : Scalar(s, FlowIndent, false, true);

    /// <summary>One <c>key: value</c> of a map whose own indent is <paramref name="indent"/>. Keys and values are written one level further in.</summary>
    private static string Pair(string key, object? value, string indent, bool flowLists)
    {
        var inner = indent + Step;
        var keyText = Scalar(key, inner, true, false);
        if (keyText.Length > MaxKeyLength) throw new InvalidOperationException("a key longer than 1024 characters can't be written");
        var valueText = Node(value, inner, flowLists);
        string ws;
        if (value is string) ws = valueText == "" || valueText[0] == '\n' ? "" : " ";
        else if (value is OrderedDictionary<string, object?> { Count: > 0 } || (value is List<object?> { Count: > 0 } && !flowLists)) ws = "\n" + inner;
        else ws = " ";
        return keyText + ":" + ws + valueText;
    }

    // ---- text ----------------------------------------------------------------------------------------------------

    private static bool ForcesDoubleQuotes(string s)
    {
        for (var i = 0; i < s.Length; i++)
        {
            var c = s[i];
            if (c <= 0x08 || (c >= 0x0b && c <= 0x1f) || (c >= 0x7f && c <= 0x9f)) return true;
            // The yaml package leaves these alone, but YAML 1.1 readers (YamlDotNet) take them for line breaks: always quoted and escaped here.
            if (c == (char)0x2028 || c == (char)0x2029) return true;
            if (char.IsHighSurrogate(c) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) i++;
            else if (char.IsSurrogate(c)) return true; // unpaired
        }
        return false;
    }

    private static string Scalar(string s, string indent, bool implicitKey, bool inFlow)
    {
        if (ForcesDoubleQuotes(s) || BlankLeadingLine().IsMatch(s)) return DoubleQuoted(s, indent, implicitKey);
        if ((implicitKey && s.Contains('\n')) || (inFlow && s.IndexOfAny(['[', ']', '{', '}', ',']) >= 0)) return Quoted(s, indent, implicitKey);
        if (NotPlain().IsMatch(s))
            return implicitKey || inFlow || !s.Contains('\n') ? Quoted(s, indent, implicitKey) : Block(s, indent, implicitKey);
        if (!implicitKey && !inFlow && s.Contains('\n')) return Block(s, indent, implicitKey);
        if (HasDocumentMarker(s))
        {
            if (indent == "") return Block(s, "  ", implicitKey);
            if (implicitKey && indent == Step) return Quoted(s, indent, implicitKey);
        }
        return s; // under the failsafe schema nothing else reads as a number, a boolean or null, so plain text is always text
    }

    /// <summary>A line that starts with %, --- or ... would read as a document marker. JavaScript's /m also breaks lines at \r, \u2028 and \u2029.</summary>
    private static bool HasDocumentMarker(string s)
    {
        for (var i = 0; i < s.Length; i++)
        {
            if (i != 0 && s[i - 1] is not ('\n' or '\r' or '\u2028' or '\u2029')) continue;
            if (s[i] == '%' || string.CompareOrdinal(s, i, "---", 0, 3) == 0 || string.CompareOrdinal(s, i, "...", 0, 3) == 0) return true;
        }
        return false;
    }

    private static string Quoted(string s, string indent, bool implicitKey)
    {
        var hasDouble = s.Contains('"');
        var hasSingle = s.Contains('\'');
        return hasDouble && !hasSingle ? SingleQuoted(s, indent, implicitKey) : DoubleQuoted(s, indent, implicitKey);
    }

    private static string SingleQuoted(string s, string indent, bool implicitKey)
    {
        if ((implicitKey && s.Contains('\n')) || SpaceAroundBreak().IsMatch(s)) return DoubleQuoted(s, indent, implicitKey);
        var pad = indent != "" ? indent : HasDocumentMarker(s) ? "  " : "";
        return "'" + Breaks().Replace(s.Replace("'", "''"), m => m.Value + "\n" + pad) + "'";
    }

    /// <summary>What JavaScript's JSON.stringify gives for text: the base of the double-quoted form.</summary>
    private static string Json(string s)
    {
        var sb = new StringBuilder("\"");
        for (var i = 0; i < s.Length; i++)
        {
            var c = s[i];
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\b': sb.Append("\\b"); break;
                case '\f': sb.Append("\\f"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20 || c == (char)0x85 || c == (char)0x2028 || c == (char)0x2029) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    else if (char.IsHighSurrogate(c) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) sb.Append(c).Append(s[++i]);
                    else if (char.IsSurrogate(c)) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.Append('"').ToString();
    }

    private static string DoubleQuoted(string value, string ctxIndent, bool implicitKey)
    {
        const int minMultiLineLength = 40;
        var json = Json(value);
        var indent = ctxIndent != "" ? ctxIndent : HasDocumentMarker(value) ? "  " : "";
        char At(int k) => k < json.Length ? json[k] : '\0';
        var sb = new StringBuilder();
        var start = 0;
        for (var i = 0; i < json.Length; i++)
        {
            var ch = json[i];
            if (ch == ' ' && At(i + 1) == '\\' && At(i + 2) == 'n')
            {
                // A space before a line break is escaped so it is never folded away.
                sb.Append(json, start, i - start).Append("\\ ");
                i += 1;
                start = i;
                ch = '\\';
            }
            if (ch != '\\') continue;
            switch (At(i + 1))
            {
                case 'u':
                {
                    sb.Append(json, start, i - start);
                    var code = json.Substring(i + 2, Math.Min(4, json.Length - (i + 2)));
                    switch (code)
                    {
                        case "0000": sb.Append("\\0"); break;
                        case "0007": sb.Append("\\a"); break;
                        case "000b": sb.Append("\\v"); break;
                        case "001b": sb.Append("\\e"); break;
                        case "0085": sb.Append("\\N"); break;
                        case "00a0": sb.Append("\\_"); break;
                        case "2028": sb.Append("\\L"); break;
                        case "2029": sb.Append("\\P"); break;
                        default:
                            if (code.StartsWith("00", StringComparison.Ordinal)) sb.Append("\\x").Append(code, 2, code.Length - 2);
                            else sb.Append(json, i, Math.Min(6, json.Length - i));
                            break;
                    }
                    i += 5;
                    start = i + 1;
                    break;
                }
                case 'n':
                    if (implicitKey || At(i + 2) == '"' || json.Length < minMultiLineLength)
                    {
                        i += 1;
                    }
                    else
                    {
                        // Folding eats the first line break, so a long text with breaks is written over several lines.
                        sb.Append(json, start, i - start).Append("\n\n");
                        while (At(i + 2) == '\\' && At(i + 3) == 'n' && At(i + 4) != '"')
                        {
                            sb.Append('\n');
                            i += 2;
                        }
                        sb.Append(indent);
                        if (At(i + 2) == ' ') sb.Append('\\');
                        i += 1;
                        start = i + 1;
                    }
                    break;
                default:
                    i += 1;
                    break;
            }
        }
        return start != 0 ? sb.Append(json, start, json.Length - start).ToString() : json;
    }

    /// <summary>A literal block scalar: <c>|</c>, <c>|-</c> or <c>|+</c> for what happens to the last line break, with an indent indicator when the text starts with a space.</summary>
    private static string Block(string value, string ctxIndent, bool implicitKey)
    {
        // Text that is only line breaks and spaces: the yaml package writes a block, which YamlDotNet can't read back.
        if (EndsInBlankLine().IsMatch(value) || value.All(c => c is '\n' or ' ' or '\t')) return Quoted(value, ctxIndent, implicitKey);
        var value0 = value;
        var indent = ctxIndent != "" ? ctxIndent : HasDocumentMarker(value) ? "  " : "";
        if (value == "") return "|\n";

        // How the text ends decides the chomping: none after it strips, one keeps just one, more keep all.
        var endStart = value.Length;
        while (endStart > 0 && value[endStart - 1] is '\n' or '\t' or ' ') endStart--;
        var end = value[endStart..];
        var endBreak = end.IndexOf('\n');
        string chomp;
        if (endBreak == -1) chomp = "-";
        else if (value == end || endBreak != end.Length - 1) chomp = "+";
        else chomp = "";
        if (end != "")
        {
            value = value[..^end.Length];
            if (end[^1] == '\n') end = end[..^1];
            end = BlockEndBreaks().Replace(end, m => m.Value + indent);
        }

        // A text that starts with spaces says how far the block is indented.
        var startWithSpace = false;
        var startEnd = 0;
        var startBreak = -1;
        for (; startEnd < value.Length; startEnd++)
        {
            if (value[startEnd] == ' ') startWithSpace = true;
            else if (value[startEnd] == '\n') startBreak = startEnd;
            else break;
        }
        var start = value[..(startBreak < startEnd ? startBreak + 1 : startEnd)];
        // The yaml package writes a block that begins with a blank line as is; YamlDotNet refuses to read it back ("extra spaces in first line"). Quoted, both can.
        if (start.Contains('\n')) return DoubleQuoted(value0, ctxIndent, implicitKey);
        if (start != "")
        {
            value = value[start.Length..];
            start = Breaks().Replace(start, m => m.Value + indent);
        }
        var header = (startWithSpace ? (indent != "" ? "2" : "1") : "") + chomp;
        value = Breaks().Replace(value, m => m.Value + indent);
        return "|" + header + "\n" + indent + start + value + end;
    }
}

/// <summary>A list the writer puts on one line, as a flow sequence: <c>[a, b]</c>. What <see cref="StoreData.Compact"/> marks.</summary>
public sealed record FlowSeq(IReadOnlyList<object?> Items);

/// <summary>A mapping the writer puts on one line, as a flow mapping: <c>{name: id, key: primary}</c>.</summary>
public sealed record FlowMap(OrderedDictionary<string, object?> Map);
