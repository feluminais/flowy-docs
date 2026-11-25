using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>How an entry of a <c>code</c> list reads and what is wrong with a list: <see cref="CodeRefs"/> must answer as src/core/code.ts does (desktop/fixtures/code.ts).</summary>
public class CodeRefsTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "code.json")))!;

    private static readonly HashSet<string> Gone = ["gone.ts", "gone/"];

    private static string Show(string text) => text.Replace("\n", "\\n").Replace("\u2028", "\\u2028");

    /// <summary>A list as the fixture wrote it: text stays text, a number stays a number, and "(none)" is no list at all.</summary>
    private static object? ListOf(JsonNode? code) => code switch
    {
        JsonArray items => items.Select(i => i!.GetValueKind() == System.Text.Json.JsonValueKind.String ? (object?)i.GetValue<string>() : i.GetValue<double>()).ToList(),
        JsonValue v when v.GetValue<string>() == "(none)" => null,
        JsonValue v => v.GetValue<string>(),
        _ => null,
    };

    [Fact]
    public void Every_entry_reads_as_the_TypeScript_reads_it_and_has_the_same_problems()
    {
        var expected = Expected();
        Assert.Equal(CodeRefs.MaxLine, expected["max"]!.GetValue<int>());
        var wrong = new List<string>();
        foreach (var c in expected["entries"]!.AsArray())
        {
            var entry = c!["entry"]!.GetValue<string>();
            var read = CodeRefs.Read(entry);
            var want = c["ref"];
            var same = want is null
                ? read is null
                : read is not null && read.Path == want["path"]!.GetValue<string>() && read.Line == want["line"]?.GetValue<int>() && read.ToString() == c["text"]!.GetValue<string>();
            if (!same) wrong.Add($"{Show(entry)} reads as {read?.ToString() ?? "nothing"}");
            var problems = CodeRefs.Problems(new List<object?> { entry }, Gone);
            var wanted = c["problems"]!.AsArray().Select(p => p!.GetValue<string>()).ToList();
            if (!problems.SequenceEqual(wanted)) wrong.Add($"{Show(entry)}: {string.Join(" | ", problems)} instead of {string.Join(" | ", wanted)}");
        }
        Assert.True(wrong.Count == 0, string.Join(Environment.NewLine, wrong));
    }

    [Fact]
    public void Every_list_gives_the_same_paths_and_problems()
    {
        foreach (var c in Expected()["lists"]!.AsArray())
        {
            var list = ListOf(c!["code"]);
            Assert.Equal(c["refs"]!.AsArray().Select(r => $"{r!["path"]}:{r["line"]}").ToList(), CodeRefs.Of(list).Select(r => $"{r.Path}:{r.Line}").ToList());
            Assert.Equal(c["problems"]!.AsArray().Select(p => p!.GetValue<string>()).ToList(), CodeRefs.Problems(list, Gone));
        }
    }

    [Fact]
    public void A_model_gives_the_same_lists_and_paths()
    {
        var model = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "links", "flowy")).Model;
        var expected = Expected()["model"]!;
        Assert.Equal(expected["lists"]!.GetValue<int>(), CodeRefs.Lists(model).Count());
        Assert.Equal(expected["paths"]!.AsArray().Select(p => p!.GetValue<string>()).ToList(), CodeRefs.Paths(model).Order(StringComparer.Ordinal).ToList());
    }
}
