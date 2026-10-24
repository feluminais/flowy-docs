using System.Diagnostics;
using System.Text.Json.Nodes;
using Flowy.Core;
using Jint;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>
/// Test classes that give highlight.js its time limits run on their own, after the rest. Beside other classes a CI machine can starve a
/// pattern past its 500 ms, and highlight.js then answers with the code uncoloured.
/// </summary>
[CollectionDefinition(nameof(RunsAlone), DisableParallelization = true)]
public sealed class RunsAlone;

/// <summary>highlight.js running inside the app: it must write what node writes for the canvas, give up quietly when it cannot, and never take long over hostile code.</summary>
[Collection(nameof(RunsAlone))]
public class HljsTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "highlight.json")))!;

    [Fact]
    public void Each_language_is_coloured_with_the_same_HTML_the_canvas_gets()
    {
        var snippets = Expected()["snippets"]!.AsArray();
        Assert.True(snippets.Count >= 20);
        foreach (var s in snippets)
            Assert.Equal(s!["html"]!.GetValue<string>(), Patiently(() => Hljs.Highlight(s["text"]!.GetValue<string>(), s["language"]!.GetValue<string>()), html => html?.Contains("<span", StringComparison.Ordinal) == true));
    }

    /// <summary>
    /// A snippet gets 2 s and each pattern 500 ms, and past that it shows plain, as the app means it to: as null, or as the code with no
    /// colours. A busy test machine can take that long, and these tests are about the grammars, so a plain answer is tried again a few times.
    /// </summary>
    private static T Patiently<T>(Func<T> highlight, Func<T, bool> coloured)
    {
        var result = highlight();
        for (var i = 0; i < 3 && !coloured(result); i++) result = highlight();
        return result;
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
            var runs = Patiently(() => CodeInk.Runs(text, s["language"]!.GetValue<string>()), got => got.Any(r => r.Kind is not null));
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
    public void A_script_past_its_budget_is_stopped_and_each_run_starts_its_own_count()
    {
        var budget = new Hljs.Budget { Limit = TimeSpan.FromMilliseconds(200) };
        var engine = new Engine(o => o.Constraint(budget));
        Assert.Throws<TimeoutException>(() => engine.Execute("while (true) {}"));
        Thread.Sleep(300);
        Assert.Equal(2, engine.Evaluate("1 + 1").AsNumber()); // a run after a pause longer than the limit still gets the whole limit
        budget.Limit = TimeSpan.FromSeconds(30);
        Assert.Equal(3, engine.Evaluate("let n = 0; for (let i = 0; i < 3; i++) n++; n").AsNumber());
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
