using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Flowy.App.Canvas;

namespace Flowy.App;

/// <summary>
/// The bar over the two panes, in the look of the top bar: the two ways to view (Side by side, or Swap, which flips one canvas between the flows), a control that puts the flows
/// on each other's side, and Close.
/// </summary>
internal sealed class CompareBar : Border
{
    private readonly Button _side = new();
    private readonly Button _swap = new();
    private readonly Button _flip = new();
    private readonly Button _close = new();
    private readonly Button[] _names = [new(), new()];
    private readonly StackPanel _namesRow = new() { Orientation = Orientation.Horizontal, Spacing = 2, Margin = new Thickness(10, 0, 8, 0), IsVisible = false };
    private string _mode = "side";

    /// <summary>The reader chose a way to view: <c>side</c> or <c>swap</c>.</summary>
    public event Action<string>? ModePicked;

    /// <summary>The reader chose the name of a flow in Swap (0 the one that reads first, 1 the other): that flow is to be on show.</summary>
    public event Action<int>? FlowPicked;

    /// <summary>The reader chose Swap sides: the flows go on each other's side.</summary>
    public event Action? Flipped;

    /// <summary>The reader chose Close.</summary>
    public event Action? Closed;

    public CompareBar()
    {
        Classes.Add("bar");
        Classes.Add("comparebar");
        Make(_side, null, "Side by side", "Side by side", "Two flows next to each other", () => ModePicked?.Invoke("side"));
        Make(_swap, null, "Swap", "Swap", "One canvas that flips between the flows", () => ModePicked?.Invoke("swap"));
        Make(_flip, Icons.ArrowsLeftRight, null, "Swap sides", "Swap sides", () => Flipped?.Invoke());
        Make(_close, Icons.Close, "Close", "Close", "Close the comparison (Esc)", () => Closed?.Invoke());
        for (var i = 0; i < _names.Length; i++)
        {
            var side = i;
            _names[i].Classes.Add("tool");
            _names[i].Classes.Add("flowname");
            _names[i].Click += (_, _) =>
            {
                if (!_names[side].Classes.Contains("pressed")) FlowPicked?.Invoke(side); // the one on show is already there
            };
            _namesRow.Children.Add(_names[i]);
        }
        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, VerticalAlignment = VerticalAlignment.Center, Children = { _side, _swap, _namesRow, _flip } };
        var dock = new DockPanel { LastChildFill = false };
        DockPanel.SetDock(_close, Dock.Right);
        dock.Children.Add(_close);
        dock.Children.Add(left);
        Child = dock;
        Mode = "side";
    }

    private static void Make(Button button, string? icon, string? text, string name, string tip, Action click)
    {
        button.Classes.Add("tool");
        if (icon is null) button.Content = new TextBlock { Text = text, VerticalAlignment = VerticalAlignment.Center, Classes = { "btntext" } };
        else Chrome.Fill(button, icon, text, name);
        AutomationProperties.SetName(button, name);
        ToolTip.SetTip(button, tip);
        ToolTip.SetShowOnDisabled(button, true);
        button.Click += (_, _) => click();
    }

    /// <summary>The way the comparison is viewed now, <c>side</c> or <c>swap</c>: that button looks pressed.</summary>
    public string Mode
    {
        get => _mode;
        set
        {
            _mode = value;
            Press(_side, value == "side");
            Press(_swap, value == "swap");
            _namesRow.IsVisible = value == "swap";
        }
    }

    /// <summary>
    /// In Swap, the two flows' names in the order they read, the one on show marked (it looks pressed, and its name for a screen reader says so). A click on the other swaps to it.
    /// </summary>
    public void ShowFlows(IReadOnlyList<string> names, int on)
    {
        for (var i = 0; i < _names.Length; i++)
        {
            var shown = i == on;
            _names[i].Content = new TextBlock { Text = names[i], VerticalAlignment = VerticalAlignment.Center, TextTrimming = Avalonia.Media.TextTrimming.CharacterEllipsis, MaxWidth = 220, Classes = { "btntext" } };
            Press(_names[i], shown);
            AutomationProperties.SetName(_names[i], shown ? $"{names[i]}, on show" : names[i]);
            ToolTip.SetTip(_names[i], shown ? $"{names[i]} is on show" : $"Swap to {names[i]} (X)");
        }
    }

    private static void Press(Button button, bool on)
    {
        if (on) button.Classes.Add("pressed");
        else button.Classes.Remove("pressed");
    }

    // What a test can look at.
    internal Button SideButton => _side;

    internal Button SwapButton => _swap;

    internal Button FlipButton => _flip;

    /// <summary>The two flows' name buttons in Swap, in the order they read.</summary>
    internal IReadOnlyList<Button> FlowButtons => _names;

    internal bool FlowsShown => _namesRow.IsVisible;

    internal Button CloseButton => _close;
}
