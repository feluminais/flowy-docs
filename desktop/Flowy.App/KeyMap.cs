using Avalonia.Input;
using Flowy.Core;

namespace Flowy.App;

/// <summary>A key press, as the keys need it: which key, where on the keyboard it sits, what is held, and the character it types.</summary>
internal readonly record struct KeyPress(Key Key, PhysicalKey Physical, KeyModifiers Mods, string? Symbol)
{
    public static KeyPress Of(KeyEventArgs e) => new(e.Key, e.PhysicalKey, e.KeyModifiers, e.KeySymbol);

    /// <summary>Nothing held.</summary>
    public bool Plain => Mods == KeyModifiers.None;

    /// <summary>Ctrl or Cmd is held (with anything else besides).</summary>
    public bool Command => (Mods & (KeyModifiers.Control | KeyModifiers.Meta)) != 0;

    public bool Shift => (Mods & KeyModifiers.Shift) != 0;

    /// <summary>A plain press of the letter on this place of the keyboard, whatever the layout types there.</summary>
    public bool Tap(PhysicalKey key) => Physical == key && Plain;

    public bool Arrow => Key is Key.Right or Key.Left;

    /// <summary>Which way an arrow goes.</summary>
    public int By => Key == Key.Right ? 1 : -1;
}

/// <summary>What the reader looks like at the moment of a key press: the things the keys' conditions ask about.</summary>
internal readonly record struct KeyState(
    bool Editing,
    bool ReadOnly,
    bool UndoMove, // the last thing done was dragging a box
    bool SearchOpen,
    bool ShortcutsOpen,
    bool PicksBoxes, // several boxes are picked
    bool Recording,
    bool Flow, // a flow is playing
    bool PerfOpen,
    bool HasLoad,
    bool FailuresOpen,
    bool ShowFlows,
    bool CanPerf,
    bool CanFailures,
    bool NavigatorShown,
    bool NavigatorUsed, // the last click or key was in the navigator
    bool InNavigator, // this press came from inside it
    bool RightOpen,
    bool Inside) // not at the top level
{
    /// <summary>
    /// Right after a box was dragged, Esc or Backspace take the drag back, which is what someone who just moved a box and got it wrong reaches for.
    /// It is only that one move: once anything else is done (a click, another edit, a move to another level) they go up a level again.
    /// </summary>
    public bool DragCanBeTakenBack => UndoMove && Editing && !ShortcutsOpen;
}

/// <summary>What a key can do. The reader supplies them; each does what its name says, on the screen as it is now.</summary>
internal interface IKeyActions
{
    void CloseSearch();

    /// <summary>Forgets a box being dragged or a line being drawn. False when there is none.</summary>
    bool CancelGesture();

    void TakeBackDrag();

    /// <summary>Clears a half-picked step of a flow being recorded. False when there is none.</summary>
    bool ResetPick();

    void ClearPicked();
    void CloseShortcuts();
    void CloseNavigator();
    void StopFlow();
    void ClosePanel();
    void Up();
    void ToggleEdit();
    void Add();
    void Delete();
    void SelectAll();
    void Undo();
    void Redo();
    void PerfStep(int by);
    void PerfFirst();
    void PerfLast();
    void PerfRamp();

    /// <summary>Steps through the failures list. False when there is no list to step through.</summary>
    bool StepFailures(Key key);

    void FlowStep(int by);
    void FlowFirst();
    void FlowLast();
    void FlowPlay();
    void FlowReplay();

    /// <summary>Opens the box in focus (or the one whose panel is open). False when there is none.</summary>
    bool Enter();

    void ToggleShortcuts();
    void Search();
    void Fit();
    void ToggleTab(PanelTab tab);
    void TogglePerf();
    void ToggleFailures();
}

/// <summary>The groups of the shortcut list, in the order it shows them.</summary>
internal enum HelpGroup { Reading, Flows, Performance, Failures, Editing }

/// <summary>A row an entry has in the shortcut list.</summary>
internal readonly record struct KeyHelp(HelpGroup Group, string What);

