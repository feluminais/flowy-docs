using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Styling;

namespace Flowy.App;

/// <summary>
/// Reading the theme: a brush from Styles.axaml by key, and whether the dark theme is showing. A control asks for its own theme variant,
/// which is where a panel set to one theme differs from the app; the <c>App</c> forms ask the application.
/// </summary>
internal static class AppTheme
{
    /// <summary>The brush for <paramref name="key"/> in the theme <paramref name="control"/> shows (grey when there is none).</summary>
    public static IBrush Brush(Control control, string key) =>
        control.TryFindResource(key, control.ActualThemeVariant, out var found) && found is IBrush brush ? brush : Brushes.Gray;

    /// <summary>The brush for <paramref name="key"/> in the application's theme (grey when there is none).</summary>
    public static IBrush AppBrush(string key) =>
        Application.Current is { } app && app.TryFindResource(key, app.ActualThemeVariant, out var found) && found is IBrush brush ? brush : Brushes.Gray;

    /// <summary>Whether <paramref name="control"/> shows the dark theme.</summary>
    public static bool IsDark(Control control) => control.ActualThemeVariant == ThemeVariant.Dark;

    /// <summary>Whether the application shows the dark theme.</summary>
    public static bool AppIsDark => Application.Current?.ActualThemeVariant == ThemeVariant.Dark;
}

/// <summary>The fonts the app draws with.</summary>
internal static class Fonts
{
    /// <summary>For code, ids and paths. The first of these that the machine has.</summary>
    public static readonly FontFamily Mono = new("Cascadia Mono, Consolas, Menlo, monospace");
}
