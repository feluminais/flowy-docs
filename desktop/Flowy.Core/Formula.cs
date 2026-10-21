using System.Globalization;

namespace Flowy.Core;

/// <summary>The tree a formula reads into. Nothing outside this file needs to look inside it.</summary>
public abstract record FormulaNode;

internal sealed record NumberNode(double Value) : FormulaNode;

internal sealed record NameNode(string Name) : FormulaNode;

internal sealed record NegateNode(FormulaNode Inner) : FormulaNode;

internal sealed record BinaryNode(char Op, FormulaNode A, FormulaNode B) : FormulaNode;

/// <summary>A formula that was read. Opaque: ask it through <see cref="Formulas"/>. It prints as its text (<see cref="Formulas.Text"/>), as the TypeScript one does when it is written to JSON.</summary>
public sealed record Formula(FormulaNode Node)
{
    public override string ToString() => Formulas.Text(this);
}

/// <summary>The numbers a formula may name. A name that has no number makes the formula give no value.</summary>
public readonly record struct FormulaVars(double? Rate = null, double? Bytes = null, double? P50 = null);

/// <summary>What reading a formula gave: the formula, or what is wrong with the text.</summary>
public readonly record struct FormulaRead(Formula? Formula, string? Problem);

/// <summary>
/// The traffic formula: plain arithmetic a run's <c>source:</c> uses to say how many dots a line shows and how big each is. Numbers, the names
/// <c>rate</c>, <c>bytes</c> and <c>p50</c>, <c>+ - * /</c>, brackets and unary minus, nothing else. A port of src/core/formula.ts, kept equal to it by
/// the fixtures in desktop/fixtures/formula.ts: the same answers and the same words for what can't be read.
/// Grammar:  expr = term { ("+" | "-") term }    term = unary { ("*" | "/") unary }    unary = "-" unary | number | name | "(" expr ")"
/// </summary>
public static class Formulas
{
    /// <summary>The names a formula may use.</summary>
    public static readonly IReadOnlyList<string> Names = ["rate", "bytes", "p50"];

    /// <summary>The longest formula there is room for.</summary>
    public const int Max = 80;

    /// <summary>How much of a formula a problem quotes, so a hostile or runaway text doesn't fill the problem list.</summary>
    private const int Quoted = 40;

    private static bool IsDigit(char c) => c >= '0' && c <= '9';

