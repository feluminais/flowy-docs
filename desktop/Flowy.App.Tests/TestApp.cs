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
    public static void NoMotion() => Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1"); // a move between views is then instant, so a test needn't wait for it

    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>().UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = true });
}
