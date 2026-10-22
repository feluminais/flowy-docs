using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>What counts as a number in a file: the C# grammar must answer as plainNumber in src/core/text.ts does (desktop/fixtures/numbers.ts).</summary>
public class NumbersTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "numbers.json")))!;

    [Fact]
    public void Every_text_reads_as_the_number_the_TypeScript_grammar_gives_or_as_none()
    {
        var cases = Expected().AsArray();
        Assert.True(cases.Count > 30);
        var wrong = cases.Where(c => JsCompat.PlainNumber(c!["text"]!.GetValue<string>()) != c["value"]?.GetValue<double>())
            .Select(c => $"{c!["text"]!.GetValue<string>().Replace("\n", "\n").Replace("\t", "\t")} should read as {c["value"]?.ToString() ?? "none"}")
            .ToList();
        Assert.True(wrong.Count == 0, string.Join("\n", wrong));
    }

    [Fact]
    public void Text_that_is_not_text_reads_as_none()
    {
        Assert.Null(JsCompat.PlainNumber(null));
        Assert.Null(JsCompat.PlainNumber(5));
        Assert.Null(JsCompat.PlainNumber(new List<object?>()));
    }

    [Fact]
    public void Every_text_is_blank_or_not_as_the_TypeScript_trim_says()
    {
        var wrong = Expected().AsArray().Where(c => JsCompat.Blank(c!["text"]!.GetValue<string>()) != c["blank"]!.GetValue<bool>())
            .Select(c => $"{c!["text"]!.GetValue<string>().Select(ch => ((int)ch).ToString("x4")).Aggregate("", (a, h) => a + " " + h)} should be {(c["blank"]!.GetValue<bool>() ? "blank" : "text")}")
            .ToList();
        Assert.True(wrong.Count == 0, string.Join(Environment.NewLine, wrong));
    }

    [Fact]
    public void White_space_is_what_JavaScript_trims_a_byte_order_mark_included()
    {
        Assert.True(JsCompat.Blank("\uFEFF"));
        Assert.True(JsCompat.Blank(" \u00a0\u2028 "));
        Assert.False(JsCompat.Blank("\u0085"));
    }
}
