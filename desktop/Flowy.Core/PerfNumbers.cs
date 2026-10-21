namespace Flowy.Core;

/// <summary>
/// Load-test runs, read and played back. A port of src/core/perf.ts, kept equal to it by the fixtures in desktop/fixtures/perf.ts: a run
/// is parsed the same way (and its problems worded the same), and between two tested levels the numbers are interpolated and never predicted.
/// This part holds the small number helpers the others share; the rest is in PerfParse, PerfCheck, PerfAnalyse, PerfRollUp, PerfKnee, PerfText, PerfTraffic and PerfSources.
/// </summary>
public static partial class Perf
{
    /// <summary>JavaScript's <c>Math.round</c>: halves go up, where .NET's goes to even.</summary>
    public static double JsRound(double x) => Math.Floor(x + 0.5);

    private static double Clamp(double n, double lo, double hi) => Math.Min(hi, Math.Max(lo, n));

    private static double Round2(double n) => JsRound(n * 100) / 100;
}
