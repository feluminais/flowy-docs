using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Input;

namespace Flowy.App.Tests;

internal static class SpaceKey
{
    /// <summary>Space pressed and let go: without the release the reader takes the next press for the key held down.</summary>
    internal static void PressSpace(this Window window)
    {
        window.KeyPress(Key.Space, RawInputModifiers.None, PhysicalKey.Space, " ");
        window.KeyRelease(Key.Space, RawInputModifiers.None, PhysicalKey.Space, " ");
    }
}
