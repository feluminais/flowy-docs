using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>A store's data: what it shows and what is wrong with it, in the words of src/core/data.ts. The fixture folder "data" (ParityTests) holds the rest.</summary>
public class StoreDataTests
{
    private static FlowyObject Store(string json, string type = "store") =>
        new(type, "S", null, null, null, null, null) { Data = YamlWriterTests.Tree(JsonNode.Parse(json)) };

    [Fact]
    public void Shown_reads_a_grid()
    {
        var shown = StoreData.Shown(Store("""
            [{ "name": "orders", "columns": [{ "name": "id", "key": "primary" }, { "name": "customer_id", "to": "customers" }, "status", { "name": "total", "note": "Cents, not decimals." }], "rows": [["o_1", "c_7", "placed"]] }]
            """));
        var orders = Assert.Single(shown);
        Assert.Equal(["id", "customer_id", "status", "total"], orders.Columns.Select(c => c.Name));
        Assert.Equal("primary", orders.Columns[0].Key);
        Assert.Equal("customers", orders.Columns[1].To);
        Assert.Equal([["o_1", "c_7", "placed", ""]], orders.Rows.Select(r => r.ToArray()));
        Assert.Equal("4 columns", orders.Summary);
        Assert.Equal([new NoteLine("total", "Cents, not decimals.")], orders.Notes);
        Assert.Empty(orders.Lines);
    }

    [Fact]
    public void Shown_reads_a_column_type_and_a_trailing_question_mark_as_nullable()
    {
        var orders = Assert.Single(StoreData.Shown(Store("""
            [{ "name": "t", "columns": [{ "name": "a", "type": "int" }, { "name": "b", "type": "text?" }, { "name": "c", "type": " ? " }, { "name": "d", "type": "  " }, { "name": "e", "type": ["x"] }, "f"] }]
            """)));
        Assert.Equal([("int", false), ("text", true), (null, true), (null, false), (null, false), (null, false)], orders.Columns.Select(c => (c.Type, c.Nullable)));
    }

    [Fact]
    public void Shown_lists_a_sample_document_line_by_line()
    {
        var doc = Assert.Single(StoreData.Shown(Store("""
            [{ "name": "restaurants", "sample": { "_id": "r_42", "tags": ["ramen", "vegan"], "hours": { "mon": "11-22" }, "items": [{ "name": "Pho" }] }, "notes": { "hours": "Inside the profile." } }]
            """)));
        Assert.Equal(
        [
            new SampleLine(1, "_id", "r_42", "_id", false),
            new SampleLine(1, "tags", "[ramen, vegan]", "tags", false),
            new SampleLine(1, "hours", "", "hours", true),
            new SampleLine(2, "mon", "11-22", "hours.mon", false),
            new SampleLine(1, "items", "", "items", false),
            new SampleLine(2, "-", "", null, false),
            new SampleLine(3, "name", "Pho", null, false),
        ], doc.Lines);
        Assert.Equal("4 fields", doc.Summary);
        Assert.Equal([new NoteLine("hours", "Inside the profile.")], doc.Notes);
    }

    [Fact]
    public void Shown_leaves_out_junk()
    {
        Assert.Empty(StoreData.Shown(Store("\"text\"")));
        Assert.Empty(StoreData.Shown(Store("{}")));
        Assert.Empty(StoreData.Shown(Store("""["text", { "name": "" }, { "name": "x" }]""")));
    }

    [Theory]
    [InlineData("""[{ "name": "a", "columns": ["x", "y"], "rows": [["1"]] }]""", "data \"a\": row 1 has 1 cell but there are 2 columns")]
    [InlineData("""[{ "name": "a", "columns": ["x"], "rows": [["1", "2", "3"]] }]""", "data \"a\": row 1 has 3 cells but there is 1 column")]
    [InlineData("""[{ "name": "a", "columns": [{ "name": "x", "type": ["int"] }] }]""", "data \"a\": column \"x\": \"type\" must be plain text")]
    [InlineData("""[{ "name": "a", "columns": [{ "name": "x", "type": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }] }]""", "data \"a\": column \"x\": type is longer than 40 characters")]
    [InlineData("""[{ "name": "a" }]""", "data \"a\" needs columns or a sample")]
    [InlineData("""[{ "name": "a", "sample": { "grid": [["a"], ["b"]] } }]""", "data \"a\": sample has a list inside a list, which isn't shown")]
    [InlineData("""[{ "name": "a", "columns": ["x"], "rows": [["a\nb"]] }]""", "data \"a\": text can't hold a line break")]
    [InlineData("\"~\"", "data must be a list of entries")]
    public void Problems_are_worded_as_the_TypeScript_checker_words_them(string json, string message) =>
        Assert.Contains(message, StoreData.Problems(Store(json)));

    [Fact]
    public void Problems_refuses_data_on_anything_but_a_store() =>
        Assert.Equal(["only a store can have data"], StoreData.Problems(Store("""[{ "name": "a", "columns": ["x"] }]""", "system")));

    /// <summary>An object whose one entry holds <paramref name="cell"/> in a row, a note and a kind, built as a tree so the text is exactly what is given.</summary>
    private static FlowyObject WithText(string text, string field = "rows")
    {
        var entry = new OrderedDictionary<string, object?> { ["name"] = "a", ["columns"] = new List<object?> { "x" } };
        if (field == "rows") entry["rows"] = new List<object?> { new List<object?> { text } };
        else entry[field] = text;
        return new FlowyObject("store", "S", null, null, null, null, null) { Data = new List<object?> { entry } };
    }

