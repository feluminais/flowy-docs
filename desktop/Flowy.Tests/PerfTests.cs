using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>Everything desktop/fixtures/perf.ts says about load-test runs, reproduced by <see cref="Perf"/> and <see cref="FolderLoader"/>.</summary>
public class PerfTests
{
    private static readonly string Dir = Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "perf", "flowy");

    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "perf-runs.json")))!;

    private static readonly Folder Loaded = FolderLoader.Load(Dir);

    // ---- the C# side of perf.ts's JSON ----------------------------------------------------------------------------

    private static void Put(JsonObject o, string key, double? value)
    {
        if (value is { } v) o[key] = v;
    }

    private static JsonObject Json(Metrics m)
    {
        var o = new JsonObject();
        Put(o, "util", m.Util);
        Put(o, "queue", m.Queue);
        Put(o, "errors", m.Errors);
        Put(o, "rate", m.Rate);
        Put(o, "bytes", m.Bytes);
        Put(o, "p50", m.P50);
        Put(o, "p95", m.P95);
        return o;
    }

    private static JsonObject Json(Pair p)
    {
        var o = new JsonObject { ["from"] = p.From, ["to"] = p.To };
        foreach (var (key, value) in Json((Metrics)p)) o[key] = value!.DeepClone();
        if (p.Failure is not null) o["failure"] = p.Failure;
        return o;
    }

    private static JsonObject Json(IdMap<Metrics> objects) => new(objects.Select(kv => KeyValuePair.Create(kv.Key, (JsonNode?)Json(kv.Value))));

    private static JsonObject Json(SourceFormula f) => new() { ["text"] = f.Text };

    private static JsonObject Json(Source s)
    {
        var o = new JsonObject();
        if (s.Color is not null) o["color"] = s.Color;
        if (s.Dot is { } dot) o["dot"] = Json(dot);
        if (s.Size is { } size) o["size"] = Json(size);
        return o;
    }

    private static JsonObject Json(Level l) => new()
    {
        ["load"] = l.Load,
        ["overall"] = Json(l.Overall),
        ["objects"] = Json(l.Objects),
        ["connections"] = new JsonArray(l.Connections.Select(c => (JsonNode?)Json(c)).ToArray()),
    };

    private static JsonObject Json(LoadRun r)
    {
        var o = new JsonObject { ["name"] = r.Name };
        if (r.About is not null) o["about"] = r.About;
        o["unit"] = r.Unit;
        if (r.Entry is not null) o["entry"] = r.Entry;
        if (r.Source is { } source) o["source"] = Json(source);
        o["levels"] = new JsonArray(r.Levels.Select(l => (JsonNode?)Json(l)).ToArray());
        return o;
    }

    private static JsonArray Json(IEnumerable<Problem> problems) => new(problems.Select(p => (JsonNode?)new JsonObject { ["file"] = p.File, ["message"] = p.Message }).ToArray());

    private static JsonObject Json(IEnumerable<Pair> lines, IdMap<Metrics> objects) => new() { ["objects"] = Json(objects), ["lines"] = new JsonArray(lines.Select(l => (JsonNode?)Json(l)).ToArray()) };

    private static JsonObject Json(Knee k)
    {
        var o = new JsonObject { ["index"] = k.Index, ["load"] = k.Load };
        if (k.By is { } by) o["by"] = new JsonObject { ["id"] = by.Id, ["kind"] = by.Kind, ["share"] = by.Share };
        else o["latency"] = new JsonObject { ["from"] = k.LatencyFrom, ["to"] = k.LatencyTo };
        return o;
    }

    private static JsonObject Json(Traffic t, string view)
    {
        var boxes = new JsonObject();
        foreach (var (id, b) in t.Boxes)
        {
            var box = new JsonObject();
            if (b.Strain is { } s) box["strain"] = s;
            box["queue"] = b.Queue;
            boxes[id] = box;
        }
        return new JsonObject
        {
            ["view"] = view,
            ["boxes"] = boxes,
            ["lines"] = new JsonArray(t.Lines.Select(l => (JsonNode?)Json(l)).ToArray()),
        };
    }

    /// <summary>A line of traffic as perf.ts writes it: what a source adds is left out when it adds nothing.</summary>
    private static JsonObject Json(LineTraffic l)
    {
        var o = new JsonObject
        {
            ["from"] = l.From, ["to"] = l.To, ["width"] = l.Width, ["perSecond"] = l.PerSecond, ["travelMs"] = l.TravelMs, ["failed"] = l.Failed,
        };
        if (l.Color is not null) o["color"] = l.Color;
        if (l.Radius is { } radius) o["radius"] = radius;
        if (l.Capped) o["capped"] = true;
        if (l.Failure is not null) o["failure"] = l.Failure;
        if (l.Dots is { } dots) o["dots"] = dots;
        return o;
    }

    private static JsonNode? Json(SourceKey? k)
    {
        if (k is null) return null;
        var o = new JsonObject { ["name"] = k.Name };
        if (k.Color is not null) o["color"] = k.Color;
        if (k.Scale is not null) o["scale"] = k.Scale;
        o["bigger"] = k.Bigger;
        o["scaledDown"] = k.ScaledDown;
        return o;
    }

    private static void Same(JsonNode? expected, JsonNode? actual, string what) => Assert.True(
        JsonDump.Pretty(expected) == JsonDump.Pretty(actual), $"{what}\nexpected {JsonDump.Pretty(expected)}\nactual   {JsonDump.Pretty(actual)}");

    // ---- tests ----------------------------------------------------------------------------------------------------

    [Fact]
    public void Every_run_file_reads_as_the_TypeScript_reads_it()
    {
        // The raw texts are in perf.ts; here each is read again from the fixture's own copy of them.
        var parsed = Expected()["parsed"]!.AsArray();
        Assert.True(parsed.Count > 30);
        foreach (var item in parsed)
        {
            var id = item!["id"]!.GetValue<string>();
            var text = Texts()[id];
            if (item["error"] is { } error)
            {
                var e = Assert.Throws<ParseError>(() => Perf.ParseRun(id, text));
                Assert.Equal(error["file"]!.GetValue<string>(), e.File);
                Assert.Equal(error["line"]?.GetValue<int>(), e.Line);
                Assert.Equal(error["message"]!.GetValue<string>(), e.Reason);
                continue;
            }
            var (run, problems) = Perf.ParseRun(id, text);
            Same(item["run"], Json(run), $"{id}: the run");
            Same(item["problems"], Json(problems), $"{id}: its problems");
        }
    }

    /// <summary>The run texts of perf.ts, which the fixture carries so the two sides read the same bytes.</summary>
    private static Dictionary<string, string> Texts() =>
        Expected()["parsed"]!.AsArray().ToDictionary(i => i!["id"]!.GetValue<string>(), i => i!["text"]!.GetValue<string>());

    [Fact]
    public void Strain_is_utilisation_or_failures_counted_twenty_times()
    {
        var all = Expected()["strain"]!.AsArray();
        Assert.True(all.Count > 10);
        foreach (var c in all)
        {
            var m = c!["metrics"]!.AsObject();
            double? Get(string key) => m[key]?.GetValue<double>();
            var strain = Perf.StrainOf(new Metrics { Util = Get("util"), Queue = Get("queue"), Errors = Get("errors"), Rate = Get("rate"), P50 = Get("p50") });
            var expected = c["strain"];
            if (expected is null) Assert.Null(strain);
            else Same(expected, new JsonObject { ["value"] = strain!.Value, ["by"] = strain.By, ["share"] = strain.Share }, m.ToJsonString());
        }
    }

    [Fact]
    public void A_folder_holds_its_runs_and_names_each_file_that_is_not_one()
    {
        var folder = Expected()["folder"]!;
        Assert.NotNull(Loaded.Runs);
        Same(folder["runs"], new JsonObject(Loaded.Runs!.Select(kv => KeyValuePair.Create(kv.Key, (JsonNode?)Json(kv.Value)))), "the runs");
        Same(folder["problems"], Json(Loaded.RunProblems!), "the problems");
    }

    [Fact]
    public void A_folder_without_runs_has_none()
    {
        using var temp = new TempDir();
        temp.Write("model.yaml", "objects: {}\n");
        var folder = FolderLoader.Load(temp.Dir);
        Assert.Empty(folder.Runs!);
        Assert.Empty(folder.RunProblems!);
    }

    [Fact]
    public void Between_the_tested_levels_what_a_view_rolls_up_and_what_is_drawn_agree()
    {
        var computed = Expected()["computed"]!.AsArray();
        Assert.Equal(Loaded.Runs!.Count, computed.Count);
        foreach (var c in computed)
        {
            var id = c!["id"]!.GetValue<string>();
            var run = Loaded.Runs![id];
            foreach (var at in c["loads"]!.AsArray())
            {
                var load = at!["load"]!.GetValue<double>();
                Same(at["level"], Json(Perf.Interpolate(run, load)), $"{id} at {load}: the numbers between levels");
                foreach (var t in at["traffic"]!.AsArray())
                {
                    var view = t!["view"]!.GetValue<string>();
                    Same(t, Json(Perf.TrafficFor(Loaded.Model, run, load, view), view), $"{id} at {load} in {view}: the traffic");
                }
            }
            foreach (var r in c["rolled"]!.AsArray())
            {
                var level = run.Levels.First(l => l.Load == r!["load"]!.GetValue<double>());
                var view = r!["view"]!.GetValue<string>();
                var (objects, lines) = Perf.RollUp(Loaded.Model, level, view);
                Same(new JsonObject { ["objects"] = r["objects"]!.DeepClone(), ["lines"] = r["lines"]!.DeepClone() }, Json(lines, objects), $"{id} at {level.Load} in {view}: the roll-up");
            }
            var knee = Perf.FindKnee(run);
            Same(c["knee"], knee is null ? null : Json(knee), $"{id}: the knee");
            Assert.Equal(c["text"]?.GetValue<string>(), knee is null ? null : Perf.KneeText(run, knee, oid => Views.NameOf(Loaded.Model, oid)));
        }
    }

    [Fact]
    public void Runs_with_a_source_read_roll_up_and_draw_as_the_TypeScript_has_them()
    {
        var all = Expected()["scaled"]!.AsArray();
        Assert.True(all.Count >= 7);
        foreach (var item in all)
        {
            var id = item!["id"]!.GetValue<string>();
            var (run, problems) = Perf.ParseRun(id, item["text"]!.GetValue<string>());
            Same(item["run"], Json(run), $"{id}: the run");
            Same(item["problems"], Json(problems), $"{id}: its problems");
            Assert.Equal(item["scale"]?.GetValue<string>(), Perf.ScaleText(run));
            foreach (var at in item["loads"]!.AsArray())
            {
                var load = at!["load"]!.GetValue<double>();
                Same(at["level"], Json(Perf.Interpolate(run, load)), $"{id} at {load}: the numbers between levels");
                foreach (var t in at["traffic"]!.AsArray())
                {
                    var view = t!["view"]!.GetValue<string>();
                    var drawn = Perf.TrafficFor(Loaded.Model, run, load, view);
                    var expected = t.DeepClone().AsObject();
                    expected.Remove("key");
                    Same(expected, Json(drawn, view), $"{id} at {load} in {view}: the traffic");
                    Same(t["key"], Json(Perf.SourceKeyOf(run, drawn.Lines)), $"{id} at {load} in {view}: the key");
                }
                foreach (var r in at["rolled"]!.AsArray())
                {
                    var view = r!["view"]!.GetValue<string>();
                    var (objects, lines) = Perf.RollUp(Loaded.Model, Perf.Interpolate(run, load), view);
                    var actual = Json(lines, objects);
                    actual["view"] = view;
                    Same(r, actual, $"{id} at {load} in {view}: the roll-up");
                }
            }
        }
    }

    [Fact]
    public void Dots_are_scaled_down_by_one_factor_past_the_cap()
    {
        Assert.Equal(24, Perf.AtOnce);
        void Case(double[] input, double[] expected, bool capped)
        {
            var (counts, wasCapped) = Perf.CapCounts(input);
            Assert.Equal(expected, counts);
            Assert.Equal(capped, wasCapped);
        }
        Case([10, 5], [10, 5], false);
        Case([24, 12], [24, 12], false);
        Case([48, 12], [24, 6], true);
        Case([6, 120], [1.2, 24], true);
        Case([0, 0], [0, 0], false);
        Case([], [], false);
    }

    [Fact]
    public void A_frame_is_the_roll_up_of_the_interpolated_level_and_the_traffic_made_from_it()
    {
        var run = Loaded.Runs!["ramp"];
        foreach (var load in new[] { 10.0, 37.5, 100 })
        {
            var frame = Perf.FrameAt(Loaded.Model, run, load, "shop");
            var (objects, lines) = Perf.RollUp(Loaded.Model, Perf.Interpolate(run, load), "shop");
            Same(Json(lines, objects), Json(frame.Lines, frame.Objects), $"at {load}: what each object and line reads");
            Same(Json(Perf.TrafficFor(Loaded.Model, run, load, "shop"), "shop"), Json(frame.Traffic, "shop"), $"at {load}: the traffic");
            Assert.Same(frame.Objects["worker"], frame.Box("worker"));
            Assert.Null(frame.Box("not-there"));
            foreach (var l in frame.Lines) Assert.Same(l, frame.Line(l.From, l.To));
            Assert.Null(frame.Line("not", "there"));
        }
    }

    [Fact]
    public void A_load_that_is_not_a_number_is_the_lowest_level_and_one_outside_the_range_is_clamped()
    {
        var run = Loaded.Runs!["ramp"];
        Assert.Equal(10, Perf.Interpolate(run, double.NaN).Load);
        Assert.Equal(10, Perf.Interpolate(run, -50).Load);
        Assert.Equal(100, Perf.Interpolate(run, 1e9).Load);
        Assert.Equal(10, Perf.Interpolate(run, double.NegativeInfinity).Load);
    }

    [Fact]
    public void Math_round_goes_up_on_a_half_as_JavaScript_does()
    {
        Assert.Equal(3, Perf.JsRound(2.5));
        Assert.Equal(-2, Perf.JsRound(-2.5));
        Assert.Equal(1, Perf.JsRound(0.5));
    }
}
