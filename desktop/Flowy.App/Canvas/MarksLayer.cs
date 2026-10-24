using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Flowy.Core;

namespace Flowy.App.Canvas;

/// <summary>One mark to draw: its words, the kind of group it is for (its icon), and where on the canvas its bottom middle sits (before the lift).</summary>
internal sealed record MarkSpec(string Text, string Kind, double X, double Y);

/// <summary>
/// What a group says about the steps lit at this stop, as small pills above their lines: how often a repeat runs, or which lane it is.
/// Static, so it shows with motion off. It sits over the boxes in the same camera and takes no pointer.
/// </summary>
internal sealed class MarksLayer : Control
{
    private IReadOnlyList<MarkSpec> _marks = [];
    private Viewport _viewport = new(0, 0, 1);

    public MarksLayer()
    {
        IsHitTestVisible = false;
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    public Viewport Viewport
    {
        get => _viewport;
        set
        {
            _viewport = value;
            InvalidateVisual();
        }
    }

    public void Set(IReadOnlyList<MarkSpec> marks)
    {
        _marks = marks;
        InvalidateVisual();
    }

    private IBrush Brush(string key) => AppTheme.Brush(this, key);

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        if (_marks.Count == 0) return;
        var accent = Brush("AccentBrush");
        var bg = Brush("BgBrush");
        using var _ = context.PushTransform(Matrix.CreateScale(_viewport.Zoom, _viewport.Zoom) * Matrix.CreateTranslation(_viewport.X, _viewport.Y));
        foreach (var mark in _marks)
        {
            var text = new FormattedText(mark.Text, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, new Typeface(FontFamily.Default, FontStyle.Normal, FontWeight.SemiBold), 11, bg);
            const double icon = 11, gap = 4, pad = 9;
            var width = pad + icon + gap + text.Width + pad;
            var height = Math.Max(text.Height, icon) + 2;
            var left = mark.X - width / 2;
            var top = mark.Y - 12 - height;
            context.DrawRectangle(accent, null, new Avalonia.Rect(left, top, width, height), height / 2, height / 2);
            using (context.PushTransform(Matrix.CreateScale(icon / 24, icon / 24) * Matrix.CreateTranslation(left + pad, top + (height - icon) / 2)))
                context.DrawGeometry(null, new Pen(bg, 1.4, lineCap: PenLineCap.Round, lineJoin: PenLineJoin.Round), Geometry.Parse(Icons.ForKind(mark.Kind)));
            context.DrawText(text, new Point(left + pad + icon + gap, top + (height - text.Height) / 2));
        }
    }
}
