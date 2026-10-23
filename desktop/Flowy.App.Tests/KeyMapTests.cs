using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>
/// Every key the reader answers to, as a table of (state, key) and what the screen is afterwards, and whether the key was taken.
/// It pins the order the keys are tried in: the Esc ladder, the arrows that belong to a load-test run before a flow, E before the panel keys.
/// </summary>
public class KeyMapTests
{
    private static string Plum => Path.Combine(Repo.Root, "docs", "demo", "flowy");

    /// <summary>A reader on a copy of Plum, which a key may change (Delete, Ctrl+Z).</summary>
    private static (TempFolder Temp, Window Window, ReaderView Reader) Open()
    {
        TestApp.NoMotion();
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        foreach (var file in Directory.GetFiles(Plum, "*", SearchOption.AllDirectories))
        {
            var target = Path.Combine(dir, Path.GetRelativePath(Plum, file));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(file, target);
        }
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        Dispatcher.UIThread.RunJobs();
        return (temp, window, reader);
    }

    private static string Snap(ReaderView r) =>
        $"view={r.View} edit={r.Editing} panel={r.HasPanel} tab={r.ShownTabNow} details={r.DetailsOpenNow} perf={r.PerfOpenNow} fail={r.FailuresOpenNow} flow={r.PlayingFlowId}/{r.PlayingStep} " +
        $"short={r.ShortcutsOpen} search={r.SearchOpen} box={r.SelectedBoxId} picked={r.PickedNow.Count} undo={r.CanUndo} redo={r.CanRedo} " +
        $"pos={r.PerfState.Pos} ramp={r.PerfState.Ramping} mode={r.FailuresState.Mode} rec={r.RecordingNow is not null}" +
        // A comparison of two runs: which, how they are viewed, and where each run stands (the pane that has the focus, or the one on show in Swap, is the one a key moves).
        (r.CompareNow is { Kind: "run" } c ? $" runs={c.A}/{c.B}:{c.Mode} at={string.Join('/', RunPlaces(r))}" : "") +
        (r.PerfPanelNow.RunPicker is not null ? " runpicker=open" : "");

    private static IEnumerable<string> RunPlaces(ReaderView r)
    {
        static string Pos(double pos) => pos.ToString(System.Globalization.CultureInfo.InvariantCulture);
        if (r.CompareShown is not { } view) return [];
        return view.RunStage is { } stage ? stage.Keys.Select(k => Pos(stage.Run(k).Session.Pos) + (k == stage.OnKey ? "*" : "")) : view.RunPanes.Select(p => Pos(p.Session.Pos) + (p.Focused ? "*" : ""));
    }

    private sealed record Case(string Name, Action<Window, ReaderView> Setup, Key Key, PhysicalKey Physical, RawInputModifiers Mods = RawInputModifiers.None, string? Symbol = null);

    private static void Edit(Window w, ReaderView r) => r.SetEditing(true);

    private static void Shop(Window w, ReaderView r)
    {
        r.GoTo("ordering");
        r.OpenObject("order-api");
    }

    private static void Flow(Window w, ReaderView r)
    {
        var flow = r.Folder!.Model.Flows.OrderByDescending(f => f.Value.Steps.Count).First();
        r.GoTo(flow.Value.View ?? Names.Root);
        r.Play(flow.Key, 1);
    }

    private static void Perf(Window w, ReaderView r) => w.KeyPress(Key.T, RawInputModifiers.None, PhysicalKey.T, null);

    private static void Failures(Window w, ReaderView r) => w.KeyPress(Key.M, RawInputModifiers.None, PhysicalKey.M, null);

    /// <summary>Two runs side by side (the first has the focus), or in Swap.</summary>
    private static void TwoRuns(Window w, ReaderView r) => r.OpenRunCompareById("dinner-rush", "eta-batched");

    private static void TwoRunsSwap(Window w, ReaderView r) => r.OpenRunCompareById("dinner-rush", "eta-batched", swap: true);

    private static Action<Window, ReaderView> Then(params Action<Window, ReaderView>[] steps) => (w, r) =>
    {
        foreach (var s in steps) s(w, r);
    };

    private static Action<Window, ReaderView> Type(Key key, PhysicalKey physical, RawInputModifiers mods = RawInputModifiers.None, string? symbol = null) =>
        (w, _) => w.KeyPress(key, mods, physical, symbol);

    private static readonly Action<Window, ReaderView> None = (_, _) => { };
    private static readonly Action<Window, ReaderView> PickAll = Type(Key.A, PhysicalKey.A, RawInputModifiers.Control);
    private static readonly Action<Window, ReaderView> Flows = (_, r) => r.ClickRail(PanelTab.Flows);
    private static readonly Action<Window, ReaderView> Shortcuts = Type(Key.OemQuestion, PhysicalKey.Slash, RawInputModifiers.Shift, "?");
    private static readonly Action<Window, ReaderView> CtrlK = Type(Key.K, PhysicalKey.K, RawInputModifiers.Control);

