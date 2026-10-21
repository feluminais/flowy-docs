using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class YamlTextTests
{
    private static object? Parse(string text) => YamlText.Parse("model.yaml", text);

    [Fact]
    public void Every_value_stays_the_text_that_was_typed()
    {
        var map = Assert.IsType<OrderedDictionary<string, object?>>(Parse("id: 007\nversion: 3.10\nflag: yes\nnothing: ~\nquoted: '12'\n"));
        Assert.Equal("007", map["id"]);
        Assert.Equal("3.10", map["version"]);
        Assert.Equal("yes", map["flag"]);
        Assert.Equal("~", map["nothing"]);
        Assert.Equal("12", map["quoted"]);
    }

    [Fact]
    public void A_key_with_nothing_after_it_reads_as_empty_text()
    {
        var map = Assert.IsType<OrderedDictionary<string, object?>>(Parse("type:\nname: A\n"));
        Assert.Equal("", map["type"]);
    }

    [Theory]
    [InlineData("{ a: x, b }", "x")]
    [InlineData("{ b, a: x }", "x")]
    [InlineData("{ a: x,\n  b\n}", "x")]
    [InlineData("{ a: \"😀: ok\", b }", "😀: ok")]
    public void A_key_with_no_colon_in_a_one_line_mapping_reads_as_null(string text, string a)
    {
        var map = Assert.IsType<OrderedDictionary<string, object?>>(Parse(text));
        Assert.Equal(a, map["a"]);
        Assert.Null(map["b"]);
        Assert.Equal(2, map.Count);
    }

    [Fact]
    public void A_colon_with_nothing_after_it_stays_empty_text_even_in_a_one_line_mapping()
    {
        var map = Assert.IsType<OrderedDictionary<string, object?>>(Parse("{ a:, b: , c: \"\", d: '', e: x }"));
        Assert.Equal(["", "", "", "", "x"], map.Values);
    }

    [Fact]
    public void An_emoji_earlier_in_the_file_does_not_throw_the_check_for_a_missing_colon_off()
    {
        var map = Assert.IsType<OrderedDictionary<string, object?>>(Parse("note: 😀😀😀 hi\nitems:\n  - { a: 😀, b, c: }\n"));
        var item = Assert.IsType<OrderedDictionary<string, object?>>(Assert.IsType<List<object?>>(map["items"])[0]);
        Assert.Equal("😀", item["a"]);
        Assert.Null(item["b"]);
        Assert.Equal("", item["c"]);
    }

    [Fact]
    public void Mappings_keep_file_order_and_lists_become_lists()
    {
        var map = Assert.IsType<OrderedDictionary<string, object?>>(Parse("b: 1\na: [x, y]\nc:\n  - z\n"));
        Assert.Equal(["b", "a", "c"], map.Keys);
        Assert.Equal<object?>(["x", "y"], Assert.IsType<List<object?>>(map["a"]));
        Assert.Equal<object?>(["z"], Assert.IsType<List<object?>>(map["c"]));
    }

    [Fact]
    public void Block_scalars_keep_their_line_breaks()
    {
        var map = Assert.IsType<OrderedDictionary<string, object?>>(Parse("d: |\n  one\n\n  two\n"));
        Assert.Equal("one\n\ntwo\n", map["d"]);
    }

    [Theory]
    [InlineData("")]
    [InlineData("# only a comment\n")]
    public void An_empty_file_gives_null(string text) => Assert.Null(Parse(text));

    [Fact]
    public void A_byte_order_mark_is_not_part_of_the_first_key()
    {
        var map = Assert.IsType<OrderedDictionary<string, object?>>(Parse("﻿objects:\n  a: b\n"));
        Assert.True(map.ContainsKey("objects"));
    }

    [Fact]
    public void A_duplicate_key_is_refused_with_its_line()
    {
        var e = Assert.Throws<ParseError>(() => Parse("objects:\n  a: 1\n  a: 2\n"));
        Assert.Equal("model.yaml", e.File);
        Assert.Equal(3, e.Line);
    }

    [Fact]
    public void Bad_syntax_is_refused_with_its_file_and_line()
    {
        var e = Assert.Throws<ParseError>(() => Parse("objects: [\n"));
        Assert.Equal("model.yaml", e.File);
        Assert.NotNull(e.Line);
    }

    [Fact]
    public void Two_documents_are_refused() => Assert.Equal("source contains multiple documents", Assert.Throws<ParseError>(() => Parse("a: 1\n---\nb: 2\n")).Reason);

    [Fact]
    public void Anchors_and_aliases_are_refused()
    {
        Assert.Equal("anchors and aliases are not supported", Assert.Throws<ParseError>(() => Parse("a: &x 1\nb: *x\n")).Reason);
        Assert.Equal("anchors and aliases are not supported", Assert.Throws<ParseError>(() => Parse("a: &x [1]\n")).Reason);
    }

    [Fact]
    public void Absurd_nesting_is_refused_instead_of_overflowing_the_stack()
    {
        var text = new string('[', 5000) + new string(']', 5000);
        Assert.Equal("nested too deeply", Assert.Throws<ParseError>(() => Parse(text)).Reason);
    }

    [Theory]
    [InlineData("a: 1\n<<<<<<< HEAD\nb: 2\n=======\nb: 3\n>>>>>>> other\n", 2)]
    [InlineData("a: 1\nb: 2\n=======\n", 3)]
    [InlineData("<<<<<<<\n", 1)]
    public void An_unresolved_merge_conflict_is_refused_at_its_line(string text, int line)
    {
        var e = Assert.Throws<ParseError>(() => Parse(text));
        Assert.Equal("unresolved merge conflict", e.Reason);
        Assert.Equal(line, e.Line);
    }

    [Fact]
    public void Seven_marker_characters_inside_a_value_are_not_a_conflict()
    {
        var map = Assert.IsType<OrderedDictionary<string, object?>>(Parse("a: x =======\nb: '<<<<<<<'\n"));
        Assert.Equal("x =======", map["a"]);
    }

    [Fact]
    public void The_message_starts_with_the_file_and_line()
    {
        var e = Assert.Throws<ParseError>(() => Parse("a: 1\n=======\n"));
        Assert.Equal("model.yaml:2: unresolved merge conflict", e.Message);
    }

    // Found by fuzzing: YamlDotNet's parser also throws InvalidOperationException and ArgumentException on some half-typed input.
    [Theory]
    [InlineData("objects:\n  a:\n    type: system\n    name: [\n    tech: x\n")]
    [InlineData(": [\ny")]
    [InlineData("... }")]
    [InlineData("!![")]
    [InlineData("!<> ")]
    public void Half_typed_YAML_is_a_parse_error_whatever_the_parser_throws(string text)
    {
        var error = Record.Exception(() => Parse(text));
        Assert.True(error is null or ParseError, error?.ToString());
    }
}
