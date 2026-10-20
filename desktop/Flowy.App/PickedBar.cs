using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;

namespace Flowy.App;

/// <summary>
/// What shows while several boxes are picked in edit mode: how many, Delete, and a way to let them go. It sits at the foot of the canvas and not
/// in the side panel, which would cover the boxes picked, right where they are to be dragged.
/// </summary>
internal sealed class PickedBar : Border
{
    private readonly TextBlock _count = new() { FontWeight = FontWeight.SemiBold, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0) };

    public event Action? DeleteRequested;
    public event Action? ClearRequested;

    /// <summary>How many boxes it says are picked, for tests.</summary>
    public string Text => _count.Text ?? "";

    public PickedBar()
    {
        Classes.Add("card");
        HorizontalAlignment = HorizontalAlignment.Center;
        VerticalAlignment = VerticalAlignment.Bottom;
        Margin = new Thickness(16, 0, 16, 24);
        Padding = new Thickness(14, 4, 6, 4);
        IsVisible = false;
        var delete = new Button();
        delete.Classes.Add("tool");
        delete.Classes.Add("danger");
        Chrome.Fill(delete, Icons.Trash, "Delete");
        delete.Click += (_, _) => DeleteRequested?.Invoke();
        var clear = new Button();
        clear.Classes.Add("tool");
        Chrome.Fill(clear, Icons.Close, null, "Clear selection");
        ToolTip.SetTip(clear, "Clear selection (Esc)");
        clear.Click += (_, _) => ClearRequested?.Invoke();
        Child = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, Children = { _count, delete, clear } };
    }

    /// <summary>Shows the bar for this many boxes picked, or hides it for fewer than two.</summary>
    public void Show(int count)
    {
        _count.Text = $"{count} selected";
        IsVisible = count > 1;
    }
}
