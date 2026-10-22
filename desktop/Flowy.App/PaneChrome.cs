using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Flowy.App.Canvas;

namespace Flowy.App;

/// <summary>What a pane of Side by side and the canvas of Swap draw the same way: the title above the diagram, and the zoom buttons over it.</summary>
internal static class PaneChrome
{
    /// <summary>The flow's name over the diagram, trimmed with an ellipsis.</summary>
    public static (Border Head, TextBlock Title) Head()
    {
        var title = new TextBlock();
        title.Classes.Add("panetitle");
        title.TextTrimming = Avalonia.Media.TextTrimming.CharacterEllipsis;
        return (new Border { Child = title, Classes = { "panehead" } }, title);
    }

    /// <summary>Zoom in, zoom out and fit, at the top right of the diagram.</summary>
    public static Border ZoomButtons(CanvasView canvas, Action fit)
    {
        Button Make(string icon, string name, Action click)
        {
            var b = new Button { Content = Icons.Make(icon, "zoomicon", 16) };
            b.Classes.Add("zoom");
            b.Click += (_, _) => click();
            AutomationProperties.SetName(b, name);
            ToolTip.SetTip(b, name);
            return b;
        }
        var group = new Border
        {
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(10),
            Child = new StackPanel
            {
                Children =
                {
                    Make(Icons.Plus, "Zoom in", () => canvas.ZoomBy(1.25)),
                    Make(Icons.Minus, "Zoom out", () => canvas.ZoomBy(0.8)),
                    Make(Icons.Fit, "Fit the view", fit),
                },
            },
        };
        group.Classes.Add("zoomgroup");
        return group;
    }
}
