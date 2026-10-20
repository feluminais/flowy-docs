using System.Diagnostics;
using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>highlight.js running inside the app: it must write what node writes for the canvas, give up quietly when it cannot, and never take long over hostile code.</summary>
public class HljsTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "highlight.json")))!;

    [Fact]
    public void Each_language_is_coloured_with_the_same_HTML_the_canvas_gets()
    {
        var snippets = Expected()["snippets"]!.AsArray();
        Assert.True(snippets.Count >= 20);
        foreach (var s in snippets)
            Assert.Equal(s!["html"]!.GetValue<string>(), Hljs.Highlight(s["text"]!.GetValue<string>(), s["language"]!.GetValue<string>()));
    }

    [Fact]
    public void A_language_without_a_grammar_has_no_answer_and_plain_text_stays_plain()
    {
        Assert.Null(Hljs.Highlight("x", "klingon"));
        var plain = CodeInk.Runs("a < b", "text");
        Assert.Equal([new CodeRun("a < b")], plain);
        Assert.Equal([new CodeRun("a < b")], CodeInk.Runs("a < b", "klingon"));
        Assert.Equal([new CodeRun("a < b")], CodeInk.Runs("a < b", null));
    }

    [Fact]
    public void The_runs_of_code_always_spell_the_code_back()
    {
        foreach (var s in Expected()["snippets"]!.AsArray())
        {
            var text = s!["text"]!.GetValue<string>();
            var runs = CodeInk.Runs(text, s["language"]!.GetValue<string>());
            Assert.Equal(text, string.Concat(runs.Select(r => r.Text)));
            Assert.Contains(runs, r => r.Kind is not null);
        }
    }

    [Fact]
    public void Colours_follow_the_kinds_highlight_js_gives()
    {
        var runs = CodeInk.Runs("const fee = 2 // later", "typescript");
        Assert.Contains(new CodeRun("const", TokenKind.Keyword), runs);
        Assert.Contains(new CodeRun("2", TokenKind.Number), runs);
        Assert.Contains(runs, r => r.Kind == TokenKind.Comment && r.Text.StartsWith("// later"));
    }

    [Fact]
    public void Code_built_to_make_a_pattern_crawl_is_given_up_on_in_a_few_seconds()
    {
        var hostile = new string('(', 200_000) + new string('"', 50_000) + "\n" + string.Concat(Enumerable.Repeat("a=a=a=a=a=a=a=a=a=a=a=a=a=a=a=a=!", 500));
        var clock = Stopwatch.StartNew();
        var runs = CodeInk.Runs(hostile, "javascript");
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(10), $"took {clock.Elapsed}");
        Assert.Equal(hostile, string.Concat(runs.Select(r => r.Text)));
    }

    [Fact]
    public void Calls_from_several_threads_at_once_all_get_their_own_answer()
    {
        var results = Enumerable.Range(0, 40).AsParallel().AsOrdered().Select(i => Hljs.Highlight($"const n{i} = {i}", "typescript")).ToList();
        for (var i = 0; i < results.Count; i++) Assert.Contains($"n{i}", results[i]);
        Assert.All(results, r => Assert.Contains("hljs-keyword", r));
    }
}