    private static Case[] Cases() =>
    [
        // Escape: one layer a press
        new("esc at the top", None, Key.Escape, PhysicalKey.Escape),
        new("esc inside a view", (_, r) => r.GoTo("ordering"), Key.Escape, PhysicalKey.Escape),
        new("esc with a box open", Shop, Key.Escape, PhysicalKey.Escape),
        new("esc with the shortcuts and a box open", Then(Shop, Shortcuts), Key.Escape, PhysicalKey.Escape),
        new("esc with search open and focus in the reader", Then(Shop, CtrlK, (_, r) => r.Focus()), Key.Escape, PhysicalKey.Escape),
        new("esc with the Flows list opened by the rail", Then(Shop, Flows), Key.Escape, PhysicalKey.Escape),
        new("esc with a flow playing", Flow, Key.Escape, PhysicalKey.Escape),
        new("esc with the load-test panel", Then(Shop, Perf), Key.Escape, PhysicalKey.Escape),
        new("esc with the failures panel", Then(Shop, Failures), Key.Escape, PhysicalKey.Escape),
        new("esc in edit mode, nothing picked, inside", Then(Edit, (_, r) => r.GoTo("ordering")), Key.Escape, PhysicalKey.Escape),
        new("esc in edit mode, a box open", Then(Edit, Shop), Key.Escape, PhysicalKey.Escape),
        new("esc in edit mode, boxes picked", Then(Edit, (_, r) => r.GoTo("ordering"), PickAll), Key.Escape, PhysicalKey.Escape),
        new("ctrl+esc at the top", None, Key.Escape, PhysicalKey.Escape, RawInputModifiers.Control),

        // Backspace and Z go up
        new("backspace inside", (_, r) => r.GoTo("ordering"), Key.Back, PhysicalKey.Backspace),
        new("backspace at the top", None, Key.Back, PhysicalKey.Backspace),
        new("ctrl+backspace inside", (_, r) => r.GoTo("ordering"), Key.Back, PhysicalKey.Backspace, RawInputModifiers.Control),
        new("z inside", (_, r) => r.GoTo("ordering"), Key.Z, PhysicalKey.Z),
        new("z at the top", None, Key.Z, PhysicalKey.Z),
        new("z in edit mode inside", Then(Edit, (_, r) => r.GoTo("ordering")), Key.Z, PhysicalKey.Z),
        new("shift+z inside", (_, r) => r.GoTo("ordering"), Key.Z, PhysicalKey.Z, RawInputModifiers.Shift),
        new("ctrl+z reading", (_, r) => r.GoTo("ordering"), Key.Z, PhysicalKey.Z, RawInputModifiers.Control),

        // Enter
        new("enter with nothing open", None, Key.Enter, PhysicalKey.Enter),
        new("enter on a box that has boxes inside", (_, r) => r.OpenObject("ordering"), Key.Enter, PhysicalKey.Enter),
        new("enter on a leaf box", Shop, Key.Enter, PhysicalKey.Enter),

        // The reader's own keys
        new("?", None, Key.OemQuestion, PhysicalKey.Slash, RawInputModifiers.Shift, "?"),
        new("? with shortcuts open", Shortcuts, Key.OemQuestion, PhysicalKey.Slash, RawInputModifiers.Shift, "?"),
        new("ctrl+k", None, Key.K, PhysicalKey.K, RawInputModifiers.Control),
        new("ctrl+shift+k", None, Key.K, PhysicalKey.K, RawInputModifiers.Control | RawInputModifiers.Shift),
        new("k", None, Key.K, PhysicalKey.K),
        new("slash symbol", None, Key.Divide, PhysicalKey.NumPadDivide, RawInputModifiers.None, "/"),
        new("slash key", None, Key.OemQuestion, PhysicalKey.Slash),
        new("shift+slash key without a symbol", None, Key.OemQuestion, PhysicalKey.Slash, RawInputModifiers.Shift),
        new("f", None, Key.F, PhysicalKey.F),
        new("ctrl+f", None, Key.F, PhysicalKey.F, RawInputModifiers.Control),
        new("l", None, Key.L, PhysicalKey.L),
        new("shift+l", None, Key.L, PhysicalKey.L, RawInputModifiers.Shift),
        new("o", None, Key.O, PhysicalKey.O),
        new("o twice is a toggle", Type(Key.O, PhysicalKey.O), Key.O, PhysicalKey.O),
        new("t", None, Key.T, PhysicalKey.T),
        new("t twice is a toggle", Perf, Key.T, PhysicalKey.T),
        new("m", None, Key.M, PhysicalKey.M),
        new("m twice is a toggle", Failures, Key.M, PhysicalKey.M),
        new("t in edit mode", Edit, Key.T, PhysicalKey.T),
        new("m in edit mode", Edit, Key.M, PhysicalKey.M),
        new("e", None, Key.E, PhysicalKey.E),
        new("e again", Edit, Key.E, PhysicalKey.E),
        new("ctrl+e", None, Key.E, PhysicalKey.E, RawInputModifiers.Control),
        new("e with the load-test panel open", Perf, Key.E, PhysicalKey.E),
        new("n reading", None, Key.N, PhysicalKey.N),
        new("delete reading", None, Key.Delete, PhysicalKey.Delete),
        new("ctrl+a reading", None, Key.A, PhysicalKey.A, RawInputModifiers.Control),
        new("ctrl+y reading", None, Key.Y, PhysicalKey.Y, RawInputModifiers.Control),

        // Edit mode
        new("n in edit mode", Edit, Key.N, PhysicalKey.N),
        new("shift+n in edit mode", Edit, Key.N, PhysicalKey.N, RawInputModifiers.Shift),
        new("delete in edit mode with a box open", Then(Edit, Shop), Key.Delete, PhysicalKey.Delete),
        new("delete in edit mode with nothing open", Edit, Key.Delete, PhysicalKey.Delete),
        new("ctrl+a in edit mode", Then(Edit, (_, r) => r.GoTo("ordering")), Key.A, PhysicalKey.A, RawInputModifiers.Control),
        new("ctrl+shift+a in edit mode", Then(Edit, (_, r) => r.GoTo("ordering")), Key.A, PhysicalKey.A, RawInputModifiers.Control | RawInputModifiers.Shift),
        new("ctrl+z in edit mode, nothing to undo", Edit, Key.Z, PhysicalKey.Z, RawInputModifiers.Control),
        new("ctrl+y in edit mode, nothing to redo", Edit, Key.Y, PhysicalKey.Y, RawInputModifiers.Control),
        new("ctrl+shift+z in edit mode, nothing to redo", Edit, Key.Z, PhysicalKey.Z, RawInputModifiers.Control | RawInputModifiers.Shift),
        new("ctrl+f in edit mode", Edit, Key.F, PhysicalKey.F, RawInputModifiers.Control),
        new("p in edit mode", Edit, Key.P, PhysicalKey.P),

        // A flow is playing
        new("flow: right", Flow, Key.Right, PhysicalKey.ArrowRight),
        new("flow: left", Flow, Key.Left, PhysicalKey.ArrowLeft),
        new("flow: home", Flow, Key.Home, PhysicalKey.Home),
        new("flow: end", Flow, Key.End, PhysicalKey.End),
        new("flow: p", Flow, Key.P, PhysicalKey.P),
        new("flow: shift+p", Flow, Key.P, PhysicalKey.P, RawInputModifiers.Shift),
        new("flow: r", Flow, Key.R, PhysicalKey.R),
        new("flow: x is not taken outside Swap", Flow, Key.X, PhysicalKey.X),
        new("no flow: p", None, Key.P, PhysicalKey.P),
        new("no flow: r", None, Key.R, PhysicalKey.R),
        new("no flow: right", None, Key.Right, PhysicalKey.ArrowRight),
        new("flow: l", Flow, Key.L, PhysicalKey.L),
        new("flow: z", Flow, Key.Z, PhysicalKey.Z),
        new("flow: enter", Flow, Key.Enter, PhysicalKey.Enter),

        // A load-test run is open: its keys come before a flow's
        new("perf: right", Perf, Key.Right, PhysicalKey.ArrowRight),
        new("perf: left after right", Then(Perf, Type(Key.Right, PhysicalKey.ArrowRight)), Key.Left, PhysicalKey.ArrowLeft),
        new("perf: home", Then(Perf, Type(Key.Right, PhysicalKey.ArrowRight)), Key.Home, PhysicalKey.Home),
        new("perf: end", Perf, Key.End, PhysicalKey.End),
        new("perf: p", Perf, Key.P, PhysicalKey.P),
        new("perf: shift+p", Perf, Key.P, PhysicalKey.P, RawInputModifiers.Shift),
        new("perf: r", Perf, Key.R, PhysicalKey.R),
        new("perf while a flow plays: right", Then(Flow, Perf), Key.Right, PhysicalKey.ArrowRight),
        new("perf while a flow plays: p", Then(Flow, Perf), Key.P, PhysicalKey.P),
        new("perf: m", Perf, Key.M, PhysicalKey.M),
        new("perf: l", Perf, Key.L, PhysicalKey.L),
        new("perf: z inside", Then((_, r) => r.GoTo("ordering"), Perf), Key.Z, PhysicalKey.Z),

        // Failures
        new("failures: right", Failures, Key.Right, PhysicalKey.ArrowRight),
        new("failures: left", Then(Failures, Type(Key.Right, PhysicalKey.ArrowRight), Type(Key.Right, PhysicalKey.ArrowRight)), Key.Left, PhysicalKey.ArrowLeft),
        new("failures: home", Failures, Key.Home, PhysicalKey.Home),
        new("failures: p", Failures, Key.P, PhysicalKey.P),
        new("failures: t", Failures, Key.T, PhysicalKey.T),
        new("failures while a flow plays: right", Then(Flow, Failures), Key.Right, PhysicalKey.ArrowRight),

        // C with a run on show is for the run: the picker (this run is linked to none). Two runs compared take the keys of the Performance panel, for the pane last clicked, and the keys of a flow stay out
        new("perf: c", Perf, Key.C, PhysicalKey.C),
        new("two runs: right", TwoRuns, Key.Right, PhysicalKey.ArrowRight),
        new("two runs: left", Then(TwoRuns, Type(Key.Right, PhysicalKey.ArrowRight)), Key.Left, PhysicalKey.ArrowLeft),
        new("two runs: home", Then(TwoRuns, Type(Key.Right, PhysicalKey.ArrowRight)), Key.Home, PhysicalKey.Home),
        new("two runs: end", TwoRuns, Key.End, PhysicalKey.End),
        new("two runs: p", TwoRuns, Key.P, PhysicalKey.P),
        new("two runs: r", TwoRuns, Key.R, PhysicalKey.R),
        new("two runs: f", TwoRuns, Key.F, PhysicalKey.F),
        new("two runs: x side by side", TwoRuns, Key.X, PhysicalKey.X),
        new("two runs in swap: x", Then(TwoRunsSwap), Key.X, PhysicalKey.X),
        new("two runs in swap: left after x", Then(TwoRunsSwap, Type(Key.X, PhysicalKey.X)), Key.Left, PhysicalKey.ArrowLeft),
        new("two runs: c", TwoRuns, Key.C, PhysicalKey.C),
        new("two runs: esc", TwoRuns, Key.Escape, PhysicalKey.Escape),
        new("two runs: t", TwoRuns, Key.T, PhysicalKey.T),
    ];