    [Theory]
    [InlineData(0x85)]
    [InlineData(0x2028)]
    [InlineData(0x2029)]
    public void The_separator_characters_YAML_1_1_readers_take_for_line_breaks_are_line_breaks_here_too(int code) =>
        Assert.Contains("data \"a\": text can't hold a line break", StoreData.Problems(WithText($"x{(char)code}y")));

    [Fact]
    public void Blank_text_is_what_JavaScript_trims_not_what_dotnet_calls_white_space()
    {
        // U+FEFF is blank to JavaScript and not to .NET; U+0085 is the other way round. The TypeScript side says: no name, and a kept kind.
        var named = new OrderedDictionary<string, object?> { ["name"] = ((char)0xFEFF).ToString(), ["columns"] = new List<object?> { "x" }, ["kind"] = ((char)0x85).ToString() };
        var o = new FlowyObject("store", "S", null, null, null, null, null) { Data = new List<object?> { named } };
        Assert.Contains("data entry 1 has no name", StoreData.Problems(o));
        Assert.Empty(StoreData.Shown(o));
        named["name"] = "a";
        Assert.Equal(((char)0x85).ToString(), StoreData.Shown(o)[0].Kind);
    }

    [Fact]
    public void ParseText_of_text_with_only_comments_is_refused_like_any_data_that_is_not_a_list()
    {
        var parsed = StoreData.ParseText("# nothing here");
        Assert.NotNull(parsed);
        Assert.Contains("data must be a list of entries", StoreData.Problems(new FlowyObject("store", "S", null, null, null, null, null) { Data = parsed }));
    }

    [Fact]
    public void Blank_data_is_no_data() => Assert.Empty(StoreData.Problems(Store("\"\"")));

    [Fact]
    public void Serialize_gives_the_lines_that_sit_under_data_and_ParseText_reads_them_back()
    {
        var entries = YamlWriterTests.Tree(JsonNode.Parse("""
            [{ "name": "orders", "columns": [{ "name": "id", "key": "primary" }, "status"], "rows": [["o_1", ""]] }, { "name": "d", "sample": { "tags": ["a", "b"] } }]
            """));
        var text = StoreData.Serialize(entries);
        Assert.Equal("- name: orders\n  columns:\n    - {name: id, key: primary}\n    - status\n  rows:\n    - [o_1, \"\"]\n- name: d\n  sample:\n    tags: [a, b]\n", text);
        Assert.True(YamlWriterTests.Same(entries, StoreData.ParseText(text)));
    }

    [Fact]
    public void Tidy_orders_keys_drops_blanks_and_writes_a_column_with_only_a_name_bare()
    {
        var tidy = (List<object?>)StoreData.Tidy(YamlWriterTests.Tree(JsonNode.Parse("""
            [{ "notes": { "x": "n" }, "sample": { "x": "1" }, "note": "n", "limits": "", "kind": "", "name": "a", "extra": "kept" },
             { "name": "g", "columns": [{ "note": "n", "to": "t", "key": "primary", "name": "id" }, { "name": "x" }, { "name": "y", "to": "", "note": "" }] }]
            """)))!;
        Assert.Equal(["name", "note", "sample", "notes", "extra"], ((OrderedDictionary<string, object?>)tidy[0]!).Keys);
        var columns = (List<object?>)((OrderedDictionary<string, object?>)tidy[1]!)["columns"]!;
        Assert.Equal(["name", "key", "to", "note"], ((OrderedDictionary<string, object?>)columns[0]!).Keys);
        Assert.Equal("x", columns[1]);
        Assert.Equal("y", columns[2]);
    }

    [Fact]
    public void Tidy_carries_a_data_of_the_wrong_shape_through()
    {
        Assert.Equal("oops", StoreData.Tidy("oops"));
        Assert.Equal("text", ((List<object?>)StoreData.Tidy(new List<object?> { "text" })!)[0]);
    }

    [Fact]
    public void Serialize_is_empty_for_no_data()
    {
        Assert.Equal("", StoreData.Serialize(null));
        Assert.Equal("", StoreData.Serialize(""));
        Assert.Equal("", StoreData.Serialize(new List<object?>()));
    }

    [Fact]
    public void ParseText_of_blank_text_is_an_empty_list_and_of_broken_text_throws_a_ParseError()
    {
        Assert.Empty((List<object?>)StoreData.ParseText("  \n")!);
        var e = Assert.Throws<ParseError>(() => StoreData.ParseText("- [a"));
        Assert.Equal("data", e.File);
    }

    [Fact]
    public void Problems_never_throws_on_junk()
    {
        foreach (var json in new[] { "\"x\"", "{}", "[[]]", "[{}]", """[{ "name": "a", "columns": "c", "rows": "r", "sample": "s", "notes": "n" }]""",
                     """[{ "name": "a", "columns": [[], {}, "x"], "rows": ["r", [[]]] }]""", """[{ "name": "a", "sample": { "x": [[], {}], "y": { "z": [{}] } }, "notes": [] }]""" })
            StoreData.Problems(Store(json));
    }
}
