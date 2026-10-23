using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Flowy.App.Canvas;
using Flowy.Core;

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

    /// <summary>
    /// The levels from the top down to the one a pane is zoomed to, as the single reader's breadcrumb draws them: the overview a house, the rest their names, the level on show not a button.
    /// Null while the pane is on its flow's own view, where there is nothing to say.
    /// </summary>
    public static Control? Crumbs(Model model, string level, bool zoomed, Action<string> jump)
    {
        if (!zoomed) return null;
        var row = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        foreach (var id in Views.Chain(model, level).AsEnumerable().Reverse())
        {
            var first = row.Children.Count == 0;
            if (!first)
            {
                var chevron = Icons.Make(Icons.ChevronRight, "crumbsep", 14);
                chevron.Margin = new Thickness(2, 2, 2, 0);
                chevron.VerticalAlignment = VerticalAlignment.Center;
                row.Children.Add(chevron);
            }
            var label = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7 };
            if (first)
            {
                var home = Icons.Make(Icons.Home, "crumbicon", 16);
                home.Margin = new Thickness(0, 2, 0, 0);
                label.Children.Add(home);
            }
            label.Children.Add(new TextBlock { Text = Views.NameOf(model, id), VerticalAlignment = VerticalAlignment.Center });
            var crumb = new Button { Content = label, IsEnabled = id != level };
            AutomationProperties.SetName(crumb, Views.NameOf(model, id));
            crumb.Classes.Add("crumb");
            var target = id;
            crumb.Click += (_, _) => jump(target);
            row.Children.Add(crumb);
        }
        var bar = new Border { Child = row, Classes = { "panecrumbs" } };
        return bar;
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
