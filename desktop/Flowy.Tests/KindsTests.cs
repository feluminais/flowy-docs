using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>
/// The kinds of a connection (src/core/kinds.ts): the six words and their names, the marks and how they scale, the look of a line that stands for several
/// connections, what the checks say of a word that is no kind, how a view line carries a kind and what Mermaid keeps (desktop/fixtures/kinds.ts). The desktop has
/// no edit history, so the labels in the same file have no reader here.
/// </summary>
public class KindsTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "kinds.json")))!;

    private static double D(JsonNode? n) => n!.GetValue<double>();

    private static LineLook LookOf(JsonNode n) => new(n["pattern"]!.GetValue<string>(), n["head"]!.GetValue<string>(), n["tail"]!.GetValue<string>());

    private static JsonNode LookJson(LineLook look) => JsonDump.Obj(("pattern", look.Pattern), ("head", look.Head), ("tail", look.Tail));

    /// <summary>The model a case describes, read from its files the way a folder is read.</summary>
    private static Model ModelOf(JsonNode c) => EditDoc.FromFiles(c["files"]!.AsObject().ToDictionary(f => f.Key, f => f.Value!.GetValue<string>()));

    [Fact]
    public void The_six_kinds_have_the_words_names_and_looks_the_TypeScript_has()
    {
        var e = Expected();
        Assert.Equal(e["ids"]!.AsArray().Select(i => i!.GetValue<string>()), Kinds.All.Select(k => k.Id));
        Assert.Equal(e["list"]!.GetValue<string>(), Kinds.List);
        Assert.Equal(Kinds.PlainName, e["plainName"]!.GetValue<string>());
        Assert.Equal(LookOf(e["plain"]!), Kinds.PlainLook);
        var kinds = e["kinds"]!.AsArray();
        Assert.Equal(6, kinds.Count);
        for (var i = 0; i < kinds.Count; i++)
        {
            Assert.Equal(kinds[i]!["id"]!.GetValue<string>(), Kinds.All[i].Id);
            Assert.Equal(kinds[i]!["name"]!.GetValue<string>(), Kinds.All[i].Name);
            Assert.Equal(kinds[i]!["name"]!.GetValue<string>(), Kinds.NameOf(Kinds.All[i].Id));
            Assert.Equal(LookOf(kinds[i]!["look"]!), Kinds.All[i].Look);
            Assert.Equal(Kinds.All[i].Look, Kinds.LookOfKind(Kinds.All[i].Id));
        }
        Assert.Equal(Kinds.PlainLook, Kinds.LookOfKind(null));
        for (var i = 0; i < kinds.Count; i++)
        {
            Assert.Equal(LookOf(kinds[i]!["lookOfKind"]!), Kinds.LookOfKind(Kinds.All[i].Id));
            Assert.Equal(kinds[i]!["plainLook"]!.GetValue<bool>(), Kinds.IsPlain(Kinds.All[i].Look));
        }
        Assert.Equal(LookOf(e["noKind"]!["lookOfKind"]!), Kinds.LookOfKind(null));
        Assert.Equal(e["noKind"]!["plainLook"]!.GetValue<bool>(), Kinds.IsPlain(Kinds.PlainLook));
    }

    [Fact]
    public void Two_looks_are_the_same_when_their_pattern_and_marks_all_agree()
    {
        var e = Expected();
        var odd = e["looks"]!.AsObject().ToDictionary(kv => kv.Key, kv => LookOf(kv.Value!));
        LineLook Named(string name) => name == "plain" ? Kinds.PlainLook : odd.TryGetValue(name, out var l) ? l : Kinds.LookOfKind(name);
        var rows = e["same"]!.AsArray();
        Assert.Equal(10, rows.Count);
        foreach (var r in rows)
        {
            var row = r!["row"]!.AsArray();
            Assert.Equal(rows.Count, row.Count);
            for (var i = 0; i < rows.Count; i++)
                Assert.Equal(row[i]!.GetValue<bool>(), Kinds.SameLook(Named(r["look"]!.GetValue<string>()), Named(rows[i]!["look"]!.GetValue<string>())));
        }
    }

    [Fact]
    public void No_two_kinds_look_alike_and_none_looks_like_the_plain_line()
    {
        var looks = new[] { Kinds.PlainLook }.Concat(Kinds.All.Select(k => k.Look)).ToList();
        Assert.Equal(looks.Count, looks.Distinct().Count());
        Assert.True(Kinds.IsPlain(Kinds.PlainLook));
        Assert.All(Kinds.All, k => Assert.False(Kinds.IsPlain(k.Look)));
    }

    [Fact]
    public void A_word_is_a_kind_only_when_it_is_written_exactly()
    {
        var words = Expected()["words"]!.AsArray();
        Assert.True(words.Count > 10);
        foreach (var w in words)
        {
            // A value that is not text never reaches here: the reader refuses it before there is a connection.
            var text = w!["value"] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
            Assert.Equal(w["isKind"]!.GetValue<bool>(), Kinds.IsKind(text));
            if (text is null) continue;
            var kind = new Connection("a", "b", null) { Kind = text };
            Assert.Equal(w["kind"]?.GetValue<string>(), Kinds.KindOf(kind));
            Assert.Equal(w["isKind"]!.GetValue<bool>() ? Kinds.LookOfKind(text) : Kinds.PlainLook, Kinds.LookOf(kind));
        }
    }

    [Fact]
    public void The_kind_a_set_of_connections_share_is_the_one_they_all_have()
    {
        var cases = Expected()["shared"]!.AsArray();
        Assert.Equal(5, cases.Count);
        foreach (var c in cases)
        {
            var connections = c!["connections"]!.AsArray().Select(x => new Connection("a", "b", null) { Kind = x!["kind"]?.GetValue<string>() }).ToList();
            Assert.Equal(c["kind"]?.GetValue<string>(), Kinds.SharedKind(connections));
        }
    }

    [Fact]
    public void Patterns_dash_the_way_the_browser_dashes_them()
    {
        var dashes = Expected()["dashes"]!;
        Assert.Equal(dashes["solid"]!.AsArray().Select(D), Kinds.Dashes("solid"));
        Assert.Equal(dashes["dashdot"]!.AsArray().Select(D), Kinds.Dashes("dashdot"));
        Assert.Equal(2, dashes.AsObject().Count);
    }

    [Fact]
    public void The_marks_are_the_paths_and_scale_as_the_browser_draws_them()
    {
        var marks = Expected()["marks"]!.AsArray();
        Assert.Equal(Kinds.Marks.Keys, marks.Select(m => m!["shape"]!.GetValue<string>()));
        Assert.Equal(Heads.Path, Kinds.Marks["filled"].Path);
        var scaled = 0;
        foreach (var m in marks)
        {
            var shape = m!["shape"]!.GetValue<string>();
            Assert.Equal(m["path"]!.GetValue<string>(), Kinds.Marks[shape].Path);
            Assert.Equal(m["paint"]!.GetValue<string>(), Kinds.Marks[shape].Paint);
            Assert.Equal(D(m["width"]), Kinds.Marks[shape].Width);
            foreach (var s in m["scaled"]!.AsArray())
            {
                Assert.Equal(s!["path"]!.GetValue<string>(), Kinds.MarkPath(shape, D(s["scale"])));
                Assert.Equal(D(s["stroke"]), Kinds.MarkStroke(shape, D(s["scale"])), 9);
                scaled++;
            }
        }
        Assert.Equal(20, scaled);
    }

    [Fact]
    public void A_line_for_several_connections_takes_the_look_the_TypeScript_gives_it()
    {
        var e = Expected();
        var odd = e["looks"]!.AsObject().ToDictionary(kv => kv.Key, kv => LookOf(kv.Value!));
        var merges = e["merges"]!.AsArray();
        Assert.True(merges.Count > 20);
        foreach (var m in merges)
        {
            var looks = m!["looks"]!.AsArray().Select(n => n!.GetValue<string>()).Select(name =>
                name == "plain" ? Kinds.PlainLook : odd.TryGetValue(name, out var l) ? l : Kinds.LookOf(new Connection("a", "b", null) { Kind = name })).ToList();
            var expected = m["result"] is { } r ? LookOf(r) : null;
            Assert.Equal(expected, Kinds.MergedLook(looks, m["both"]!.GetValue<bool>()));
        }
    }

    [Fact]
    public void A_view_line_carries_the_kind_and_the_look_of_its_connections()
    {
        var views = Expected()["views"]!.AsArray();
        Assert.Equal(10, views.Count);
        foreach (var c in views.Select(v => v!))
        {
            var edges = Views.Compute(ModelOf(c), "shop").Edges.Select(x => (JsonNode?)JsonDump.Obj(
                ("from", x.From), ("to", x.To), ("label", x.Label), ("count", x.Count), ("both", x.Both ? (object)true : null), ("kind", x.Kind),
                ("look", x.Look is null ? null : LookJson(x.Look)))).ToArray();
            Assert.Equal(JsonDump.Pretty(c["edges"]), JsonDump.Pretty(new JsonArray(edges)));
        }
    }

    [Fact]
    public void A_model_with_no_kind_draws_lines_with_no_kind_or_look()
    {
        var edges = Views.Compute(TestModels.Shop(), "shop").Edges;
        Assert.All(edges, x => Assert.Equal((null, null), (x.Kind, x.Look)));
    }

    [Fact]
    public void A_word_that_is_no_kind_is_a_problem_and_a_kind_makes_no_duplicate()
    {
        var checks = Expected()["checks"]!.AsArray();
        Assert.Equal(5, checks.Count);
        foreach (var c in checks.Select(v => v!))
        {
            var problems = Checks.Run(ModelOf(c)).Select(p => (JsonNode?)JsonDump.Obj(("message", p.Message), ("connection", p.Connection is { } i ? (object)i : null))).ToArray();
            Assert.Equal(JsonDump.Pretty(c["problems"]), JsonDump.Pretty(new JsonArray(problems)));
        }
        Assert.Contains(checks, c => c!["problems"]!.AsArray().Count > 0);
    }

    [Fact]
    public void Mermaid_keeps_the_dotted_line_and_the_head_at_a_mark()
    {
        var cases = Expected()["mermaid"]!.AsArray();
        Assert.Equal(10, cases.Count);
        foreach (var c in cases.Select(v => v!)) Assert.Equal(c["text"]!.GetValue<string>(), Mermaid.View(ModelOf(c), "shop"));
        // The dash-dot of an extension point is dotted, and a mark at the start gets a head there too.
        Assert.Contains(cases, c => c!["text"]!.GetValue<string>().Contains("-.") && c["name"]!.GetValue<string>().Contains("extension"));
        Assert.Contains(cases, c => c!["text"]!.GetValue<string>().Contains("<--"));
    }

    [Fact]
    public void A_connection_is_read_with_its_kind()
    {
        var parsed = ModelFiles.ParseModel("objects:\n  a: { type: system, name: A }\n  b: { type: system, name: B }\nconnections:\n  - { from: a, to: b, label: x, kind: stream }\n  - { from: b, to: a }\n");
        Assert.Equal(["stream", null], parsed.Connections.Select(c => c.Kind));
        Assert.Throws<ParseError>(() => ModelFiles.ParseModel("connections:\n  - { from: a, to: b, kind: [stream] }\n"));
    }
}
