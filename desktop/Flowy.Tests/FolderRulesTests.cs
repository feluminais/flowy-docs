using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>
/// The rules for where flows are filed and how they are tagged, as desktop/fixtures/folders.ts dumps them from the TypeScript core: what a folder name and a tag may be, the paths of flow files, and
/// the helpers over a model's folders. The loader, the edits and the Flows list have their own tests against their own dumps.
/// </summary>
public class FolderRulesTests
{
    private static JsonNode Rules() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "folder-rules.json")))!;

    /// <summary>A value of the dump as a parsed YAML value: text, a list, a mapping, or a number (which no tag can be).</summary>
    private static object? Raw(JsonNode? node) => node switch
    {
        null => null,
        JsonArray list => list.Select(Raw).ToList(),
        JsonObject map => new OrderedDictionary<string, object?>(map.Select(kv => KeyValuePair.Create(kv.Key, Raw(kv.Value)))),
        JsonValue v when v.TryGetValue<string>(out var s) => s,
        _ => node.GetValue<double>(),
    };

    [Fact]
    public void The_words_of_the_rule_and_its_limits_are_the_TypeScript_ones()
    {
        var rules = Rules();
        Assert.Equal(Names.FolderRule, rules["folderRule"]!.GetValue<string>());
        Assert.Equal(Names.MaxTagLength, rules["maxTagLength"]!.GetValue<int>());
        Assert.Equal(rules["suggestedTags"]!.AsArray().Select(t => t!.GetValue<string>()), Names.SuggestedTags);
    }

    [Fact]
    public void A_folder_path_is_usable_exactly_when_the_TypeScript_says_so()
    {
        var folders = Rules()["folders"]!.AsArray();
        Assert.True(folders.Count > 40);
        foreach (var f in folders)
            Assert.True(f!["valid"]!.GetValue<bool>() == Names.IsValidFolder(f["folder"]!.GetValue<string>()), $"folder {f["folder"]!.ToJsonString()} should be {(f["valid"]!.GetValue<bool>() ? "usable" : "refused")}");
    }

    [Fact]
    public void A_tag_is_valid_exactly_when_the_TypeScript_says_so_and_is_compared_in_lower_case()
    {
        var tags = Rules()["tags"]!.AsArray();
        Assert.True(tags.Count > 10);
        foreach (var t in tags)
        {
            var tag = t!["tag"]!.GetValue<string>();
            Assert.True(t["valid"]!.GetValue<bool>() == Names.IsValidTag(tag), $"tag {t["tag"]!.ToJsonString()} should be {(t["valid"]!.GetValue<bool>() ? "valid" : "refused")}");
            Assert.Equal(t["key"]!.GetValue<string>(), Names.TagKey(tag));
        }
        Assert.False(Names.IsValidTag(null));
        Assert.False(Names.IsValidTag(7.0));
    }

    [Fact]
    public void The_tags_of_a_flow_are_the_well_formed_ones_each_once_in_the_order_written()
    {
        var lists = Rules()["tagLists"]!.AsArray();
        Assert.True(lists.Count > 8);
        foreach (var l in lists)
            Assert.Equal(l!["tags"]!.AsArray().Select(t => t!.GetValue<string>()), Names.TagsOf(Raw(l["raw"])));
    }

    [Fact]
    public void A_models_folders_are_listed_and_looked_up_as_in_the_TypeScript()
    {
        var maps = Rules()["folderMaps"]!.AsArray();
        Assert.True(maps.Count > 3);
        foreach (var m in maps)
        {
            var model = new Model { Folders = m!["folders"]!.AsObject().ToDictionary(kv => kv.Key, kv => kv.Value!.GetValue<string>()) };
            Assert.Equal(m["paths"]!.AsArray().Select(p => p!.GetValue<string>()), model.FolderPaths());
            foreach (var o in m["of"]!.AsArray())
                Assert.Equal(o!["folder"]!.GetValue<string>(), model.FolderOf(o["id"]!.GetValue<string>()));
        }
    }

    [Fact]
    public void A_path_names_the_id_and_folder_of_a_flow_file_and_is_allowed_as_the_TypeScript_allows_it()
    {
        var paths = Rules()["paths"]!.AsArray();
        Assert.True(paths.Count > 25);
        foreach (var p in paths)
        {
            var path = p!["path"]!.GetValue<string>();
            Assert.Equal(p["id"]?.GetValue<string>(), FolderLayout.FlowIdOf(path));
            Assert.Equal(p["folder"]!.GetValue<string>(), FolderLayout.FlowFolderOf(path));
            Assert.True(p["allowed"]!.GetValue<bool>() == FileStore.IsAllowed(path), $"{path} should be {(p["allowed"]!.GetValue<bool>() ? "allowed" : "refused")}");
        }
    }

    [Fact]
    public void The_path_of_a_flow_file_is_its_folder_then_its_name()
    {
        foreach (var p in Rules()["pathOf"]!.AsArray())
            Assert.Equal(p!["path"]!.GetValue<string>(), FolderLayout.FlowFile(p["id"]!.GetValue<string>(), p["sub"]!.GetValue<string>()));
    }
}
