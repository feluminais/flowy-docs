namespace Flowy.Core;

/// <summary>
/// A dial: one thing the load can be turned up on. A run with one source has one (its <c>Id</c> is ""); a run that adds others has one for each run it adds (the id of that run); a
/// run tested together has one for each of its sources. <c>Values</c> are the loads that were tested, going up; <c>Color</c> is the colour its dots are drawn in, from its source or
/// else from the palette. A port of <c>Dial</c> in src/core/perf/types.ts.
/// </summary>
public sealed record Dial(string Id, string Name, string Unit, IReadOnlyList<double> Values, Source? Source, string Color);

/// <summary>Which kind of run it is, and what it is turned up on (see <see cref="Perf.DialsOf"/>). <c>Mode</c> is "single", "added" or "tested".</summary>
public sealed record Dials(string Mode, IReadOnlyList<Dial> Items);

/// <summary>A source in the key: its name, the colour of its dots, its scale in words when its formula is a plain ratio of the rate and a line follows it, and whether any dot is bigger or smaller than usual.</summary>
public sealed record KeyedSource(string Id, string Name, string? Color, string? Scale, bool Bigger);

/// <summary>The pieces the Performance key draws for the sources (see <see cref="Perf.SourceKeyAt"/>).</summary>
public sealed record SourcesKey(IReadOnlyList<KeyedSource> Sources, bool ScaledDown, bool Other);

/// <summary>Several sources of requests: a port of src/core/perf/dials.ts, src/core/perf/levels.ts, src/core/perf/analyse.ts, src/core/perf/traffic.ts and src/core/perf/text.ts, kept equal to them by the same fixtures.</summary>
public static partial class Perf
{
    public const string ModeSingle = "single";

    public const string ModeAdded = "added";

    public const string ModeTested = "tested";

    /// <summary>
    /// The colour of each source: the one it names, else the first of the palette that no other source draws in, in the order the sources come. (Two sources that name the same colour are
    /// a problem the checks report; they keep it.) A source nobody names a colour for is never red, the colour of a failing call.
    /// </summary>
    private static List<string> ColorsOf(IReadOnlyList<Source?> sources)
    {
        var taken = sources.Where(s => s?.Color is not null).Select(s => s!.Color!).ToList();
        var free = SourcePalette.Where(c => !taken.Any(t => SameColor(t, c))).ToList();
        var next = 0;
        return [.. sources.Select(s => s?.Color ?? (free.Count == 0 ? SourcePalette[0] : free[Math.Min(next++, free.Count - 1)]))];
    }

    /// <summary>
    /// What a run is turned up on. A run with one source is one dial; a run that adds others is one dial for each run it can add (at least two, else the run can't be played and this is
    /// null); a run tested together is one for each source. Null too for an id that isn't a run. The loads of a dial are the tested ones, so a position on it can be any fraction of an index into them.
    /// </summary>
    public static Dials? DialsOf(IdMap<LoadRun> runs, string id)
    {
        if (!runs.TryGetValue(id, out var run)) return null;
        static List<double> Loads(LoadRun r) => [.. r.Levels.Select(l => l.Load)];
        if (run.Adds is { } adds)
        {
            var parts = adds.Where(part => WhyNotAdded(runs, part) is null).ToList();
            if (parts.Count < 2) return null;
            var colors = ColorsOf([.. parts.Select(part => runs[part].Source)]);
            return new Dials(ModeAdded, [.. parts.Select((part, i) => new Dial(part, runs[part].Name, runs[part].Unit, Loads(runs[part]), runs[part].Source, colors[i]))]);
        }
        if (run.Sources is { } sources)
        {
            var ids = sources.Keys;
            var colors = ColorsOf([.. ids.Select(sid => sources[sid].Source)]);
            return new Dials(ModeTested, [.. ids.Select((sid, i) =>
            {
                var info = sources[sid];
                var values = run.Levels.Select(l => l.Loads is { } loads && loads.TryGetValue(sid, out var v) ? v : 0).Distinct().Order().ToList();
                return new Dial(sid, info.Name, info.Unit, values, info.Source, colors[i]);
            })]);
        }
        return new Dials(ModeSingle, [new Dial("", run.Name, run.Unit, Loads(run), run.Source, run.Source?.Color ?? SourcePalette[0])]);
    }

