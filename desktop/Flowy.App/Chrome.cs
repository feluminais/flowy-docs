using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Controls.Primitives;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The small visual pieces the bar and the side panel are made of: a button with an icon, the coloured tile of an object's type, chips, and
/// the headings of a panel's sections. Their colours come from Styles.axaml (by class), so they follow light and dark.
/// </summary>
internal static class Chrome
{
    /// <summary>A button's content: an icon, then its text unless it has none (an icon-only button). It gets the text as its name for screen readers and tests.</summary>
    public static void Fill(Button button, string icon, string? text, string? name = null)
    {
        // An icon-only button is a fixed square: its row would stretch to fill it and leave the icon at the left edge, so the row is centred.
        // A fixed height, so the words and an icon-only button's lone icon are placed the same way: the height of a row of words follows the font.
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7, Height = 20, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = text is null ? HorizontalAlignment.Center : HorizontalAlignment.Stretch };
        // The icon sits at the middle of the row, and the words a little above it: a font's line has more room under the letters than over them,
        // so the capitals fall below the middle of their line, and the bar's picker, which has no such nudge, puts them where these go.
        var glyph = Icons.Make(icon, "btnicon", 16);
        glyph.VerticalAlignment = VerticalAlignment.Center;
        row.Children.Add(glyph);
        if (text is not null) row.Children.Add(new TextBlock { Text = text, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 0, 1), Classes = { "btntext" } });
        button.Content = row;
        AutomationProperties.SetName(button, name ?? text ?? icon);
        if (text is null) button.Classes.Add("icononly");
    }

    /// <summary>
    /// A picker for the bar: the words and a chevron right beside them. The box is as wide as the chosen item, so the chevron's column is the chevron
    /// itself instead of the template's fixed 32, and the words move on a pick while the chevron and the hit area stay at the right edge.
    /// </summary>
    public static void FlatPicker(ComboBox box)
    {
        box.Classes.Add("flat");
        box.TemplateApplied += (_, e) =>
        {
            if (e.NameScope.Find<Control>("DropDownGlyph")?.Parent is Grid { ColumnDefinitions.Count: 2 } grid) grid.ColumnDefinitions[1].Width = GridLength.Auto;
        };
    }

    /// <summary>The tile of an object's type: its icon in its colour on a tint of it, or a cloud on grey for an outside service.</summary>
    public static Control TypeTile(string? type, bool external, double size) => TypeTile(type, external, size, null, out _);

    /// <summary>The same with an icon of its own (path data) instead of the type's, and the path it draws, for a caller that colours it.</summary>
    public static Control TypeTile(string? type, bool external, double size, string? iconData, out Avalonia.Controls.Shapes.Path path)
    {
        var icon = Icons.Make(iconData ?? (external ? Icons.Cloud : Icons.ForType(type)), "ticon", size * 0.56, out path);
        icon.HorizontalAlignment = HorizontalAlignment.Center;
        icon.VerticalAlignment = VerticalAlignment.Center;
        var tile = new Border { Width = size, Height = size, CornerRadius = new CornerRadius(Math.Round(size * 0.3)), Child = icon, VerticalAlignment = VerticalAlignment.Center };
        tile.Classes.Add("ttile");
        tile.Classes.Add(Names.ObjectTypes.Contains(type ?? "") ? type! : "system");
        if (external) tile.Classes.Add("external");
        return tile;
    }

    /// <summary>The tile of one object as the canvas draws it: the icon and the colour it names, else its type's.</summary>
    public static Control ObjectTile(Model model, FlowyObject? o, double size)
    {
        if (o is null) return TypeTile(null, false, size);
        var tile = TypeTile(o.Type, Model.IsExternal(o), size, Look.IconData(model, o), out var path);
        if (Look.IsColor(o.Color) && Look.ColorPair(o.Color) is { } pair)
        {
            ((Border)tile).Background = ThemeBrushes.For(pair.Light, pair.Dark, 0.18);
            path.Stroke = ThemeBrushes.For(pair.Light, pair.Dark);
        }
        return tile;
    }

    /// <summary>The switch for an outside service: the grey cloud tile it is drawn with, its name, and a switch that slides over when it is on.</summary>
    public static ToggleButton OutsideSwitch()
    {
        var thumb = new Avalonia.Controls.Shapes.Ellipse { Width = 14, Height = 14, Margin = new Thickness(2), HorizontalAlignment = HorizontalAlignment.Left, Classes = { "thumb" } };
        var track = new Border { Width = 30, Height = 18, CornerRadius = new CornerRadius(9), VerticalAlignment = VerticalAlignment.Center, Child = thumb, Classes = { "track" } };
        var row = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 10 };
        var tile = TypeTile(null, true, 28);
        var label = new TextBlock { Text = "Outside service", VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(tile);
        row.Children.Add(label);
        row.Children.Add(track);
        Grid.SetColumn(label, 1);
        Grid.SetColumn(track, 2);
        var toggle = new ToggleButton { Content = row, HorizontalContentAlignment = HorizontalAlignment.Stretch };
        toggle.Classes.Add("pick");
        toggle.Classes.Add("wide");
        AutomationProperties.SetName(toggle, "Outside service");
        return toggle;
    }

    /// <summary>A small rounded label: an optional icon and some text. <paramref name="kind"/> picks its colour: an object type, "warn" or nothing.</summary>
    public static Control Chip(string text, string? icon = null, string? kind = null)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 5, VerticalAlignment = VerticalAlignment.Center };
        if (icon is not null) row.Children.Add(Icons.Make(icon, "chipicon", 12));
        row.Children.Add(new TextBlock { Text = text, VerticalAlignment = VerticalAlignment.Center });
        var chip = new Border { Child = row };
        chip.Classes.Add("chip");
        if (kind is not null) chip.Classes.Add(kind);
        return chip;
    }

    /// <summary>Chips as small words in a line, a dot between each, wrapping when they run out of room.</summary>
    public static Control Chips(params Control[] chips)
    {
        var wrap = new WrapPanel { Orientation = Orientation.Horizontal };
        foreach (var chip in chips)
        {
            if (wrap.Children.Count > 0) wrap.Children.Add(new TextBlock { Text = "·", FontSize = 12, Margin = new Thickness(8, 0), Opacity = 0.6, VerticalAlignment = VerticalAlignment.Center, Classes = { "muted" } });
            wrap.Children.Add(chip);
        }
        return wrap;
    }

    /// <summary>The rule under a title: the colour of <paramref name="brush"/> at the left, fading out to the right.</summary>
    public static Control Rule(IBrush brush)
    {
        var color = brush is ISolidColorBrush solid ? solid.Color : Colors.Gray;
        return new Border
        {
            Height = 2,
            CornerRadius = new CornerRadius(1),
            Background = new LinearGradientBrush
            {
                StartPoint = new RelativePoint(0, 0, RelativeUnit.Relative),
                EndPoint = new RelativePoint(0.75, 0, RelativeUnit.Relative),
                GradientStops = [new GradientStop(color, 0), new GradientStop(Color.FromArgb(0, color.R, color.G, color.B), 1)],
            },
            // A drop shadow follows the painted pixels, so the glow fades with the line. A box shadow is cut out under the box and left a dark hole where the line is clear.
            Effect = new DropShadowEffect { BlurRadius = 8, OffsetX = 0, OffsetY = 0, Color = color, Opacity = 0.6 },
        };
    }

    /// <summary>The heading of a section of the panel: an icon, the title in small capitals, how many there are, and a hairline running on to the edge.</summary>
    public static Control Section(string icon, string title, int? count = null)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(Icons.Make(icon, "sectionicon", 14));
        row.Children.Add(new TextBlock { Text = title.ToUpperInvariant(), FontSize = 11, FontWeight = FontWeight.SemiBold, LetterSpacing = 1, VerticalAlignment = VerticalAlignment.Center, Classes = { "muted" } });
        if (count is { } n) row.Children.Add(new Border { Classes = { "count" }, Child = new TextBlock { Text = n.ToString(), FontSize = 11, VerticalAlignment = VerticalAlignment.Center } });
        var hairline = new Border { Classes = { "hairline" }, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0, 0, 0) };
        var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], Margin = new Thickness(0, 10, 0, 0), Children = { row, hairline } };
        Grid.SetColumn(hairline, 1);
        return grid;
    }

    /// <summary>A note set beside the text by a rule, like a quote.</summary>
    public static Border Card(Control child)
    {
        var card = new Border { Child = child };
        card.Classes.Add("inset");
        return card;
    }
}
