using System.Collections;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Templates;
using Avalonia.Interactivity;
using Avalonia.Layout;

namespace Flowy.App;

/// <summary>
/// A short set of choices as rows in a panel, in place of a dropdown: the runs of the Performance panel, the analyses of the Failures panel. Four rows show in full; past that the list
/// scrolls inside itself, and half a fifth row shows there is more. Only the rows in view are made. A click gives the keyboard back to the reader, and the arrows keep it on the list.
/// A panel that rebuilds leaves the list where it is and tells it the choice, or each rebuild would put it back to the top. A port of <c>RowList</c> in ui/src/RowList.tsx.
/// </summary>
internal sealed class RowList : ListBox
{
    /// <summary>Four rows, 32 tall in Styles.axaml, and half a fifth.</summary>
    private const double Tall = 144;

    private bool _told;

    /// <param name="label">What the list is called, for a screen reader.</param>
    /// <param name="items">The rows, each drawn by <paramref name="row"/>.</param>
    /// <param name="chosen">The row that is chosen.</param>
    /// <param name="row">Draws a row: <see cref="PlainRow"/> for a list of names.</param>
    /// <param name="picked">The reader moved to the row at this place, with the mouse or the keys.</param>
    /// <param name="clicked">The reader let go of the mouse on the list.</param>
    public RowList(string label, IEnumerable items, int chosen, IDataTemplate row, Action<int> picked, Action clicked)
    {
        Classes.Add("rowlist");
        MaxHeight = Tall;
        ItemsSource = items;
        ItemTemplate = row;
        SelectedIndex = chosen;
        AutomationProperties.SetName(this, label);
        SelectionChanged += (_, _) =>
        {
            if (!_told && SelectedIndex >= 0) picked(SelectedIndex);
        };
        // After a click, not at every change: the arrows go through the rows with the keyboard staying on the list.
        AddHandler(PointerReleasedEvent, (_, _) => clicked(), RoutingStrategies.Bubble, handledEventsToo: true);
    }

    protected override Type StyleKeyOverride => typeof(ListBox);

    /// <summary>A row with nothing but a name.</summary>
    public static readonly IDataTemplate PlainRow = new FuncDataTemplate<string>((name, _) => RowName(name));

    /// <summary>The name on a row: trimmed when it doesn't fit, with all of it as a tooltip.</summary>
    public static TextBlock RowName(string? text)
    {
        var name = new TextBlock { Text = text, VerticalAlignment = VerticalAlignment.Center, TextTrimming = Avalonia.Media.TextTrimming.CharacterEllipsis };
        ToolTip.SetTip(name, text);
        return name;
    }

    /// <summary>The choice changed, or was said again: the list goes to it, which is not the reader picking one.</summary>
    public void Choose(int chosen)
    {
        _told = true;
        SelectedIndex = chosen;
        _told = false;
    }
}