    /// <summary>The load a setting gives a dial; a dial it doesn't name is not a number.</summary>
    private static double SettingFor(IdMap<double> setting, string id) => setting.TryGetValue(id, out var v) ? v : double.NaN;

    /// <summary>A load kept inside a dial's tested range, as <see cref="Interpolate"/> keeps it: nothing is extrapolated, and one that isn't a number is the lowest.</summary>
    private static double Keep(Dial d, double x) => double.IsFinite(x) ? Math.Min(d.Values[^1], Math.Max(d.Values[0], x)) : d.Values[0];

    /// <summary>
    /// The load at a position along a dial's tested loads: a tested load exactly at a whole number, a straight line between two in between. A position past either end is that end; one that
    /// isn't a number is the lowest.
    /// </summary>
    public static double LoadOfPosition(IReadOnlyList<double> values, double pos)
    {
        var top = values.Count - 1;
        var p = Math.Min(top, Math.Max(0, double.IsFinite(pos) ? pos : 0));
        var i = Math.Min(top - 1, (int)Math.Floor(p));
        return values[i] + (values[i + 1] - values[i]) * (p - i);
    }

    /// <summary>The setting that puts every dial at a position along its own loads (one position for each dial, in dial order).</summary>
    public static IdMap<double> SettingAt(IReadOnlyList<Dial> dials, IReadOnlyList<double> positions)
    {
        var output = new IdMap<double>();
        for (var i = 0; i < dials.Count; i++) output.Add(dials[i].Id, LoadOfPosition(dials[i].Values, i < positions.Count ? positions[i] : 0));
        return output;
    }

    /// <summary>
    /// The steps of every dial rising together, from its lowest load to its highest: as many as the dial with the most loads has levels, less one. Step <c>i</c> puts a dial with <c>m</c> levels
    /// at position <c>i * (m - 1) / N</c>, so a dial with 3 levels and one with 5 meet at (0, 0), (0.5, 1), (1, 2), (1.5, 3) and (2, 4).
    /// </summary>
    public static int LockstepTop(IReadOnlyList<Dial> dials) => dials.Max(d => d.Values.Count) - 1;

    public static List<double> LockstepPositions(IReadOnlyList<Dial> dials, int step)
    {
        var n = LockstepTop(dials);
        return [.. dials.Select(d => n == 0 ? 0 : step * (double)(d.Values.Count - 1) / n)];
    }

    /// <summary>What several parts carry together on a line or overall: rates added, the worst latency and failing share, and the size of a call weighted by rate.</summary>
    private static Metrics FoldEdges(IEnumerable<Metrics> items)
    {
        var sum = new Metrics();
        var mean = new Mean();
        foreach (var m in items)
        {
            sum = new Metrics { Rate = Either(sum.Rate, m.Rate, (a, b) => a + b), P50 = Either(sum.P50, m.P50, Math.Max), P95 = Either(sum.P95, m.P95, Math.Max), Errors = Either(sum.Errors, m.Errors, Math.Max) };
            mean.TakeBytes(m.Bytes, m.Rate);
        }
        return sum with { Bytes = mean.Bytes };
    }

