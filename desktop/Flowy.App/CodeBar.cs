using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;

namespace Flowy.App;

/// <summary>
/// The bar under a code box that scrolls a long line along. It sits below the box, so it never covers a line of code, and its handle keeps one size:
/// the scroll bar the box would draw itself is a hairline until the pointer reaches it, then widens over the last line. Drag the handle, click the bar to
/// jump there, or turn the wheel over it. It shows only while a line runs past the box.
/// </summary>
internal sealed class CodeBar : Control
{
    internal const double Tall = 12; // what the pointer can hit
    private const double Thick = 6; // what is drawn
    private const double Shortest = 32;

    private readonly ScrollViewer _scroller;
    private readonly IBrush _track;
    private readonly IBrush _handle;
    private readonly IBrush _hot;
    private double? _grab; // while dragging: how far into the handle it was taken
    private bool _over;

    public CodeBar(ScrollViewer scroller, Func<string, IBrush> resource)
    {
        _scroller = scroller;
        _track = resource("HoverBrush");
        _handle = resource("MutedBrush");
        _hot = resource("FgBrush");
        Height = Tall;
        IsVisible = false;
        Classes.Add("codebar");
        scroller.ScrollChanged += (_, _) => Update();
        scroller.PropertyChanged += (_, e) =>
        {
            if (e.Property == ScrollViewer.ExtentProperty || e.Property == ScrollViewer.ViewportProperty) Update();
        };
    }

    /// <summary>How far the code can scroll along: 0 when every line fits.</summary>
    internal double Room => Math.Max(0, _scroller.Extent.Width - _scroller.Viewport.Width);

    /// <summary>Where the handle is drawn on the bar, and how wide.</summary>
    internal (double Left, double Width) Handle
    {
        get
        {
            var bar = Bounds.Width;
            var width = Math.Min(bar, Math.Max(Shortest, bar * _scroller.Viewport.Width / Math.Max(1, _scroller.Extent.Width)));
            var left = Room <= 0 ? 0 : (bar - width) * Math.Clamp(_scroller.Offset.X / Room, 0, 1);
            return (left, width);
        }
    }

    private void Update()
    {
        IsVisible = Room > 0.5;
        InvalidateVisual();
    }

    public override void Render(DrawingContext context)
    {
        var top = (Bounds.Height - Thick) / 2;
        var corner = Thick / 2;
        context.DrawRectangle(_track, null, new Rect(0, top, Bounds.Width, Thick), corner, corner);
        var (left, width) = Handle;
        context.DrawRectangle(_over || _grab is not null ? _hot : _handle, null, new Rect(left, top, width, Thick), corner, corner);
    }

    /// <summary>Scrolls so the handle's left edge is at <paramref name="left"/> on the bar.</summary>
    private void MoveTo(double left)
    {
        var (_, width) = Handle;
        var travel = Bounds.Width - width;
        if (travel <= 0) return;
        _scroller.Offset = _scroller.Offset.WithX(Math.Clamp(left / travel, 0, 1) * Room);
    }

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;
        var x = e.GetPosition(this).X;
        var (left, width) = Handle;
        if (x < left || x > left + width)
        {
            MoveTo(x - width / 2); // a click beside the handle brings it there
            (left, _) = Handle;
        }
        _grab = x - left;
        e.Pointer.Capture(this);
        e.Handled = true;
        InvalidateVisual();
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);
        if (_grab is { } grab) MoveTo(e.GetPosition(this).X - grab);
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        _grab = null;
        e.Pointer.Capture(null);
        InvalidateVisual();
    }

    protected override void OnPointerCaptureLost(PointerCaptureLostEventArgs e)
    {
        base.OnPointerCaptureLost(e);
        _grab = null;
        InvalidateVisual();
    }

    protected override void OnPointerEntered(PointerEventArgs e)
    {
        base.OnPointerEntered(e);
        _over = true;
        InvalidateVisual();
    }

    protected override void OnPointerExited(PointerEventArgs e)
    {
        base.OnPointerExited(e);
        _over = false;
        InvalidateVisual();
    }

    protected override void OnPointerWheelChanged(PointerWheelEventArgs e)
    {
        base.OnPointerWheelChanged(e);
        var step = (e.Delta.X != 0 ? -e.Delta.X : -e.Delta.Y) * 48;
        _scroller.Offset = _scroller.Offset.WithX(Math.Clamp(_scroller.Offset.X + step, 0, Room));
        e.Handled = true; // the panel would scroll up and down instead
    }
}
