using System.Text.Json;
using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>What <see cref="YamlWriter"/> writes must be what the <c>yaml</c> package writes (desktop/fixtures/yaml-write.ts), and must read back as what was written.</summary>
public class YamlWriterTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "yaml-write.json")))!;

    internal static object? Tree(JsonNode? n) => n switch
    {
        JsonValue v => v.TryGetValue<string>(out var text) ? text : v.ToJsonString(),
        JsonArray a => a.Select(Tree).ToList(),
        JsonObject o => Map(o),
        _ => throw new InvalidOperationException("a tree is text, lists and maps"),
    };

    private static OrderedDictionary<string, object?> Map(JsonObject o)
    {
        var map = new OrderedDictionary<string, object?>();
        foreach (var (key, value) in o) map[key] = Tree(value);
        return map;
    }

    internal static bool Same(object? a, object? b) => (a, b) switch
    {
        (string x, string y) => x == y,
        (List<object?> x, List<object?> y) => x.Count == y.Count && x.Zip(y).All(p => Same(p.First, p.Second)),
        (OrderedDictionary<string, object?> x, OrderedDictionary<string, object?> y) =>
            x.Count == y.Count && x.Keys.OrderBy(k => k, StringComparer.Ordinal).SequenceEqual(y.Keys.OrderBy(k => k, StringComparer.Ordinal)) && x.All(kv => Same(kv.Value, y[kv.Key])),
        _ => false,
    };

    private static string Show(string s) => JsonSerializer.Serialize(s, new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });

    private static void Check(List<string> problems, string what, object? tree, string expected, bool flowLists = false)
    {
        string text;
        try
        {
            text = YamlWriter.Write(tree, flowLists);
        }
        catch (InvalidOperationException e)
        {
            problems.Add($"{what}: {e.Message}");
            return;
        }
        if (text != expected) problems.Add($"{what}\n    expected {Show(expected)}\n    wrote    {Show(text)}");
    }

    /// <summary>
    /// Text the yaml package writes in a form YamlDotNet can't read back: a block scalar that begins with a blank line, and a raw line or
    /// paragraph separator. Written quoted here instead. They still have to read back (see the round-trip test), but not byte for byte.
    /// </summary>
    private static bool WrittenDifferently(string s) =>
        s.TrimStart(' ').StartsWith('\n') || s.All(c => c is '\n' or ' ' or '\t') && s.Contains('\n') || s.Contains((char)0x85) || s.Contains((char)0x2028) || s.Contains((char)0x2029);

    /// <summary>A key YamlDotNet reads differently: one that starts with a byte-order mark (taken for the file's own) or holds a backtick.</summary>
    private static bool OddKey(string s) => s.StartsWith((char)0xfeff) || s.Contains('`');

    private static void Report(List<string> problems) => Assert.True(problems.Count == 0, $"{problems.Count} differ:\n" + string.Join("\n", problems.Take(40)));

    [Fact]
    public void Awkward_text_is_written_as_the_yaml_package_writes_it_as_a_value_a_list_item_a_key_and_nested()
    {
        var problems = new List<string>();
        var strings = Expected()["strings"]!.AsArray();
        Assert.True(strings.Count > 100);
        foreach (var r in strings)
        {
            var s = r!["s"]!.GetValue<string>();
            if (WrittenDifferently(s)) continue;
            var shown = Show(s);
            Check(problems, $"value {shown}", Map(new JsonObject { ["k"] = s }), r["value"]!["text"]!.GetValue<string>());
            Check(problems, $"item {shown}", Map(new JsonObject { ["k"] = new JsonArray(s) }), r["item"]!["text"]!.GetValue<string>());
            Check(problems, $"key {shown}", Map(new JsonObject { [s] = "v" }), r["key"]!["text"]!.GetValue<string>());
            Check(problems, $"nested {shown}", Map(new JsonObject { ["a"] = new JsonObject { ["b"] = new JsonArray(new JsonObject { ["c"] = s, ["d"] = "x" }) } }), r["nested"]!["text"]!.GetValue<string>());
        }
        Report(problems);
    }

    [Fact]
    public void Collections_are_written_as_the_yaml_package_writes_them()
    {
        var problems = new List<string>();
        var shapes = Expected()["shapes"]!.AsArray();
        Assert.True(shapes.Count > 10);
        foreach (var s in shapes) Check(problems, s!["name"]!.GetValue<string>(), Tree(s["data"]), s["text"]!.GetValue<string>());
        Report(problems);
    }

    [Fact]
    public void A_layout_has_each_position_on_one_line()
    {
        var problems = new List<string>();
        foreach (var l in Expected()["layouts"]!.AsArray()) Check(problems, l!["layout"]!.ToJsonString(), Tree(l["layout"]), l["text"]!.GetValue<string>(), flowLists: true);
        Report(problems);
    }

    [Fact]
    public void Every_file_of_every_fixture_is_written_as_the_typescript_writes_it()
    {
        var problems = new List<string>();
        var files = Expected()["files"]!.AsArray();
        Assert.True(files.Count > 8, $"{files.Count} files");
        foreach (var f in files) Check(problems, $"{f!["folder"]} {f["rel"]}", Tree(f["data"]), f["text"]!.GetValue<string>());
        Report(problems);
    }

    [Fact]
    public void What_is_written_reads_back_as_the_same_tree()
    {
        var problems = new List<string>();
        var expected = Expected();
        void RoundTrip(string what, object? tree)
        {
            try
            {
                var back = YamlText.Parse("x.yaml", YamlWriter.Write(tree));
                if (!Same(tree, back)) problems.Add($"{what}: read back as something else");
            }
            catch (Exception e) when (e is ParseError or InvalidOperationException)
            {
                problems.Add($"{what}: {e.Message}");
            }
        }
        foreach (var r in expected["strings"]!.AsArray())
        {
            var s = r!["s"]!.GetValue<string>();
            RoundTrip($"value {Show(s)}", Map(new JsonObject { ["k"] = s }));
            RoundTrip($"item {Show(s)}", Map(new JsonObject { ["k"] = new JsonArray(s) }));
            if (!OddKey(s)) RoundTrip($"key {Show(s)}", Map(new JsonObject { [s] = "v" }));
        }
        foreach (var s in expected["shapes"]!.AsArray()) RoundTrip(s!["name"]!.GetValue<string>(), Tree(s["data"]));
        foreach (var f in expected["files"]!.AsArray()) RoundTrip($"{f!["folder"]} {f["rel"]}", Tree(f["data"]));
        Report(problems);
    }

    [Fact]
    public void Only_text_lists_and_maps_can_be_written()
    {
        Assert.Throws<InvalidOperationException>(() => YamlWriter.Write(new OrderedDictionary<string, object?> { ["a"] = null }));
        Assert.Throws<InvalidOperationException>(() => YamlWriter.Write(new OrderedDictionary<string, object?> { ["a"] = 5 }));
    }

    [Fact]
    public void Keys_that_look_like_array_indexes_come_first_as_they_do_in_javascript()
    {
        var map = new OrderedDictionary<string, object?> { ["b"] = "1", ["10"] = "2", ["2"] = "3", ["007"] = "4" };
        Assert.Equal("2: 3\n10: 2\nb: 1\n007: 4\n", YamlWriter.Write(map));
    }
}