    [AvaloniaFact]
    public async Task Every_key_does_what_the_reader_has_always_done_with_it()
    {
        var lines = new List<string>();
        foreach (var c in Cases())
        {
            var (temp, window, reader) = Open();
            using var _ = temp;
            c.Setup(window, reader);
            Dispatcher.UIThread.RunJobs();
            var handled = false;
            window.AddHandler(InputElement.KeyDownEvent, (_, e) => handled = e.Handled, Avalonia.Interactivity.RoutingStrategies.Bubble, handledEventsToo: true);
            var before = Snap(reader);
            window.KeyPress(c.Key, c.Mods, c.Physical, c.Symbol);
            Dispatcher.UIThread.RunJobs();
            await Task.Delay(30); // an undo or a delete is saved in the background
            Dispatcher.UIThread.RunJobs();
            var after = Snap(reader);
            lines.Add($"{c.Name} | {(handled ? "taken" : "left")} | {(before == after ? "same" : after)}");
        }
        var dump = Environment.GetEnvironmentVariable("FLOWY_KEYMAP_DUMP");
        if (dump is not null) File.WriteAllLines(dump, lines);
        Assert.Equal(Expected.Lines, lines);
    }

    private static KeyState State(bool editing = false, bool perf = false, bool flow = false, bool failures = false, bool drag = false, bool inside = false, bool shortcuts = false) =>
        default(KeyState) with
        {
            Editing = editing, UndoMove = drag, ShortcutsOpen = shortcuts, Flow = flow, PerfOpen = perf, HasLoad = perf, FailuresOpen = failures,
            ShowFlows = true, CanPerf = true, CanFailures = true, Inside = inside,
        };