/// <summary>
/// One key (or keys that do one thing). <see cref="When"/> says whether it takes this press, <see cref="Run"/> does it; false from <see cref="Run"/> says there
/// was nothing to do, and the press goes on to the next entry.
/// </summary>
internal sealed record KeyEntry(string Id, string Keys, Func<KeyPress, KeyState, bool> When, Func<KeyPress, KeyState, IKeyActions, bool> Run, params KeyHelp[] Help);

/// <summary>
/// Every key the reader answers to, in one ordered list. The first entry that takes a press does it, so the order is part of what the keys mean: Esc closes
/// the layers one at a time, a load-test run takes the arrows before a flow does, and E works whatever is open. The list ? opens and the hint under the
/// load slider are read from the same entries, so a key is written down once. The browser has the same list in <c>ui/src/keymap.ts</c>.
/// </summary>
internal static class KeyMap
{
    private static KeyEntry Do(string id, string keys, Func<KeyPress, KeyState, bool> when, Action<KeyPress, KeyState, IKeyActions> run, params KeyHelp[] help) =>
        new(id, keys, when, (p, s, a) =>
        {
            run(p, s, a);
            return true;
        }, help);

    private static KeyHelp Reading(string what) => new(HelpGroup.Reading, what);
    private static KeyHelp Flows(string what) => new(HelpGroup.Flows, what);
    private static KeyHelp Performance(string what) => new(HelpGroup.Performance, what);
    private static KeyHelp Failures(string what) => new(HelpGroup.Failures, what);
    private static KeyHelp Editing(string what) => new(HelpGroup.Editing, what);