    private static bool IsLetter(char c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_';

    /// <summary>The character at <paramref name="i"/> as a reader sees it: a pair of UTF-16 halves is one character.</summary>
    private static string CharAt(string text, int i) =>
        char.IsHighSurrogate(text[i]) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1]) ? text.Substring(i, 2) : text[i].ToString();

    private enum Kind
    {
        Number,
        Name,
        Sign,
        Bad,
    }

    /// <summary>A piece of the text: a number, a name, a sign or bracket, or the place the text stops making sense (<c>Bad</c> holds the problem).</summary>
    private readonly record struct Token(Kind Kind, string Text, int At);

    /// <summary>Raised inside the parser and caught at its edge, so what a caller sees is a problem, never an exception.</summary>
    private sealed class Unreadable(string message) : Exception(message);

    /// <summary>The text as tokens, 1-based places. It stops at the first thing it can't read, which comes last as a <c>Bad</c> token the parser reports if it gets that far.</summary>
    private static List<Token> Tokenize(string text)
    {
        var tokens = new List<Token>();
        var i = 0;
        while (i < text.Length)
        {
            var c = text[i];
            if (c == ' ')
            {
                i++;
            }
            else if (IsDigit(c) || c == '.')
            {
                var j = i;
                var dots = 0;
                var digits = 0;
                while (j < text.Length && (IsDigit(text[j]) || text[j] == '.'))
                {
                    if (text[j] == '.') dots++;
                    else digits++;
                    j++;
                }
                var piece = text[i..j];
                if (dots > 1 || digits == 0)
                {
                    tokens.Add(new Token(Kind.Bad, $"bad number \"{piece}\" at {i + 1}", i + 1));
                    return tokens;
                }
                tokens.Add(new Token(Kind.Number, piece, i + 1));
                i = j;
            }
            else if (IsLetter(c))
            {
                var j = i + 1;
                while (j < text.Length && (IsLetter(text[j]) || IsDigit(text[j]))) j++;
                tokens.Add(new Token(Kind.Name, text[i..j], i + 1));
                i = j;
            }
            else if (c is '+' or '-' or '*' or '/' or '(' or ')')
            {
                tokens.Add(new Token(Kind.Sign, c.ToString(), i + 1));
                i++;
            }
            else
            {
                tokens.Add(new Token(Kind.Bad, $"unexpected \"{CharAt(text, i)}\" at {i + 1}", i + 1));
                return tokens;
            }
        }
        return tokens;
    }

    private static string Quote(string text) => $"formula \"{(text.Length > Quoted ? text[..Quoted] + "…" : text)}\"";

    /// <summary>
    /// Reads a formula. A formula that can't be read gives the problem instead, worded <c>formula "&lt;text&gt;": &lt;what&gt;</c>: what is empty, too long,
    /// an unknown name, a character or token in the wrong place (with its place), a bracket left open, or text that ends too soon.
    /// </summary>
    public static FormulaRead Parse(string? text)
    {
        if (text is null) return new FormulaRead(null, "formula \"\": must be text");
        FormulaRead Say(string what) => new(null, $"{Quote(text)}: {what}");
        if (text.All(c => c == ' ')) return Say("empty"); // a space is the only blank there is
        if (text.Length > Max) return Say($"at most {Max} characters");

        var tokens = Tokenize(text);
        var at = 0;
        Token? Peek() => at < tokens.Count ? tokens[at] : null;

        // What is wrong with the token in hand: its own problem when it was unreadable, else that it is in the wrong place.
        Unreadable Wrong(Token? t, string? expected = null) =>
            t is not { } token
                ? new Unreadable(expected is null ? "unexpected end" : $"missing \"{expected}\"")
                : new Unreadable(token.Kind == Kind.Bad ? token.Text : $"unexpected \"{token.Text}\" at {token.At}");

        FormulaNode Primary()
        {
            var t = Peek();
            if (t is not { } token || token.Kind == Kind.Bad) throw Wrong(t);
            if (token.Kind == Kind.Number)
            {
                at++;
                return new NumberNode(double.Parse(token.Text, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture));
            }
            if (token.Kind == Kind.Name)
            {
                if (!Names.Contains(token.Text)) throw new Unreadable($"unknown name \"{token.Text}\" (use {string.Join(", ", Names)})");
                at++;
                return new NameNode(token.Text);
            }
            if (token.Text == "(")
            {
                at++;
                var inside = Expr();
                var close = Peek();
                if (close is not { Kind: Kind.Sign, Text: ")" }) throw Wrong(close, ")");
                at++;
                return inside;
            }
            throw Wrong(token);
        }

        FormulaNode Unary()
        {
            if (Peek() is { Kind: Kind.Sign, Text: "-" })
            {
                at++;
                return new NegateNode(Unary());
            }
            return Primary();
        }

        FormulaNode Chain(Func<FormulaNode> next, string ops)
        {
            var left = next();
            while (Peek() is { Kind: Kind.Sign } t && ops.Contains(t.Text))
            {
                at++;
                left = new BinaryNode(t.Text[0], left, next());
            }
            return left;
        }

        FormulaNode Term() => Chain(Unary, "*/");
        FormulaNode Expr() => Chain(Term, "+-");

        try
        {
            var node = Expr();
            if (at < tokens.Count) throw Wrong(tokens[at]);
            return new FormulaRead(new Formula(node), null);
        }
        catch (Unreadable e)
        {
            return Say(e.Message);
        }
    }

    /// <summary>A result is finite, so it is never Infinity or NaN; zero is plain zero, never negative zero. Null otherwise.</summary>
    private static double? Finite(double n) => double.IsFinite(n) ? (n == 0 ? 0 : n) : null;

    private static double? Eval(FormulaNode node, FormulaVars vars)
    {
        switch (node)
        {
            case NumberNode n:
                return Finite(n.Value);
            case NameNode v:
                var value = v.Name switch { "rate" => vars.Rate, "bytes" => vars.Bytes, _ => vars.P50 };
                return value is { } x ? Finite(x) : null;
            case NegateNode neg:
                return Eval(neg.Inner, vars) is { } inner ? Finite(-inner) : null;
            case BinaryNode b:
                if (Eval(b.A, vars) is not { } a || Eval(b.B, vars) is not { } c) return null;
                return b.Op switch
                {
                    '+' => Finite(a + c),
                    '-' => Finite(a - c),
                    '*' => Finite(a * c),
                    _ => c == 0 ? null : Finite(a / c),
                };
            default:
                return null;
        }
    }

    /// <summary>
    /// The formula's value for these numbers. Null ("no value", never Infinity or NaN) when a name it uses has no number, when it divides by zero,
    /// or when any step is too big to hold.
    /// </summary>
    public static double? Eval(Formula f, FormulaVars vars) => Eval(f.Node, vars);

    /// <summary>The names a formula uses, each once, in the order it first uses them.</summary>
    public static IReadOnlyList<string> UsedNames(Formula f)
    {
        var seen = new List<string>();
        void Walk(FormulaNode node)
        {
            switch (node)
            {
                case NameNode v:
                    if (!seen.Contains(v.Name)) seen.Add(v.Name);
                    break;
                case NegateNode neg:
                    Walk(neg.Inner);
                    break;
                case BinaryNode b:
                    Walk(b.A);
                    Walk(b.B);
                    break;
            }
        }
        Walk(f.Node);
        return seen;
    }

    /// <summary>
    /// The constant <c>k</c> when the formula is <c>k * rate</c> for every rate and uses nothing else, so a key can say "1 dot = 50 calls/s". Null for
    /// anything else, and for a <c>k</c> that is not above zero. Found by trying four rates.
    /// </summary>
    public static double? LinearInRate(Formula f)
    {
        if (Eval(f, new FormulaVars(Rate: 1)) is not { } k || !(k > 0)) return null;
        foreach (var rate in new[] { 2.0, 10, 1000 })
        {
            if (Eval(f, new FormulaVars(Rate: rate)) is not { } v || Math.Abs(v - k * rate) > 1e-9 * Math.Max(1, Math.Abs(k * rate))) return null;
        }
        return k;
    }

    private static string Show(FormulaNode node, bool root) => node switch
    {
        NumberNode n => n.Value.ToString("R", CultureInfo.InvariantCulture),
        NameNode v => v.Name,
        NegateNode neg => $"-{Show(neg.Inner, false)}",
        BinaryNode b => root ? $"{Show(b.A, false)} {b.Op} {Show(b.B, false)}" : $"({Show(b.A, false)} {b.Op} {Show(b.B, false)})",
        _ => "",
    };

    /// <summary>The formula as text, every sum or product inside another in brackets (the outermost bare): how the fixtures write a formula down.</summary>
    public static string Text(Formula f) => Show(f.Node, true);
}
