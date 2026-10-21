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
        Put("bytes", m.Bytes);
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
            Assert.Equal(w["bytes"]!.GetValue<string>(), PerfView.FmtBytes(n));
            Assert.Equal(w["load"]!.GetValue<string>(), PerfView.FmtLoad(n, "req/s"));
        }
    }

    [Fact]
    public void The_key_draws_the_kinds_of_failing_call_that_are_on_the_lines()
    {
        var all = Expected["marks"]!.AsArray();
        Assert.True(all.Count >= 8);
        foreach (var c in all)
        {
            var lines = c!["lines"]!.AsArray().Select(l => new LineTraffic("a", "b", 2, 1, 1000, l!["failed"]!.GetValue<double>()) { Failure = l["failure"]?.GetValue<string>() }).ToList();
            var marks = PerfView.FailureMarksOf(lines);
            Assert.Equal(c["marks"]!["fade"]!.GetValue<bool>(), marks.Fade);
            Assert.Equal(c["marks"]!["lost"]!.GetValue<bool>(), marks.Lost);
            Assert.Equal(c["marks"]!["rejected"]!.GetValue<bool>(), marks.Rejected);
        }
    }

    [Fact]
    public void A_source_colour_is_a_hex_for_each_theme_the_way_the_browser_writes_it_as_css()
    {
        foreach (var c in Expected["colours"]!.AsArray())
        {
            var color = c!["color"]?.GetValue<string>();
            var css = c["css"]?.GetValue<string>();
            var (light, dark) = (PerfView.SourceHex(color, false), PerfView.SourceHex(color, true));
            if (css is null) Assert.True(light is null && dark is null, $"{color} is no colour");
            else Assert.Equal(css, light == dark ? light : $"light-dark({light}, {dark})");
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

    private static Scale Line => new(0, 80, false);

    private static void SameTicks(JsonNode? expected, IEnumerable<(double Fraction, string Label)> ticks)
    {
        var all = expected!.AsArray();
        var actual = ticks.ToList();
        Assert.Equal(all.Count, actual.Count);
        for (var i = 0; i < all.Count; i++)
        {
            Assert.Equal(D(all[i]!["fraction"]), actual[i].Fraction, 9);
            Assert.Equal(all[i]!["label"]!.GetValue<string>(), actual[i].Label);
        }
    }

    private static void SameEvents(JsonNode? expected, IReadOnlyList<(double Fraction, RunEvent Event)> events, string what)
    {
        var all = expected!.AsArray();
        Assert.Equal(all.Count, events.Count);
        for (var i = 0; i < all.Count; i++)
        {
            Assert.Equal(D(all[i]!["fraction"]), events[i].Fraction, 9);
            Same(all[i]!["event"], new JsonObject { ["at"] = events[i].Event.At, ["on"] = events[i].Event.On, ["state"] = events[i].Event.State, ["text"] = events[i].Event.Text }, what);
        }
    }

    [Fact]
    public void The_slider_of_a_load_run_is_even_and_snaps_and_has_no_events()
    {
        var all = Expected["sliders"]!.AsArray();
        Assert.Equal(Loaded.Runs!.Count, all.Count);
        foreach (var r in all)
        {
            var id = r!["id"]!.GetValue<string>();
            var run = Loaded.Runs![id];
            var (min, max) = PerfView.SliderRange(run);
            Assert.Equal(D(r["range"]!["min"]), min);
            Assert.Equal(D(r["range"]!["max"]), max);
            SameEvents(r["events"], PerfView.EventFractions(run), $"{id}: the events");
            SameTicks(r["ticks"], PerfView.TickLabels(run));
            SameTicks(r["few"], PerfView.TickLabels(run, 2));
            foreach (var at in r["at"]!.AsArray())
            {
                var pos = D(at!["pos"]);
                Assert.Equal(D(at["fraction"]), PerfView.SliderFraction(run, pos), 9);
                Assert.Equal(D(at["value"]), PerfView.SliderValue(run, pos), 9);
                Assert.Equal(D(at["slide"]), PerfView.SlidePos(run, pos), 9);
                Assert.Equal(D(at["x"]), PerfView.XOfPos(run, pos), 9);
                Assert.Equal(D(at["back"]), PerfView.PosAt(run, PerfView.LoadAt(run, pos)), 9);
            }
        }
    }

    [Fact]
    public void The_slider_of_a_time_run_is_linear_in_time_and_the_panel_maths_agree_with_the_browser()
    {
        var all = Expected["timed"]!.AsArray();
        Assert.True(all.Count >= 5);
        foreach (var r in all)
        {
            var id = r!["id"]!.GetValue<string>();
            var run = Perf.ParseRun(id, r["text"]!.GetValue<string>()).Run;
            Assert.True(run.IsTime);
            Assert.Equal((int)D(r["top"]), PerfView.Top(run));
            var (min, max) = PerfView.SliderRange(run);
            Assert.Equal(D(r["range"]!["min"]), min);
            Assert.Equal(D(r["range"]!["max"]), max);
            SameEvents(r["events"], PerfView.EventFractions(run), $"{id}: the events");
            SameTicks(r["ticks"], PerfView.TickLabels(run));
            SameTicks(r["few"], PerfView.TickLabels(run, 2));
            foreach (var at in r["at"]!.AsArray())
            {
                var pos = D(at!["pos"]);
                Assert.Equal(D(at["load"]), PerfView.LoadAt(run, pos), 9);
                Assert.Equal(D(at["x"]), PerfView.XOfPos(run, pos), 9);
                Assert.Equal(D(at["fraction"]), PerfView.SliderFraction(run, pos), 9);
                Assert.Equal(D(at["value"]), PerfView.SliderValue(run, pos), 9);
                Assert.Equal(D(at["cursor"]), PerfView.CursorX(run, Plot, pos), 9);
                Assert.Equal(D(at["snap"]), PerfView.Snap(run, pos));
                Assert.Equal(D(at["from"]), PerfView.RampFrom(run, pos));
                var ramp = at["ramp"]!.AsArray();
                var ms = new[] { 0, 16, 1000, PerfView.RampMs / 2, PerfView.RampMs };
                for (var i = 0; i < ms.Length; i++) Assert.Equal(D(ramp[i]), PerfView.RampPos(run, pos, ms[i]), 9);
            }
            foreach (var p in r["posAt"]!.AsArray())
            {
                var x = D(p!["x"]);
                Assert.Equal(D(p["pos"]), PerfView.PosAt(run, x), 9);
                Assert.Equal(D(p["slide"]), PerfView.SlidePos(run, x), 9);
            }
            foreach (var row in r["rows"]!.AsArray())
            {
                var x = D(row!["x"]);
                var expected = row["rows"]!.AsArray();
                var actual = PerfView.EventRows(run, x);
                Assert.Equal(expected.Count, actual.Count);
                for (var i = 0; i < expected.Count; i++)
                {
                    Assert.Equal(D(expected[i]!["event"]!["at"]), actual[i].Event.At);
                    Assert.Equal(expected[i]!["passed"]!.GetValue<bool>(), actual[i].Passed);
                    Assert.Equal(expected[i]!["current"]!.GetValue<bool>(), actual[i].Current);
                }
            }
            var levels = r["levels"]!.AsArray();
            for (var i = 0; i < levels.Count; i++) Assert.Equal(D(levels[i]), PerfView.LevelX(run, Plot, i), 9);
            JsonArray Labels(int most) => new(PerfView.LevelLabels(run, Plot, most).Select(x => (JsonNode?)new JsonObject { ["x"] = x.X, ["label"] = x.Label }).ToArray());
            Same(r["labels"], Labels(8), $"{id}: the labels");
            Same(r["few_labels"], Labels(2), $"{id}: the thinned labels");
            var values = run.Levels.Select((_, i) => i % 3 == 1 ? (double?)null : (i + 1) * 10).ToList();
            Assert.Equal(r["path"]!.GetValue<string>(), PerfView.PathOf(values, Line, Plot, run));
            Assert.Equal(r["even"]!.GetValue<string>(), PerfView.PathOf(values, Line, Plot));
        }
    }

    [Fact]
    public void A_time_that_is_not_a_number_is_the_start_of_a_run()
    {
        var run = Perf.ParseRun("t", "name: T\naxis: time\nlevels:\n  - at: 10\n  - at: 20\n").Run;
        Assert.Equal(0, PerfView.PosAt(run, double.NaN));
        Assert.Equal(0, PerfView.PosAt(run, double.NegativeInfinity));
        Assert.Equal(0, PerfView.PosAt(run, double.PositiveInfinity)); // not finite is the start, as for ClampPos
        Assert.Equal(0.5, PerfView.SliderFraction(run, 0.5));
        Assert.Equal(0, PerfView.SliderFraction(run, double.NaN));
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
