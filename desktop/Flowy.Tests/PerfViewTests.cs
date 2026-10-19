using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>Everything desktop/fixtures/perf.ts says about the panel's maths and words (ui/src/perfview.ts), reproduced by <see cref="PerfView"/>.</summary>
public class PerfViewTests
{
    private static readonly string Dir = Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "perf", "flowy");

    private static readonly JsonNode Expected = JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "perf-view.json")))!;

    private static readonly Folder Loaded = FolderLoader.Load(Dir);

    private static readonly Area Plot = new(10, 3, 90, 50);

    private static double D(JsonNode? n) => n!.GetValue<double>();

    private static double? Maybe(JsonNode? n) => n is null ? null : D(n);

    private static Scale ScaleFrom(JsonNode? n) => new(D(n!["lo"]), D(n["hi"]), n["log"]!.GetValue<bool>());

    private static void Same(JsonNode? expected, JsonNode? actual, string what) => Assert.True(
        JsonDump.Pretty(expected) == JsonDump.Pretty(actual), $"{what}\nexpected {JsonDump.Pretty(expected)}\nactual   {JsonDump.Pretty(actual)}");

    private static JsonObject Json(Scale s) => new() { ["lo"] = s.Lo, ["hi"] = s.Hi, ["log"] = s.Log };

    private static JsonObject Json(Metrics m)
    {
        var o = new JsonObject();
        void Put(string key, double? v)
        {
            if (v is { } n) o[key] = n;
        }
        Put("util", m.Util);
        Put("queue", m.Queue);
        Put("errors", m.Errors);
        Put("rate", m.Rate);
        Put("p50", m.P50);
        Put("p95", m.P95);
        if (m is Pair p)
        {
            o["from"] = p.From;
            o["to"] = p.To;
        }
        return o;
    }

    private static JsonArray Series(IEnumerable<double?> values) => new(values.Select(v => v is { } n ? JsonValue.Create(n) : null).ToArray());

    [Fact]
    public void A_ramp_takes_as_long_and_steps_as_often_as_the_browser_does()
    {
        Assert.Equal(PerfView.RampMs, D(Expected["constants"]!["rampMs"]));
        Assert.Equal(PerfView.RampStepMs, D(Expected["constants"]!["rampStepMs"]));
    }

    [Fact]
    public void Numbers_are_written_the_way_a_reader_says_them()
    {
        var words = Expected["words"]!.AsArray();
        Assert.True(words.Count > 15);
        foreach (var w in words)
        {
            var n = D(w!["n"]);
            Assert.Equal(w["ms"]!.GetValue<string>(), PerfView.FmtMs(n));
            Assert.Equal(w["pct"]!.GetValue<string>(), PerfView.FmtPct(n));
            Assert.Equal(w["rate"]!.GetValue<string>(), PerfView.FmtRate(n));
            Assert.Equal(w["load"]!.GetValue<string>(), PerfView.FmtLoad(n, "req/s"));
        }
    }

    [Fact]
    public void Each_number_of_the_panel_has_its_name_scale_and_words()
    {
        foreach (var m in Expected["metrics"]!.AsArray())
        {
            var info = PerfView.Metrics[m!["key"]!.GetValue<string>()];
            Assert.Equal(m["label"]!.GetValue<string>(), info.Label);
            Assert.Equal(m["log"]!.GetValue<bool>(), info.Log);
            Assert.Equal(Maybe(m["max"]), info.Max);
            var shown = new[] { 0, 0.4, 0.93, 40.4, 2500 }.Select(info.Show).ToArray();
            Assert.Equal(m["shown"]!.AsArray().Select(s => s!.GetValue<string>()), shown);
        }
        Assert.Equal(Expected["keys"]!["box"]!.AsArray().Select(k => k!.GetValue<string>()), PerfView.BoxKeys);
        Assert.Equal(Expected["keys"]!["line"]!.AsArray().Select(k => k!.GetValue<string>()), PerfView.LineKeys);
    }

    [Fact]
    public void A_position_along_the_levels_is_a_load_and_a_ramp_moves_it_on()
    {
        var all = Expected["positions"]!.AsArray();
        Assert.Equal(Loaded.Runs!.Count, all.Count);
        foreach (var r in all)
        {
            var run = Loaded.Runs![r!["id"]!.GetValue<string>()];
            Assert.Equal((int)D(r["top"]), PerfView.Top(run));
            foreach (var at in r["at"]!.AsArray())
            {
                var pos = D(at!["pos"]);
                Assert.Equal(D(at["clamp"]), PerfView.ClampPos(run, pos));
                Assert.Equal(D(at["load"]), PerfView.LoadAt(run, pos), 9);
                Assert.Equal(at["tested"]!.GetValue<bool>(), PerfView.IsTested(pos));
                Assert.Equal(D(at["snap"]), PerfView.Snap(run, pos));
                Assert.Equal(D(at["from"]), PerfView.RampFrom(run, pos));
                var ramp = at["ramp"]!.AsArray();
                var ms = new[] { 0, 16, 1000, PerfView.RampMs / 2, PerfView.RampMs };
                for (var i = 0; i < ms.Length; i++) Assert.Equal(D(ramp[i]), PerfView.RampPos(run, pos, ms[i]), 9);
            }
        }
    }

    [Fact]
    public void A_position_that_is_not_a_number_is_the_lowest_level()
    {
        var run = Loaded.Runs!["ramp"];
        Assert.Equal(0, PerfView.ClampPos(run, double.NaN));
        Assert.Equal(10, PerfView.LoadAt(run, double.NaN));
    }

    [Fact]
    public void The_run_on_show_is_the_one_asked_for_if_there_is_such_a_run_else_the_first()
    {
        foreach (var a in Expected["active"]!.AsArray())
        {
            var id = a!["id"]!.GetValue<string>();
            var runs = id == "x" ? new IdMap<LoadRun>() : Loaded.Runs!;
            Assert.Equal(a["active"]!.GetValue<string>(), PerfView.ActiveRun(runs, id));
        }
    }

    [Fact]
    public void A_scale_holds_every_number()
    {
        var scales = Expected["scales"]!.AsArray();
        Assert.True(scales.Count > 8);
        foreach (var s in scales)
        {
            var options = s!["options"];
            var scale = PerfView.ScaleOf(s["values"]!.AsArray().Select(Maybe), options?["log"]?.GetValue<bool>() ?? false, Maybe(options?["from"]), Maybe(options?["to"]));
            Same(s["scale"], Json(scale), s["values"]!.ToJsonString());
        }
    }

    [Fact]
    public void Levels_values_curves_grids_and_labels_sit_where_the_browser_puts_them()
    {
        var place = Expected["place"]!;
        foreach (var x in place["x"]!.AsArray())
            Assert.Equal(D(x!["x"]), PerfView.XAt(Plot, D(x["i"]), (int)D(x["count"])), 9);
        foreach (var y in place["y"]!.AsArray())
            Assert.Equal(D(y!["y"]), PerfView.YAt(Plot, ScaleFrom(y["scale"]), D(y["v"])), 9);
        foreach (var p in place["paths"]!.AsArray())
            Assert.Equal(p!["path"]!.GetValue<string>(), PerfView.PathOf(p["values"]!.AsArray().Select(Maybe).ToList(), new Scale(0, 1, false), Plot));
        foreach (var g in place["grids"]!.AsArray())
        {
            var grid = PerfView.GridOf(ScaleFrom(g!["scale"]), Plot);
            Same(g["grid"], new JsonArray(grid.Select(l => (JsonNode?)new JsonObject { ["y"] = l.Y, ["label"] = l.Label }).ToArray()), "the grid");
        }
        foreach (var l in place["labels"]!.AsArray())
        {
            var run = Loaded.Runs![l!["id"]!.GetValue<string>()];
            JsonArray Labels(int most) => new(PerfView.LevelLabels(run, Plot, most).Select(x => (JsonNode?)new JsonObject { ["x"] = x.X, ["label"] = x.Label }).ToArray());
            Same(l["labels"], Labels(8), "the labels");
            Same(l["few"], Labels(2), "the thinned labels");
        }
    }

    [Fact]
    public void What_a_shape_or_line_measured_is_read_level_by_level_and_at_a_load()
    {
        var all = Expected["readings"]!.AsArray();
        Assert.True(all.Count >= 12);
        foreach (var r in all)
        {
            var run = Loaded.Runs![r!["id"]!.GetValue<string>()];
            var view = r["view"]!.GetValue<string>();
            var loads = new[] { run.Levels[0].Load, (run.Levels[0].Load + run.Levels[1].Load) / 2, run.Levels[^1].Load };
            foreach (var b in r["boxes"]!.AsArray())
            {
                var id = b!["id"]!.GetValue<string>();
                foreach (var key in PerfView.BoxKeys)
                    Same(b["series"]![key], Series(PerfView.BoxSeries(Loaded.Model, run, view, id, key)), $"{run.Name} {view} {id} {key}");
                var at = b["at"]!.AsArray();
                for (var i = 0; i < loads.Length; i++)
                    Same(at[i], PerfView.BoxAt(Loaded.Model, run, view, id, loads[i]) is { } m ? Json(m) : null, $"{run.Name} {view} {id} at {loads[i]}");
            }
            foreach (var l in r["lines"]!.AsArray())
            {
                var (from, to) = (l!["from"]!.GetValue<string>(), l["to"]!.GetValue<string>());
                foreach (var key in PerfView.LineKeys)
                    Same(l["series"]![key], Series(PerfView.LineSeries(Loaded.Model, run, view, from, to, key)), $"{run.Name} {view} {from}→{to} {key}");
                var at = l["at"]!.AsArray();
                for (var i = 0; i < loads.Length; i++)
                    Same(at[i], PerfView.LineAt(Loaded.Model, run, view, from, to, loads[i]) is { } m ? Json(m) : null, $"{run.Name} {view} {from}→{to} at {loads[i]}");
            }
        }
    }
}