    /// <summary>
    /// Runs added together: every part is the level its run has at its own load, and what they say about one shape or line is put together. A shape's utilisation and queue add (they may pass 1:
    /// it reads as over capacity), its failing share is the worst; a line's rate adds, its latency and failing share are the worst, the size of a call is the mean weighted by rate, and
    /// <c>By</c> keeps what each part carried so its dots can be drawn in its colour and scale. This is an estimate: queues grow faster than a sum, so it looks calmer than the system would near its limit.
    /// </summary>
    private static Level AddLevels(IReadOnlyList<(string Id, Level Level)> parts, IdMap<double> loads)
    {
        var held = new Dictionary<string, Metrics>();
        var order = new List<string>();
        foreach (var (_, level) in parts)
        {
            foreach (var (oid, m) in level.Objects)
            {
                var so = held.TryGetValue(oid, out var found) ? found : new Metrics();
                if (!held.ContainsKey(oid)) order.Add(oid);
                held[oid] = new Metrics { Util = Either(so.Util, m.Util, (a, b) => a + b), Errors = Either(so.Errors, m.Errors, Math.Max), Queue = Either(so.Queue, m.Queue, (a, b) => a + b) };
            }
        }
        var objects = new IdMap<Metrics>();
        foreach (var oid in order) objects.Add(oid, held[oid]);

        var lines = new Dictionary<(string, string), List<(string Id, Pair Pair)>>();
        var lineOrder = new List<(string From, string To)>();
        foreach (var (id, level) in parts)
        {
            foreach (var pair in level.Connections)
            {
                if (!lines.TryGetValue((pair.From, pair.To), out var carried))
                {
                    lines[(pair.From, pair.To)] = carried = [];
                    lineOrder.Add((pair.From, pair.To));
                }
                carried.Add((id, pair));
            }
        }
        var connections = new List<Pair>();
        foreach (var (from, to) in lineOrder)
        {
            var carried = lines[(from, to)];
            var failures = carried.Where(c => c.Pair.Failure is not null).Select(c => c.Pair.Failure!).Distinct().ToList();
            var by = new IdMap<Metrics>();
            foreach (var (id, pair) in carried)
            {
                var m = new Metrics { Rate = pair.Rate, Bytes = pair.Bytes, P50 = pair.P50, Errors = pair.Errors };
                if (!m.IsEmpty) by.Add(id, m);
            }
            var folded = FoldEdges(carried.Select(c => (Metrics)c.Pair));
            connections.Add(new Pair(from, to)
            {
                Rate = folded.Rate, Bytes = folded.Bytes, P50 = folded.P50, P95 = folded.P95, Errors = folded.Errors,
                Failure = failures.Count == 1 ? failures[0] : null,
                By = by.Count > 0 ? by : null,
            });
        }
        return new Level(0, FoldEdges(parts.Select(p => p.Level.Overall)), objects, connections) { Loads = loads };
    }

