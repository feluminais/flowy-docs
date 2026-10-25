using System.Globalization;

namespace Flowy.Core;

/// <summary>
/// Everything a run can measure. On an object: util, queue, errors. On a connection or overall: rate, bytes (a call's size), p50, p95, errors. A missing number
/// means "not measured", never zero. A port of <c>Metrics</c> in src/core/perf/types.ts.
/// </summary>
public record Metrics
{
    public double? Util { get; init; }

    public double? Queue { get; init; }

    public double? Errors { get; init; }

    public double? Rate { get; init; }

    public double? Bytes { get; init; }

    public double? P50 { get; init; }

    public double? P95 { get; init; }

    public double? this[string key] => key switch { "util" => Util, "queue" => Queue, "errors" => Errors, "rate" => Rate, "bytes" => Bytes, "p50" => P50, "p95" => P95, _ => null };

    internal Metrics With(string key, double? value) => key switch
    {
        "util" => this with { Util = value },
        "queue" => this with { Queue = value },
        "errors" => this with { Errors = value },
        "rate" => this with { Rate = value },
        "bytes" => this with { Bytes = value },
        "p50" => this with { P50 = value },
        "p95" => this with { P95 = value },
        _ => this,
    };

    /// <summary>Whether no number was measured.</summary>
    public bool IsEmpty => Util is null && Queue is null && Errors is null && Rate is null && Bytes is null && P50 is null && P95 is null;
}

/// <summary>
/// What one connection measured, or one line in a view once connections are rolled up. <c>Failure</c> is how its failing share fails when it says (lost or rejected).
/// <c>By</c> splits what the line carries between the sources of a run that has several: each source's own rate, bytes, p50 and errors. Null for a line that doesn't say.
/// </summary>
public sealed record Pair(string From, string To) : Metrics
{
    public string? Failure { get; init; }

    public IdMap<Metrics>? By { get; init; }
}

/// <summary>
/// What was measured at one load (or one time). A run tested with several sources has no single load: its levels carry <c>Loads</c>, a load for each source (and <c>Load</c> is 0,
/// unused). The level of a run with several sources at a setting has <c>Loads</c> too, as the setting it was worked out at.
/// </summary>
public sealed record Level(double Load, Metrics Overall, IdMap<Metrics> Objects, IReadOnlyList<Pair> Connections)
{
    public IdMap<double>? Loads { get; init; }
}

/// <summary>
/// One of the sources of a run that was tested with several at once: a name, the unit of its load, the shape its requests enter at, and how to draw them
/// (the colour and the two formulas of a single run's <c>source:</c>, kept as a <see cref="Source"/>).
/// </summary>
public sealed record SourceInfo(string Name, string? Entry, string Unit, Source? Source);

/// <summary>A formula as the run wrote it, with the formula that text reads as (a text that does not read is no <see cref="SourceFormula"/>). The text is the wire format: perf.ts keeps only the text, and the run travels to the browser as JSON.</summary>
public sealed record SourceFormula(string Text, Formula Formula);

/// <summary>Where a run's requests come from, and how to draw them: the dots' colour, and formulas for how many dots a line shows at once and for the area of a dot. Every part is optional.</summary>
public sealed record Source(string? Color = null, SourceFormula? Dot = null, SourceFormula? Size = null);

/// <summary>Something that happens at a time in a time run: a shape goes into a state. <c>Text</c> is empty when the run doesn't say; <see cref="Perf.EventText"/> then words it.</summary>
public sealed record RunEvent(double At, string On, string State, string Text);

/// <summary>
/// A load test, summarised, or a run measured over time (<c>Run</c> in perf.ts; renamed because the app already has things called Run). A time run says so
/// (<c>IsTime</c>) and may have events; its levels keep their time in <c>Load</c>, as in perf.ts. A load run has neither, as before time runs existed.
/// </summary>
public sealed record LoadRun(string Name, string? About, string Unit, string? Entry, IReadOnlyList<Level> Levels, Source? Source = null)
{
    public bool IsTime { get; init; }

