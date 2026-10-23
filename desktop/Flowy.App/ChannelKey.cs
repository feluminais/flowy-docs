using Avalonia.Controls;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The key under the state key on the player: one mark for each kind of channel that is open now, drawn as it looks on the canvas, with its name beside it
/// ("Open stream", "Listening", "Running job"). The words are the browser's (<see cref="Channels.Labels"/>); nothing when no channel is open.
/// </summary>
internal static class ChannelKey
{
    /// <summary>The words beside each mark, in the order given.</summary>
    public static List<string> Words(IEnumerable<string> kinds) => kinds.Select(k => Channels.Labels[k]).ToList();

    /// <summary>The key for these kinds (each once, in the order of <see cref="Animations.ChannelKinds"/>).</summary>
    public static Control Of(IReadOnlyList<string> kinds) =>
        KeyRow.Of(Animations.ChannelKinds.Where(kinds.Contains).Select(k => ((Control Swatch, string Label)?)(new ChannelSwatch(k), Channels.Labels[k])).ToArray());
}
