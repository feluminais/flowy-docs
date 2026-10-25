using Flowy.Core;

namespace Flowy.App.Canvas;

/// <summary>How the Used by panel marks a shape: it is about to be deleted, a row in focus names it, or neither.</summary>
internal enum UsedMark { None, Going, Flagged }

/// <summary>How a shape or a line shows a picked failure mode: it fails, it is hurt by it, it is faded, or nothing is picked.</summary>
internal enum FailLight { None, Fails, Affects, Dim }

/// <summary>
/// What the Failures tab draws on the canvas: the badges (by box id and by line key, rolled up to what the view draws) and, for a picked mode, what to light
/// (<see cref="Failures.LightFor"/>), with everything else faded. What fails is outlined in the colour of the picked mode's band (<see cref="LitBand"/>).
/// </summary>
internal sealed record FailureOverlay(IReadOnlyDictionary<string, FailureMark> Boxes, IReadOnlyDictionary<string, FailureMark> Lines, Reach? Lit, RiskBand LitBand = RiskBand.High)
{
    /// <summary>How a shape is lit: its part of the picked mode fails, it is hurt by it, or it is faded. None when no mode is picked.</summary>
    public FailLight LightOfBox(string id) =>
        Lit is null ? FailLight.None : Lit.Fails.Contains(id) ? FailLight.Fails : Lit.Affects.Contains(id) ? FailLight.Affects : FailLight.Dim;

    /// <summary>How a line is lit: it is the picked mode's line, or faded. A line is never only hurt.</summary>
    public FailLight LightOfLine(string from, string to) =>
        Lit is null ? FailLight.None : Lit.FailsLine == Failures.LineKey(from, to) ? FailLight.Fails : FailLight.Dim;

    /// <summary>The overlay for one view: the marks the analysis rolls up to it, and what a picked mode lights in it (null for none picked, or one the view cannot light).</summary>
    public static FailureOverlay For(Model model, FailureAnalysis analysis, string view, FailureMode? mode)
    {
        var marks = Failures.RollUp(model, analysis, view);
        return new FailureOverlay(marks.Boxes, marks.Lines, mode is null ? null : Failures.LightFor(model, view, mode), mode is null ? RiskBand.High : Failures.BandOf(mode));
    }
}