    public static readonly IReadOnlyList<KeyEntry> Entries =
    [
        // Esc peels one layer a press (see Escape). Straight after a drag in edit mode, Backspace takes the drag back as Esc does.
        new("escape", "Esc", (p, _) => p.Key == Key.Escape, (_, s, a) => Escape(s, a),
            Reading("Close what's open, then go up a level. The navigator closes only if your last click was in it"), Flows("Stop the flow"), Performance("Close the panel")),
        Do("undo-move", "Esc  Backspace", (p, s) => p.Key == Key.Back && p.Plain && s.DragCanBeTakenBack, (_, _, a) => a.TakeBackDrag(),
            Editing("Straight after dragging a shape: take the drag back")),

        // Edit mode: E turns it on and off from anywhere; the rest work inside it.
        Do("edit", "E", (p, s) => p.Tap(PhysicalKey.E) && !s.ReadOnly, (_, _, a) => a.ToggleEdit(), Reading("Edit mode on and off")),
        Do("add", "N", (p, s) => s.Editing && p.Tap(PhysicalKey.N), (_, _, a) => a.Add(), Editing("Add a shape here")),
        Do("delete", "Delete", (p, s) => s.Editing && p.Key == Key.Delete && p.Plain, (_, _, a) => a.Delete(), Editing("Delete the selected shapes or line")),
        Do("select-all", "Ctrl+A", (p, s) => s.Editing && p.Command && !p.Shift && p.Physical == PhysicalKey.A, (_, _, a) => a.SelectAll(), Editing("Select every shape in this view")),
        Do("redo", "Ctrl+Y  Ctrl+Shift+Z", (p, s) => s.Editing && p.Command && (p.Physical == PhysicalKey.Y || (p.Physical == PhysicalKey.Z && p.Shift)), (_, _, a) => a.Redo(), Editing("Redo")),
        Do("undo", "Ctrl+Z", (p, s) => s.Editing && p.Command && p.Physical == PhysicalKey.Z && !p.Shift, (_, _, a) => a.Undo(), Editing("Undo the last change")),

        // A load-test run takes the arrows before a flow does: a flow is not playing while one is open.
        Do("perf-step", "→  ←", (p, s) => s.PerfOpen && p.Arrow, (p, _, a) => a.PerfStep(p.By), Performance("Next and previous tested level")),
        Do("perf-ends", "Home  End", (p, s) => s.PerfOpen && (p.Key == Key.Home || (p.Key == Key.End && s.HasLoad)), (p, _, a) => { if (p.Key == Key.Home) a.PerfFirst(); else a.PerfLast(); },
            Performance("First and last tested level")),
        Do("perf-ramp", "P", (p, s) => s.PerfOpen && p.Tap(PhysicalKey.P), (_, _, a) => a.PerfRamp(), Performance("Ramp the load or play the time, or pause")),
        new("failure-step", "→  ←", (p, s) => s.FailuresOpen && p.Arrow, (p, _, a) => a.StepFailures(p.Key), Failures("Next and previous failure")),

        Do("flow-step", "→  ←", (p, s) => s.Flow && p.Arrow, (p, _, a) => a.FlowStep(p.By), Flows("Next and previous step")),
        Do("flow-ends", "Home  End", (p, s) => s.Flow && p.Key is Key.Home or Key.End, (p, _, a) => { if (p.Key == Key.Home) a.FlowFirst(); else a.FlowLast(); }, Flows("First and last step")),
        Do("flow-play", "P", (p, s) => s.Flow && p.Tap(PhysicalKey.P), (_, _, a) => a.FlowPlay(), Flows("Step through the flow on its own, or pause")),
        Do("flow-replay", "R", (p, s) => s.Flow && p.Tap(PhysicalKey.R), (_, _, a) => a.FlowReplay(), Flows("Replay the step")),

        // The box with keyboard focus (Tab moves it), else the one whose panel is open: in if it opens, else its panel.
        new("enter", "Enter", (p, s) => p.Key == Key.Enter && !s.Recording, (_, _, a) => a.Enter(), Reading("Open the selected shape")),
        Do("shortcuts", "?", (p, _) => p.Symbol == "?", (_, _, a) => a.ToggleShortcuts(), Reading("Show these shortcuts")),
        Do("search", "Ctrl+K  /", (p, _) => (p.Physical == PhysicalKey.K && p.Mods == KeyModifiers.Control) || p.Symbol == "/" || (p.Physical == PhysicalKey.Slash && p.Plain), (_, _, a) => a.Search(),
            Reading("Find a shape")),
        Do("fit", "F", (p, _) => p.Tap(PhysicalKey.F), (_, _, a) => a.Fit(), Reading("Fit the view")),
        Do("flows", "L", (p, s) => p.Tap(PhysicalKey.L) && s.ShowFlows, (_, _, a) => a.ToggleTab(PanelTab.Flows), Reading("Show every flow, and play one")),
        Do("explorer", "O", (p, _) => p.Tap(PhysicalKey.O), (_, _, a) => a.ToggleTab(PanelTab.Explorer), Reading("Show everything as a tree")),
        Do("perf", "T", (p, s) => p.Tap(PhysicalKey.T) && s.CanPerf, (_, _, a) => a.TogglePerf(), Reading("Show a load-test run on the diagram, where there is one")),
        Do("failures", "M", (p, s) => p.Tap(PhysicalKey.M) && s.CanFailures, (_, _, a) => a.ToggleFailures(), Reading("Show how things fail, worst first")),
        // Z zooms out, always: in edit mode Esc and Backspace may be busy taking a drag back, and going up should stay one key away.
        Do("up", "Backspace  Z", (p, s) => (p.Key == Key.Back || p.Physical == PhysicalKey.Z) && p.Plain && s.Inside && !s.Recording, (_, _, a) => a.Up(), Reading("Zoom out: go up a level")),
    ];

    /// <summary>The entry that takes this press, if any.</summary>
    public static KeyEntry? Match(KeyPress press, KeyState state) => Entries.FirstOrDefault(e => e.When(press, state));

    /// <summary>Does what the press asks. True when something was done, so the key is taken.</summary>
    public static bool Dispatch(KeyPress press, KeyState state, IKeyActions actions)
    {
        foreach (var entry in Entries)
            if (entry.When(press, state) && entry.Run(press, state, actions)) return true;
        return false;
    }

