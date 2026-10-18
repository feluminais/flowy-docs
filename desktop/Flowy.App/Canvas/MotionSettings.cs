using System.Runtime.InteropServices;

namespace Flowy.App.Canvas;

/// <summary>Whether the reader asked the system for less motion. Opening a box is then instant, as in the browser version.</summary>
internal static class MotionSettings
{
    private const uint GetClientAreaAnimation = 0x1042;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SystemParametersInfo(uint action, uint param, out bool value, uint winIni);

    /// <summary>
    /// On Windows, "Animation effects" off in Settings › Accessibility › Visual effects. Other systems report nothing here yet, and
    /// FLOWY_REDUCE_MOTION=1 sets it by hand (the screenshots use that).
    /// </summary>
    public static bool Reduced
    {
        get
        {
            switch (Environment.GetEnvironmentVariable("FLOWY_REDUCE_MOTION"))
            {
                case "1":
                    return true;
                case "0": // motion on whatever the system says (a test that waits for it)
                    return false;
            }
            if (!OperatingSystem.IsWindows()) return false;
            try
            {
                return SystemParametersInfo(GetClientAreaAnimation, 0, out var animations, 0) && !animations;
            }
            catch (Exception e) when (e is DllNotFoundException or EntryPointNotFoundException)
            {
                return false;
            }
        }
    }
}
