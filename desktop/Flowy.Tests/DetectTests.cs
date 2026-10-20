using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>Which language some code is in, and how highlight.js's HTML becomes runs: the C# twins must answer as src/core/detect.ts and ui/src/highlight.ts do (desktop/fixtures/detect.ts).</summary>
public class DetectTests
{
    private static JsonNode Expected(string name) => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", name + ".json")))!;

    [Fact]
    public void Every_snippet_gets_the_language_the_TypeScript_cues_give_it()
    {
        var cases = Expected("detect").AsArray();
        Assert.True(cases.Count > 200);
        var wrong = cases.Where(c => Detect.Guess(c!["text"]!.GetValue<string>()) != c["guess"]?.GetValue<string>())
            .Select(c => $"{c!["guess"]?.GetValue<string>() ?? "nothing"} for {c["text"]!.GetValue<string>()[..Math.Min(60, c["text"]!.GetValue<string>().Length)].ReplaceLineEndings(" ")}")
            .ToList();
        Assert.True(wrong.Count == 0, string.Join("\n", wrong));
    }

    [Fact]
    public void The_languages_the_cues_name_are_all_ones_Flowy_knows()
    {
        foreach (var (language, _) in DetectData.Cues) Assert.NotNull(Snippets.LanguageOf(language));
    }

    [Fact]
    public void Nothing_that_stands_out_is_left_without_a_name()
    {
        Assert.Null(Detect.Guess(""));
        Assert.Null(Detect.Guess("hello"));
        Assert.Equal("json", Detect.Guess("  [1, 2, 3]"));
        Assert.Null(Detect.Guess("[1, 2"));
    }

    private static string Describe(IEnumerable<CodeRun> runs) => string.Join("|", runs.Select(r => $"{r.Kind?.ToString().ToLowerInvariant() ?? "-"}:{r.Text}"));

    [Fact]
    public void Highlight_js_html_becomes_the_runs_the_canvas_draws()
    {
        var cases = Expected("highlight")["htmlCases"]!.AsArray();
        Assert.True(cases.Count >= 10);
        foreach (var c in cases)
        {
            var expected = c!["runs"]!.AsArray().Select(r => $"{r!["kind"]?.GetValue<string>() ?? "-"}:{r["text"]!.GetValue<string>()}");
            Assert.Equal(string.Join("|", expected), Describe(CodeRuns.FromHtml(c["html"]!.GetValue<string>())));
        }
    }
}
