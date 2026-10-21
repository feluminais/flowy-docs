using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>Everything desktop/fixtures/beats.ts says about tags, reproduced by Flowy.Core.</summary>
public class BeatsTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "beats.json")))!;

    private static Step Tagged(JsonNode? animation) => new("a", "x", "t", null, YamlWriterTests.Tree(animation));

    private static JsonObject Json(StepAnimation a)
    {
        var o = new JsonObject { ["kind"] = a.Kind, ["trigger"] = a.Trigger };
        if (a.Carries is not null) o["carries"] = a.Carries;
        if (a.Outcome is not null) o["outcome"] = a.Outcome;
        if (a.Share is { } share) o["share"] = share;
        if (a.Reason is not null) o["reason"] = a.Reason;
        if (a.By is { } by) o["by"] = by.Name is not null ? new JsonObject { ["name"] = by.Name } : new JsonObject { ["shape"] = by.Shape };
        if (a.At is { } at) o["at"] = at;
        return o;
    }

    private static JsonObject Json(Beat b)
    {
        var o = new JsonObject { ["do"] = b.Do, ["on"] = b.On, ["at"] = b.At, ["dur"] = b.Dur };
        if (b.Dir is not null) o["dir"] = b.Dir;
        if (b.Glyph is not null) o["glyph"] = b.Glyph;
        if (b.Tone is not null) o["tone"] = b.Tone;
        if (b.Label is not null) o["label"] = b.Label;
        if (b.Start is { } start) o["start"] = start;
        if (b.End is { } end) o["end"] = end;
        if (b.Tint is { } tint) o["tint"] = tint;
        if (b.Ring is { } ring) o["ring"] = ring;
        if (b.Along is { } along) o["along"] = along;
        if (b.Text is not null) o["text"] = b.Text;
        return o;
    }

    private static (string, string)? Ends(JsonNode? n) => n is JsonArray a ? (a[0]!.GetValue<string>(), a[1]!.GetValue<string>()) : null;

    [Fact]
    public void Travel_time_follows_the_length_of_the_line()
    {
        var travel = Expected()["travel"]!.AsArray();
        Assert.True(travel.Count > 5);
        foreach (var t in travel) Assert.Equal(t!["ms"]!.GetValue<int>(), Animations.Travel(t["length"]!.GetValue<double>()));
        Assert.Equal(1200, Animations.Travel(double.NaN));
        Assert.Equal(1200, Animations.Travel(double.PositiveInfinity));
    }

    [Fact]
    public void Every_tag_is_judged_as_the_TypeScript_judges_it()
    {
        var problems = Expected()["problems"]!.AsArray();
        Assert.True(problems.Count > 150);
        foreach (var p in problems)
            Assert.Equal(p!["problem"]?.GetValue<string>(), Animations.Problem(YamlWriterTests.Tree(p["animation"]), p["to"]!.GetValue<bool>()));
    }

    [Fact]
    public void Every_tag_reads_as_the_TypeScript_reads_it()
    {
        foreach (var r in Expected()["reads"]!.AsArray())
        {
            var read = Animations.Read(Tagged(r!["animation"]));
            Assert.Equal(JsonDump.Pretty(r["read"]), JsonDump.Pretty(read is null ? null : Json(read)));
        }
    }

    [Fact]
    public void Every_kind_makes_the_same_beats()
    {
        var all = Expected()["beats"]!.AsArray();
        Assert.True(all.Count > 400);
        foreach (var b in all)
        {
            var a = Animations.Read(Tagged(b!["animation"]))!;
            var (beats, total) = Animations.BeatsFor(a, b["length"]!.GetValue<double>(), b["afterLanding"]!.GetValue<bool>());
            Assert.Equal(b["total"]!.GetValue<int>(), total);
            Assert.Equal(JsonDump.Pretty(b["beats"]), JsonDump.Pretty(new JsonArray(beats.Select(x => (JsonNode?)Json(x)).ToArray())));
        }
    }

    [Fact]
    public void Every_burst_makes_the_same_beats()
    {
        var all = Expected()["bursting"]!.AsArray();
        Assert.True(all.Count >= 12);
        foreach (var b in all)
        {
            var a = Animations.Read(Tagged(b!["animation"]))!;
            var (beats, total) = Animations.BeatsFor(a, b["length"]!.GetValue<double>(), b["afterLanding"]!.GetValue<bool>());
            Assert.Equal(b["total"]!.GetValue<int>(), total);
            Assert.Equal(JsonDump.Pretty(b["beats"]), JsonDump.Pretty(new JsonArray(beats.Select(x => (JsonNode?)Json(x)).ToArray())));
        }
    }

    [Fact]
    public void A_share_plays_the_same_burst_with_the_same_hits()
    {
        var bursts = Expected()["bursts"]!.AsArray();
        Assert.True(bursts.Count > 8);
        foreach (var b in bursts)
        {
            var (count, hit) = Animations.BurstOf(b!["share"]!.GetValue<int>());
            Assert.Equal(b["count"]!.GetValue<int>(), count);
            Assert.Equal(b["hit"]!.AsArray().Select(h => h!.GetValue<bool>()), hit);
        }
    }

    [Fact]
    public void The_interceptor_is_checked_against_the_model_as_the_TypeScript_checks_it()
    {
        bool Exists(string id) => id is "web" or "api" or "proxy";
        var all = Expected()["interceptors"]!.AsArray();
        Assert.True(all.Count > 5);
        foreach (var i in all)
            Assert.Equal(i!["problem"]?.GetValue<string>(), Animations.InterceptorProblem(YamlWriterTests.Tree(i["animation"]), "web", "api", Exists));
        foreach (var i in Expected()["interceptorShapes"]!.AsArray())
        {
            var raw = YamlWriterTests.Tree(new JsonObject { ["kind"] = "send", ["outcome"] = "intercepted", ["by"] = i!["by"]!.GetValue<string>() });
            Assert.Equal(i["problem"]?.GetValue<string>(), Animations.InterceptorProblem(raw, "web", "api", Exists));
        }
    }

    [Fact]
    public void The_card_line_is_the_one_the_browser_shows()
    {
        var all = Expected()["lines"]!.AsArray();
        Assert.True(all.Count > 20);
        foreach (var l in all)
        {
            var a = Animations.Read(Tagged(l!["animation"]))!;
            Assert.Equal(l["line"]!.GetValue<string>(), Animations.OutcomeLine(a));
            Assert.Equal(l["named"]!.GetValue<string>(), Animations.OutcomeLine(a, id => id == "proxy" ? "Edge proxy" : id));
        }
    }

    [Fact]
    public void A_step_leaves_marks_when_the_browser_says_it_does()
    {
        var all = Expected()["marks"]!.AsArray();
        Assert.True(all.Count > 40);
        foreach (var m in all) Assert.Equal(m!["marks"]!.GetValue<bool>(), Animations.LeavesMarks(Animations.Read(Tagged(m["animation"]))!));
        Assert.Contains(all, m => m!["marks"]!.GetValue<bool>());
        Assert.Contains(all, m => !m!["marks"]!.GetValue<bool>());
    }

    /// <summary>An animation as the pickers make it (a bare kind, or a mapping), as the JSON the fixtures hold.</summary>
    private static JsonNode? Node(object? animation) => animation switch
    {
        null => null,
        string s => JsonValue.Create(s),
        OrderedDictionary<string, object?> map => new JsonObject(map.Select(kv => KeyValuePair.Create(kv.Key, Node(kv.Value)))),
        _ => throw new InvalidOperationException("an animation is text or a mapping"),
    };

    [Fact]
    public void The_pickers_offer_the_same_drawings_and_block_the_same_choices()
    {
        var sketches = Expected()["sketches"]!;
        Assert.Equal(sketches["kinds"]!.AsArray().Select(k => (k![0]!.GetValue<string>(), k[1]!.GetValue<string>())), Animations.KindSketches);
        Assert.Equal(sketches["outcomes"]!.AsArray().Select(k => (k![0]!.GetValue<string>(), k[1]!.GetValue<string>())), Animations.OutcomeSketches);
        var blocks = Expected()["blocks"]!.AsArray();
        Assert.True(blocks.Count > 40);
        foreach (var b in blocks) Assert.Equal(b!["block"]?.GetValue<string>(), Animations.OutcomeBlock(b["kind"]?.GetValue<string>(), b["outcome"]!.GetValue<string>()));
    }

    [Fact]
    public void Picking_in_edit_mode_builds_the_same_animation_as_the_browser()
    {
        var chains = Expected()["picks"]!.AsArray();
        Assert.True(chains.Count >= 5);
        foreach (var chain in chains)
        {
            object? current = null;
            foreach (var pick in chain!.AsArray())
            {
                current = Animations.With(current, pick!["key"]!.GetValue<string>(), pick["value"]!.GetValue<string>());
                Assert.Equal(JsonDump.Pretty(pick["result"]), JsonDump.Pretty(Node(current)));
            }
        }
        var from = Expected()["picksFrom"]!.AsArray();
        Assert.True(from.Count >= 30);
        foreach (var pick in from)
            Assert.Equal(JsonDump.Pretty(pick!["result"]), JsonDump.Pretty(Node(Animations.With(YamlWriterTests.Tree(pick["from"]), pick["key"]!.GetValue<string>(), pick["value"]!.GetValue<string>()))));
    }

    [Fact]
    public void A_long_word_is_cut_the_way_the_browser_cuts_it()
    {
        foreach (var l in Expected()["labels"]!.AsArray()) Assert.Equal(l!["short"]!.GetValue<string>(), Animations.ShortLabel(l["label"]!.GetValue<string>()));
    }

    [Fact]
    public void A_step_follows_a_landing_when_the_one_before_ended_where_it_starts()
    {
        var all = Expected()["follows"]!.AsArray();
        Assert.True(all.Count > 20);
        foreach (var f in all) Assert.Equal(f!["follows"]!.GetValue<bool>(), Animations.Follows(Ends(f["previous"]), Ends(f["current"])));
    }
}
