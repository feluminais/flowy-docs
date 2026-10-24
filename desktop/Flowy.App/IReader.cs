using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// What the parts of a <see cref="ReaderView"/> (the Failures tab, the panels, the comparison, edit mode) ask of the reader they sit in: what it holds in common (the folder,
/// the level, what is picked), and the few things only it can do (redraw, say something, go somewhere). A part holds its own state and nothing else of the reader's.
/// </summary>
internal interface IReader
{
    Folder? Folder { get; }

    /// <summary>The level on show.</summary>
    string CurrentView { get; }

    /// <summary>What is picked: it shows in Details.</summary>
    ReaderView.Side? Pick { get; set; }

    /// <summary>The navigator's tab, as chosen on its rail or its strip; null when it is closed.</summary>
    PanelTab? Tab { get; }

    bool Editing { get; }

    /// <summary>False while the folder can be written; true for a sample inside the install, a folder with a file that can't be read, or no folder.</summary>
    bool ReadOnly { get; }

    void Refresh();

    void ShowNotice(string text, double seconds = 0, Action? undo = null);

    void GoTo(string view);

    void OpenObject(string id);

    void Play(string flow, int step = 0);

    void SetTab(PanelTab tab);

    void CloseNavigator();

    void SetEditing(bool on);

    Task<bool> RunAsync(Func<EditDoc, EditDoc> op);

    /// <summary>Gives the keyboard back to the reader, so its keys work.</summary>
    void TakeFocus();

    /// <summary>Pans the canvas just far enough that these shapes are not under a panel.</summary>
    void RevealAll(IEnumerable<string> ids);

    /// <summary>Opens the Performance tab on a run, at a load or a time of it.</summary>
    void ShowRun(string run, double at);

    /// <summary>Puts text on the clipboard, and keeps it for a test that has none. False when the clipboard wasn't available.</summary>
    Task<bool> CopyAsync(string text);
}
