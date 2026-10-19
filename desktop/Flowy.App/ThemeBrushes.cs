using Avalonia;
using Avalonia.Media;
using Avalonia.Styling;

namespace Flowy.App;

/// <summary>
/// Brushes for colours a model picks itself (<c>color:</c> on an object), which Styles.axaml can't hold. A colour has a light and a dark
/// form, and one brush per (light, dark, opacity) is shared and recoloured when the app's theme changes, so the controls that use it follow.
/// </summary>
internal static class ThemeBrushes
{
    private static readonly Dictionary<(string Light, string Dark, double Opacity), SolidColorBrush> Cache = [];
    private static bool _watching;

    private static bool IsDark => Application.Current?.ActualThemeVariant == ThemeVariant.Dark;

    private static Color Pick(string light, string dark) => Color.Parse(IsDark ? dark : light);

    public static IBrush For(string light, string dark, double opacity = 1)
    {
        if (!_watching && Application.Current is { } app)
        {
            _watching = true;
            app.ActualThemeVariantChanged += (_, _) =>
            {
                foreach (var ((l, d, _), brush) in Cache) brush.Color = Pick(l, d);
            };
        }
        var key = (light, dark, opacity);
        if (!Cache.TryGetValue(key, out var brush)) Cache[key] = brush = new SolidColorBrush(Pick(light, dark), opacity);
        return brush;
    }
}
