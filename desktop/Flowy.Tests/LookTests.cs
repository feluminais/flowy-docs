using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>The shapes, colours and icons, and what each object of the look case resolves to, against what src/core/look.ts says (desktop/fixtures/look.ts).</summary>
public class LookTests
{
    private static JsonObject Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "appearance.json")))!.AsObject();

    private static Model Case() => FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "look", "flowy")).Model;

    private static string[] Strings(JsonNode? n) => n!.AsArray().Select(s => s!.GetValue<string>()).ToArray();

    [Fact]
    public void Shapes_are_the_ones_the_TypeScript_core_draws()
    {
        var shapes = Expected()["shapes"]!.AsObject();
        Assert.Equal(shapes.Select(s => s.Key), Look.ShapeNames);
        foreach (var (name, def) in shapes)
        {
            var actual = LookData.Shapes[name];
            Assert.Equal(def!["path"]!.GetValue<string>(), actual.Path);
            Assert.Equal(def["pad"]!.AsArray().Select(v => v!.GetValue<int>()), actual.Pad);
            Assert.Equal(def["badge"]!.AsArray().Select(v => v!.GetValue<int>()), actual.Badge);
            Assert.Equal(def["tile"]!.GetValue<bool>(), actual.Tile);
        }
    }

    [Fact]
    public void Colours_and_icons_are_the_ones_the_TypeScript_core_has()
    {
        var expected = Expected();
        Assert.Equal(expected["colors"]!.AsObject().Select(c => c.Key), Look.ColorNames);
        foreach (var (name, pair) in expected["colors"]!.AsObject()) Assert.Equal(Strings(pair), LookData.Colors[name]);
        Assert.Equal(expected["icons"]!.AsObject().Select(i => i.Key), LookData.Icons.Keys);
        foreach (var (name, d) in expected["icons"]!.AsObject()) Assert.Equal(d!.GetValue<string>(), LookData.Icons[name]);
        var groups = expected["iconGroups"]!.AsArray();
        Assert.Equal(groups.Select(g => g!["group"]!.GetValue<string>()), LookData.IconGroups.Select(g => g.Group));
        for (var i = 0; i < groups.Count; i++) Assert.Equal(Strings(groups[i]!["names"]), LookData.IconGroups[i].Names);
    }

    [Fact]
    public void Each_object_of_the_look_case_resolves_the_way_the_TypeScript_core_does()
    {
        var model = Case();
        var expected = Expected();
        Assert.Equal(expected["customIcons"]!.AsObject().ToDictionary(i => i.Key, i => i.Value!.GetValue<string>()), Look.CustomIcons(model.Meta));
        foreach (var e in expected["objects"]!.AsArray())
        {
            var id = e!["id"]!.GetValue<string>();
            var o = model.GetObject(id)!;
            Assert.True(Look.ShapeOf(o) == e["shape"]!.GetValue<string>(), $"{id}: shape");
            Assert.True(Look.ShowsTile(o) == e["tile"]!.GetValue<bool>(), $"{id}: tile");
            Assert.True(Look.TypeColor(o) == e["typeColor"]!.GetValue<string>(), $"{id}: type colour");
            Assert.True(Look.FillOpacity(o) == e["fillOpacity"]!.GetValue<int>(), $"{id}: fill opacity");
            var pair = Look.ColorPair(o.Color);
            Assert.True(e["pair"] is null ? pair is null : pair is { } p && Strings(e["pair"]).SequenceEqual([p.Light, p.Dark]), $"{id}: colour pair");
            var on = Look.OnFill(o);
            Assert.True(e["onFill"] is null ? on is null : on is { } t && Strings(e["onFill"]).SequenceEqual([t.Light, t.Dark]), $"{id}: text on the fill");
            Assert.True(Look.IconData(model, o) == e["icon"]!.GetValue<string>(), $"{id}: icon");
        }
    }

    [Theory]
    [InlineData("M4 4h16v16h-16z", true)]
    [InlineData("  m1 1", true)]
    [InlineData("1 1", false)]
    [InlineData("M4 4 rm -rf", false)]
    [InlineData("", false)]
    public void Path_data_is_commands_and_numbers_only(string d, bool ok) => Assert.Equal(ok, Look.IsPathData(d));

    [Fact]
    public void Path_data_stops_at_4000_characters()
    {
        Assert.True(Look.IsPathData("M" + new string('1', 3999)));
        Assert.False(Look.IsPathData("M" + new string('1', 4000)));
    }
}
