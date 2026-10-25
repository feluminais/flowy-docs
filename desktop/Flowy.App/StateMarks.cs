using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;
using Path = Avalonia.Controls.Shapes.Path;

namespace Flowy.App;

/// <summary>
/// The little drawing that names a state, on a ring in the state's colour (dashed when only something inside the shape is in it), so colour is never the
/// only cue. The same drawings as the browser's (ui/src/states.tsx). The colours come from Styles.axaml by class (<c>state-stopped</c> and the rest), so
/// the chip follows light and dark wherever it sits: on a shape, in the key under the player, or in Details.
/// </summary>
internal sealed class StateGlyph : Grid
{
    private readonly Path _icon;
    private readonly Control _holder;

    public StateGlyph(StateMark mark, double size = 20)
    {
        Width = Height = size;
        IsHitTestVisible = false;
        Classes.Add("stateglyph");
        Classes.Add("state-" + mark.State);
        if (mark.Inside) Classes.Add("state-inside");
        var ring = new Ellipse { Width = size, Height = size, StrokeThickness = Math.Max(1.2, size / 13) };
        ring.Classes.Add("ring");
        if (mark.Inside) ring.StrokeDashArray = [2.2, 2.2];
        _holder = Icons.Make(Icons.ForState(mark.State), "stateicon", size * 0.6, out _icon);
        _holder.HorizontalAlignment = HorizontalAlignment.Center;
        _holder.VerticalAlignment = VerticalAlignment.Center;
        _holder.RenderTransformOrigin = RelativePoint.Center;
        Children.Add(ring);
        Children.Add(_holder);
        var word = StateKey.Word(mark);
        AutomationProperties.SetName(this, word);
        ToolTip.SetTip(this, word);
    }

    /// <summary>Turns the drawing (degrees): a state that is coming up or restarting spins it.</summary>
    public void Spin(double degrees) => _holder.RenderTransform = degrees == 0 ? null : new RotateTransform(degrees);
}

/// <summary>A mark as the key draws it: a small outline in the state's own dash with its glyph over the corner, as it is on a shape. Still, whatever the shape does.</summary>
internal sealed class StateSwatch : Grid
{
    public StateSwatch(StateMark mark)
    {
        Classes.Add("stateswatch");
        Classes.Add("state-" + mark.State);
        VerticalAlignment = VerticalAlignment.Center;
        if (!mark.Inside)
        {
            Width = 26;
            Height = 16;
            Margin = new Thickness(6, 0, 0, 0);
            var outline = new Rectangle { Width = 26, Height = 16, RadiusX = 4, RadiusY = 4, StrokeThickness = 1.8 };
            outline.Classes.Add("outline");
            outline.StrokeDashArray = Dash(mark.State);
            if (mark.State is "starting" or "stopping" or "restarting") outline.StrokeLineCap = PenLineCap.Round;
            Children.Add(outline);
            var glyph = new StateGlyph(mark, 14) { HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(-6, -6, 0, 0) };
            Children.Add(glyph);
        }
        else
        {
            Width = Height = 14;
            Children.Add(new StateGlyph(mark, 14));
        }
    }

    /// <summary>The dash of a state's outline in the key, in units of its stroke (1.8 px) round a 76 px rectangle: dots, a half drawn line, dashes, a short arc, solid.</summary>
    private static Avalonia.Collections.AvaloniaList<double>? Dash(string state) => state switch
    {
        "starting" => [0.01, 2],
        "stopping" => [21, 21],
        "stopped" => [2.2, 1.6],
        "restarting" => [9, 33],
        _ => null,
    };
}

/// <summary>The picker's tile for no change at all ("none": a faint dotted outline) and for Running (a plain outline, which is how a running shape looks).</summary>
internal sealed class PlainSwatch : Grid
{
    public PlainSwatch(bool none)
    {
        Classes.Add("stateswatch");
        Classes.Add(none ? "none" : "plain");
        Width = 26;
        Height = 16;
        Margin = new Thickness(6, 6, 0, 0);
        HorizontalAlignment = HorizontalAlignment.Center;
        var outline = new Rectangle { Width = 26, Height = 16, RadiusX = 4, RadiusY = 4, StrokeThickness = none ? 1.5 : 1.8 };
        outline.Classes.Add("outline");
        if (none) outline.StrokeDashArray = [1.3, 2];
        Children.Add(outline);
    }
}

/// <summary>
/// The key under the player: one mark for each state that is on the canvas now, drawn as it looks there, and nothing when no shape is in one. The words are
/// the browser's: "Stopped", and "Stopped inside" for a shape that holds one that is.
/// </summary>
internal static class StateKey
{
    /// <summary>A state as a person says it: "Stopped", and "Stopped inside: Checkout" for a shape that holds one that is, naming the shape inside.</summary>
    public static string Word(StateMark mark) => mark.Inside ? $"{States.Labels[mark.State]} inside{(mark.Via is null ? "" : $": {mark.Via}")}" : States.Labels[mark.State];

    /// <summary>The marks the key draws for these shapes: each distinct state once, in the order of the six, a shape's own before one it only holds.</summary>
    public static List<StateMark> Distinct(IEnumerable<StateMark> marks) =>
        marks.Distinct().OrderBy(m => Array.IndexOf(States.Names, m.State)).ThenBy(m => m.Inside).ToList();

    /// <summary>The key, or null when none of the shapes on the canvas is in a state.</summary>
    public static Control? Of(IEnumerable<StateMark> marks)
    {
        var items = Distinct(marks);
        return items.Count == 0 ? null : KeyRow.Of(items.Select(m => ((Control Swatch, string Label)?)(new StateSwatch(m), Word(m))).ToArray());
    }
}
