using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Flowy.Core;
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

    // The controls: Tabler's arrows, files, pencil and so on, and two of our own (Grid, Fit).
    public const string Home = "M5 12l-2 0l9 -9l9 9l-2 0M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6";
    public const string ChevronRight = "M9 6l6 6l-6 6";
    public const string ArrowRight = "M5 12l14 0M15 16l4 -4M15 8l4 4";
    public const string ArrowLeft = "M5 12l14 0M5 12l4 4M5 12l4 -4";
    public const string File = "M14 3v4a1 1 0 0 0 1 1h4M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z";
    public const string Folder = "M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2";
    public const string Code = "M7 8l-4 4l4 4M17 8l4 4l-4 4M14 4l-4 16";
    public const string Text = "M4 6l16 0M4 12l10 0M4 18l14 0";
    public const string Pencil = "M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4M13.5 6.5l4 4";
    public const string Plus = "M12 5l0 14M5 12l14 0";
    public const string Minus = "M5 12l14 0";
    public const string Undo = "M9 14l-4 -4l4 -4M5 10h11a4 4 0 1 1 0 8h-1";
    public const string Redo = "M15 14l4 -4l-4 -4M19 10h-11a4 4 0 1 0 0 8h1";
    public const string Search = "M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0M21 21l-6 -6";
    public const string Route = "M6 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M18 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M12 19h4.5a3.5 3.5 0 0 0 0 -7h-8a3.5 3.5 0 0 1 0 -7h3.5";
    public const string Grid = "M4 4h6v6h-6zM14 4h6v6h-6zM4 14h6v6h-6zM14 14h6v6h-6z";
    public const string Alert = "M12 9v4M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0zM12 16h.01";
    public const string Trash = "M4 7l16 0M10 11l0 6M14 11l0 6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3";
    public const string Play = "M7 4v16l13 -8z";
    public const string Help = "M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M12 17l0 .01M12 13.5a1.5 1.5 0 0 1 1 -1.5a2.6 2.6 0 1 0 -3 -4";
    public const string Close = "M18 6l-12 12M6 6l12 12";
    public const string ArrowUp = "M12 5l0 14M18 11l-6 -6M6 11l6 -6";
    public const string ArrowDown = "M12 5l0 14M18 13l-6 6M6 13l6 6";
    public const string Check = "M5 12l5 5l10 -10";
    public const string Fit = "M4 9v-3a2 2 0 0 1 2 -2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1 -2 2h-3M9 20h-3a2 2 0 0 1 -2 -2v-3";
    public const string Link = "M9 15l6 -6M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463";

    /// <summary>The heading icon of an object's look (shape, colour, icon).</summary>
    public static string Sparkles => LookData.Icons["sparkles"];

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
    public static Control Make(string data, string cssClass, double size) => Make(data, cssClass, size, out _);

    /// <summary>The same, with the path it draws, for a caller that colours it itself (an object that names a colour).</summary>
    public static Control Make(string data, string cssClass, double size, out Path path)
    {
        // A model's own icons are checked to be path data, but not to parse; one that doesn't draws nothing.
        Geometry geometry;
        try
        {
            geometry = Geometry.Parse(data);
        }
        catch (Exception e) when (e is FormatException or ArgumentException or InvalidOperationException)
        {
            geometry = new StreamGeometry();
        }
        path = new Path { Data = geometry };
        path.Classes.Add(cssClass);
        // A Viewbox scales the 24-unit grid, stroke included, so the line stays as thick as in the browser's SVG.
        return new Viewbox { Width = size, Height = size, Child = new Avalonia.Controls.Canvas { Width = 24, Height = 24, Children = { path } } };
    }
}
