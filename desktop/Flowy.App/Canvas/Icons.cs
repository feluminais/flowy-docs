using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Media;
using Path = Avalonia.Controls.Shapes.Path;

namespace Flowy.App.Canvas;

/// <summary>
/// Icons from Tabler Icons, https://tabler.io/icons. MIT License, Copyright (c) 2020-2024 Paweł Kuna. The notice ships as
/// Assets/TABLER-ICONS-LICENSE.txt next to the program. Each is drawn on a 24-unit grid with a 2-unit round stroke.
/// </summary>
internal static class Icons
{
    public const string User = "M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2";
    public const string Cube = "M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5M12 12l8 -4.5M12 12l0 9M12 12l-8 -4.5";
    public const string AppWindow = "M3 5m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2zM6 8h.01M9 8h.01";
    public const string Database = "M12 6m-8 0a8 3 0 1 0 16 0a8 3 0 1 0 -16 0M4 6v6a8 3 0 0 0 16 0v-6M4 12v6a8 3 0 0 0 16 0v-6";
    public const string Puzzle = "M4 7h3a1 1 0 0 0 1 -1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0 -1 1v3a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-1a2 2 0 0 0 -4 0v1a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h1a2 2 0 0 0 0 -4h-1a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1";
    public const string Cloud = "M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 1.927 -1.551 3.487 -3.465 3.487h-11.878";
    public const string ZoomIn = "M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0M7 10l6 0M10 7l0 6M21 21l-6 -6";

    /// <summary>The icon for an object type; a type nobody knows gets the system's.</summary>
    public static string ForType(string? type) => type switch
    {
        "actor" => User,
        "app" => AppWindow,
        "store" => Database,
        "component" => Puzzle,
        _ => Cube,
    };

    /// <summary>An icon at <paramref name="size"/>; <paramref name="cssClass"/> picks its stroke colour in Styles.axaml.</summary>
    public static Control Make(string data, string cssClass, double size)
    {
        var path = new Path { Data = Geometry.Parse(data) };
        path.Classes.Add(cssClass);
        // A Viewbox scales the 24-unit grid, stroke included, so the line stays as thick as in the browser's SVG.
        return new Viewbox { Width = size, Height = size, Child = new Avalonia.Controls.Canvas { Width = 24, Height = 24, Children = { path } } };
    }
}