    private static string? Pick(Key key, PhysicalKey physical, KeyState state, KeyModifiers mods = KeyModifiers.None, string? symbol = null) =>
        KeyMap.Match(new KeyPress(key, physical, mods, symbol), state)?.Id;

    /// <summary>The first entry that takes a press wins, so the order is what the keys mean.</summary>
    [AvaloniaFact]
    public void Esc_goes_back_to_the_level_before_and_Z_forgets_the_way_back()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.GoTo("ordering");
        reader.GoTo("delivery");
        window.KeyPress(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);
        Assert.Equal("ordering", reader.View); // not the level above (the overview)
        window.KeyPress(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);
        Assert.Equal(Names.Root, reader.View);
        window.KeyPress(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);
        Assert.Equal(Names.Root, reader.View);

        reader.GoTo("ordering");
        reader.GoTo("delivery");
        window.KeyPress(Key.Z, RawInputModifiers.None, PhysicalKey.Z, null);
        Assert.Equal(Names.Root, reader.View);
        reader.GoTo("delivery"); // opened straight from the top: nothing to go back to but the level above
        window.KeyPress(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);
        Assert.Equal(Names.Root, reader.View);
    }

    [Fact]
    public void The_first_entry_that_takes_a_press_wins()
    {
        Assert.Equal("escape", Pick(Key.Escape, PhysicalKey.Escape, State(editing: true, drag: true)));
        Assert.Equal("undo-move", Pick(Key.Back, PhysicalKey.Backspace, State(editing: true, drag: true, inside: true)));
        Assert.Equal("up", Pick(Key.Back, PhysicalKey.Backspace, State(editing: true, drag: true, shortcuts: true, inside: true))); // the list is open: Backspace goes up
        Assert.Equal("up", Pick(Key.Z, PhysicalKey.Z, State(editing: true, drag: true, inside: true)));
        Assert.Equal("up", Pick(Key.Z, PhysicalKey.Z, State() with { Compare = true, PaneInside = true })); // a pane of a comparison zoomed into a shape
        Assert.NotEqual("up", Pick(Key.Z, PhysicalKey.Z, State() with { Compare = true }));
        Assert.Null(Pick(Key.Back, PhysicalKey.Backspace, State(), KeyModifiers.Control));
        Assert.Equal("perf-step", Pick(Key.Right, PhysicalKey.ArrowRight, State(perf: true, flow: true)));
        Assert.Equal("flow-step", Pick(Key.Right, PhysicalKey.ArrowRight, State(flow: true)));
        Assert.Equal("failure-step", Pick(Key.Right, PhysicalKey.ArrowRight, State(failures: true)));
        Assert.Equal("perf-ramp", Pick(Key.P, PhysicalKey.P, State(perf: true, flow: true)));
        Assert.Equal("flow-play", Pick(Key.P, PhysicalKey.P, State(flow: true)));
        Assert.Equal("edit", Pick(Key.E, PhysicalKey.E, State(perf: true)));
        // Two runs compared take the keys of the Performance panel (for the pane last clicked), and the keys of a flow stay out; two flows compared take the keys of a flow.
        var runs = State() with { Compare = true, RunCompare = true, HasLoad = false };
        Assert.Equal("perf-step", Pick(Key.Left, PhysicalKey.ArrowLeft, runs));
        Assert.Equal("perf-ends", Pick(Key.Home, PhysicalKey.Home, runs));
        Assert.Equal("perf-ends", Pick(Key.End, PhysicalKey.End, runs));
        Assert.Equal("perf-ramp", Pick(Key.P, PhysicalKey.P, runs));
        Assert.Null(Pick(Key.R, PhysicalKey.R, runs));
        Assert.Equal("flow-step", Pick(Key.Left, PhysicalKey.ArrowLeft, State() with { Compare = true }));
        Assert.Equal("flow-replay", Pick(Key.R, PhysicalKey.R, State() with { Compare = true }));
        // C is taken with the Performance panel open (for the run on show), and not with nothing open.
        Assert.Equal("compare", Pick(Key.C, PhysicalKey.C, State(perf: true)));
        Assert.Null(Pick(Key.C, PhysicalKey.C, State()));
        Assert.Equal("redo", Pick(Key.Z, PhysicalKey.Z, State(editing: true), KeyModifiers.Control | KeyModifiers.Shift));
        Assert.Equal("undo", Pick(Key.Z, PhysicalKey.Z, State(editing: true), KeyModifiers.Control));
        Assert.Null(Pick(Key.Z, PhysicalKey.Z, State(), KeyModifiers.Control));
        Assert.Equal("shortcuts", Pick(Key.OemQuestion, PhysicalKey.Slash, State(), KeyModifiers.Shift, "?"));
        Assert.Equal("search", Pick(Key.OemQuestion, PhysicalKey.Slash, State()));
        Assert.Null(Pick(Key.OemQuestion, PhysicalKey.Slash, State(), KeyModifiers.Shift));
    }

    [Fact]
    public void Every_entry_has_its_own_id_and_every_row_of_the_shortcut_list_has_words()
    {
        Assert.Equal(KeyMap.Entries.Count, KeyMap.Entries.Select(e => e.Id).Distinct().Count());
        foreach (var group in Enum.GetValues<HelpGroup>())
        {
            var rows = KeyMap.Rows(group);
            Assert.NotEmpty(rows);
            Assert.All(rows, r => Assert.False(string.IsNullOrWhiteSpace(r.Keys) || string.IsNullOrWhiteSpace(r.What)));
        }
        Assert.False(KeyMap.Shows(HelpGroup.Performance, State() with { CanPerf = false }));
        Assert.True(KeyMap.Shows(HelpGroup.Performance, State()));
    }

    /// <summary>What the ? list says, in the order it says it, for readers that show different groups.</summary>
    [AvaloniaFact]
    public void The_shortcut_list_says_the_same_keys_in_the_same_order()
    {
        var lines = new List<string>();
        foreach (var (name, setup) in new (string, Func<string>)[]
        {
            ("everything", () => Plum),
            ("editing", () => Plum),
            ("run but no analysis", () => Path.Combine(Repo.Root, "perf-lab", "flowy")),
            ("neither", () => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "text", "flowy")),
        })
        {
            TestApp.NoMotion();
            var dir = setup();
            var reader = new ReaderView();
            var window = new Window { Width = 1200, Height = 800, Content = reader };
            window.Show();
            reader.Load(FolderLoader.Load(dir), dir);
            if (name == "editing") reader.SetEditing(true);
            Dispatcher.UIThread.RunJobs();
            reader.ShowShortcuts();
            var texts = reader.GetVisualDescendants().OfType<ShortcutsCard>().Single().GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text);
            lines.Add($"{name} | {string.Join(" | ", texts)}");
            window.Close();
        }
        var dump = Environment.GetEnvironmentVariable("FLOWY_KEYMAP_DUMP2");
        if (dump is not null) File.WriteAllLines(dump, lines);
        Assert.Equal(Expected.Shortcuts, lines);
    }

    /// <summary>Straight after a drag Esc takes the drag back, but not while the shortcut list is open (Esc closes that), and not with Ctrl held (Backspace).</summary>
    [AvaloniaFact]
    public async Task Taking_back_a_drag_comes_after_closing_the_shortcut_list()
    {
        var (temp, _, window, reader) = EditModeTests.Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.GoTo("shop");
        EditModeTests.Settle(window);
        var start = EditModeTests.Where(window, reader.Canvas, "web", 100, 25);
        window.MouseDown(start, MouseButton.Left);
        window.MouseMove(new Point(start.X + 20, start.Y + 10), RawInputModifiers.LeftMouseButton);
        window.MouseMove(new Point(start.X + 80, start.Y + 40), RawInputModifiers.LeftMouseButton);
        window.MouseUp(new Point(start.X + 80, start.Y + 40), MouseButton.Left);
        await EditModeTests.Until(() => reader.CanUndoMove);

        reader.ShowShortcuts();
        EditModeTests.Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.False(reader.ShortcutsOpen);
        Assert.True(reader.CanUndoMove); // the list took the Esc

        EditModeTests.Press(window, Key.Back, PhysicalKey.Backspace, RawInputModifiers.Control);
        Assert.Equal("shop", reader.View); // Ctrl+Backspace is neither taking the drag back nor going up
        Assert.True(reader.CanUndoMove);

        EditModeTests.Press(window, Key.Escape, PhysicalKey.Escape);
        await EditModeTests.Until(() => !reader.CanUndoMove);
        Assert.Equal("shop", reader.View);
    }
}

