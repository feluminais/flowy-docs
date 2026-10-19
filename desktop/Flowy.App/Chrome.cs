using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Controls.Templates;
using Avalonia.Media;
using Flowy.App.Canvas;

namespace Flowy.App;

/// <summary>
/// The small visual pieces the bar and the side panel are made of: a button with an icon, the coloured tile of an object's type, chips, and
/// the headings of a panel's sections. Their colours come from Styles.axaml (by class), so they follow light and dark.
/// </summary>
internal static class Chrome
{
    private static readonly string[] Types = ["actor", "system", "app", "store", "component"];

    /// <summary>A button's content: an icon, then its text unless it has none (an icon-only button). It gets the text as its name for screen readers and tests.</summary>
    public static void Fill(Button button, string icon, string? text, string? name = null)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(Icons.Make(icon, "btnicon", 16));
        if (text is not null) row.Children.Add(new TextBlock { Text = text, VerticalAlignment = VerticalAlignment.Center, Classes = { "btntext" } });
        button.Content = row;
        AutomationProperties.SetName(button, name ?? text ?? icon);
        if (text is null) button.Classes.Add("icononly");
    }

    /// <summary>The tile of an object's type: its icon in its colour on a tint of it, or a cloud on grey for an outside service.</summary>
    public static Control TypeTile(string? type, bool external, double size)
    {
        var icon = Icons.Make(external ? Icons.Cloud : Icons.ForType(type), "ticon", size * 0.56);
        icon.HorizontalAlignment = HorizontalAlignment.Center;
        icon.VerticalAlignment = VerticalAlignment.Center;
        var tile = new Border { Width = size, Height = size, CornerRadius = new CornerRadius(Math.Round(size * 0.3)), Child = icon, VerticalAlignment = VerticalAlignment.Center };
        tile.Classes.Add("ttile");
        tile.Classes.Add(Types.Contains(type ?? "") ? type! : "system");
        if (external) tile.Classes.Add("external");
        return tile;
    }

    /// <summary>How a picker shows an object type: its tile, then its name.</summary>
    public static IDataTemplate TypeItem { get; } = new FuncDataTemplate<string>((type, _) =>
        new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 9,
            Children = { TypeTile(type, false, 22), new TextBlock { Text = type, VerticalAlignment = VerticalAlignment.Center } },
        });

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

    /// <summary>The heading of a section of the panel: an icon, the title in small capitals, and how many there are.</summary>
    public static Control Section(string icon, string title, int? count = null)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(2, 6, 0, 0) };
        row.Children.Add(Icons.Make(icon, "sectionicon", 14));
        row.Children.Add(new TextBlock { Text = title.ToUpperInvariant(), FontSize = 11, FontWeight = FontWeight.SemiBold, LetterSpacing = 0.8, VerticalAlignment = VerticalAlignment.Center, Classes = { "muted" } });
        if (count is { } n) row.Children.Add(new Border { Classes = { "count" }, Child = new TextBlock { Text = n.ToString(), FontSize = 11, VerticalAlignment = VerticalAlignment.Center } });
        return row;
    }

    /// <summary>A block set a little apart from the panel: its own background and a hairline border.</summary>
    public static Border Card(Control child)
    {
        var card = new Border { Child = child };
        card.Classes.Add("inset");
        return card;
    }
}
