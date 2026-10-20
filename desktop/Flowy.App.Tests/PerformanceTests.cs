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
    public void The_right_rail_has_a_Performance_button_where_there_are_runs_and_the_number_on_it_is_how_many()
    {
        var (_, reader) = Open();
        var runs = FolderLoader.Load(Shop).Runs!.Count;
        Assert.Equal(["Details", $"Performance, {runs}"], reader.DetailsRail.Shown.Select(i => i.Name));
        Assert.All(reader.DetailsRail.Shown, i => Assert.True(i.Visible));
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
    public void The_demo_Plum_has_two_runs_and_opens_on_the_one_where_Delivery_gives_way()
    {
        var folder = FolderLoader.Load(Plum);
        Assert.Empty(folder.RunProblems!);
        Assert.Equal(["dinner-rush", "eta-batched"], folder.Runs!.Keys);
        var (window, reader) = Open(Plum);
        Assert.Equal(["Details", "Performance, 2"], reader.DetailsRail.Shown.Where(i => i.Visible).Select(i => i.Name));
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
        Assert.Contains("Ramp the load up on its own, or pause", text);
        Assert.Contains("Show a load-test run on the diagram, where there is one", text);
        using var temp = Runless();
        var (_, plain) = Open(temp.Path);
        plain.ShowShortcuts();
        var without = string.Join("|", plain.GetVisualDescendants().OfType<ShortcutsCard>().SelectMany(c => c.GetVisualDescendants().OfType<TextBlock>()).Select(t => t.Text));
        Assert.DoesNotContain("Ramp the load up", without);
    }

    [AvaloniaFact]
    public void Edit_mode_closes_the_panel_and_greys_the_button_out()
    {
        var (window, reader) = Open();
        Press(window, Key.T, PhysicalKey.T);
        Assert.True(reader.PerfOpenNow);
        reader.SetEditing(true);
        Assert.False(reader.PerfOpenNow);
        var button = reader.DetailsRail.Shown.First(i => i.Name.StartsWith("Performance"));
        Assert.True(button.Visible); // it stays where it is
        Assert.False(button.Enabled);
        Press(window, Key.T, PhysicalKey.T);
        Assert.False(reader.PerfOpenNow);
        reader.ClickRail(PanelTab.Performance);
        Assert.False(reader.PerfOpenNow);
        reader.SetEditing(false);
        button = reader.DetailsRail.Shown.First(i => i.Name.StartsWith("Performance"));
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
