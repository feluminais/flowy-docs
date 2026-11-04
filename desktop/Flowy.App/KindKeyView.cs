using Avalonia.Controls;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The key at the foot of the canvas for the kinds of connection: one swatch for each kind the lines on show are drawn as, in the order of the list, with its name beside it, and
/// "Plain line" when a plain one is on show too. The swatch is the real drawing (<see cref="LookSwatch"/>: the pattern and the marks, in the line's colour for the theme showing).
/// The twin of KindKey in ui/src/kinds.tsx. After the kinds come, where the canvas draws them, a trunk ("Stacked lines": a line with two hairlines behind it and a chip with a number) and a lane
/// a step plays on among others of its pair ("In use": a line in the accent colour). Nothing when there is none of these.
/// </summary>
internal static class KindKeyView
{
    /// <summary>The words beside the swatches, in order.</summary>
    public static List<string> Words(IReadOnlyList<string> kinds, bool plain, bool stacked = false, bool inUse = false)
    {
        var words = kinds.Select(Kinds.NameOf).ToList();
        if (plain && kinds.Count > 0) words.Add(Kinds.PlainName);
        if (stacked) words.Add(Lanes.KeyStacked);
        if (inUse) words.Add(Lanes.KeyInUse);
        return words;
    }

    /// <summary>The key for these items, or null when there are none.</summary>
    public static Control? Of(IReadOnlyList<string> kinds, bool plain, bool stacked = false, bool inUse = false)
    {
        if (kinds.Count == 0 && !stacked && !inUse) return null;
        var items = kinds.Select(id => ((Control Swatch, string Label)?)(new LookSwatch(Kinds.LookOfKind(id)), Kinds.NameOf(id))).ToList();
        if (plain && kinds.Count > 0) items.Add((new LookSwatch(null), Kinds.PlainName));
        if (stacked) items.Add((new TrunkSwatch(), Lanes.KeyStacked));
        if (inUse) items.Add((new LookSwatch(null, inUse: true), Lanes.KeyInUse));
        return KeyRow.Of([.. items]);
    }
}
