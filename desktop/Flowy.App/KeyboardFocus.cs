using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;

namespace Flowy.App;

/// <summary>
/// Where the keyboard is, and giving it back when what held it goes (a panel closes, a list is drawn again, a box is put away). Code focus is silent: it
/// draws no ring and opens no tooltip, so only a reader who had come in with Tab or the arrows is put back where they were.
/// </summary>
internal static class KeyboardFocus
{
    /// <summary>The element that has the keyboard, or null.</summary>
    internal static IInputElement? Held(Visual at) => TopLevel.GetTopLevel(at)?.FocusManager?.GetFocusedElement();

    /// <summary>Whether the keyboard is on <paramref name="inside"/> or on something in it.</summary>
    internal static bool Within(Visual inside) => Held(inside) is Visual held && (ReferenceEquals(held, inside) || inside.IsVisualAncestorOf(held));

    /// <summary>
    /// Once what held the keyboard has gone, gives it to <paramref name="target"/>, unless the reader (or other code) put it somewhere else meanwhile. Posted, so the
    /// control that closed is out of the tree first.
    /// </summary>
    internal static void HandBack(Control target) =>
        Dispatcher.UIThread.Post(() =>
        {
            if (Held(target) is null or Visual { IsEffectivelyVisible: false }) target.Focus();
        });
}
