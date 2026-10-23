using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>Where this port matches JavaScript instead of .NET: the same trim, the same key order, the same number text. desktop/fixtures keeps it equal to src/core.</summary>
public static class JsCompat
{
    /// <summary>
    /// The characters JavaScript's <c>trim()</c> and <c>\s</c> take: white space and line terminators. .NET's own white space differs: it takes U+0085 and not U+FEFF.
    /// <see cref="SpaceClass"/> and <see cref="IsSpace"/> are one set, so change them together.
    /// </summary>
    public const string SpaceClass = @"[\t\n\v\f\r    -     　﻿]";

    public static bool IsSpace(char c) =>
        c is '\t' or '\n' or '\v' or '\f' or '\r' or ' ' or (char)0xa0 or (char)0x1680 or (>= (char)0x2000 and <= (char)0x200a)
            or (char)0x2028 or (char)0x2029 or (char)0x202f or (char)0x205f or (char)0x3000 or (char)0xfeff;

    /// <summary>The text without the white space JavaScript's <c>trim()</c> removes.</summary>
    public static string JsTrim(string s)
    {
        var start = 0;
        var end = s.Length;
        while (start < end && IsSpace(s[start])) start++;
        while (end > start && IsSpace(s[end - 1])) end--;
        return start == 0 && end == s.Length ? s : s[start..end];
    }

    /// <summary>The text as JavaScript's <c>JSON.stringify</c> writes it, quotes included: what a message that shows a bad value in quotes says.</summary>
    public static string Json(string s)
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
                    if (char.IsHighSurrogate(c) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) sb.Append(c).Append(s[++i]);
                    else if (c < 0x20 || char.IsSurrogate(c)) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture)); // a lone surrogate is escaped
                    else sb.Append(c);
                    break;
            }
        }
        return sb.Append('"').ToString();
    }

    private static readonly Regex PlainNumberText = new(@"^[ \t\n\v\f\r]*[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?[ \t\n\v\f\r]*\z");

    /// <summary>
    /// A number written in a file: decimal digits with an optional sign, fraction and exponent, and nothing else (not 0x10, not Infinity). Null for anything else,
    /// and for a number too big to be finite. The same grammar as <c>plainNumber</c> in src/core/text.ts; desktop/fixtures/numbers.ts keeps the two equal.
    /// </summary>
    public static double? PlainNumber(object? v) =>
        v is string s && PlainNumberText.IsMatch(s) && double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && double.IsFinite(n) ? n : null;

    /// <summary>Whether a value says nothing: not text, or only white space. A blank group, lane, flow or option is the same as none.</summary>
    public static bool Blank(object? v) => v is not string s || JsTrim(s) == "";

    /// <summary>Whether a parsed YAML value is an empty one: nothing, "" or any spelling of null.</summary>
    public static bool IsEmpty(object? v) => v is null or "" or "~" or "null" or "Null" or "NULL";

    /// <summary>The value, or <paramref name="empty"/> when <see cref="IsEmpty"/> says it is empty.</summary>
    public static object? OrEmpty(object? v, object? empty) => IsEmpty(v) ? empty : v;

    /// <summary>Keys in the order JavaScript lists an object's: ids that look like array indexes ("2", "10") first, ascending, then the rest as given.</summary>
    public static List<string> OrderKeys(IEnumerable<string> keys)
    {
        var indexes = new List<(uint N, string Key)>();
        var rest = new List<string>();
        foreach (var key in keys)
        {
            if (IsIndex(key, out var n)) indexes.Add((n, key));
            else rest.Add(key);
        }
        indexes.Sort((a, b) => a.N.CompareTo(b.N));
        return [.. indexes.Select(i => i.Key), .. rest];
    }

    private static bool IsIndex(string s, out uint n) =>
        uint.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out n) && n != uint.MaxValue && (s.Length == 1 || s[0] != '0');

    /// <summary>A number as the shortest text that reads back to it (the <c>R</c> format), the form run files and the Performance readouts use.</summary>
    public static string Raw(double n) => n.ToString("R", CultureInfo.InvariantCulture);

    /// <summary>A number as JavaScript prints it: 10 not 10.0, 12.5 as it is. A position is a whole number or a short fraction, so this stays simple.</summary>
    public static string Number(double d)
    {
        if (d == 0) return "0"; // also -0
        if (d == Math.Floor(d) && Math.Abs(d) < 1e15) return ((long)d).ToString(CultureInfo.InvariantCulture);
        var s = d.ToString("R", CultureInfo.InvariantCulture);
        return s.Contains('E') ? d.ToString("0.####################", CultureInfo.InvariantCulture) : s;
    }
}
