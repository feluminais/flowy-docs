using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Flowy.Core;
using CoreRect = Flowy.Core.Rect;

namespace Flowy.App.Canvas;

/// <summary>
/// A recursion's pile of ghost cards: copies of the box's own shape, each a step lower and narrower than the one above. It sits with the other layers
/// under the canvas's camera transform, in world units, UNDER the boxes, so the box covers the part of a card that is behind it and only what sticks out shows, whatever the shape.
/// The cards are faint and unfilled enough that a box under one stays readable.
/// </summary>
internal sealed class CardsLayer : Control
{
    private static readonly Dictionary<string, Geometry> Shapes = [];

    private CoreRect? _box;
    private string? _shape;
    private double _cards;

    public CardsLayer()
    {
        IsHitTestVisible = false;
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    /// <summary>Shows <paramref name="cards"/> cards (a fraction while one slides in or out) under <paramref name="box"/>, drawn in <paramref name="shapePath"/>, the box's shape in its own 200 x 72 area.</summary>
    public void Show(CoreRect box, string shapePath, double cards)
    {
        (_box, _shape, _cards) = (box, shapePath, cards);
        InvalidateVisual();
    }

    public void Clear()
    {
        _box = null;
        InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        if (_box is not { } box || _shape is not { } path || _cards <= 0) return;
        if (!Shapes.TryGetValue(path, out var shape)) Shapes[path] = shape = Geometry.Parse(path);
        var accent = this.TryFindResource("AccentBrush", ActualThemeVariant, out var found) && found is ISolidColorBrush solid ? solid.Color : Colors.Gray;
        var fill = new SolidColorBrush(accent, 0.08);
        var edge = new Pen(new SolidColorBrush(accent, 0.55), 1.5);
        for (var k = 1; k <= Math.Min(4, (int)Math.Ceiling(_cards)); k++)
        {
            var at = MotionMath.CardBox(box, k, Math.Min(1, _cards - (k - 1)));
            using var place = context.PushTransform(Matrix.CreateScale(at.Width / 200, at.Height / 72) * Matrix.CreateTranslation(at.X, at.Y));
            context.DrawGeometry(fill, edge, shape);
        }
    }
}
