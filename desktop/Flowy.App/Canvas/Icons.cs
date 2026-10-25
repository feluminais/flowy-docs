using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Flowy.Core;
using Avalonia.Media;
using Path = Avalonia.Controls.Shapes.Path;

namespace Flowy.App.Canvas;

/// <summary>Quiet controls use Lucide 1.17.0 (ISC); model and animation icons use Tabler (MIT). Both licence notices ship with the app.</summary>
internal static class Icons
{
    public const string User = "M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2";
    public const string Cube = "M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5M12 12l8 -4.5M12 12l0 9M12 12l-8 -4.5";
    public const string AppWindow = "M3 5m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2zM6 8h.01M9 8h.01";
    public const string Database = "M12 6m-8 0a8 3 0 1 0 16 0a8 3 0 1 0 -16 0M4 6v6a8 3 0 0 0 16 0v-6M4 12v6a8 3 0 0 0 16 0v-6";
    public const string Puzzle = "M4 7h3a1 1 0 0 0 1 -1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0 -1 1v3a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-1a2 2 0 0 0 -4 0v1a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1h1a2 2 0 0 0 0 -4h-1a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1";
    public const string Cloud = "M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 1.927 -1.551 3.487 -3.465 3.487h-11.878";
    public const string ZoomIn = "M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0M7 10l6 0M10 7l0 6M21 21l-6 -6";

    // Controls share the Quiet set's 1.4-unit rounded stroke on a 24-unit grid.
    public const string Workflow = "M5 3h4a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-4a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2zM7 11v4a2 2 0 0 0 2 2h4M15 13h4a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-4a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2z";
    public const string StepForward = "M10.029 4.285A2 2 0 0 0 7 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432zM3 4v16";
    public const string StepBack = "M13.971 4.285A2 2 0 0 1 17 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432zM21 20V4";
    public const string Home = "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";
    public const string ChevronRight = "M0 0m9 18 6-6-6-6";
    public const string ArrowRight = "M5 12h14M0 0m12 5 7 7-7 7";
    public const string ArrowLeft = "M0 0m12 19-7-7 7-7M19 12H5";
    public const string File = "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2zM14 2v5a1 1 0 0 0 1 1h5";
    public const string Folder = "M0 0m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2";
    public const string Tag = "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42zM7 7.5a.5.5 0 1 0 1 0a.5.5 0 1 0 -1 0";
    public const string Code = "M0 0m18 16 4-4-4-4M0 0m6 8-4 4 4 4M0 0m14.5 4-5 16";
    public const string Text = "M21 5H3M15 12H3M17 19H3";
    public const string Table = "M3 5a9 3 0 1 0 18 0a9 3 0 1 0 -18 0M3 5V19A9 3 0 0 0 21 19V5M3 12A9 3 0 0 0 21 12";
    public const string Clock = "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0M12 7v5l3 3";
    public const string Pencil = "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM0 0m15 5 4 4";
    public const string Plus = "M5 12h14M12 5v14";
    public const string Minus = "M5 12h14";
    public const string Undo = "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11";
    public const string Redo = "M0 0m15 14 5-5-5-5M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13";
    public const string Search = "M0 0m21 21-4.34-4.34M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0";
    // The three kinds of group: a repeat, a branch (one of several lanes) and parallel lanes.
    public const string Repeat = "M0 0m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M0 0m7 22-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3";
    public const string GitFork = "M9 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M3 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M15 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9M12 12v3";
    public const string ArrowsSplit = "M16 3h5v5M8 3H3v5M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3M0 0m15 9 6-6";

    // What names a state (see StateMarks.cs): an arc that spins coming up, an hourglass shutting down, a power symbol when off, a circling arrow restarting, and the alert triangle when not well.
    public const string Loader = "M12 3a9 9 0 1 0 9 9";
    public const string Hourglass = "M6.5 7h11M6.5 17h11M6 20v-2a6 6 0 1 1 12 0v2a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1zM6 4v2a6 6 0 1 0 12 0v-2a1 1 0 0 0 -1 -1h-10a1 1 0 0 0 -1 1z";
    public const string Power = "M7 6a7.75 7.75 0 1 0 10 0M12 4l0 8";
    public const string Refresh = "M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4";

    /// <summary>The glyph of a state. Running has none, since it draws nothing.</summary>
    public static string ForState(string state) => state switch { "starting" => Loader, "stopping" => Hourglass, "stopped" => Power, "restarting" => Refresh, _ => Alert };

    /// <summary>The icon of a kind of group: repeat, branch or parallel.</summary>
    public static string ForKind(string? kind) => kind switch { "repeat" => Repeat, "branch" => GitFork, _ => ArrowsSplit };

    public const string Help = "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01";
    public const string Route = "M3 19a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15M15 5a3 3 0 1 0 6 0a3 3 0 1 0 -6 0";
    public const string Grid = "M4 4h6v6h-6zM14 4h6v6h-6zM4 14h6v6h-6zM14 14h6v6h-6z";
    public const string Alert = "M0 0m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01";
    public const string Trash = "M10 11v6M14 11v6M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2";
    public const string Play = "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z";
    public const string Keyboard = "M10 8h.01M12 12h.01M14 8h.01M16 12h.01M18 8h.01M6 8h.01M7 16h10M8 12h.01M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2z";
    public const string Close = "M18 6 6 18M0 0m6 6 12 12";
    public const string ArrowUp = "M0 0m5 12 7-7 7 7M12 19V5";
    public const string ArrowDown = "M12 5v14M0 0m19 12-7 7-7-7";
    public const string Check = "M20 6 9 17l-5-5";
    public const string Copy = "M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2zM4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2";
    public const string Fit = "M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3";

    // What runs through a step's pipe (Mail, Bolt, Bell), and the player's Pause and Reload.
    public const string Mail = "M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10zM3 7l9 6l9 -6";
    public const string Bolt = "M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11";
    public const string Bell = "M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6M9 17v1a3 3 0 0 0 6 0v-1";
    public const string Pause = "M15 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1zM6 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1z";
    public const string Reload = "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5";
    public const string Info = "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0M12 16v-4M12 8h.01";
    // The YAML tab: a file with code on it, and the lock that says it is read only (the browser's FileCode and Lock).
    public const string FileCode = "M4 12.15V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2h-3.35M14 2v5a1 1 0 0 0 1 1h5M0 0m5 16-3 3 3 3M0 0m9 22 3-3-3-3";
    public const string Lock = "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-7a2 2 0 0 1 2 -2zM7 11V7a5 5 0 0 1 10 0v4";
    public const string Activity = "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2";
    public const string Explorer = "M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1ZM20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1ZM3 5a2 2 0 0 0 2 2h3M3 3v13a2 2 0 0 0 2 2h3";
    public const string Link = "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71";
    // Compare: two panes side by side, and the arrows that put them on each other's side.
    public const string Columns = "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2zM12 3v18";
    public const string ArrowsLeftRight = "M0 0m8 3-4 4 4 4M4 7h16M0 0m16 21 4-4-4-4M20 17H4";

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
