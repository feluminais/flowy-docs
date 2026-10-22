using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Layout;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// What the change marks on the panes mean, in the compare bar: a swatch for each kind that is on screen now, drawn as the ring it marks a shape with (the same colour and dash, from the
/// tokens in Styles.axaml), and its name. <c>sides</c> are the flows on screen: both side by side, the one on show in Swap. Flows that share no shape have no marks, so the key says so
/// instead; two that match step for step say there is nothing to mark. A port of CompareKey.tsx, with the same words.
/// </summary>
internal sealed class CompareKey : WrapPanel
{
    /// <summary>The words of a key with nothing to draw: the flows share no shape, or they match.</summary>
    internal const string Unrelated = "Nothing in common";

    internal const string Same = "No changes";

    public CompareKey(FlowDiff diff, IReadOnlyList<string> sides)
    {
        Orientation = Orientation.Horizontal;
        VerticalAlignment = VerticalAlignment.Center;
        var (items, related) = CompareUi.KeyItems(diff, sides);
        Kinds = items;
        foreach (var kind in items) Children.Add(Item(Swatch(kind), CompareUi.Name(kind)));
        if (!related) Children.Add(Item(null, Unrelated));
        else if (items.Count == 0) Children.Add(Item(null, Same));
    }

    /// <summary>The kinds the key lists, in order.</summary>
    internal IReadOnlyList<Change> Kinds { get; }

    /// <summary>The words of the key's items, in order.</summary>
    internal IReadOnlyList<string> Words => [.. Children.OfType<StackPanel>().Select(item => item.Children.OfType<TextBlock>().Single().Text ?? "")];

    /// <summary>A kind's mark as the canvas draws it: the ring's outline, small. It has no name of its own: the label beside it carries the meaning.</summary>
    internal static Control Swatch(Change kind)
    {
        var ring = new Rectangle { Width = 24, Height = 14, IsHitTestVisible = false };
        ring.Classes.Add("chg");
        var swatch = new Border { Child = ring, IsHitTestVisible = false };
        swatch.Classes.Add("sw");
        swatch.Classes.Add(BoxControl.Word(kind));
        return swatch;
    }

    private static Control Item(Control? swatch, string label)
    {
        var item = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(0, 0, 14, 0), VerticalAlignment = VerticalAlignment.Center };
        if (swatch is not null) item.Children.Add(swatch);
        item.Children.Add(new TextBlock { Text = label, Classes = { "muted" }, FontSize = 12.5, VerticalAlignment = VerticalAlignment.Center });
        return item;
    }
}
