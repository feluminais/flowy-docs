using Avalonia;
using Avalonia.Controls;

namespace Flowy.App.Canvas;

/// <summary>
/// Whether a layer that animates on its own clock should draw a frame now. A window that is minimised shows nothing, so the clock stops and starts again when it comes back; a window that is
/// behind another (not the active one) is drawn a few times a second, enough to see what moves without spending a core on it.
/// </summary>
internal sealed class WindowFrames
{
    private static readonly TimeSpan BehindFrame = TimeSpan.FromMilliseconds(66);

    private Window? _window;
    private Action? _resume;
    private DateTime _drawn;

    /// <summary>Watches the window the layer is in; <paramref name="resume"/> is called when it is no longer minimised.</summary>
    public void Watch(TopLevel top, Action resume)
    {
        _resume = resume;
        if (top is not Window window || ReferenceEquals(window, _window)) return;
        Stop();
        _window = window;
        window.PropertyChanged += OnChanged;
    }

    public void Stop()
    {
        if (_window is not null) _window.PropertyChanged -= OnChanged;
        _window = null;
    }

    public bool Minimised => _window is { WindowState: WindowState.Minimized };

    /// <summary>Whether this frame is to be drawn: always for the active window, one in a while behind another.</summary>
    public bool Due(DateTime now)
    {
        if (_window is not { IsActive: false } || now - _drawn >= BehindFrame)
        {
            _drawn = now;
            return true;
        }
        return false;
    }

    /// <summary>Marks now as the last frame drawn: a clock that has just started draws at once.</summary>
    public void Drew(DateTime now) => _drawn = now;

    private void OnChanged(object? sender, AvaloniaPropertyChangedEventArgs e)
    {
        if (e.Property == Window.WindowStateProperty && !Minimised) _resume?.Invoke();
    }
}
