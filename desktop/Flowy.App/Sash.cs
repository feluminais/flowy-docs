using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;

namespace Flowy.App;

/// <summary>
/// The edge of a side panel you drag to resize it, as in VS Code: it lights up under the pointer, a double-click puts the width back, and the
/// arrow keys nudge it. The navigator grows as its edge goes right, Details as its edge goes left. ReaderView places it on the panel's edge and
/// decides what width a drag gives (<see cref="Resized"/> is the width the pointer asks for, before any limit).
/// </summary>
internal sealed class Sash : Border
{
    private const double Step = 16;

    private readonly int _sign;
    private double? _startX;
    private double _startWidth;

    public Sash(bool navigator, string name)
    {
        _sign = navigator ? 1 : -1;
        Classes.Add("sash");
        Width = 6;
        HorizontalAlignment = navigator ? HorizontalAlignment.Left : HorizontalAlignment.Right;
        Cursor = new Cursor(StandardCursorType.SizeWestEast);
        Focusable = true;
        IsVisible = false;
        AutomationProperties.SetName(this, name);
    }

    /// <summary>The panel's width now, read when a drag starts or a key is pressed.</summary>
    public Func<double> Current { get; set; } = () => 0;

    /// <summary>The width wanted, while a drag goes on or a key is pressed.</summary>
    public event Action<double>? Resized;

    /// <summary>A drag or a key press is over: the place to remember the width.</summary>
    public event Action? Settled;

    /// <summary>A double-click: back to the width the panel begins with.</summary>
    public event Action? Reset;

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;
        e.Handled = true;
        if (e.ClickCount == 2)
        {
            Reset?.Invoke();
            Settled?.Invoke();
            return;
        }
        _startX = e.GetPosition(Parent as Avalonia.Visual).X; // measured against the stage, which stays put as the sash moves
        _startWidth = Current();
        e.Pointer.Capture(this); // the drag goes on over the canvas, and nothing there sees it
        Classes.Add("drag");
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);
        if (_startX is { } x) Resized?.Invoke(_startWidth + _sign * (e.GetPosition(Parent as Avalonia.Visual).X - x));
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        End();
    }

    protected override void OnPointerCaptureLost(PointerCaptureLostEventArgs e)
    {
        base.OnPointerCaptureLost(e);
        End();
    }

    private void End()
    {
        if (_startX is null) return;
        _startX = null;
        Classes.Remove("drag");
        Settled?.Invoke();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        var step = e.Key == Key.Right ? Step : e.Key == Key.Left ? -Step : 0;
        if (step == 0)
        {
            base.OnKeyDown(e);
            return;
        }
        Resized?.Invoke(Current() + _sign * step);
        Settled?.Invoke();
        e.Handled = true; // the arrows of a flow playing are not meant for the sash
    }
}