/// <summary>What the screen says after each key, as the reader answered it before the keys moved into a table (see KeyMap).</summary>
internal static class Expected
{
    public static readonly string[] Lines =
    [
        "esc at the top | left | same",
        "esc inside a view | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "esc with a box open | taken | view=ordering edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "esc with the shortcuts and a box open | taken | view=ordering edit=False panel=True tab= details=True perf=False fail=False flow=/0 short=False search=False box=order-api picked=1 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "esc with search open and focus in the reader | taken | view=ordering edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "esc with the Flows list opened by the rail | taken | view=ordering edit=False panel=True tab= details=True perf=False fail=False flow=/0 short=False search=False box=order-api picked=1 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "esc with a flow playing | taken | view=delivery edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "esc with the load-test panel | taken | view=ordering edit=False panel=True tab= details=True perf=False fail=False flow=/0 short=False search=False box=order-api picked=1 undo=False redo=False pos=3 ramp=False mode= rec=False",
        "esc with the failures panel | taken | view=ordering edit=False panel=True tab= details=True perf=False fail=False flow=/0 short=False search=False box=order-api picked=1 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "esc in edit mode, nothing picked, inside | taken | view=root edit=True panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "esc in edit mode, a box open | taken | view=ordering edit=True panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "esc in edit mode, boxes picked | taken | view=ordering edit=True panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "ctrl+esc at the top | left | same",
        "backspace inside | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "backspace at the top | left | same",
        "ctrl+backspace inside | left | same",
        "z inside | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "z at the top | left | same",
        "z in edit mode inside | taken | view=root edit=True panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "shift+z inside | left | same",
        "ctrl+z reading | left | same",
        "enter with nothing open | left | same",
        "enter on a box that has boxes inside | taken | view=ordering edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "enter on a leaf box | taken | view=order-api edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "? | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=True search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "? with shortcuts open | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "ctrl+k | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=True box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "ctrl+shift+k | left | same",
        "k | left | same",
        "slash symbol | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=True box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "slash key | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=True box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "shift+slash key without a symbol | left | same",
        "f | taken | same",
        "ctrl+f | left | same",
        "l | taken | view=root edit=False panel=True tab=Flows details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "shift+l | left | same",
        "o | taken | view=root edit=False panel=True tab=Explorer details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "o twice is a toggle | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "t | taken | view=root edit=False panel=True tab=Performance details=False perf=True fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=3 ramp=False mode= rec=False",
        "t twice is a toggle | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=3 ramp=False mode= rec=False",
        "m | taken | view=root edit=False panel=True tab=Failures details=False perf=False fail=True flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "m twice is a toggle | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "t in edit mode | left | same",
        "m in edit mode | taken | view=root edit=True panel=True tab=Failures details=False perf=False fail=True flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "e | taken | view=root edit=True panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "e again | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "ctrl+e | left | same",
        "e with the load-test panel open | taken | view=root edit=True panel=True tab=Performance details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=3 ramp=False mode= rec=False",
        "n reading | left | same",
        "delete reading | left | same",
        "ctrl+a reading | left | same",
        "ctrl+y reading | left | same",
        "n in edit mode | taken | view=root edit=True panel=True tab= details=True perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "shift+n in edit mode | left | same",
        "delete in edit mode with a box open | taken | view=ordering edit=True panel=True tab= details=True perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "delete in edit mode with nothing open | taken | same",
        "ctrl+a in edit mode | taken | view=ordering edit=True panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=7 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "ctrl+shift+a in edit mode | left | same",
        "ctrl+z in edit mode, nothing to undo | taken | same",
        "ctrl+y in edit mode, nothing to redo | taken | same",
        "ctrl+shift+z in edit mode, nothing to redo | taken | same",
        "ctrl+f in edit mode | left | same",
        "p in edit mode | left | same",
        "flow: right | taken | view=delivery edit=False panel=False tab= details=False perf=False fail=False flow=deliver-order/2 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "flow: left | taken | view=delivery edit=False panel=False tab= details=False perf=False fail=False flow=deliver-order/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "flow: home | taken | view=delivery edit=False panel=False tab= details=False perf=False fail=False flow=deliver-order/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "flow: end | taken | view=delivery edit=False panel=False tab= details=False perf=False fail=False flow=deliver-order/7 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "flow: p | taken | same",
        "flow: shift+p | left | same",
        "flow: r | taken | same",
        "flow: x is not taken outside Swap | left | same",
        "no flow: p | left | same",
        "no flow: r | left | same",
        "no flow: right | left | same",
        "flow: l | taken | view=delivery edit=False panel=True tab=Flows details=False perf=False fail=False flow=deliver-order/1 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "flow: z | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "flow: enter | left | same",
        "perf: right | taken | view=root edit=False panel=True tab=Performance details=False perf=True fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=4 ramp=False mode= rec=False",
        "perf: left after right | taken | view=root edit=False panel=True tab=Performance details=False perf=True fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=3 ramp=False mode= rec=False",
        "perf: home | taken | view=root edit=False panel=True tab=Performance details=False perf=True fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "perf: end | taken | view=root edit=False panel=True tab=Performance details=False perf=True fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=4 ramp=False mode= rec=False",
        "perf: p | taken | same",
        "perf: shift+p | left | same",
        "perf: r | left | same",
        "perf while a flow plays: right | taken | view=delivery edit=False panel=True tab=Performance details=False perf=True fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=4 ramp=False mode= rec=False",
        "perf while a flow plays: p | taken | same",
        "perf: m | taken | view=root edit=False panel=True tab=Failures details=False perf=False fail=True flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=3 ramp=False mode= rec=False",
        "perf: l | taken | view=root edit=False panel=True tab=Flows details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=3 ramp=False mode= rec=False",
        "perf: z inside | taken | view=root edit=False panel=True tab=Performance details=False perf=True fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=3 ramp=False mode= rec=False",
        "failures: right | taken | view=root edit=False panel=True tab=Failures details=False perf=False fail=True flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode=refund-not-recorded rec=False",
        "failures: left | taken | view=root edit=False panel=True tab=Failures details=False perf=False fail=True flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode=refund-not-recorded rec=False",
        "failures: home | left | same",
        "failures: p | left | same",
        "failures: t | taken | view=root edit=False panel=True tab=Performance details=False perf=True fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=3 ramp=False mode= rec=False",
        "failures while a flow plays: right | taken | view=delivery edit=False panel=True tab=Failures details=False perf=False fail=True flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode=eta-mapbox-fails rec=False",
        "perf: c | taken | view=root edit=False panel=True tab=Performance details=False perf=True fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=3 ramp=False mode= rec=False runpicker=open",
        "two runs: right | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False runs=dinner-rush/eta-batched:side at=4*/4",
        "two runs: left | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False runs=dinner-rush/eta-batched:side at=3*/4",
        "two runs: home | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False runs=dinner-rush/eta-batched:side at=0*/4",
        "two runs: end | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False runs=dinner-rush/eta-batched:side at=4*/4",
        "two runs: p | taken | same",
        "two runs: r | left | same",
        "two runs: f | taken | same",
        "two runs: x side by side | left | same",
        "two runs in swap: x | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False runs=dinner-rush/eta-batched:swap at=3/4*",
        "two runs in swap: left after x | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False runs=dinner-rush/eta-batched:swap at=3/3*",
        "two runs: c | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "two runs: esc | taken | view=root edit=False panel=False tab= details=False perf=False fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=0 ramp=False mode= rec=False",
        "two runs: t | taken | view=root edit=False panel=True tab=Performance details=False perf=True fail=False flow=/0 short=False search=False box= picked=0 undo=False redo=False pos=3 ramp=False mode= rec=False runs=dinner-rush/eta-batched:side at="
    ];