    /// <summary>
    /// A run tested together at a setting: the tested combinations around it, blended in proportion (a straight line along each source, so at the middle of a cell the mean of its corners).
    /// Nothing outside the grid is shown: a setting past an end is that end. A number comes out only when every corner that counts carries it, and a corner the setting is not in (weight 0)
    /// doesn't count, so a tested combination is exactly what was measured. How a failing share fails is the nearest corner's, as it is a kind, not a number.
    /// </summary>
    private static Level BlendGrid(LoadRun run, IReadOnlyList<Dial> dials, IdMap<double> setting)
    {
        var loads = new IdMap<double>();
        var cells = new List<(int Lo, double T)>();
        foreach (var d in dials)
        {
            var x = Keep(d, SettingFor(setting, d.Id));
            loads.Add(d.Id, x);
            var last = d.Values.Count - 1;
            if (x >= d.Values[last])
            {
                cells.Add((last - 1, 1));
                continue;
            }
            var lo = 0;
            while (x >= d.Values[lo + 1]) lo++;
            cells.Add((lo, (x - d.Values[lo]) / (d.Values[lo + 1] - d.Values[lo])));
        }
        string KeyOf(IEnumerable<double?> values) => string.Join("|", values.Select(v => v is { } n ? Js(n) : "-"));
        var tested = new Dictionary<string, Level>();
        foreach (var l in run.Levels) tested[KeyOf(dials.Select(d => l.Loads is { } own && own.TryGetValue(d.Id, out var v) ? (double?)v : null))] = l;
        var corners = new List<(double W, Level Level)>();
        for (var mask = 0; mask < 1 << dials.Count; mask++)
        {
            var w = 1.0;
            var picked = new List<double?>();
            for (var i = 0; i < dials.Count; i++)
            {
                var up = (mask >> i) & 1;
                w *= up == 1 ? cells[i].T : 1 - cells[i].T;
                picked.Add(dials[i].Values[cells[i].Lo + up]);
            }
            if (w != 0 && tested.TryGetValue(KeyOf(picked), out var level)) corners.Add((w, level));
        }
        Metrics Blend(Func<Level, Metrics?> pick, string[] keys)
        {
            var output = new Metrics();
            if (corners.Count == 0) return output;
            foreach (var key in keys)
            {
                var total = 0.0;
                var all = true;
                foreach (var (w, level) in corners)
                {
                    if (pick(level)?[key] is not { } v)
                    {
                        all = false;
                        break;
                    }
                    total += w * v;
                }
                if (all) output = output.With(key, total);
            }
            return output;
        }

        var objects = new IdMap<Metrics>();
        foreach (var oid in corners.SelectMany(c => c.Level.Objects.Keys).Distinct())
        {
            var m = Blend(l => l.Objects.TryGetValue(oid, out var found) ? found : null, ObjectKeys);
            if (!m.IsEmpty) objects.Add(oid, m);
        }
        var pairs = new List<(string From, string To)>();
        foreach (var (_, level) in corners)
            foreach (var c in level.Connections)
                if (!pairs.Contains((c.From, c.To))) pairs.Add((c.From, c.To));
        var connections = new List<Pair>();
        foreach (var (from, to) in pairs)
        {
            Pair? Pick(Level l) => l.Connections.FirstOrDefault(c => c.From == from && c.To == to);
            var m = Blend(Pick, EdgeKeys);
            var by = new IdMap<Metrics>();
            foreach (var d in dials)
            {
                var b = Blend(l => Pick(l)?.By is { } own && own.TryGetValue(d.Id, out var found) ? found : null, ByKeys);
                if (!b.IsEmpty) by.Add(d.Id, b);
            }
            string? failure = null;
            var heaviest = 0.0;
            foreach (var (w, level) in corners)
            {
                if (Pick(level)?.Failure is { } f && w > heaviest)
                {
                    heaviest = w;
                    failure = f;
                }
            }
            if (!m.IsEmpty || by.Count > 0)
                connections.Add(new Pair(from, to) { Rate = m.Rate, Bytes = m.Bytes, P50 = m.P50, P95 = m.P95, Errors = m.Errors, Failure = failure, By = by.Count > 0 ? by : null });
        }
        return new Level(0, Blend(l => l.Overall, EdgeKeys), objects, connections) { Loads = loads };
    }

    /// <summary>
    /// The run at a setting, as a <see cref="Level"/>, whatever kind of run it is: one source is <see cref="Interpolate"/>; runs added are each interpolated at their own load and put together; a run
    /// tested together is blended inside its grid. A load past a dial's tested range is that end, and one that isn't a number is the lowest. A run that can't be played (<see cref="DialsOf"/> says so) is an
    /// empty level. A level of several sources has <c>Loads</c>, the setting it was worked out at.
    /// </summary>
    public static Level LevelAt(IdMap<LoadRun> runs, string id, IdMap<double> setting)
    {
        if (DialsOf(runs, id) is not { } found) return new Level(0, new Metrics(), new IdMap<Metrics>(), []);
        if (found.Mode == ModeSingle) return Interpolate(runs[id], SettingFor(setting, ""));
        if (found.Mode == ModeTested) return BlendGrid(runs[id], found.Items, setting);
        var loads = new IdMap<double>();
        var parts = found.Items.Select(d =>
        {
            var x = Keep(d, SettingFor(setting, d.Id));
            loads.Add(d.Id, x);
            return (d.Id, Interpolate(runs[d.Id], x));
        }).ToList();
        return AddLevels(parts, loads);
    }

