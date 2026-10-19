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
        return o;
    }

    private static JsonObject Json(Beat b)
    {
        var o = new JsonObject { ["do"] = b.Do, ["on"] = b.On, ["at"] = b.At, ["dur"] = b.Dur };
        if (b.Dir is not null) o["dir"] = b.Dir;
        if (b.Glyph is not null) o["glyph"] = b.Glyph;
        if (b.Tone is not null) o["tone"] = b.Tone;
        if (b.Label is not null) o["label"] = b.Label;
        return o;
    }

    private static (string, string)? Ends(JsonNode? n) => n is JsonArray a ? (a[0]!.GetValue<string>(), a[1]!.GetValue<string>()) : null;

    [Fact]
    public void Travel_time_follows_the_length_of_the_line()
    {
        var travel = Expected()["travel"]!.AsArray();
        Assert.True(travel.Count > 5);
        foreach (var t in travel) Assert.Equal(t!["ms"]!.GetValue<int>(), Animations.Travel(t["length"]!.GetValue<double>()));
        Assert.Equal(500, Animations.Travel(double.NaN));
        Assert.Equal(500, Animations.Travel(double.PositiveInfinity));
    }

    [Fact]
    public void Every_tag_is_judged_as_the_TypeScript_judges_it()
    {
        var problems = Expected()["problems"]!.AsArray();
        Assert.True(problems.Count > 40);
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
        Assert.True(all.Count > 100);
        foreach (var b in all)
        {
            var a = Animations.Read(Tagged(b!["animation"]))!;
            var (beats, total) = Animations.BeatsFor(a, b["length"]!.GetValue<double>(), b["afterLanding"]!.GetValue<bool>());
            Assert.Equal(b["total"]!.GetValue<int>(), total);
            Assert.Equal(JsonDump.Pretty(b["beats"]), JsonDump.Pretty(new JsonArray(beats.Select(x => (JsonNode?)Json(x)).ToArray())));
        }
    }

    [Fact]
    public void A_step_follows_a_landing_when_the_one_before_ended_where_it_starts()
    {
        var all = Expected()["follows"]!.AsArray();
        Assert.True(all.Count > 20);
        foreach (var f in all) Assert.Equal(f!["follows"]!.GetValue<bool>(), Animations.Follows(Ends(f["previous"]), Ends(f["current"])));
    }
}
