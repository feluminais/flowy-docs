using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Interactivity;
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
    public void The_right_rail_has_a_Performance_button_where_there_are_runs_and_the_number_on_it_is_how_many()
    {
        var (_, reader) = Open();
        var runs = FolderLoader.Load(Shop).Runs!.Count;
        Assert.Equal(["Details", $"Performance, {runs}"], reader.DetailsRail.Shown.Select(i => i.Name));
        Assert.All(reader.DetailsRail.Shown, i => Assert.True(i.Visible));
        Assert.False(reader.PerfOpenNow); // nothing is open until the button is pressed
    }

    [AvaloniaFact]
    public void A_folder_without_runs_has_no_Performance_button_and_T_does_nothing()
    {
        var (window, reader) = Open(Plum);
        Assert.False(reader.DetailsRail.Shown.First(i => i.Name.StartsWith("Performance")).Visible);
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
        Assert.Equal("a tested level", reader.PerfPanelNow.LoadNote);
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
    public void The_panel_takes_Details_place_and_the_Details_button_takes_it_back()
    {
        var (window, reader) = Open();
        reader.Select("customer");
        Assert.True(reader.DetailsOpenNow);
        Press(window, Key.T, PhysicalKey.T);
        Assert.True(reader.PerfOpenNow);
        Assert.False(reader.DetailsOpenNow);
        reader.ClickRail(PanelTab.Details);
        Assert.False(reader.PerfOpenNow);
        Assert.True(reader.DetailsOpenNow);
        reader.ClickRail(PanelTab.Performance);
        Press(window, Key.Escape, PhysicalKey.Escape); // closes the Performance panel and does not leave Details open in its place
        Assert.False(reader.HasPanel);
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
        picker.SelectedIndex = ((IEnumerable<string>)picker.ItemsSource!).ToList().IndexOf("Latency only");
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
        Assert.Contains("← → step the levels", string.Join("|", AllText(reader.PerfPanelNow)));
        Assert.DoesNotContain("P ramps up", string.Join("|", AllText(reader.PerfPanelNow)));
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
        Assert.Equal(["Calls", "Typical", "Slowest 1 in 20", "Failing"], reader.PerfPanelNow.Readings.Select(r => r.Label));
        Press(window, Key.Home, PhysicalKey.Home);
        Assert.Equal("2 calls a second", reader.PerfPanelNow.Readings[0].Value);
        reader.Select("customer");
        Assert.Contains("Nothing was measured here", string.Join("|", AllText(reader.PerfPanelNow)));
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
        Assert.Contains("Ramp the load up on its own, or pause", text);
        Assert.Contains("Show a load-test run on the diagram, where there is one", text);
        var (_, plain) = Open(Plum);
        plain.ShowShortcuts();
        var without = string.Join("|", plain.GetVisualDescendants().OfType<ShortcutsCard>().SelectMany(c => c.GetVisualDescendants().OfType<TextBlock>()).Select(t => t.Text));
        Assert.DoesNotContain("Ramp the load up", without);
    }

    [AvaloniaFact]
    public void Edit_mode_closes_the_panel_and_takes_the_button_away()
    {
        var (window, reader) = Open();
        Press(window, Key.T, PhysicalKey.T);
        Assert.True(reader.PerfOpenNow);
        reader.SetEditing(true);
        Assert.False(reader.PerfOpenNow);
        Assert.False(reader.DetailsRail.Shown.First(i => i.Name.StartsWith("Performance")).Visible);
        Press(window, Key.T, PhysicalKey.T);
        Assert.False(reader.PerfOpenNow);
        reader.SetEditing(false);
        Assert.True(reader.DetailsRail.Shown.First(i => i.Name.StartsWith("Performance")).Visible);
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
        Assert.True(reader.DetailsRail.Shown.First(i => i.Name.StartsWith("Performance")).Visible);
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
}
