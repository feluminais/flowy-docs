using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.Core;

namespace Flowy.App.Canvas;

/// <summary>
/// The payload card on a paused dot: the way it goes and its name, then what it is about, its shape and its example, as the payload rows show them open. It is at most
/// <see cref="MotionMath.Card"/> big and scrolls inside past that. Desktop twin of DotCard in ui/src/DotCard.tsx; <see cref="CanvasView"/> shows, places and closes it.
/// </summary>
internal sealed class DotCard : Border
{
    public DotCard(Payloads.Shown shown, bool back, Func<string, IBrush> resource)
    {
        Classes.Add("card");
        Classes.Add("dotcard");
        MaxWidth = MotionMath.Card.Width;
        MaxHeight = MotionMath.Card.Height;
        AutomationProperties.SetName(this, shown.Name);
        if (back) AutomationProperties.SetHelpText(this, "Comes back"); // the arrow says so to the eye
        var arrow = Icons.Make(back ? Icons.ArrowLeft : Icons.ArrowRight, "payloadicon", 14);
        arrow.VerticalAlignment = VerticalAlignment.Center;
        var name = new TextBlock { Text = shown.Name, FontSize = 14, FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap };
        var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { arrow, name } };
        Child = new ScrollViewer
        {
            HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            Content = new StackPanel { Spacing = 8, Children = { head, PayloadView.Body(shown, resource) } },
        };
        // The wheel is the card's: scrolled to its end it does nothing, rather than zoom the canvas under it (which would close it).
        AddHandler(PointerWheelChangedEvent, (_, e) => e.Handled = true);
    }
}
