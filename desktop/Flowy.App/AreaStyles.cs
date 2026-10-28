using Avalonia;
using Avalonia.Markup.Xaml;
using Avalonia.Styling;

namespace Flowy.App;

/// <summary>
/// The styles of one area of the window (the canvas, a panel, the bar), in <c>Styles/&lt;area&gt;.axaml</c>, kept on the control that holds that area
/// rather than with the app's (<c>Styles.axaml</c>). Avalonia checks every control that goes on screen against every style of its type that can reach it,
/// matching or not, so a style the canvas alone uses would otherwise cost every Border in the Explorer too. A style moves here only when the
/// classes it names are used in that area alone; one used in two areas stays in <c>Styles.axaml</c>. <c>StyleScopeTests</c> holds the areas to that.
/// An area's style beats one in <c>Styles.axaml</c> wherever either sits in its file: to override an area's style, write the override in the area's file, after it.
/// </summary>
internal static class AreaStyles
{
    /// <summary>
    /// Puts the styles of <paramref name="area"/> on <paramref name="host"/>. Each control gets a copy of its own (a set of styles has one owner); the file is compiled,
    /// and the controls that load one are made a few times at most (two rails, a canvas a pane).
    /// </summary>
    public static void Add(StyledElement host, string area) => host.Styles.Add((IStyle)AvaloniaXamlLoader.Load(new Uri($"avares://FlowyDocs/Styles/{area}.axaml")));

    /// <summary>The areas with a styles file of their own, by the control that loads it (for the tests).</summary>
    internal static readonly IReadOnlyDictionary<string, string> Hosts = new Dictionary<string, string>
    {
        ["CanvasView"] = "Canvas", ["ExplorerView"] = "Explorer", ["FailuresPanel"] = "Failures", ["PerfPanel"] = "Performance",
        ["YamlPanel"] = "Yaml", ["NavigatorPanel"] = "Navigator", ["NavRail"] = "Rail", ["SidePanel"] = "SidePanel", ["PlayerCard"] = "Player",
        ["TopBar"] = "TopBar", ["CompareBar"] = "CompareBar", ["CompareView"] = "Compare",
    };
}
