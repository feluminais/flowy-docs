using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>The files the YAML tab lists and where it puts a shape: YamlFiles must answer as ui/src/yamlview.ts and readSnapshot do (desktop/fixtures/yamlview.ts).</summary>
public class YamlFilesTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "yaml-view.json")))!;

    private static List<string> Strings(JsonNode? node) => node!.AsArray().Select(n => n!.GetValue<string>()).ToList();

    [Fact]
    public void Files_are_listed_in_the_order_the_browser_lists_them()
    {
        foreach (var c in Expected()["order"]!.AsArray())
            Assert.Equal(Strings(c!["order"]), YamlFiles.FileOrder(Strings(c["paths"])));
    }

    [Fact]
    public void The_file_shown_first_is_the_one_the_browser_shows_first()
    {
        foreach (var c in Expected()["defaults"]!.AsArray())
            Assert.Equal(c!["file"]!.GetValue<string>(), YamlFiles.DefaultFile(Strings(c["paths"]), c["flow"]?.GetValue<string>()));
    }

    [Fact]
    public void A_tab_has_the_name_the_browser_gives_it()
    {
        foreach (var c in Expected()["names"]!.AsArray())
            Assert.Equal(c!["name"]!.GetValue<string>(), YamlFiles.TabName(c["path"]!.GetValue<string>()));
    }

    [Fact]
    public void A_shape_s_block_is_where_the_browser_finds_it()
    {
        var wrong = new List<string>();
        foreach (var c in Expected()["blocks"]!.AsArray())
        {
            var id = c!["id"]!.GetValue<string>();
            var want = c["block"] is { } b ? (b["start"]!.GetValue<int>(), b["end"]!.GetValue<int>()) : ((int, int)?)null;
            var got = YamlFiles.BlockOf(c["text"]!.GetValue<string>(), id);
            if (got != want) wrong.Add($"{id}: {got?.ToString() ?? "none"}, not {want?.ToString() ?? "none"}");
        }
        Assert.True(wrong.Count == 0, string.Join(Environment.NewLine, wrong));
    }

    [Fact]
    public void The_demo_lists_the_files_the_browser_lists()
    {
        var files = YamlFiles.Read(Path.Combine(Repo.Root, "docs", "demo", "flowy"));
        Assert.Equal(Strings(Expected()["demo"]), files.Select(f => f.Path).ToList());
        Assert.All(files, f => Assert.NotNull(f.Text));
    }

    [Fact]
    public void A_file_that_is_not_text_says_so_and_files_flowy_does_not_write_are_left_out()
    {
        var dir = Directory.CreateTempSubdirectory("flowy-yaml-").FullName;
        try
        {
            File.WriteAllText(Path.Combine(dir, "model.yaml"), "objects: {}\n");
            Directory.CreateDirectory(Path.Combine(dir, "flows", ".hidden"));
            File.WriteAllBytes(Path.Combine(dir, "flows", "bad.yaml"), [0xC3, 0x28]);
            File.WriteAllText(Path.Combine(dir, "flows", "notes.txt"), "x");
            File.WriteAllText(Path.Combine(dir, "flows", "old.yml"), "x");
            File.WriteAllText(Path.Combine(dir, "flows", ".hidden", "a.yaml"), "x");
            File.WriteAllText(Path.Combine(dir, "readme.yaml"), "x");
            var files = YamlFiles.Read(dir);
            Assert.Equal(["model.yaml", "flows/bad.yaml"], files.Select(f => f.Path));
            Assert.Equal("Not UTF-8 text", files[1].Note);
            Assert.Null(files[1].Text);
        }
        finally
        {
            Directory.Delete(dir, true);
        }
    }

    [Fact]
    public void Lines_end_at_the_last_newline()
    {
        Assert.Equal(["a", "b"], YamlFiles.LinesOf("a\r\nb\n"));
        Assert.Equal(["a", "", "b"], YamlFiles.LinesOf("a\n\nb"));
        Assert.Empty(YamlFiles.LinesOf(""));
    }
}
