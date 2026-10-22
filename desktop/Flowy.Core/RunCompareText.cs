using System.Text;
using System.Text.RegularExpressions;
using YamlDotNet.Core;
using YamlDotNet.Core.Events;

namespace Flowy.Core;

/// <summary>
/// A run file is read-only except for one field: its <c>compare</c> tag (see <see cref="Compares"/>), which the Compare control writes in place. This edits the run's text
/// and nothing else: comments, key order, flow-style lines and every other byte stay, so removing a tag that was just added gives back the text that was there before.
/// A port of src/core/perf/comparetag.ts, which writes the same bytes (desktop/fixtures/compare.ts keeps the two equal). The forms it writes:
/// <list type="bullet">
/// <item>no note: <c>compare: &lt;id&gt;</c></item>
/// <item>a note: <c>compare:</c> then <c>  with: &lt;id&gt;</c> and <c>  note: &lt;text&gt;</c> on lines of their own. A note on one line is double-quoted with JSON escapes (the
/// Unicode line and paragraph separators are written as escapes too). A note that holds a line break and can be held by a block scalar is written as <c>note: |-</c> with each
/// line indented four spaces (an empty line stays empty); any other note falls back to the quoted line.</item>
/// <item>an id is written as it is when it is letters, digits, <c>.</c>, <c>_</c> or <c>-</c> (starting with a letter or digit); otherwise it is double-quoted.</item>
/// <item>a key that is not there goes at the end of the file, after the text's last line break (one is added when it has none). A key that is there is replaced where it
/// stands, and the line breaks of the text (LF or CRLF) are the ones written.</item>
/// </list>
/// </summary>
public static partial class RunCompareText
{
    private const string File = "run";
    private const char LineSeparator = (char)0x2028;
    private const char ParagraphSeparator = (char)0x2029;

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._-]*$", RegexOptions.CultureInvariant)]
    private static partial Regex PlainId();

    /// <summary>Whether a character is one a block scalar cannot carry as it is: a control character (a tab and a line feed aside), the Unicode line breaks, the byte order mark or a carriage return.</summary>
    private static bool NotInBlock(char c) =>
        c <= 0x08 || (c >= 0x0b && c <= 0x1f) || (c >= 0x7f && c <= 0x9f) || c == LineSeparator || c == ParagraphSeparator || c == (char)0xfeff;

    /// <summary>A double-quoted single-line YAML text, written the way JSON writes it (a lone surrogate as an escape, as JSON.stringify does).</summary>
    private static string Quoted(string text)
    {
        var sb = new StringBuilder("\"");
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
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
                    if (c < 0x20 || c == LineSeparator || c == ParagraphSeparator || IsLoneSurrogate(text, i)) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.Append('"').ToString();
    }

    private static bool IsLoneSurrogate(string text, int i) =>
        char.IsHighSurrogate(text[i]) ? !(i + 1 < text.Length && char.IsLowSurrogate(text[i + 1])) : char.IsLowSurrogate(text[i]) && !(i > 0 && char.IsHighSurrogate(text[i - 1]));

    private static string IdText(string id) => PlainId().IsMatch(id) ? id : Quoted(id);

    /// <summary>Whether a note with a line break reads back the same as a <c>|-</c> block scalar: no leading blank or space, no trailing break, no line of only spaces.</summary>
    private static bool FitsBlock(string note) =>
        note.Contains('\n') && !note.Any(NotInBlock) && !note.EndsWith('\n') && note[0] is not (' ' or '\t' or '\n')
        && note.Split('\n').All(line => line == "" || JsCompat.JsTrim(line) != "");

    /// <summary>The lines of the tag (without the line break after the last), joined with <paramref name="eol"/>.</summary>
    private static string Render(CompareTag tag, string eol)
    {
        if (tag.Note is null) return $"compare: {IdText(tag.With)}";
        var lines = new List<string> { "compare:", $"  with: {IdText(tag.With)}" };
        if (FitsBlock(tag.Note))
        {
            lines.Add("  note: |-");
            lines.AddRange(tag.Note.Split('\n').Select(line => line == "" ? "" : $"    {line}"));
        }
        else lines.Add($"  note: {Quoted(tag.Note)}");
        return string.Join(eol, lines);
    }

    /// <summary>
    /// The text of a run file with its <c>compare</c> set to <paramref name="tag"/>, or with the tag taken out when it is null (a text without one comes back as it was).
    /// Throws a <see cref="ParseError"/> when the text is not a mapping written in block style, so nothing is written over a file that cannot be read.
    /// </summary>
    public static string Set(string text, CompareTag? tag)
    {
        var (start, contentEnd) = Find(text);
        var eol = text.Contains("\r\n") ? "\r\n" : "\n";
        if (start < 0)
        {
            if (tag is null) return text;
            return $"{text}{(text == "" || text.EndsWith('\n') ? "" : eol)}{Render(tag, eol)}{eol}";
        }
        // The tag ends where its last line does.
        var at = text.IndexOf('\n', contentEnd);
        var lineEnd = at < 0 ? text.Length : at + 1;
        var contentStop = at < 0 ? text.Length : at - (text[at - 1] == '\r' ? 1 : 0);
        if (tag is null) return text[..start] + text[lineEnd..];
        return text[..start] + Render(tag, eol) + text[contentStop..];
    }

    /// <summary>
    /// Where the top-level <c>compare</c> key starts and where its value's last content ends, or -1 and -1 when there is none. Walks the parser's events: only the
    /// outermost mapping's keys count, so a nested <c>compare</c> is left alone.
    /// </summary>
    private static (int Start, int ContentEnd) Find(string text)
    {
        try
        {
            var parser = new Parser(new StringReader(text));
            parser.Consume<StreamStart>();
            if (parser.TryConsume<StreamEnd>(out _)) throw new ParseError(File, "expected a mapping with \"name\", \"unit\" and \"levels\"");
            parser.Consume<DocumentStart>();
            if (!parser.TryConsume<MappingStart>(out var top)) throw new ParseError(File, "expected a mapping with \"name\", \"unit\" and \"levels\"");
            if (top.Style == MappingStyle.Flow) throw new ParseError(File, "expected the keys one to a line, not in braces");
            var seen = new HashSet<string>();
            int start = -1, contentEnd = -1;
            while (!parser.Accept<MappingEnd>(out _))
            {
                var key = parser.Consume<Scalar>();
                if (!seen.Add(key.Value)) throw new ParseError(File, "Map keys must be unique", (int)key.Start.Line);
                var last = SkipValue(parser, text, key);
                if (key.Value != "compare") continue;
                start = (int)key.Start.Index;
                contentEnd = last;
            }
            return (start, contentEnd);
        }
        catch (Exception e) when (e is not ParseError)
        {
            throw new ParseError(File, e.Message.Split('\n')[0], e is YamlException y ? (int)y.Start.Line : null);
        }
    }

    /// <summary>Consumes one value and gives where its last content ends: a scalar's end (minus any blank lines a block scalar swallowed), or the closing mark of a flow collection.</summary>
    private static int SkipValue(Parser parser, string text, Scalar key)
    {
        var depth = 0;
        var end = (int)key.End.Index + 1; // an empty value ends after its colon
        var flow = new Stack<bool>();
        do
        {
            var e = parser.Consume<ParsingEvent>();
            switch (e)
            {
                case MappingStart m: depth++; flow.Push(m.Style == MappingStyle.Flow); break;
                case SequenceStart s: depth++; flow.Push(s.Style == SequenceStyle.Flow); break;
                case MappingEnd or SequenceEnd:
                    depth--;
                    if (flow.Pop()) end = (int)e.End.Index;
                    break;
                case Scalar sc when sc.Value.Length > 0 || sc.Style != ScalarStyle.Plain || sc.End.Index > sc.Start.Index:
                    end = TrimBack(text, (int)sc.End.Index);
                    break;
            }
        } while (depth > 0);
        return end;
    }

    /// <summary>Back from <paramref name="at"/> over the blank lines and spaces a block scalar's end mark swallows, to just after its last content.</summary>
    private static int TrimBack(string text, int at)
    {
        while (at > 0 && text[at - 1] is ' ' or '\t' or '\r' or '\n') at--;
        return at;
    }
}
