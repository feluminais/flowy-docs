using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>
/// src/core/failures.ts, reproduced: everything desktop/fixtures/failures.ts says about the analyses of a small shop (a mode for each band and each kind of
/// problem) and of Plum: ratings, risk, bands, the ranking, coverage, the table, the problems, and for every view what is marked, lit and carried.
/// </summary>
public class FailuresTests
{
    private static string Fixtures => Path.Combine(Repo.Root, "desktop", "fixtures");

    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "expected", "failures-core.json")))!;

    private static Folder Load(string fixture)
    {
        var dirs = JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "fixtures.json")))!.AsObject();
        return FolderLoader.Load(Path.Combine(Repo.Root, dirs[fixture]!.GetValue<string>()));
    }

    private static JsonObject Obj(params (string Key, object? Value)[] pairs) => JsonDump.Obj(pairs);

    private static JsonArray Strings(IEnumerable<string> items) => new(items.Select(s => (JsonNode?)JsonValue.Create(s)).ToArray());

    private static JsonNode? Num(int? n) => n is { } v ? JsonValue.Create(v) : null;

    private static JsonNode RatedNode(Rated r) => Obj(("severity", r.Severity), ("occurrence", r.Occurrence), ("detection", r.Detection));

    private static JsonNode ProblemNode(Problem p) => Obj(("file", p.File), ("message", p.Message));

    private static JsonNode ReachNode(Reach r)
    {
        var o = new JsonObject { ["fails"] = Strings(r.Fails) };
        if (r.FailsLine is { } line) o["failsLine"] = line;
        o["affects"] = Strings(r.Affects);
        return o;
    }

    private static JsonNode MarksNode(OrderedDictionary<string, FailureMark> marks) =>
        new JsonObject(marks.Select(kv => KeyValuePair.Create(kv.Key, (JsonNode?)Obj(("band", Failures.BandKey(kv.Value.Band)), ("count", kv.Value.Count)))));

    [Fact]
    public void A_rating_is_exactly_the_text_1_to_10()
    {
        var all = Expected()["ratingOf"]!.AsArray();
        Assert.True(all.Count >= 10);
        foreach (var e in all)
            Assert.Equal(e!["rating"]?.GetValue<int>(), Failures.RatingOf(e["text"]!.GetValue<string>()));
    }

    [Theory]
    [InlineData("shop", "failures")]
    [InlineData("plum", "plum")]
    public void Every_mode_is_rated_ranked_named_and_checked_the_way_the_TypeScript_does(string key, string fixture)
    {
        var expected = Expected()[key]!["analyses"]!.AsArray();
        var model = Load(fixture).Model;
        Assert.Equal(expected.Count, model.Failures.Count);
        foreach (var e in expected)
        {
            var id = e!["id"]!.GetValue<string>();
            var a = model.Failures[id];
            var modes = a.Modes.Select(kv => (JsonNode?)new JsonObject
            {
                ["id"] = kv.Key,
                ["ratings"] = RatedNode(Failures.RatingsOf(kv.Value)),
                ["after"] = RatedNode(Failures.RatingsAfter(kv.Value)),
                ["risk"] = Num(Failures.RiskOf(kv.Value)),
                ["band"] = Failures.BandKey(Failures.BandOf(kv.Value)),
                ["bandReason"] = JsonValue.Create(Failures.BandReason(kv.Value)),
                ["bandLabel"] = Failures.BandLabel(kv.Value),
                ["riskProduct"] = JsonValue.Create(Failures.RiskProduct(kv.Value)),
                ["part"] = Failures.PartName(model, kv.Value),
                ["home"] = Failures.HomeView(model, kv.Value),
            }).ToArray();
            Assert.Equal(JsonDump.Pretty(e["modes"]), JsonDump.Pretty(new JsonArray(modes)));

            var rank = Failures.Rank(a).Select(r => (JsonNode?)new JsonObject { ["id"] = r.Id, ["risk"] = Num(r.Risk), ["band"] = Failures.BandKey(r.Band) }).ToArray();
            Assert.Equal(JsonDump.Pretty(e["rank"]), JsonDump.Pretty(new JsonArray(rank)));

            var (analysed, left) = Failures.Coverage(model, a);
            Assert.Equal(JsonDump.Pretty(e["coverage"]), JsonDump.Pretty(new JsonObject { ["analysed"] = Strings(analysed), ["left"] = Strings(left) }));
            Assert.Equal(e["coverageText"]!.GetValue<string>(), Failures.CoverageText(model, a));
            Assert.Equal(JsonDump.Pretty(e["rowNames"]), JsonDump.Pretty(new JsonArray(Failures.Rank(a).Select(r => (JsonNode?)new JsonObject { ["id"] = r.Id, ["name"] = Failures.RowName(model, r) }).ToArray())));
            Assert.Equal(e["markdown"]!.GetValue<string>(), Failures.AnalysisText(model, id, a, "markdown"));
            Assert.Equal(e["csv"]!.GetValue<string>(), Failures.AnalysisText(model, id, a, "csv"));
            Assert.Equal(JsonDump.Pretty(e["problems"]), JsonDump.Pretty(new JsonArray(Failures.AnalysisProblems(model, id, a).Select(p => (JsonNode?)ProblemNode(p)).ToArray())));
            Assert.Equal(JsonDump.Pretty(e["runLinks"]), JsonDump.Pretty(new JsonArray(Failures.RunLinkProblems(id, a, Load(fixture).Runs ?? new IdMap<LoadRun>()).Select(p => (JsonNode?)ProblemNode(p)).ToArray())));
        }
    }

    [Theory]
    [InlineData("shop", "failures")]
    [InlineData("plum", "plum")]
    public void Every_view_marks_lights_and_carries_what_the_TypeScript_says(string key, string fixture)
    {
        var model = Load(fixture).Model;
        foreach (var e in Expected()[key]!["analyses"]!.AsArray())
        {
            var a = model.Failures[e!["id"]!.GetValue<string>()];
            var views = new[] { Names.Root }.Concat(model.Objects.Keys).Where(id => Views.IsView(model, id)).ToList();
            Assert.Equal(views, e["views"]!.AsArray().Select(v => v!["view"]!.GetValue<string>()).ToList());
            foreach (var v in e["views"]!.AsArray())
            {
                var view = v!["view"]!.GetValue<string>();
                var marks = Failures.RollUp(model, a, view);
                Assert.Equal(JsonDump.Pretty(v["marks"]), JsonDump.Pretty(new JsonObject { ["boxes"] = MarksNode(marks.Boxes), ["lines"] = MarksNode(marks.Lines) }));
                Assert.Equal(JsonDump.Pretty(v["inView"]), JsonDump.Pretty(Strings(a.Modes.Where(kv => Failures.InView(model, view, kv.Value)).Select(kv => kv.Key))));
                Assert.Equal(JsonDump.Pretty(v["drawnIn"]), JsonDump.Pretty(Strings(a.Modes.Where(kv => Failures.DrawnIn(model, view, kv.Value)).Select(kv => kv.Key))));
                var reach = a.Modes.Select(kv => (JsonNode?)new JsonObject
                {
                    ["id"] = kv.Key,
                    ["reach"] = ReachNode(Failures.ReachOf(model, view, kv.Value)),
                    ["light"] = Failures.LightFor(model, view, kv.Value) is { } lit ? ReachNode(lit) : null,
                }).ToArray();
                Assert.Equal(JsonDump.Pretty(v["reach"]), JsonDump.Pretty(new JsonArray(reach)));

                var shown = Views.Compute(model, view);
                var carried = new List<JsonNode?>();
                foreach (var box in shown.Members.Concat(shown.Outsiders))
                    carried.Add(new JsonObject { ["box"] = box, ["ids"] = Strings(Failures.Carried(model, a, view, new FailurePart.Box(box))) });
                foreach (var edge in shown.Edges)
                    carried.Add(new JsonObject { ["line"] = Strings([edge.From, edge.To]), ["ids"] = Strings(Failures.Carried(model, a, view, new FailurePart.Line(edge.From, edge.To))) });
                Assert.Equal(JsonDump.Pretty(v["carried"]), JsonDump.Pretty(new JsonArray(carried.ToArray())));
            }
        }
    }

    [Theory]
    [InlineData("shop", "failures")]
    [InlineData("plum", "plum")]
    public void The_analyses_that_name_a_shape_or_a_line_are_found_as_the_TypeScript_finds_them(string key, string fixture)
    {
        var model = Load(fixture).Model;
        var users = Expected()[key]!["users"]!;
        Assert.Equal(
            JsonDump.Pretty(users["objects"]),
            JsonDump.Pretty(new JsonArray(model.Objects.Keys.Select(id => (JsonNode?)new JsonObject { ["id"] = id, ["analyses"] = Strings(Failures.UsersOfObject(model, id)) }).ToArray())));
        Assert.Equal(
            JsonDump.Pretty(users["connections"]),
            JsonDump.Pretty(new JsonArray(model.Connections.Select(c => (JsonNode?)new JsonObject { ["from"] = c.From, ["to"] = c.To, ["analyses"] = Strings(Failures.UsersOfConnection(model, c.From!, c.To!)) }).ToArray())));
    }

    [Fact]
    public void A_refusal_names_the_analyses_in_the_way()
    {
        var expected = Expected()["analysesText"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
        string[][] ids = [[], ["a"], ["a", "b"], ["a", "b", "c"]];
        Assert.Equal(expected, ids.Select(Failures.AnalysesText).ToList());
    }

    [Fact]
    public void The_words_beside_the_marks_are_the_ones_the_TypeScript_says()
    {
        var expected = Expected();
        var rules = expected["bandRules"]!.AsObject();
        foreach (var band in new[] { RiskBand.High, RiskBand.Medium, RiskBand.Low, RiskBand.Unrated })
            Assert.Equal(rules[Failures.BandKey(band)]!.GetValue<string>(), Failures.BandRule(band));
        var analysed = expected["analysedText"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
        Assert.Equal(analysed, new[] { (0, 0), (1, 1), (3, 4), (15, 26) }.Select(p => Failures.AnalysedText(p.Item1, p.Item2)).ToList());
        var badges = expected["badgeNames"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
        Assert.Equal(badges, [Failures.BadgeName(new FailureMark(RiskBand.High, 1)), Failures.BadgeName(new FailureMark(RiskBand.Medium, 2), "Ordering to Stripe")]);
    }
}
