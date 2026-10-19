using System.Globalization;
using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>
/// How an object is drawn and which icon it carries: shape, colour, opacity, icon. A port of src/core/look.ts with the same rules and the same
/// wording; the tables themselves (shapes, named colours, built-in icons) are <see cref="LookData"/>, generated from the TypeScript ones.
/// </summary>
public static partial class Look
{
    /// <summary>The shapes in the order the pickers and the guide list them.</summary>
    public static IEnumerable<string> ShapeNames => LookData.Shapes.Keys;

    public static IEnumerable<string> ColorNames => LookData.Colors.Keys;

    public static bool IsShape(string? v) => v is not null && LookData.Shapes.ContainsKey(v);

    /// <summary>What the object draws as: the shape it names, else the type's (actors as pills, stores as cylinders, the rest as rectangles).</summary>
    public static string ShapeOf(FlowyObject o) =>
        IsShape(o.Shape) ? o.Shape! : o.Type switch { "actor" => "pill", "store" => "cylinder", _ => "rectangle" };

    public static ShapeDef DefOf(FlowyObject o) => LookData.Shapes[ShapeOf(o)];

    public static bool IsColorName(string? v) => v is not null && LookData.Colors.ContainsKey(v);

    [GeneratedRegex(@"^#(?:[0-9a-f]{3}|[0-9a-f]{6})\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Hex();

    public static bool IsColor(string? v) => IsColorName(v) || (v is not null && Hex().IsMatch(v));

    [GeneratedRegex(@"^(?:100|[1-9]?[0-9])\z", RegexOptions.CultureInvariant)]
    private static partial Regex Percent();

    /// <summary>Whole percent, 0 to 100, no sign, no leading zero.</summary>
    public static bool IsOpacity(string? v) => v is not null && Percent().IsMatch(v);

    /// <summary>A colour as [light, dark] #rrggbb, or null when it isn't one. A hex colour is the same in both themes.</summary>
    public static (string Light, string Dark)? ColorPair(string? color)
    {
        if (IsColorName(color)) return (LookData.Colors[color!][0], LookData.Colors[color!][1]);
        if (color is null || !Hex().IsMatch(color)) return null;
        var hex = color.Length == 4 ? "#" + string.Concat(color.Skip(1).Select(c => $"{c}{c}")) : color;
        hex = hex.ToLowerInvariant();
        return (hex, hex);
    }

    /// <summary>How much of the colour the fill holds, in percent: what <c>opacity:</c> says, else 15 once a colour is set, else 0 (the plain surface).</summary>
    public static int FillOpacity(FlowyObject o) => IsOpacity(o.Opacity) ? int.Parse(o.Opacity!, CultureInfo.InvariantCulture) : IsColor(o.Color) ? 15 : 0;

    /// <summary>What an icon name may look like, worded to follow "icon names".</summary>
    public const string IconNameRule = "use lowercase letters, digits and dashes, not starting with a dash";

    [GeneratedRegex(@"^[a-z0-9][a-z0-9-]*\z", RegexOptions.CultureInvariant)]
    private static partial Regex IconName();

    public static bool IsIconName(string name) => IconName().IsMatch(name);

    [GeneratedRegex(@"^[ \t\n\r\f\v]*[Mm]", RegexOptions.CultureInvariant)]
    private static partial Regex PathStart();

    [GeneratedRegex(@"^[MmLlHhVvCcSsQqTtAaZz0-9 \t\n\r\f\v,.+\-eE]+\z", RegexOptions.CultureInvariant)]
    private static partial Regex PathChars();

    /// <summary>SVG path data a custom icon may hold: path commands and numbers only, on the 24×24 grid, kept short.</summary>
    public static bool IsPathData(object? d) => d is string s && s.Length <= 4000 && PathStart().IsMatch(s) && PathChars().IsMatch(s);

    /// <summary>Why <c>icons: { name: d }</c> can't be used, or null when it can. Worded to follow "icon &lt;name&gt;:".</summary>
    public static string? IconProblem(string name, object? d)
    {
        if (!IsIconName(name)) return $"names {IconNameRule}";
        if (LookData.Icons.ContainsKey(name)) return "is a built-in icon, so pick another name";
        if (!IsPathData(d)) return "must be SVG path data (commands like M, L, C, A and Z, on a 24×24 grid, at most 4000 characters)";
        return null;
    }

    /// <summary>The model's own icons: the well-formed entries of <c>icons:</c> in model.yaml. The checks report the rest.</summary>
    public static Dictionary<string, string> CustomIcons(IReadOnlyDictionary<string, object?> meta)
    {
        var result = new Dictionary<string, string>();
        if (meta.TryGetValue("icons", out var icons) && icons is OrderedDictionary<string, object?> map)
            foreach (var (name, d) in map)
                if (IconProblem(name, d) is null) result[name] = (string)d!;
        return result;
    }

    /// <summary>Whether an icon name is a built-in or one the model defines.</summary>
    public static bool IsKnownIcon(IReadOnlyDictionary<string, object?> meta, string? name) =>
        name is not null && (LookData.Icons.ContainsKey(name) || CustomIcons(meta).ContainsKey(name));

    /// <summary>The colour an object has when it names none: its type's, or grey for an outside service.</summary>
    public static string TypeColor(FlowyObject o) =>
        o.External == "true" ? "gray" : o.Type switch { "actor" => "purple", "app" => "teal", "store" => "pink", "component" => "orange", _ => "blue" };

    private static readonly Dictionary<string, string> TypeIcons = new() { ["actor"] = "user", ["system"] = "cube", ["app"] = "app-window", ["store"] = "database", ["component"] = "puzzle" };

    /// <summary>The path data of the icon an object shows: the one it names, else a cloud when it is an outside service, else its type's (a type nobody knows gets the system's).</summary>
    public static string IconData(Model model, FlowyObject o)
    {
        if (!string.IsNullOrEmpty(o.Icon))
        {
            if (CustomIcons(model.Meta).TryGetValue(o.Icon, out var own)) return own;
            if (LookData.Icons.TryGetValue(o.Icon, out var builtIn)) return builtIn;
        }
        if (o.External == "true") return LookData.Icons["cloud"];
        return LookData.Icons[o.Type is not null && TypeIcons.TryGetValue(o.Type, out var name) ? name : "cube"];
    }

    /// <summary>Whether the icon tile shows: always, unless the shape has no room for it and the object names no icon.</summary>
    public static bool ShowsTile(FlowyObject o) => DefOf(o).Tile || !string.IsNullOrEmpty(o.Icon);

    private static double Channel(string hex, int at) => Convert.ToInt32(hex.Substring(at, 2), 16) / 255.0;

    private static double Linear(double c) => c <= 0.03928 ? c / 12.92 : Math.Pow((c + 0.055) / 1.055, 2.4);

    private static double Luminance(double[] rgb) => 0.2126 * Linear(rgb[0]) + 0.7152 * Linear(rgb[1]) + 0.0722 * Linear(rgb[2]);

    private static readonly string[] Surface = ["#ffffff", "#292524"];
    private const string DarkInk = "#1c1917";
    private const string LightInk = "#fafaf9";

    /// <summary>
    /// The text colour that reads on an object's fill, as [light theme, dark theme], or null while the usual text already does (a light tint, or
    /// no fill at all: dark text on the light theme, light text on the dark one). The fill is the colour at its opacity over the plain surface;
    /// the text is whichever of near-black and near-white has the better WCAG contrast against it.
    /// </summary>
    public static (string Light, string Dark)? OnFill(FlowyObject o)
    {
        var opacity = FillOpacity(o) / 100.0;
        if (opacity == 0) return null;
        var pair = ColorPair(IsColor(o.Color) ? o.Color : TypeColor(o))!.Value;
        string Pick(int theme)
        {
            var colour = theme == 0 ? pair.Light : pair.Dark;
            var fill = Luminance(new[] { 1, 3, 5 }.Select(at => opacity * Channel(colour, at) + (1 - opacity) * Channel(Surface[theme], at)).ToArray());
            double Contrast(string ink)
            {
                var t = Luminance(new[] { 1, 3, 5 }.Select(at => Channel(ink, at)).ToArray());
                return (Math.Max(fill, t) + 0.05) / (Math.Min(fill, t) + 0.05);
            }
            return Contrast(DarkInk) >= Contrast(LightInk) ? DarkInk : LightInk;
        }
        var on = (Light: Pick(0), Dark: Pick(1));
        return on is (DarkInk, LightInk) ? null : on;
    }
}
