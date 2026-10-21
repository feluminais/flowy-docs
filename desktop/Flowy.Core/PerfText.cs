using System.Globalization;

namespace Flowy.Core;

/// <summary>A run's numbers in words: what gives out, and the scale of a source's dots.</summary>
public static partial class Perf
{
    private static string Pct(double n) => $"{JsCompat.Raw(JsRound(n * 100))}%";

    /// <summary>What gives out, in words: "Fleet DB at 90% of capacity", "the slowest 5% of calls go from 100 ms to 420 ms".</summary>
    private static string StruggleText(Knee k, Func<string, string> nameOf)
    {
        if (k.By is { } by) return $"{nameOf(by.Id)} {(by.Kind == "util" ? $"at {Pct(by.Share)} of capacity" : $"failing {Pct(by.Share)} of calls")}";
        return $"the slowest 5% of calls go from {JsCompat.Raw(JsRound(k.LatencyFrom!.Value))} ms to {JsCompat.Raw(JsRound(k.LatencyTo!.Value))} ms";
    }

    /// <summary>The sentence under the Performance panel's strip. <paramref name="nameOf"/> turns an object id into the name a reader sees.</summary>
    public static string KneeText(LoadRun run, Knee k, Func<string, string> nameOf) => $"First struggles at {JsCompat.Raw(k.Load)} {run.Unit}: {StruggleText(k, nameOf)}";

    /// <summary>The number in a scale, as short as it reads: 50, 0.5, 12.5, with the float noise of a division (3.0000000000000004) rounded off.</summary>
    private static string Plain(double n) => JsCompat.Raw(double.Parse(n.ToString("G6", CultureInfo.InvariantCulture), CultureInfo.InvariantCulture));

    /// <summary>
    /// "1 dot = 50 calls/s" for a run whose <c>dot</c> formula is a constant times the rate and nothing else; null for any other, because a scale in words
    /// that is not true for every line is worse than none. Also null for a scale nobody reads (under a thousandth of a call or over a billion).
    /// </summary>
    public static string? ScaleText(LoadRun run) => SourceScale(run.Source);

    /// <summary>The scale in words of one source (see <see cref="ScaleText"/>).</summary>
    private static string? SourceScale(Source? source)
    {
        if (source?.Dot is not { } dot || Formulas.LinearInRate(dot.Formula) is not { } k) return null;
        var calls = 1 / k;
        return calls >= 0.001 && calls < 1e9 ? $"1 dot = {Plain(calls)} calls/s" : null;
    }
}
