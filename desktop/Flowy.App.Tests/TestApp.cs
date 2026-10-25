using System.Runtime.CompilerServices;
using Avalonia;
using Avalonia.Headless;
using Flowy.App;

[assembly: AvaloniaTestApplication(typeof(Flowy.App.Tests.TestApp))]

namespace Flowy.App.Tests;

/// <summary>The real application's styles and resources, on Avalonia's headless platform: no window on screen, but real layout, input and rendering logic.</summary>
public static class TestApp
{
    [ModuleInitializer]
    public static void NoMotion()
    {
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1"); // a move between views is then instant, so a test needn't wait for it
        Flowy.App.Canvas.Anim.WaitsOnFrames = true; // and a pause between steps is made of frames, which a test can pump
    }

    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>().UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = true });

    /// <summary>The flow card after a layout pass: most of the card sits in a scroll box, which makes its content only when it is measured.</summary>
    internal static PlayerCard Laid(this PlayerCard card)
    {
        card.UpdateLayout();
        return card;
    }
}