    public static readonly string[] Shortcuts =
    [
        "everything | Keyboard shortcuts | GETTING AROUND | Enter | Open the selected shape | Esc | Close what's open, then go back to the last level. The navigator closes only if your last click was in it | Backspace | Z | Zoom out: go up a level | Ctrl+K | / | Find a shape | F | Fit the view | L | Show every flow, and play one | O | Show everything as a tree | T | Show a load-test run on the diagram, where there is one | M | Show how things fail, worst first | ? | Show these shortcuts | FLOWS | → | ← | Next and previous step | Home | End | First and last step | P | Step through the flow on its own, or pause | R | Replay the step | C | Compare with another flow, or close the comparison | X | Swap to the other flow of a comparison | Esc | Stop the flow | PERFORMANCE | → | ← | Next and previous tested level | Home | End | First and last tested level | P | Ramp the load or play the time, or pause | Esc | Close the panel | FAILURES | → | ← | Next and previous failure | EDIT MODE | E | Edit mode on and off | N | Add a shape | Ctrl+click | Shift+click | Add a shape to the selection, or take it out | Shift+drag | Draw a box round shapes to select them | Ctrl+A | Select every shape in this view | Delete | Delete the selected shapes or line | Ctrl+Z | Undo | Esc | Backspace | Straight after dragging a shape: take the drag back | Ctrl+Y | Ctrl+Shift+Z | Redo",
        "editing | Keyboard shortcuts | GETTING AROUND | Enter | Open the selected shape | Esc | Close what's open, then go back to the last level. The navigator closes only if your last click was in it | Backspace | Z | Zoom out: go up a level | Ctrl+K | / | Find a shape | F | Fit the view | L | Show every flow, and play one | O | Show everything as a tree | T | Show a load-test run on the diagram, where there is one | M | Show how things fail, worst first | ? | Show these shortcuts | FLOWS | → | ← | Next and previous step | Home | End | First and last step | P | Step through the flow on its own, or pause | R | Replay the step | C | Compare with another flow, or close the comparison | X | Swap to the other flow of a comparison | Esc | Stop the flow | FAILURES | → | ← | Next and previous failure | EDIT MODE | E | Edit mode on and off | N | Add a shape | Ctrl+click | Shift+click | Add a shape to the selection, or take it out | Shift+drag | Draw a box round shapes to select them | Ctrl+A | Select every shape in this view | Delete | Delete the selected shapes or line | Ctrl+Z | Undo | Esc | Backspace | Straight after dragging a shape: take the drag back | Ctrl+Y | Ctrl+Shift+Z | Redo",
        "run but no analysis | Keyboard shortcuts | GETTING AROUND | Enter | Open the selected shape | Esc | Close what's open, then go back to the last level. The navigator closes only if your last click was in it | Backspace | Z | Zoom out: go up a level | Ctrl+K | / | Find a shape | F | Fit the view | L | Show every flow, and play one | O | Show everything as a tree | T | Show a load-test run on the diagram, where there is one | M | Show how things fail, worst first | ? | Show these shortcuts | FLOWS | → | ← | Next and previous step | Home | End | First and last step | P | Step through the flow on its own, or pause | R | Replay the step | C | Compare with another flow, or close the comparison | X | Swap to the other flow of a comparison | Esc | Stop the flow | PERFORMANCE | → | ← | Next and previous tested level | Home | End | First and last tested level | P | Ramp the load or play the time, or pause | Esc | Close the panel | FAILURES | → | ← | Next and previous failure | EDIT MODE | E | Edit mode on and off | N | Add a shape | Ctrl+click | Shift+click | Add a shape to the selection, or take it out | Shift+drag | Draw a box round shapes to select them | Ctrl+A | Select every shape in this view | Delete | Delete the selected shapes or line | Ctrl+Z | Undo | Esc | Backspace | Straight after dragging a shape: take the drag back | Ctrl+Y | Ctrl+Shift+Z | Redo",
        "neither | Keyboard shortcuts | GETTING AROUND | Enter | Open the selected shape | Esc | Close what's open, then go back to the last level. The navigator closes only if your last click was in it | Backspace | Z | Zoom out: go up a level | Ctrl+K | / | Find a shape | F | Fit the view | L | Show every flow, and play one | O | Show everything as a tree | T | Show a load-test run on the diagram, where there is one | M | Show how things fail, worst first | ? | Show these shortcuts | FLOWS | → | ← | Next and previous step | Home | End | First and last step | P | Step through the flow on its own, or pause | R | Replay the step | C | Compare with another flow, or close the comparison | X | Swap to the other flow of a comparison | Esc | Stop the flow | PERFORMANCE | → | ← | Next and previous tested level | Home | End | First and last tested level | P | Ramp the load or play the time, or pause | Esc | Close the panel | FAILURES | → | ← | Next and previous failure | EDIT MODE | E | Edit mode on and off | N | Add a shape | Ctrl+click | Shift+click | Add a shape to the selection, or take it out | Shift+drag | Draw a box round shapes to select them | Ctrl+A | Select every shape in this view | Delete | Delete the selected shapes or line | Ctrl+Z | Undo | Esc | Backspace | Straight after dragging a shape: take the drag back | Ctrl+Y | Ctrl+Shift+Z | Redo"
    ];
}
