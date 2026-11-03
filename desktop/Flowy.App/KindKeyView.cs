using Avalonia.Controls;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The key at the foot of the canvas for the kinds of connection: one swatch for each kind the lines on show are drawn as, in the order of the list, with its name beside it, and
/// "Plain line" when a plain one is on show too. The swatch is the real drawing (<see cref="LookSwatch"/>: the pattern and the marks, in the line's colour for the theme showing).
/// The twin of KindKey in ui/src/kinds.tsx. Nothing when no line has a kind.
/// </summary>
internal static class KindKeyView
{
    /// <summary>The words beside the swatches, in order.</summary>
    public static List<string> Words(IReadOnlyList<string> kinds, bool plain)
    {
        var words = kinds.Select(Kinds.NameOf).ToList();
        if (plain && kinds.Count > 0) words.Add(Kinds.PlainName);
        return words;
    }

    /// <summary>The key for these kinds, or null when there are none.</summary>
    public static Control? Of(IReadOnlyList<string> kinds, bool plain)
    {
        if (kinds.Count == 0) return null;
        var items = kinds.Select(id => ((Control Swatch, string Label)?)(new LookSwatch(Kinds.LookOfKind(id)), Kinds.NameOf(id))).ToList();
        if (plain) items.Add((new LookSwatch(null), Kinds.PlainName));
        return KeyRow.Of([.. items]);
    }
}
