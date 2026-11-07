using System.Reflection;
using System.Runtime.CompilerServices;
using Avalonia.Controls;
using Avalonia.Threading;
using Xunit.v3;

[assembly: Flowy.App.Tests.CloseWindowsAfterEachTest]

namespace Flowy.App.Tests;

/// <summary>
/// Every window a test shows, so the next test starts without it. A window left open keeps its reader, model, canvas and timers alive (about
/// 15 MB on the Plum demo), and the tests close few of theirs: the fast set grew to 11 GB of live objects by its end, and the pauses a heap
/// that size takes on a CI machine broke the tests that time something.
/// </summary>
internal static class OpenWindows
{
    private static readonly HashSet<Window> Shown = [];

    /// <summary>
    /// True on the thread that has shown a window, which is Avalonia's. <c>Dispatcher.UIThread</c> binds itself to the first thread that asks for it, so a plain
    /// test's thread asking would take it from Avalonia (the headless start then fails with "a different thread owns it"), and an <c>Invoke</c> to it from there
    /// waits for a thread that never pumps. This flag lets the hook tell the two apart without asking.
    /// </summary>
    [ThreadStatic]
    private static bool _windowThread;

    [ModuleInitializer]
    internal static void Track()
    {
        Window.WindowOpenedEvent.AddClassHandler<Window>((window, _) =>
        {
            _windowThread = true;
            Shown.Add(window);
        });
        Window.WindowClosedEvent.AddClassHandler<Window>((window, _) => Shown.Remove(window));
    }

    internal static int Count => Shown.Count;

    internal static bool OnWindowThread => _windowThread;

    internal static void CloseAll()
    {
        foreach (var window in Shown.ToList()) window.Close();
        Shown.Clear();
        Dispatcher.UIThread.RunJobs();
    }
}

/// <summary>
/// Closes the windows a test left open once it ends, pass or fail. xUnit runs this on Avalonia's thread for a test that runs there; a plain test shows no
/// window, and its thread must not touch the dispatcher (see <see cref="OpenWindows.OnWindowThread"/>).
/// </summary>
[AttributeUsage(AttributeTargets.Assembly)]
internal sealed class CloseWindowsAfterEachTestAttribute : BeforeAfterTestAttribute
{
    public override void After(MethodInfo methodUnderTest, IXunitTest test)
    {
        if (OpenWindows.OnWindowThread) OpenWindows.CloseAll();
    }
}
