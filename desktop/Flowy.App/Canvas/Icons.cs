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

    // The controls: Tabler's arrows, files, pencil and so on, and four of our own (Grid, Fit, Explorer, Info).
    public const string Home = "M5 12l-2 0l9 -9l9 9l-2 0M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6";
    public const string ChevronRight = "M9 6l6 6l-6 6";
    public const string ArrowRight = "M5 12l14 0M15 16l4 -4M15 8l4 4";
    public const string ArrowLeft = "M5 12l14 0M5 12l4 4M5 12l4 -4";
    public const string File = "M14 3v4a1 1 0 0 0 1 1h4M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z";
    public const string Folder = "M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2";
    public const string Code = "M7 8l-4 4l4 4M17 8l4 4l-4 4M14 4l-4 16";
    public const string Text = "M4 6l16 0M4 12l10 0M4 18l14 0";
    public const string Table = "M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14zM3 10h18M10 3v18";
    public const string Clock = "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0M12 7v5l3 3";
    public const string Pencil = "M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4M13.5 6.5l4 4";
    public const string Plus = "M12 5l0 14M5 12l14 0";
    public const string Minus = "M5 12l14 0";
    public const string Undo = "M9 14l-4 -4l4 -4M5 10h11a4 4 0 1 1 0 8h-1";
    public const string Redo = "M15 14l4 -4l-4 -4M19 10h-11a4 4 0 1 0 0 8h1";
    public const string Search = "M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0M21 21l-6 -6";
    // The three kinds of group: a repeat, a branch (one of several lanes) and parallel lanes.
    public const string Repeat = "M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3";
    public const string GitFork = "M12 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M7 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M17 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M7 8v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2 -2v-2M12 12l0 4";
    public const string ArrowsSplit = "M21 17h-8l-3.5 -5h-6.5M21 7h-8l-3.495 5";

    // What names a state (see StateMarks.cs): an arc that spins coming up, an hourglass shutting down, a power symbol when off, a circling arrow restarting, and the alert triangle when not well.
    public const string Loader = "M12 3a9 9 0 1 0 9 9";
    public const string Hourglass = "M6.5 7h11M6.5 17h11M6 20v-2a6 6 0 1 1 12 0v2a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1zM6 4v2a6 6 0 1 0 12 0v-2a1 1 0 0 0 -1 -1h-10a1 1 0 0 0 -1 1z";
    public const string Power = "M7 6a7.75 7.75 0 1 0 10 0M12 4l0 8";
    public const string Refresh = "M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4";

    /// <summary>The glyph of a state. Running has none, since it draws nothing.</summary>
    public static string ForState(string state) => state switch { "starting" => Loader, "stopping" => Hourglass, "stopped" => Power, "restarting" => Refresh, _ => Alert };

    /// <summary>The icon of a kind of group: repeat, branch or parallel.</summary>
    public static string ForKind(string? kind) => kind switch { "repeat" => Repeat, "branch" => GitFork, _ => ArrowsSplit };

    public const string Help = "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0M12 17l0 .01M12 13.5a1.5 1.5 0 0 1 1 -1.5a2.6 2.6 0 1 0 -3 -4";
    public const string Route = "M6 19m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M18 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M12 19h4.5a3.5 3.5 0 0 0 0 -7h-8a3.5 3.5 0 0 1 0 -7h3.5";
    public const string Grid = "M4 4h6v6h-6zM14 4h6v6h-6zM4 14h6v6h-6zM14 14h6v6h-6z";
    public const string Alert = "M12 9v4M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0zM12 16h.01";
    public const string Trash = "M4 7l16 0M10 11l0 6M14 11l0 6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3";
    public const string Play = "M7 4v16l13 -8z";
    public const string Keyboard = "M2 6m0 2a2 2 0 0 1 2 -2h16a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2zM6 10l0 .01M10 10l0 .01M14 10l0 .01M18 10l0 .01M6 14l0 .01M18 14l0 .01M10 14l4 .01";
    public const string Close = "M18 6l-12 12M6 6l12 12";
    public const string ArrowUp = "M12 5l0 14M18 11l-6 -6M6 11l6 -6";
    public const string ArrowDown = "M12 5l0 14M18 13l-6 6M6 13l6 6";
    public const string Check = "M5 12l5 5l10 -10";
    public const string Copy = "M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667zM4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1";
    public const string Fit = "M4 9v-3a2 2 0 0 1 2 -2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1 -2 2h-3M9 20h-3a2 2 0 0 1 -2 -2v-3";

    // What runs through a step's pipe (Mail, Bolt, Bell), and the player's Pause and Reload.
    public const string Mail = "M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10zM3 7l9 6l9 -6";
    public const string Bolt = "M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11";
    public const string Bell = "M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6M9 17v1a3 3 0 0 0 6 0v-1";
    public const string Pause = "M6 5m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1zM14 5m0 1a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1z";
    public const string Reload = "M19.933 13.041a8 8 0 1 1 -9.925 -8.788c3.899 -1.002 7.935 1.007 9.425 4.747M20 4v5h-5";
    // The rail's Details and Explorer icons: Details is an i in a rounded square, drawn to stay sharp at 18 pixels.
    public const string Info = "M5.5 3h13a2.5 2.5 0 0 1 2.5 2.5v13a2.5 2.5 0 0 1 -2.5 2.5h-13a2.5 2.5 0 0 1 -2.5 -2.5v-13a2.5 2.5 0 0 1 2.5 -2.5zM12 7.5h.01M12 11.5v5";
    public const string Activity = "M3 12h4l3 8l4 -16l3 8h4";
    // Our own, drawn for the rail: a folder with what is in it hanging below, and an i with no serifs, which stays sharp at 18 pixels.
    public const string Explorer = "M4 3h4l2 2h9a2 2 0 0 1 2 2v2a2 2 0 0 1 -2 2h-15a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2zM7 11v9.5h3M7 15.5h3M13 15.5h8M13 20.5h8";
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