    /// <summary>The run this one compares with, or null when the file has no readable <c>compare</c>. Whether that run exists is for <see cref="Perf.CheckRuns"/>.</summary>
    public CompareTag? Compare { get; init; }

    /// <summary>The ids of the runs this run adds (and it has no levels of its own), or null. Read what a run means through <see cref="Perf.DialsOf"/>, never from this.</summary>
    public IReadOnlyList<string>? Adds { get; init; }

    /// <summary>The sources of a run tested together, in the order they are listed, or null.</summary>
    public IdMap<SourceInfo>? Sources { get; init; }

    /// <summary>The events in time order (later in the file last among those at one time). None for a load run.</summary>
    public IReadOnlyList<RunEvent> Events { get; init; } = [];
}

/// <summary>How strained an object is: 0 to 1, whether its utilisation or its failures decided it, and the raw share that did.</summary>
public sealed record Strain(double Value, string By, double Share);

/// <summary>What decided a knee: the object that is worst, and why.</summary>
public sealed record KneeBy(string Id, string Kind, double Share);

/// <summary>
/// Where a run first struggles: a tested level, and either the object worst there (<see cref="By"/>) or, with none to blame, the latency (<see cref="LatencyFrom"/> to <see cref="LatencyTo"/>).
/// A run with several sources has no single load: its knee is a step of the sources rising together (<c>Index</c>) and <c>Setting</c> says where each stood (<c>Load</c> is 0).
/// </summary>
public sealed record Knee(int Index, double Load, KneeBy? By, double? LatencyFrom = null, double? LatencyTo = null)
{
    public IdMap<double>? Setting { get; init; }
}

public sealed record BoxTraffic(double? Strain, int Queue);

/// <summary>
/// How a line looks: how thick, how many particles a second, how long one takes to cross (ms), and the share of them that fail. What a run's source adds
/// is null (or false) when it adds nothing: <c>Color</c> as written, <c>Radius</c> times the usual dot's, <c>Capped</c> when the count was scaled down to fit the
/// screen, <c>Failure</c> how the failing share fails, <c>Dots</c> how many are on the line at once once the formula and the cap have decided.
/// </summary>
public sealed record LineTraffic(string From, string To, double Width, double PerSecond, int TravelMs, double Failed)
{
    public string? Color { get; init; }

    public double? Radius { get; init; }

    public bool Capped { get; init; }

    public string? Failure { get; init; }

    public double? Dots { get; init; }

    /// <summary>The dial this entry is for, when several sources share the line; null for a run with one.</summary>
    public string? Source { get; init; }

    /// <summary>How far from the middle of the line its dots run, in steps of a dot's width, when several sources share it.</summary>
    public double? Offset { get; init; }

    /// <summary>How busy the stripes moving along the line are, 0 to 1, for the calls a second it carries; null when it has none to show.</summary>
    public double? Stripes { get; init; }

    /// <summary>Whether the run gives the line nothing to show: it has plain stripes at a middling pace.</summary>
    public bool Bare { get; init; }
}

/// <summary>The pieces the Performance key draws for a run's source (see <see cref="Perf.SourceKeyOf"/>).</summary>
public sealed record SourceKey(string Name, string? Color, string? Scale, bool Bigger, bool ScaledDown);

public sealed record Traffic(IdMap<BoxTraffic> Boxes, IReadOnlyList<LineTraffic> Lines);

/// <summary>
/// A run at one load as one view draws it: what each object and line reads, and the traffic made from that. Worked out once, so the canvas and the
/// panel's readouts share it instead of each interpolating and rolling the run up again.
/// </summary>
public sealed record LoadFrame(IdMap<Metrics> Objects, IReadOnlyList<Pair> Lines, Traffic Traffic)
{
    /// <summary>An object's numbers, or null when nothing was measured on it.</summary>
    public Metrics? Box(string id) => Objects.TryGetValue(id, out var m) ? m : null;

    /// <summary>The numbers of the line the view draws between two shapes, given either way, or null when none was measured.</summary>
    public Pair? Line(string from, string to) => Lines.FirstOrDefault(p => Views.LineKey(p.From, p.To) == Views.LineKey(from, to));
}
