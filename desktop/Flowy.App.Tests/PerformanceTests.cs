using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Media;
using Avalonia.Styling;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>
/// The Performance panel on the fixtures' small shop (desktop/fixtures/cases/perf): the rail button, T and Esc, the slider and the keys, Ramp, what is drawn
/// on the canvas, what the panel reads out for a pick, and what it does without motion.
/// </summary>
public class PerformanceTests
{
    private static string Shop => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "perf", "flowy");

    private static string Plum => Path.Combine(Repo.Root, "docs", "demo", "flowy");

    /// <summary>Motion on for as long as it is held: the tests run on one thread and share the environment, so what one leaves behind the next would inherit.</summary>
    private sealed class Motion : IDisposable
    {
        private Motion() => Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0");

        public static Motion On() => new();

        public void Dispose() => Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
    }

    private static (Window Window, ReaderView Reader) Open(string? dir = null)
    {
        dir ??= Shop;
        var reader = new ReaderView();
        var window = new Window { Width = 1280, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        Dispatcher.UIThread.RunJobs();
        return (window, reader);
    }

    private static void Press(Window w, Key key, PhysicalKey physical) => w.KeyPress(key, RawInputModifiers.None, physical, null);

    private static void Click(Button button) => button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));

    private static bool Strained(ReaderView reader, string id) => reader.Canvas.BoxControlFor(id)!.Classes.Contains("strained");

    [AvaloniaFact]
    public void The_left_rail_has_a_Performance_button_where_there_are_runs_and_the_number_on_it_is_how_many()
    {
        var (_, reader) = Open();
        var runs = FolderLoader.Load(Shop).Runs!.Count;
        Assert.DoesNotContain(reader.DetailsRail.Shown, i => i.Name.StartsWith("Performance")); // Details' rail on the right has Details only
        Assert.Contains($"Performance, {runs}", reader.Rail.Shown.Where(i => i.Visible).Select(i => i.Name));
        Assert.False(reader.PerfOpenNow); // nothing is open until the button is pressed
    }

    /// <summary>A folder with a model and no run.</summary>
    private static TempFolder Runless()
    {
        var temp = new TempFolder();
        File.WriteAllText(Path.Combine(temp.Path, "model.yaml"), OneObject);
        return temp;
    }

    [AvaloniaFact]
    public void The_demo_Plum_has_seven_runs_and_opens_on_the_one_where_Delivery_gives_way()
    {
        var folder = FolderLoader.Load(Plum);
        Assert.Empty(folder.RunProblems!);
        Assert.Equal(["dinner-rush", "eta-batched", "orders-only", "pings-climbing", "stripe-outage", "together-measured", "together"], folder.Runs!.Keys); // the file names sort so that the demo opens on the dinner rush
        var (window, reader) = Open(Plum);
        Assert.Contains("Performance, 7", reader.Rail.Shown.Where(i => i.Visible).Select(i => i.Name));
        Press(window, Key.T, PhysicalKey.T);
        Assert.Equal(("dinner-rush", 3.0, false), reader.PerfState); // the load where ETA reaches 90%
        Assert.Contains("First struggles at 900 orders/min: ETA at 90% of capacity", string.Join("|", AllText(reader.PerfPanelNow)));
        Assert.InRange(reader.Canvas.Load!.Boxes["delivery"].Strain!.Value, Perf.KneeStrain, 1); // at the overview the system holding ETA is the one that is red
        Assert.InRange(reader.Canvas.Load!.Boxes["ordering"].Strain!.Value, 0, Perf.KneeStrain - 0.01);
        Assert.Equal(14, reader.Canvas.Load!.Boxes["events"].Queue); // and Order events has begun to fill behind it
        reader.PickRunById("eta-batched");
        Assert.Contains("It never struggled in the tested range.", string.Join("|", AllText(reader.PerfPanelNow)));
        Assert.InRange(reader.Canvas.Load!.Boxes["delivery"].Strain!.Value, 0, Perf.KneeStrain - 0.01); // at its highest load, still fine
    }

    [AvaloniaFact]
    public void A_folder_without_runs_has_no_Performance_button_and_T_does_nothing()
    {
        using var temp = Runless();
        var (window, reader) = Open(temp.Path);
        Assert.False(reader.Rail.Shown.First(i => i.Name.StartsWith("Performance")).Visible);
        Press(window, Key.T, PhysicalKey.T);
        Assert.False(reader.PerfOpenNow);
        Assert.False(reader.HasPanel);
    }

    [AvaloniaFact]
    public void T_and_the_button_open_the_panel_on_the_load_where_things_first_struggle_and_Esc_closes_it()
    {
        var (window, reader) = Open();
        reader.PickRunById("ramp");
        Press(window, Key.T, PhysicalKey.T);
        Assert.True(reader.PerfOpenNow);
        Assert.True(reader.HasPanel);
        Assert.Equal(("ramp", 3.0, false), reader.PerfState); // the worker is at 97% at 100 req/s, the last level
        Assert.Equal("100 req/s", reader.PerfPanelNow.LoadText);
        Assert.Equal("Tested", reader.PerfPanelNow.LoadNote);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.False(reader.PerfOpenNow);
        Assert.False(reader.HasPanel);
        reader.ClickRail(PanelTab.Performance);
        Assert.True(reader.PerfOpenNow);
        reader.ClickRail(PanelTab.Performance);
        Assert.False(reader.PerfOpenNow);
    }

    [AvaloniaFact]
    public void A_run_that_never_struggles_opens_on_its_highest_load()
    {
        var (window, reader) = Open();
        reader.PickRunById("calm");
        Press(window, Key.T, PhysicalKey.T);
        Assert.Equal(("calm", 1.0, false), reader.PerfState);
        Assert.Contains("It never struggled", string.Join("|", AllText(reader.PerfPanelNow)));
    }

    private static IEnumerable<string> AllText(Control root) =>
        root.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text ?? "");

    [AvaloniaFact]
    public void The_panel_is_a_tab_on_the_left_and_Details_stays_free_on_the_right()
    {
        var (window, reader) = Open();
        reader.Select("customer");
        Assert.True(reader.DetailsOpenNow);
        Press(window, Key.T, PhysicalKey.T);
        Assert.True(reader.PerfOpenNow);
        Assert.Equal(PanelTab.Performance, reader.ShownTabNow);
        Assert.True(reader.DetailsOpenNow); // what is picked still reads out on the right
        reader.ClickRail(PanelTab.Details);
        Assert.False(reader.DetailsOpenNow);
        Assert.True(reader.PerfOpenNow); // closing Details leaves the load where it is
        reader.ClickRail(PanelTab.Details);
        Assert.True(reader.DetailsOpenNow);
        Assert.True(reader.PerfOpenNow);
        reader.ClickRail(PanelTab.Explorer);
        Assert.False(reader.PerfOpenNow); // one tab on the left at a time
        reader.ClickRail(PanelTab.Performance);
        Press(window, Key.Escape, PhysicalKey.Escape); // closes the Performance tab and leaves Details as it was
        Assert.False(reader.PerfOpenNow);
        Assert.True(reader.DetailsOpenNow);
    }

    [AvaloniaFact]
    public void The_arrow_keys_Home_and_End_move_along_the_tested_loads_and_stop_at_the_ends()
    {
        var (window, reader) = Open();
        reader.PickRunById("ramp");
        Press(window, Key.T, PhysicalKey.T);
        Press(window, Key.Left, PhysicalKey.ArrowLeft);
        Assert.Equal(2.0, reader.PerfState.Pos);
        Assert.Equal("50 req/s", reader.PerfPanelNow.LoadText);
        Press(window, Key.Home, PhysicalKey.Home);
        Assert.Equal(0.0, reader.PerfState.Pos);
        Press(window, Key.Left, PhysicalKey.ArrowLeft);
        Assert.Equal(0.0, reader.PerfState.Pos);
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Assert.Equal(1.0, reader.PerfState.Pos);
        Press(window, Key.End, PhysicalKey.End);
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Assert.Equal(3.0, reader.PerfState.Pos);
    }

    [AvaloniaFact]
    public void The_slider_picks_a_tested_level_and_the_picker_picks_a_run()
    {
        var (window, reader) = Open();
        reader.PickRunById("ramp");
        Press(window, Key.T, PhysicalKey.T);
        Assert.Equal(3, reader.PerfPanelNow.SliderMaximum);
        reader.PerfPanelNow.Slider.Value = 1.4; // dragged to between two
        Assert.Equal(1.0, reader.PerfState.Pos);
        Assert.Equal(1.0, reader.PerfPanelNow.SliderValue);
        Assert.Equal("25 req/s", reader.PerfPanelNow.LoadText);
        var picker = reader.PerfPanelNow.Picker!;
        picker.SelectedIndex = reader.PerfPanelNow.RunChoices.Select(c => c.Name).ToList().IndexOf("Latency only");
        Assert.Equal("latency", reader.PerfState.Run);
        Assert.Equal("users", string.Join("", reader.PerfPanelNow.LoadText.Where(char.IsLetter)));
    }

    [AvaloniaFact]
    public void The_shapes_show_their_strain_and_the_queue_and_the_lines_their_traffic()
    {
        var (window, reader) = Open();
        reader.PickRunById("ramp");
        reader.GoTo("shop");
        Press(window, Key.T, PhysicalKey.T);
        Assert.True(Strained(reader, "worker"));
        Assert.True(Strained(reader, "web"));
        Assert.False(Strained(reader, "queue")); // the queue was measured by its length only
        var load = reader.Canvas.Load!;
        Assert.Equal(40, load.Boxes["queue"].Queue);
        Assert.Equal(0.97, load.Boxes["worker"].Strain);
        Assert.Contains(load.Lines, l => l is { From: "queue", To: "worker" });
        Press(window, Key.Home, PhysicalKey.Home);
        Assert.False(Strained(reader, "queue"));
        Assert.Equal(0, reader.Canvas.Load!.Boxes["queue"].Queue);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Null(reader.Canvas.Load);
        Assert.False(Strained(reader, "worker"));
    }

    [AvaloniaFact]
    public void The_lines_carry_particles_while_the_panel_is_open_and_none_when_it_closes()
    {
        using var motion = Motion.On();
        var (window, reader) = Open();
        reader.PickRunById("ramp");
        reader.GoTo("shop");
        Press(window, Key.T, PhysicalKey.T);
        Dispatcher.UIThread.RunJobs();
        var (particles, running) = reader.Canvas.TrafficNow;
        Assert.True(running);
        Assert.True(particles > 10, $"{particles} particles");
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Equal((0, false), reader.Canvas.TrafficNow);
    }

    [AvaloniaFact]
    public void Without_motion_there_are_no_particles_and_no_Ramp_but_the_outlines_and_numbers_stay()
    {
        var (window, reader) = Open();
        reader.PickRunById("ramp");
        reader.GoTo("shop");
        Press(window, Key.T, PhysicalKey.T);
        Assert.Equal((0, false), reader.Canvas.TrafficNow);
        Assert.True(Strained(reader, "worker"));
        Assert.Null(reader.PerfPanelNow.RampButton.Parent); // not in the panel
        Assert.Contains("←|→|Step", string.Join("|", AllText(reader.PerfPanelNow)));
        Assert.DoesNotContain("|P|", string.Join("|", AllText(reader.PerfPanelNow))); // no hint for P
        Press(window, Key.P, PhysicalKey.P);
        Assert.False(reader.PerfState.Ramping);
    }

    [AvaloniaFact]
    public void Ramp_sweeps_up_from_where_it_is_and_from_the_top_starts_again_from_the_bottom()
    {
        using var motion = Motion.On();
        var (window, reader) = Open();
        reader.PickRunById("ramp");
        Press(window, Key.T, PhysicalKey.T);
        Press(window, Key.End, PhysicalKey.End);
        Press(window, Key.P, PhysicalKey.P); // at the top: from the bottom
        Assert.True(reader.PerfState.Ramping);
        Assert.Equal(0.0, reader.PerfState.Pos);
        Assert.Equal("Pause", ButtonText(reader.PerfPanelNow.RampButton));
        Thread.Sleep(250);
        reader.TickRamp();
        Assert.InRange(reader.PerfState.Pos, 0.01, 0.2); // a level takes 10 s on a ramp of four levels
        Press(window, Key.P, PhysicalKey.P); // pause where it has got to
        var paused = reader.PerfState.Pos;
        Assert.False(reader.PerfState.Ramping);
        Thread.Sleep(100);
        reader.TickRamp();
        Assert.Equal(paused, reader.PerfState.Pos);
        Assert.Equal("Ramp", ButtonText(reader.PerfPanelNow.RampButton));
        Press(window, Key.P, PhysicalKey.P);
        Press(window, Key.Right, PhysicalKey.ArrowRight); // a key stops it
        Assert.False(reader.PerfState.Ramping);
    }

    private static string ButtonText(Button b) => string.Join("", b.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text));

    [AvaloniaFact]
    public void Touching_the_slider_stops_a_ramp()
    {
        using var motion = Motion.On();
        var (window, reader) = Open();
        reader.PickRunById("ramp");
        Press(window, Key.T, PhysicalKey.T);
        Press(window, Key.Home, PhysicalKey.Home);
        Click(reader.PerfPanelNow.RampButton);
        Assert.True(reader.PerfState.Ramping);
        reader.PerfPanelNow.Slider.Value = 2;
        Assert.False(reader.PerfState.Ramping);
        Assert.Equal(2.0, reader.PerfState.Pos);
    }

    [AvaloniaFact]
    public void A_pick_on_the_canvas_keeps_the_panel_and_it_reads_out_the_numbers()
    {
        var (window, reader) = Open();
        reader.PickRunById("ramp");
        reader.GoTo("shop");
        Press(window, Key.T, PhysicalKey.T);
        reader.Select("worker");
        Assert.True(reader.PerfOpenNow);
        Assert.Equal([("Busy", "97%"), ("Failing", "1%")], reader.PerfPanelNow.Readings);
        reader.OpenLine("queue", "worker");
        Assert.True(reader.PerfOpenNow);
        Assert.Equal(["Calls", "Expected call", "Slowest 5%", "Failing"], reader.PerfPanelNow.Readings.Select(r => r.Label));
        Press(window, Key.Home, PhysicalKey.Home);
        Assert.Equal("2 calls a second", reader.PerfPanelNow.Readings[0].Value);
        reader.Select("customer");
        Assert.Contains("Nothing measured here", string.Join("|", AllText(reader.PerfPanelNow)));
    }

    [AvaloniaFact]
    public void A_flow_that_was_playing_waits_behind_the_panel()
    {
        var lab = Path.Combine(Repo.Root, "perf-lab", "flowy");
        var (window, reader) = Open(lab);
        var flow = FolderLoader.Load(lab).Model.Flows.First(f => f.Value.Steps.Count > 0);
        reader.GoTo(flow.Value.View ?? Names.Root);
        reader.Play(flow.Key);
        Assert.Equal(flow.Key, reader.PlayingFlowId);
        Press(window, Key.T, PhysicalKey.T);
        Assert.Null(reader.PlayingFlowId); // its motion and the traffic never draw at once
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Equal(flow.Key, reader.PlayingFlowId);
    }

    [AvaloniaFact]
    public void The_shortcut_list_names_the_performance_keys_only_where_there_is_a_run()
    {
        var (_, reader) = Open();
        reader.ShowShortcuts();
        var text = string.Join("|", reader.GetVisualDescendants().OfType<ShortcutsCard>().SelectMany(c => c.GetVisualDescendants().OfType<TextBlock>()).Select(t => t.Text));
        Assert.Contains("PERFORMANCE", text.ToUpperInvariant());
        Assert.Contains("Ramp the load or play the time, or pause", text);
        Assert.Contains("Show a load-test run on the diagram, where there is one", text);
        using var temp = Runless();
        var (_, plain) = Open(temp.Path);
        plain.ShowShortcuts();
        var without = string.Join("|", plain.GetVisualDescendants().OfType<ShortcutsCard>().SelectMany(c => c.GetVisualDescendants().OfType<TextBlock>()).Select(t => t.Text));
        Assert.DoesNotContain("Ramp the load", without);
    }

    [AvaloniaFact]
    public void Edit_mode_closes_the_panel_and_greys_the_button_out()
    {
        var (window, reader) = Open();
        Press(window, Key.T, PhysicalKey.T);
        Assert.True(reader.PerfOpenNow);
        reader.SetEditing(true);
        Assert.False(reader.PerfOpenNow);
        var button = reader.Rail.Shown.First(i => i.Name.StartsWith("Performance"));
        Assert.True(button.Visible); // it stays where it is
        Assert.False(button.Enabled);
        Press(window, Key.T, PhysicalKey.T);
        Assert.False(reader.PerfOpenNow);
        reader.ClickRail(PanelTab.Performance);
        Assert.False(reader.PerfOpenNow);
        reader.SetEditing(false);
        button = reader.Rail.Shown.First(i => i.Name.StartsWith("Performance"));
        Assert.True(button.Visible);
        Assert.True(button.Enabled);
        Assert.False(reader.PerfOpenNow); // it does not come back on its own
    }

    [AvaloniaFact]
    public void A_folder_with_only_a_broken_run_has_the_button_and_the_panel_says_what_is_wrong()
    {
        using var temp = new TempFolder();
        File.WriteAllText(Path.Combine(temp.Path, "model.yaml"), "objects:\n  a: { type: system, name: A }\n");
        Directory.CreateDirectory(Path.Combine(temp.Path, "perf"));
        File.WriteAllText(Path.Combine(temp.Path, "perf", "bad.yaml"), "name: Bad\nlevels:\n  - load: 1\n");
        var (window, reader) = Open(temp.Path);
        Assert.True(reader.Rail.Shown.First(i => i.Name.StartsWith("Performance")).Visible);
        Press(window, Key.T, PhysicalKey.T);
        Assert.True(reader.PerfOpenNow);
        var text = string.Join("|", AllText(reader.PerfPanelNow));
        Assert.Contains("No run could be read.", text);
        Assert.Contains("perf/bad.yaml", text);
        Assert.Contains("needs at least two levels", text);
    }

    [AvaloniaFact]
    public void A_run_that_goes_away_leaves_the_panel_on_one_that_is_there()
    {
        using var temp = new TempFolder();
        File.WriteAllText(Path.Combine(temp.Path, "model.yaml"), "objects:\n  a: { type: system, name: A }\n");
        Directory.CreateDirectory(Path.Combine(temp.Path, "perf"));
        string Run(string name) => $"name: {name}\nlevels:\n  - load: 1\n    objects:\n      a: {{ util: 0.1 }}\n  - load: 2\n    objects:\n      a: {{ util: 0.2 }}\n";
        File.WriteAllText(Path.Combine(temp.Path, "perf", "one.yaml"), Run("One"));
        File.WriteAllText(Path.Combine(temp.Path, "perf", "two.yaml"), Run("Two"));
        var (window, reader) = Open(temp.Path);
        reader.PickRunById("two");
        Press(window, Key.T, PhysicalKey.T);
        Assert.Equal("two", reader.PerfState.Run);
        File.Delete(Path.Combine(temp.Path, "perf", "two.yaml"));
        reader.Reload(FolderLoader.Load(temp.Path));
        Assert.True(reader.PerfOpenNow);
        Assert.Equal("one", reader.PerfState.Run);
        Assert.Equal("One", string.Join("|", AllText(reader.PerfPanelNow)).Split('|')[0]);
    }

    private const string OneObject = "objects:\n  a: { type: system, name: A }\n";

    private const string GoodRun = "name: One\nlevels:\n  - load: 1\n    objects:\n      a: { util: 0.1 }\n  - load: 2\n    objects:\n      a: { util: 0.2 }\n";

    private const string BadRun = "name: Bad\nlevels:\n  - load: 1\n";

    /// <summary>A folder with one good run, open on it with a ramp running.</summary>
    private static (Window Window, ReaderView Reader, string RunFile) Ramping(TempFolder temp)
    {
        File.WriteAllText(Path.Combine(temp.Path, "model.yaml"), OneObject);
        Directory.CreateDirectory(Path.Combine(temp.Path, "perf"));
        var file = Path.Combine(temp.Path, "perf", "one.yaml");
        File.WriteAllText(file, GoodRun);
        var (window, reader) = Open(temp.Path);
        Press(window, Key.T, PhysicalKey.T);
        Press(window, Key.Home, PhysicalKey.Home);
        Click(reader.PerfPanelNow.RampButton);
        Assert.True(reader.PerfState.Ramping);
        return (window, reader, file);
    }

    [AvaloniaTheory]
    [InlineData(BadRun)] // the file stops parsing: the panel stays, to say what is wrong, with no load to run on
    [InlineData(null)] // the file goes: the panel has nothing to show
    public void A_ramp_whose_run_goes_away_stops_and_is_not_left_saying_Pause_when_the_run_is_back(string? meanwhile)
    {
        using var motion = Motion.On();
        using var temp = new TempFolder();
        var (window, reader, file) = Ramping(temp);
        if (meanwhile is null) File.Delete(file);
        else File.WriteAllText(file, meanwhile);
        reader.Reload(FolderLoader.Load(temp.Path));
        Assert.False(reader.PerfState.Ramping);
        File.WriteAllText(file, GoodRun);
        reader.Reload(FolderLoader.Load(temp.Path));
        window.UpdateLayout();
        Assert.True(reader.PerfOpenNow); // the browser's panel comes back with its run too
        Assert.False(reader.PerfState.Ramping);
        Assert.Equal("Ramp", ButtonText(reader.PerfPanelNow.RampButton));
    }

    [AvaloniaFact]
    public void A_step_to_the_level_already_shown_draws_nothing_again_but_puts_the_thumb_back_on_it()
    {
        var (window, reader) = Open();
        reader.PickRunById("ramp");
        Press(window, Key.T, PhysicalKey.T);
        Press(window, Key.Home, PhysicalKey.Home);
        var drawn = reader.Canvas.Load;
        Assert.NotNull(drawn);
        Press(window, Key.Home, PhysicalKey.Home); // already there
        Assert.Same(drawn, reader.Canvas.Load);
        reader.PerfPanelNow.Slider.Value = 0.3; // a drag that has not got to the next level
        Assert.Same(drawn, reader.Canvas.Load);
        Assert.Equal(0.0, reader.PerfPanelNow.SliderValue);
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Assert.NotSame(drawn, reader.Canvas.Load);
        Assert.Equal(1.0, reader.PerfPanelNow.SliderValue);
    }

    private static TextBlock TextBlockOf(PerfPanel panel, string startsWith) =>
        panel.GetVisualDescendants().OfType<TextBlock>().First(t => t.Text?.StartsWith(startsWith) == true);

    private static Color Colour(IBrush? brush) => Assert.IsAssignableFrom<ISolidColorBrush>(brush).Color;

    private static Color ThemeColour(string key, ThemeVariant theme) =>
        Application.Current!.TryGetResource(key, theme, out var found) ? Colour((IBrush)found!) : throw new InvalidOperationException(key);

    // ---- a run over time: Plum's Stripe outage, killed at 40 s, restarting at 70 s and answering at 85 s, over 150 s ----------------------------------

    /// <summary>The panel open on the outage, on the Ordering view where Stripe is drawn, at the time it first struggles (45 s).</summary>
    private static (Window Window, ReaderView Reader) Outage()
    {
        var (window, reader) = Open(Plum);
        reader.GoTo("ordering");
        reader.PickRunById("stripe-outage");
        Press(window, Key.T, PhysicalKey.T);
        return (window, reader);
    }

    /// <summary>The words of the key that name a state: what the key says is on screen now.</summary>
    private static List<string> StateWords(PerfPanel panel) => panel.KeyLabels.Where(l => States.Labels.Values.Contains(l)).ToList();

    private static StateMark? StripeState(ReaderView reader) => ((BoxControl)reader.Canvas.BoxControlFor("stripe")!).State;

    [AvaloniaFact]
    public void A_run_over_time_says_Time_and_Play_and_lists_its_events_with_the_one_the_run_has_got_to()
    {
        using var motion = Motion.On();
        var (_, reader) = Outage();
        var panel = reader.PerfPanelNow;
        Assert.Equal(("stripe-outage", 2.0, false), reader.PerfState); // opens where it first struggles: 45 s
        Assert.Equal("45 s", panel.LoadText);
        Assert.Equal("Tested", panel.LoadNote);
        Assert.Equal("Play", ButtonText(panel.RampButton));
        Assert.Contains("TIME", AllText(panel)); // a section's title is set in capitals
        Assert.DoesNotContain("LOAD", AllText(panel));
        Assert.Contains("EVENTS", AllText(panel));
        Assert.Equal("Play", AllText(panel).SkipWhile(t => t != "P").Skip(1).First()); // the hint
        Assert.Equal([("40 s", "Payments killed", true, true), ("70 s", "Restart begins", false, false), ("85 s", "Answers again", false, false)], panel.EventLines);
        Assert.Equal(3, panel.EventMarkCount);
        Assert.Equal((0.0, 150.0), (panel.Slider.Minimum, panel.Slider.Maximum)); // the slider is in time
        Assert.Equal(45.0, panel.SliderValue);
    }

    [AvaloniaFact]
    public void A_load_run_still_says_Load_and_Ramp_and_has_no_events()
    {
        using var motion = Motion.On();
        var (window, reader) = Open(Plum);
        Press(window, Key.T, PhysicalKey.T);
        var panel = reader.PerfPanelNow;
        Assert.Equal("Ramp", ButtonText(panel.RampButton));
        Assert.Contains("LOAD", AllText(panel));
        Assert.DoesNotContain("EVENTS", AllText(panel));
        Assert.Empty(panel.EventLines);
        Assert.Equal(0, panel.EventMarkCount);
        Assert.Equal(4.0, panel.SliderMaximum); // a step to each level
    }

    [AvaloniaFact]
    public void Stripe_is_stopped_from_40_s_starting_from_70_s_and_running_from_85_s_and_the_key_names_only_what_is_on_screen()
    {
        var (window, reader) = Outage();
        var panel = reader.PerfPanelNow;
        Assert.Equal(new StateMark("stopped", false), StripeState(reader)); // 45 s
        Assert.Equal(["Stopped"], StateWords(panel));
        panel.Slider.Value = 39; // the slider goes where it is put, and not only to a level
        Assert.Null(StripeState(reader));
        Assert.Equal<string>([], StateWords(panel));
        panel.Slider.Value = 40;
        Assert.Equal(new StateMark("stopped", false), StripeState(reader));
        panel.Slider.Value = 70;
        Assert.Equal(new StateMark("starting", false), StripeState(reader));
        Assert.Equal("70 s", panel.LoadText);
        Assert.Equal("Between 60 and 90, estimated", panel.LoadNote);
        Assert.Equal(70.0, panel.SliderValue);
        Assert.Equal(["Starting"], StateWords(panel));
        panel.Slider.Value = 85;
        Assert.Null(StripeState(reader)); // Running draws nothing
        Assert.Equal([("40 s", "Payments killed", true, false), ("70 s", "Restart begins", true, false), ("85 s", "Answers again", true, true)], panel.EventLines);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Null(StripeState(reader)); // closing the panel takes the run's states away
    }

    [AvaloniaFact]
    public void A_click_on_an_event_goes_there_and_the_arrow_keys_still_go_from_level_to_level()
    {
        var (window, reader) = Outage();
        var panel = reader.PerfPanelNow;
        Click(panel.EventButtons[1]); // Restart begins, at 70 s
        Assert.Equal(70.0, panel.SliderValue);
        Assert.Equal(new StateMark("starting", false), StripeState(reader));
        Assert.Equal(PerfView.PosAt(OutageRun(), 70), reader.PerfState.Pos, 9);
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Assert.Equal(4.0, reader.PerfState.Pos); // the next level, 90 s
        Assert.Equal("90 s", panel.LoadText);
        Press(window, Key.Left, PhysicalKey.ArrowLeft);
        Press(window, Key.Left, PhysicalKey.ArrowLeft);
        Assert.Equal(2.0, reader.PerfState.Pos); // 60 s, then 45 s
        Click(panel.EventButtons[0]);
        Assert.Equal(40.0, panel.SliderValue);
    }

    private static LoadRun OutageRun() => FolderLoader.Load(Plum).Runs!["stripe-outage"];

    [AvaloniaFact]
    public void The_marks_on_the_slider_sit_where_their_events_are_and_a_click_on_one_goes_there()
    {
        var (window, reader) = Outage();
        window.UpdateLayout();
        var marks = reader.PerfPanelNow.Marks!;
        var fractions = PerfView.EventFractions(OutageRun());
        var hits = marks.Children.OfType<Border>().ToList();
        Assert.Equal(3, hits.Count);
        for (var i = 0; i < 3; i++)
        {
            var centre = hits[i].Bounds.X + hits[i].Bounds.Width / 2;
            var expected = TickLabels.Edge + (marks.Bounds.Width - 2 * TickLabels.Edge) * fractions[i].Fraction;
            Assert.InRange(centre, expected - 1, expected + 1); // layout rounds to whole pixels
            Assert.Contains(fractions[i].Event.Text, ToolTip.GetTip(hits[i])!.ToString()!);
        }
        var at = hits[2].TranslatePoint(new Point(7, 6), window)!.Value;
        window.MouseDown(at, MouseButton.Left);
        window.MouseUp(at, MouseButton.Left);
        Assert.Equal(85.0, reader.PerfPanelNow.SliderValue);
    }

    [AvaloniaFact]
    public void Dragging_the_slider_changes_a_state_at_once_and_a_step_eases_it_out()
    {
        using var motion = Motion.On();
        var (window, reader) = Outage();
        var box = (BoxControl)reader.Canvas.BoxControlFor("stripe")!;
        Press(window, Key.Left, PhysicalKey.ArrowLeft); // 30 s: Stripe is Running again, and the stopped look fades out
        Assert.Null(StripeState(reader));
        Assert.Contains("state-leaving", box.Classes);
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Press(window, Key.Right, PhysicalKey.ArrowRight); // 45 s again, stopped
        Assert.Equal(new StateMark("stopped", false), StripeState(reader));
        reader.PerfPanelNow.Slider.Value = 10; // dragged to before the outage: no fade
        Assert.Null(StripeState(reader));
        Assert.DoesNotContain("state-leaving", box.Classes);
        Assert.DoesNotContain(box.Classes, c => c.StartsWith("state-"));
    }

    [AvaloniaFact]
    public void Play_goes_through_a_run_over_time_evenly_in_time()
    {
        using var motion = Motion.On();
        var (window, reader) = Outage();
        var run = OutageRun();
        Press(window, Key.End, PhysicalKey.End);
        Press(window, Key.P, PhysicalKey.P); // at the end: from the start
        Assert.True(reader.PerfState.Ramping);
        Assert.Equal("Pause", ButtonText(reader.PerfPanelNow.RampButton));
        Thread.Sleep(300);
        reader.TickRamp();
        var time = PerfView.LoadAt(run, reader.PerfState.Pos);
        Assert.InRange(time, 0.5, 4); // a ramp of 150 s takes 30 s, so 5 s of the run in each second
        Press(window, Key.P, PhysicalKey.P);
        Assert.False(reader.PerfState.Ramping);
        Assert.Equal("Play", ButtonText(reader.PerfPanelNow.RampButton));
    }

    [AvaloniaFact]
    public void Without_motion_a_run_over_time_has_no_Play_but_the_states_and_the_events_stay()
    {
        var (window, reader) = Outage();
        var panel = reader.PerfPanelNow;
        Assert.Null(panel.RampButton.Parent);
        Assert.DoesNotContain("|P|", string.Join("|", AllText(panel)));
        Assert.Equal(new StateMark("stopped", false), StripeState(reader));
        Assert.Equal(3, panel.EventLines.Count);
        Press(window, Key.P, PhysicalKey.P);
        Assert.False(reader.PerfState.Ramping);
    }

    [AvaloniaFact]
    public void A_picked_shape_says_the_state_it_is_in_under_its_readings()
    {
        var (_, reader) = Outage();
        reader.Select("stripe");
        Assert.Equal("stopped", reader.PerfPanelNow.SelectedState); // 45 s
        reader.PerfPanelNow.Slider.Value = 10;
        Assert.Null(reader.PerfPanelNow.SelectedState);
        reader.PerfPanelNow.Slider.Value = 75;
        Assert.Equal("starting", reader.PerfPanelNow.SelectedState);
    }

    [AvaloniaFact]
    public void Switching_to_a_load_run_takes_the_states_away_and_the_panel_goes_back_to_levels()
    {
        using var motion = Motion.On();
        var (_, reader) = Outage();
        Assert.NotNull(StripeState(reader));
        reader.PickRunById("dinner-rush");
        Assert.Null(StripeState(reader));
        Assert.Equal("Ramp", ButtonText(reader.PerfPanelNow.RampButton));
        Assert.Equal(4.0, reader.PerfPanelNow.SliderMaximum);
        reader.PickRunById("stripe-outage");
        Assert.Equal(new StateMark("stopped", false), StripeState(reader));
    }

    [AvaloniaFact]
    public void The_panels_words_are_in_the_themes_colours_when_it_first_opens_and_after_the_theme_changes()
    {
        var app = Application.Current!;
        var was = app.RequestedThemeVariant;
        try
        {
            app.RequestedThemeVariant = ThemeVariant.Light;
            using var broken = new TempFolder();
            File.WriteAllText(Path.Combine(broken.Path, "model.yaml"), OneObject);
            Directory.CreateDirectory(Path.Combine(broken.Path, "perf"));
            File.WriteAllText(Path.Combine(broken.Path, "perf", "bad.yaml"), BadRun);
            var (brokenWindow, brokenReader) = Open(broken.Path);
            Press(brokenWindow, Key.T, PhysicalKey.T);
            var (window, reader) = Open();
            Press(window, Key.T, PhysicalKey.T);
            window.UpdateLayout();
            brokenWindow.UpdateLayout();

            void Check(ThemeVariant theme)
            {
                Assert.Equal(ThemeColour("MutedBrush", theme), Colour(TextBlockOf(reader.PerfPanelNow, "Click a shape").Foreground));
                Assert.Equal(ThemeColour("MutedBrush", theme), Colour(TextBlockOf(brokenReader.PerfPanelNow, "No run could be read").Foreground));
                Assert.Equal(ThemeColour("WarnFgBrush", theme), Colour(TextBlockOf(brokenReader.PerfPanelNow, "perf/bad.yaml").Foreground));
            }

            Check(ThemeVariant.Light);
            app.RequestedThemeVariant = ThemeVariant.Dark;
            Dispatcher.UIThread.RunJobs();
            Assert.NotEqual(ThemeColour("MutedBrush", ThemeVariant.Light), ThemeColour("MutedBrush", ThemeVariant.Dark)); // the two themes differ, or this proves nothing
            Check(ThemeVariant.Dark);
        }
        finally
        {
            app.RequestedThemeVariant = was;
        }
    }
}
