using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>ui/src/failuresview.ts, reproduced: what desktop/fixtures/failures.ts says the Failures tab works out before it draws, over the shop case and Plum.</summary>
public class FailuresViewTests
{
    private static string Fixtures => Path.Combine(Repo.Root, "desktop", "fixtures");

    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "expected", "failures-view.json")))!;

    private static Folder Load(string fixture)
    {
        var dirs = JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "fixtures.json")))!.AsObject();
        return FolderLoader.Load(Path.Combine(Repo.Root, dirs[fixture]!.GetValue<string>()));
    }

    private static JsonArray Strings(IEnumerable<string> items) => new(items.Select(s => (JsonNode?)JsonValue.Create(s)).ToArray());

    private static readonly (string Name, RiskBand? Band)[] Bands =
        [("none", null), ("high", RiskBand.High), ("medium", RiskBand.Medium), ("low", RiskBand.Low), ("unrated", RiskBand.Unrated)];

    [Fact]
    public void A_rating_is_ten_cells_the_first_of_them_filled()
    {
        foreach (var e in Expected()["ratingCells"]!.AsArray())
            Assert.Equal(
                e!["cells"]!.AsArray().Select(c => c!.GetValue<bool>()).ToArray(),
                FailuresView.RatingCells(e["rating"]?.GetValue<int>()));
    }

    [Fact]
    public void A_status_has_the_name_a_reader_sees()
    {
        var expected = Expected()["statusNames"]!.AsObject().ToDictionary(kv => kv.Key, kv => kv.Value!.GetValue<string>());
        Assert.Equal(expected, FailuresView.StatusNames.ToDictionary(kv => kv.Key, kv => kv.Value));
    }

    [Fact]
    public void The_arrows_stop_at_the_ends_of_the_list_and_start_at_the_first()
    {
        var all = Expected()["neighbour"]!.AsArray();
        Assert.True(all.Count >= 10);
        foreach (var e in all)
            Assert.Equal(
                e!["id"]?.GetValue<string>(),
                FailuresView.Neighbour(e["ids"]!.AsArray().Select(i => i!.GetValue<string>()).ToList(), e["current"]?.GetValue<string>(), e["delta"]!.GetValue<int>()));
    }

    [Theory]
    [InlineData("shop", "failures")]
    [InlineData("plum", "plum")]
    public void The_list_the_counts_and_the_words_come_out_as_the_TypeScript_says(string key, string fixture)
    {
        var folder = Load(fixture);
        var model = folder.Model;
        var expected = Expected()[key]!;
        Assert.Equal(expected["modeCount"]!.GetValue<int>(), FailuresView.ModeCount(model));
        foreach (var e in expected["active"]!.AsArray())
            Assert.Equal(e!["active"]?.GetValue<string>(), FailuresView.ActiveAnalysis(model.Failures, e["id"]!.GetValue<string>()));

        var views = new[] { Names.Root }.Concat(model.Objects.Keys).Where(id => Views.IsView(model, id)).ToList();
        foreach (var e in expected["analyses"]!.AsArray())
        {
            var id = e!["id"]!.GetValue<string>();
            var a = model.Failures[id];
            var counts = FailuresView.BandCounts(a);
            Assert.Equal(
                JsonDump.Pretty(e["bandCounts"]),
                JsonDump.Pretty(new JsonObject { ["high"] = counts[RiskBand.High], ["medium"] = counts[RiskBand.Medium], ["low"] = counts[RiskBand.Low], ["unrated"] = counts[RiskBand.Unrated] }));

            var rows = views.SelectMany(view => Bands.Select(b =>
            {
                var (here, elsewhere) = FailuresView.RowsFor(model, a, view, b.Band);
                return (JsonNode?)new JsonObject
                {
                    ["view"] = view, ["band"] = b.Band is { } band ? Failures.BandKey(band) : null,
                    ["here"] = Strings(here.Select(r => r.Id)), ["elsewhere"] = Strings(elsewhere.Select(r => r.Id)),
                };
            })).ToArray();
            Assert.Equal(JsonDump.Pretty(e["rows"]), JsonDump.Pretty(new JsonArray(rows)));

            var partRows = new List<JsonNode?>();
            foreach (var view in views)
            {
                var shown = Views.Compute(model, view);
                foreach (var box in shown.Members.Concat(shown.Outsiders))
                    partRows.Add(new JsonObject { ["view"] = view, ["box"] = box, ["here"] = Strings(FailuresView.RowsFor(model, a, view, null, new FailurePart.Box(box)).Here.Select(r => r.Id)) });
                foreach (var edge in shown.Edges)
                    partRows.Add(new JsonObject
                    {
                        ["view"] = view, ["line"] = Strings([edge.From, edge.To]),
                        ["here"] = Strings(FailuresView.RowsFor(model, a, view, null, new FailurePart.Line(edge.From, edge.To)).Here.Select(r => r.Id)),
                    });
            }
            Assert.Equal(JsonDump.Pretty(e["partRows"]), JsonDump.Pretty(new JsonArray(partRows.ToArray())));

            var modes = a.Modes.Select(kv => (JsonNode?)new JsonObject
            {
                ["id"] = kv.Key,
                ["after"] = FailuresView.AfterText(kv.Value),
                ["known"] = FailuresView.ModeIn(model, id, kv.Key) is not null,
                ["firstError"] = new JsonArray((folder.Runs ?? new IdMap<LoadRun>()).Select(run => (JsonNode?)new JsonObject
                {
                    ["run"] = run.Key, ["at"] = FailuresView.FirstErrorAt(model, run.Value, kv.Value) is { } at ? at : null,
                }).ToArray()),
            }).ToArray();
            Assert.Equal(JsonDump.Pretty(e["modes"]), JsonDump.Pretty(new JsonArray(modes)));
        }
    }
}
