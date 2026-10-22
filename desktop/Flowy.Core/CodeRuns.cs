using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>What a stretch of code is, for colouring. The same nine kinds as <c>TOKEN_KINDS</c> in ui/src/highlight.ts, which the stylesheet and Styles.axaml colour.</summary>
public enum TokenKind { Comment, Keyword, String, Number, Type, Function, Property, Tag, Meta }

/// <summary>A stretch of code and what it is, if it is any of the kinds. A stretch of none is drawn plain.</summary>
public readonly record struct CodeRun(string Text, TokenKind? Kind = null);

/// <summary>Turns the HTML highlight.js writes into runs. The twin of <c>runsFromHtml</c> in ui/src/highlight.ts, checked against it by fixtures.</summary>
public static partial class CodeRuns
{
    // The kind each class highlight.js puts on a stretch stands for; a class mapped to null is plain. A class that isn't here is drawn as the stretch around it.
    private static readonly Dictionary<string, TokenKind?> Kinds = new()
    {
        ["comment"] = TokenKind.Comment, ["quote"] = TokenKind.Comment,
        ["keyword"] = TokenKind.Keyword, ["doctag"] = TokenKind.Keyword, ["meta-keyword"] = TokenKind.Keyword,
        ["string"] = TokenKind.String, ["regexp"] = TokenKind.String, ["meta-string"] = TokenKind.String, ["link"] = TokenKind.String, ["template_string"] = TokenKind.String,
        ["number"] = TokenKind.Number, ["literal"] = TokenKind.Number, ["symbol"] = TokenKind.Number, ["bullet"] = TokenKind.Number,
        ["type"] = TokenKind.Type, ["built_in"] = TokenKind.Type, ["class_"] = TokenKind.Type,
        ["function_"] = TokenKind.Function,
        ["attr"] = TokenKind.Property, ["attribute"] = TokenKind.Property, ["property"] = TokenKind.Property, ["variable"] = TokenKind.Property, ["template-variable"] = TokenKind.Property,
        ["tag"] = TokenKind.Tag, ["name"] = TokenKind.Tag, ["section"] = TokenKind.Tag, ["selector-tag"] = TokenKind.Tag, ["selector-id"] = TokenKind.Tag,
        ["selector-class"] = TokenKind.Tag, ["selector-attr"] = TokenKind.Tag, ["selector-pseudo"] = TokenKind.Tag,
        ["meta"] = TokenKind.Meta,
        ["subst"] = null, ["params"] = null, ["operator"] = null, ["punctuation"] = null,
    };

    [GeneratedRegex(@"(<span class=""[^""]*"">|</span>)")]
    private static partial Regex Tags();

    [GeneratedRegex(@"^<span class=""([^""]*)"">$")]
    private static partial Regex Open();

    [GeneratedRegex(@"&(?:amp|lt|gt|quot|#x27|#39);")]
    private static partial Regex Entity();

    private static string Unescape(string text) => Entity().Replace(text, e => e.Value switch
    {
        "&amp;" => "&", "&lt;" => "<", "&gt;" => ">", "&quot;" => "\"", _ => "'",
    });

    /// <summary>
    /// The HTML as runs: each stretch of text with the kind of the innermost span that has one, text unescaped, adjacent runs of one kind joined.
    /// </summary>
    public static IReadOnlyList<CodeRun> FromHtml(string html)
    {
        var runs = new List<CodeRun>();
        var stack = new List<(bool Mapped, TokenKind? Kind)>();
        void Push(string text)
        {
            if (text == "") return;
            TokenKind? kind = null;
            for (var i = stack.Count - 1; i >= 0; i--)
                if (stack[i].Mapped)
                {
                    kind = stack[i].Kind;
                    break;
                }
            if (runs.Count > 0 && runs[^1].Kind == kind) runs[^1] = runs[^1] with { Text = runs[^1].Text + text };
            else runs.Add(new CodeRun(text, kind));
        }
        foreach (var part in Tags().Split(html))
        {
            if (Open().Match(part) is { Success: true } open)
            {
                var frame = (Mapped: false, Kind: (TokenKind?)null);
                foreach (var cls in open.Groups[1].Value.Split([' ', '\t', '\n'], StringSplitOptions.RemoveEmptyEntries).Select(c => c.StartsWith("hljs-", StringComparison.Ordinal) ? c[5..] : c))
                    if (Kinds.TryGetValue(cls, out var kind))
                    {
                        frame = (true, kind);
                        break;
                    }
                stack.Add(frame);
            }
            else if (part == "</span>")
            {
                if (stack.Count > 0) stack.RemoveAt(stack.Count - 1);
            }
            else Push(Unescape(part));
        }
        return runs;
    }
}