    /// <summary>
    /// Where a run first struggles. One source: <see cref="FindKnee"/>. Several: every dial rises together from its lowest load to its highest, each along its own loads (see
    /// <see cref="LockstepPositions"/>), and the first step where a shape is strained to <see cref="KneeStrain"/>, or failing that the slowest 5% pass <see cref="KneeLatency"/> times what they were
    /// at the start, is the knee; its <c>Setting</c> says where each source stood. Null when the run never struggles, and for a run that can't be played.
    /// </summary>
    public static Knee? KneeOf(IdMap<LoadRun> runs, string id)
    {
        if (DialsOf(runs, id) is not { } found) return null;
        if (found.Mode == ModeSingle) return FindKnee(runs[id]);
        double? baseline = null;
        for (var step = 0; step <= LockstepTop(found.Items); step++)
        {
            var setting = SettingAt(found.Items, LockstepPositions(found.Items, step));
            var level = LevelAt(runs, id, setting);
            if (step == 0) baseline = level.Overall.P95;
            if (Struggle(level, baseline) is { } hit) return hit with { Index = step, Load = 0, Setting = setting };
        }
        return null;
    }

    private static string JoinAnd(IReadOnlyList<string> items) => items.Count < 2 ? string.Concat(items) : $"{string.Join(", ", items.Take(items.Count - 1))} and {items[^1]}";

    /// <summary>
    /// The knee in words. One source: <see cref="KneeText"/>, unchanged. Several: where each source stood, then what gave out ("First struggles with Customer orders at 300 orders/min and Courier pings
    /// at 100 pings/s: Fleet DB at 90% of capacity"). <paramref name="nameOf"/> turns a shape id into the name a reader sees.
    /// </summary>
    public static string KneeTextOf(IdMap<LoadRun> runs, string id, Knee k, Func<string, string> nameOf)
    {
        if (DialsOf(runs, id) is not { } found || found.Mode == ModeSingle) return KneeText(runs[id], k, nameOf);
        var stood = found.Items.Select(d => $"{d.Name} at {Js(Round2(k.Setting is { } setting && setting.TryGetValue(d.Id, out var at) ? at : d.Values[0]))} {d.Unit}").ToList();
        return $"First struggles with {JoinAnd(stood)}: {StruggleText(k, nameOf)}";
    }

    /// <summary>The colour of a line that no source is said to carry: neutral, so it is never mistaken for one of them.</summary>
    public const string OtherColor = "gray";

    /// <summary>
    /// The traffic on one rolled-up line of a run with several sources: an entry for each source that carries something on it, in the colour, scale and size of that source. The sources on a line are
    /// scaled by one common factor when the busiest passes <see cref="AtOnce"/>, so a line of ten times the calls still reads as ten times the dots; they run a little apart, so two on one path don't
    /// hide each other. The line is as thick as everything it carries. A line the run doesn't split by source draws as it would for a run with no source, in a neutral colour.
    /// </summary>
    private static List<LineTraffic> SharedLines(Pair l, IReadOnlyList<Dial> dials)
    {
        var split = dials.Where(d => l.By is { } by && by.Contains(d.Id)).Select(d => (Dial: d, By: l.By![d.Id])).ToList();
        var carried = split.Where(s => s.By.Rate is not null).Select(s => s.By.Rate!.Value).ToList();
        var total = l.Rate ?? (carried.Count > 0 ? carried.Aggregate((a, b) => a + b) : null);
        if (split.Count == 0) return l.Rate is { } rate ? [LineTrafficOf(l, rate, null) with { Color = OtherColor }] : [];
        if (total is not { } whole) return [];
        // A source's own numbers are its own. What it doesn't give is the line's where that is fair: the whole line when it is the only source named, the expected call always (it sets only how
        // fast dots cross), and the failing share when no source gives one (then the line's is the best guess for each). Never another source's size or failing share.
        var alone = split.Count == 1;
        var anyErrors = split.Any(s => s.By.Errors is not null);
        var rows = new List<(Dial Dial, Pair Pair, double Rate, double? Count)>();
        foreach (var (dial, by) in split)
        {
            var rate = by.Rate ?? (alone ? whole : (double?)null);
            if (rate is not { } r) continue;
            var pair = new Pair(l.From, l.To)
            {
                Rate = r, Bytes = by.Bytes ?? (alone ? l.Bytes : null), P50 = by.P50 ?? l.P50, Errors = by.Errors ?? (alone || !anyErrors ? l.Errors : null), Failure = l.Failure,
            };
            rows.Add((dial, pair, r, DotsFor(pair, r, dial.Source)));
        }
        var (counts, capped) = CapCounts([.. rows.Where(r => r.Count is not null).Select(r => r.Count!.Value)]);
        var next = 0;
        var output = new List<LineTraffic>();
        for (var i = 0; i < rows.Count; i++)
        {
            var row = rows[i];
            (double Dots, bool Capped)? counted = row.Count is null ? null : (counts[next++], capped);
            output.Add(LineTrafficOf(row.Pair, row.Rate, row.Dial.Source, whole, counted) with
            {
                Color = row.Dial.Color, Source = row.Dial.Id, Offset = rows.Count > 1 ? i - (rows.Count - 1) / 2.0 : null,
            });
        }
        return output;
    }

