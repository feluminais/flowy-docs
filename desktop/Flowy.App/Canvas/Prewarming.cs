namespace Flowy.App.Canvas;

/// <summary>Whether <see cref="CanvasView.Prewarm"/> does anything. The tests turn it off: every reader they make would otherwise leave idle work for the tests after it.</summary>
internal static class Prewarming
{
    public static bool On { get; set; } = true;
}
