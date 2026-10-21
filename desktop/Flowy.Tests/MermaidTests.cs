using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class MermaidTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "mermaid.json")))!;

    [Fact]
    public void Text_never_reads_as_Mermaid_syntax()
    {
        var texts = Expected()["texts"]!.AsArray();
        Assert.True(texts.Count > 5);
        foreach (var t in texts) Assert.Equal(t!["escaped"]!.GetValue<string>(), Mermaid.Text(t["text"]!.GetValue<string>()));
    }

    [Fact]
    public void Every_view_and_flow_is_the_text_the_browser_copies()
    {
        var folders = Expected()["folders"]!.AsArray();
        Assert.Equal(7, folders.Count);
        foreach (var f in folders)
        {
            var folder = FolderLoader.Load(Path.Combine(Repo.Root, f!["folder"]!.GetValue<string>())).Model;
            foreach (var v in f["views"]!.AsArray()) Assert.Equal(v!["text"]!.GetValue<string>(), Mermaid.View(folder, v["view"]!.GetValue<string>()));
            foreach (var fl in f["flows"]!.AsArray()) Assert.Equal(fl!["text"]!.GetValue<string>(), Mermaid.Flow(folder, fl["flow"]!.GetValue<string>()));
        }
    }

    [Fact]
    public void An_unknown_view_or_flow_is_an_error()
    {
        var model = FolderLoader.Load(Path.Combine(Repo.Root, "example")).Model;
        Assert.Throws<ArgumentException>(() => Mermaid.View(model, "nope"));
        Assert.Throws<ArgumentException>(() => Mermaid.Flow(model, "nope"));
    }
}
