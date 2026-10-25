using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.Core;

namespace Flowy.App;

/// <summary>A gradient from green through amber to red, in the colours the canvas outlines a shape with in the theme that is showing.</summary>
internal sealed class HeatSwatch : Border
{
    public HeatSwatch()
    {
        Classes.Add("sw");
        Classes.Add("heat");
        ActualThemeVariantChanged += (_, _) => Fill();
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        Fill();
    }

    private void Fill()
    {
        var dark = AppTheme.IsDark(this);
        var brush = new LinearGradientBrush { StartPoint = new RelativePoint(0, 0.5, RelativeUnit.Relative), EndPoint = new RelativePoint(1, 0.5, RelativeUnit.Relative) };
        foreach (var strain in new[] { 0.0, 0.5, 1.0 }) brush.GradientStops.Add(new GradientStop(Color.Parse(PerfColors.Hex(strain, dark)), strain));
        Background = brush;
    }
}

/// <summary>A row of marks, each drawn as it looks on the chart or the canvas with its name beside it: how the panel says what a colour or a shape means.</summary>
internal static class KeyRow
{
    public static Control Of(params (Control Swatch, string Label)?[] items)
    {
        var row = new WrapPanel();
        foreach (var item in items)
        {
            if (item is not { } entry) continue;
            var label = new TextBlock { Text = entry.Label, Classes = { "muted" }, FontSize = 12.5, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap };
            var cell = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(0, 0, 16, 6), Children = { entry.Swatch, label } };
            if (ToolTip.GetTip(entry.Swatch) is string tip) ToolTip.SetTip(cell, tip);
            row.Children.Add(cell);
        }
        return row;
    }

    /// <summary>A mark the styles draw: a line (<c>p50</c>, <c>p95</c>, <c>busy</c>), a dot (<c>call</c>, and <c>bad</c> as well for one that fails) or an outline (<c>none</c>).</summary>
    public static Control Mark(params string[] classes)
    {
        var mark = new Border();
        mark.Classes.Add("sw");
        foreach (var c in classes) mark.Classes.Add(c);
        return mark;
    }

    /// <summary>The red dashes that mark where a run first struggles.</summary>
    public static Control Dashes()
    {
        var dashes = new Avalonia.Controls.Shapes.Line { StartPoint = new Point(0, 0), EndPoint = new Point(0, 14), StrokeThickness = 2, StrokeDashArray = [1.5, 1.5], VerticalAlignment = VerticalAlignment.Center };
        dashes.Classes.Add("knee");
        return dashes;
    }

    /// <summary>The plain stripes moving along a line the run gives no numbers.</summary>
    public static Control Stripes()
    {
        var stripes = new Avalonia.Controls.Shapes.Line { StartPoint = new Point(0, 0), EndPoint = new Point(20, 0), StrokeThickness = 3, StrokeDashArray = [1.7, 1.3], VerticalAlignment = VerticalAlignment.Center };
        stripes.Classes.Add("stripes");
        return stripes;
    }

    /// <summary>A call: a small stripe in a source's colour (for the theme that is showing); without a colour, the accent the styles give it. <paramref name="size"/> is its width over 1.5.</summary>
    public static Control Call(string? color, bool dark, double size = 8, double opacity = 1)
    {
        var call = new Border { Width = size * 1.5, Height = size * 0.55, CornerRadius = new CornerRadius(size * 0.275), Opacity = opacity, VerticalAlignment = VerticalAlignment.Center };
        call.Classes.Add("sw");
        if (PerfView.SourceHex(color, dark) is { } hex) call.Background = new SolidColorBrush(Color.Parse(hex));
        else call.Classes.Add("accent");
        return call;
    }

    /// <summary>A dot in a source's colour (the real dot, for the theme that is showing); without a colour, the accent the styles give a dot.</summary>
    public static Control Dot(string? color, bool dark, double size = 8, double opacity = 1)
    {
        var dot = new Border { Width = size, Height = size, CornerRadius = new CornerRadius(size / 2), Opacity = opacity };
        dot.Classes.Add("sw");
        if (PerfView.SourceHex(color, dark) is { } hex) dot.Background = new SolidColorBrush(Color.Parse(hex));
        else dot.Classes.Add("accent");
        return dot;
    }

    /// <summary>A small stripe beside a big one: the marks of calls of different sizes.</summary>
    public static Control Bigger(string? color, bool dark) =>
        new StackPanel { Orientation = Orientation.Horizontal, Spacing = 3, VerticalAlignment = VerticalAlignment.Center, Children = { Call(color, dark, 5), Call(color, dark, 11) } };

    /// <summary>Marks that thin out: a line that is scaled down to fit the screen.</summary>
    public static Control Scaled(string? color, bool dark) =>
        new StackPanel { Orientation = Orientation.Horizontal, Spacing = 3, VerticalAlignment = VerticalAlignment.Center, Children = { Call(color, dark, 6), Call(color, dark, 6, 0.55), Call(color, dark, 6, 0.25) } };

    /// <summary>A call that is turned away: a dot, and the bar it stops at.</summary>
    public static Control Rejected()
    {
        var bar = new Border();
        bar.Classes.Add("sw");
        bar.Classes.Add("bar");
        return new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, VerticalAlignment = VerticalAlignment.Center, Children = { Mark("call", "bad"), bar } };
    }

    /// <summary>A mark with a tooltip for the whole key item it sits in (see <see cref="Of"/>).</summary>
    public static Control Tipped(Control swatch, string tip)
    {
        ToolTip.SetTip(swatch, tip);
        return swatch;
    }

    /// <summary>The number a shape wears once it is past the struggle mark.</summary>
    public static Control Pct(string number)
    {
        var badge = new Border { Child = new TextBlock { Text = number } };
        badge.Classes.Add("sw");
        badge.Classes.Add("pct");
        return badge;
    }

    /// <summary>The badge that says how many are waiting.</summary>
    public static Control Count(string number)
    {
        var badge = new Border { Child = new TextBlock { Text = number } };
        badge.Classes.Add("sw");
        badge.Classes.Add("queue");
        return badge;
    }
}

