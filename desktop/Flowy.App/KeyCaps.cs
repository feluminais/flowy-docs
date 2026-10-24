using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace Flowy.App;

/// <summary>Keycaps: one drawn cap for each key, as in <c>[←][→]</c>. Only the shortcut list draws them: a panel names no keys, the list ? opens does.</summary>
internal static class KeyCaps
{
    /// <summary>
    /// The caps for <paramref name="keys"/> (one cap per key, keys separated by spaces) in a row, with <paramref name="after"/> (the verb) at the end of it.
    /// Without a verb the row is the caps of one shortcut, kept to the top left of its cell.
    /// </summary>
    public static StackPanel Of(string keys, Control? after = null)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        if (after is null)
        {
            row.HorizontalAlignment = HorizontalAlignment.Left;
            row.VerticalAlignment = VerticalAlignment.Top;
        }
        foreach (var name in keys.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            var cap = new Border { Child = new TextBlock { Text = name, FontSize = 12, FontFamily = Fonts.Mono } };
            cap.Classes.Add("kbd");
            row.Children.Add(cap);
        }
        if (after is not null) row.Children.Add(after);
        return row;
    }
}