    /// <summary>
    /// What Esc closes, innermost first: the search, a drag or a line being drawn, the drag just made, a half-picked step, the boxes picked, and then the
    /// layers <see cref="Navigation.Escape"/> knows (the shortcut list, the navigator, a flow, the panel, a level). False when there was nothing to close.
    /// </summary>
    private static bool Escape(KeyState s, IKeyActions a)
    {
        if (s.SearchOpen)
        {
            // The search field closes itself on Escape; this is for when the focus has slipped out of it.
            a.CloseSearch();
            return true;
        }
        if (a.CancelGesture()) return true;
        if (s.DragCanBeTakenBack)
        {
            a.TakeBackDrag();
            return true;
        }
        if (a.ResetPick()) return true;
        if (!s.ShortcutsOpen && s.PicksBoxes)
        {
            a.ClearPicked();
            return true;
        }
        var navigator = s.NavigatorShown && (s.NavigatorUsed || s.InNavigator);
        switch (Navigation.Escape(s.ShortcutsOpen, navigator, s.Flow, s.RightOpen, s.Inside))
        {
            case EscapeStep.Shortcuts: a.CloseShortcuts(); return true;
            case EscapeStep.Navigator: a.CloseNavigator(); return true;
            case EscapeStep.Flow: a.StopFlow(); return true;
            case EscapeStep.Panel: a.ClosePanel(); return true;
            case EscapeStep.Up: a.Up(); return true;
            default: return false;
        }
    }

    // ---- the shortcut list ---------------------------------------------------------------------------------------

    /// <summary>The title of a group of the list.</summary>
    public static string Title(HelpGroup group) => group switch
    {
        HelpGroup.Reading => "Getting around",
        HelpGroup.Flows => "Flows",
        HelpGroup.Performance => "Performance",
        HelpGroup.Failures => "Failures",
        _ => "In edit mode",
    };

    /// <summary>Whether the list shows a group: the Performance keys only where T opens a run, the Failures keys only where M opens the analysis.</summary>
    public static bool Shows(HelpGroup group, KeyState state) => group switch
    {
        HelpGroup.Performance => state.CanPerf,
        HelpGroup.Failures => state.CanFailures,
        _ => true,
    };

    /// <summary>The order of each group's rows. A row that is not a key (a click, a drag) is written out here.</summary>
    private static readonly IReadOnlyDictionary<HelpGroup, (string Id, string Keys, string What)[]> Order = new Dictionary<HelpGroup, (string, string, string)[]>
    {
        [HelpGroup.Reading] = [R("enter"), R("escape"), R("up"), R("search"), R("fit"), R("flows"), R("explorer"), R("perf"), R("failures"), R("edit"), R("shortcuts")],
        [HelpGroup.Flows] = [R("flow-step"), R("flow-ends"), R("flow-play"), R("flow-replay"), R("escape")],
        [HelpGroup.Performance] = [R("perf-step"), R("perf-ends"), R("perf-ramp"), R("escape")],
        [HelpGroup.Failures] = [R("failure-step")],
        [HelpGroup.Editing] =
        [
            R("add"), ("", "Ctrl+click  Shift+click", "Add a shape to the selection, or take it out"), ("", "Shift+drag", "Draw a box round shapes to select them"),
            R("select-all"), R("delete"), R("undo"), R("undo-move"), R("redo"),
        ],
    };

    private static (string, string, string) R(string id) => (id, "", "");

    /// <summary>The rows of one group of the list: the keys (caps separated by two spaces), and what they do.</summary>
    public static IReadOnlyList<(string Keys, string What)> Rows(HelpGroup group) =>
        Order[group].Select(row =>
        {
            if (row.Id == "") return (row.Keys, row.What);
            var entry = Entries.First(e => e.Id == row.Id);
            return (entry.Keys, entry.Help.First(h => h.Group == group).What);
        }).ToList();
}