    /// <summary>
    /// The run at a setting of its dials as one view draws it, interpolated and rolled up once, as <see cref="FrameAt"/> is for one source (and the same for a run with one): the panel's readouts
    /// and <see cref="TrafficAt"/> are both made from it. For runs with several the boxes are those of the combined level (strain stops at 1 however far over capacity they are added) and a line
    /// for each source on each line.
    /// </summary>
    public static LoadFrame FrameOf(Model model, IdMap<LoadRun> runs, string id, IdMap<double> setting, string view)
    {
        if (DialsOf(runs, id) is not { } found) return new LoadFrame(new IdMap<Metrics>(), [], new Traffic(new IdMap<BoxTraffic>(), []));
        if (found.Mode == ModeSingle) return FrameAt(model, runs[id], SettingFor(setting, ""), view);
        var (objects, lines) = RollUp(model, LevelAt(runs, id, setting), view);
        return new LoadFrame(objects, lines, new Traffic(BoxesOf(objects), [.. lines.SelectMany(l => SharedLines(l, found.Items))]));
    }

    /// <summary>Everything the Performance panel draws for one view at a setting of a run's dials (see <see cref="FrameOf"/>).</summary>
    public static Traffic TrafficAt(Model model, IdMap<LoadRun> runs, string id, IdMap<double> setting, string view) => FrameOf(model, runs, id, setting, view).Traffic;

    /// <summary>
    /// The pieces the Performance key draws for the sources, from the lines on screen now: a swatch and a name for each source that has a line, its scale and size where it has them, whether any line is
    /// scaled down to fit, and whether a line is drawn in the neutral colour (a line the run doesn't split by source). For one source it is what <see cref="SourceKeyOf"/> says.
    /// </summary>
    public static SourcesKey SourceKeyAt(IdMap<LoadRun> runs, string id, IReadOnlyList<LineTraffic> lines)
    {
        var none = new SourcesKey([], false, false);
        if (DialsOf(runs, id) is not { } found) return none;
        if (found.Mode == ModeSingle)
            return SourceKeyOf(runs[id], lines) is { } k ? new SourcesKey([new KeyedSource("", k.Name, k.Color, k.Scale, k.Bigger)], k.ScaledDown, false) : none;
        var sources = new List<KeyedSource>();
        foreach (var d in found.Items)
        {
            var mine = lines.Where(l => l.Source == d.Id).ToList();
            if (mine.Count == 0) continue;
            sources.Add(new KeyedSource(d.Id, d.Name, d.Color, mine.Any(l => l.Dots is not null) ? SourceScale(d.Source) : null, mine.Any(l => l.Radius is not null)));
        }
        return new SourcesKey(sources, lines.Any(l => l.Capped), lines.Any(l => l.Source is null));
    }
}
