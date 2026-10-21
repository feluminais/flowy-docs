using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>The Performance panel on its own (desktop/fixtures/cases/perf): what it says, how it is updated in place, and what it tells the reader about.</summary>
public class PerfPanelTests
{
    private static string Shop => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "perf", "flowy");

    private static (PerfPanel Panel, Folder Folder) Open()
    {
        var folder = FolderLoader.Load(Shop);
        var panel = new PerfPanel();
        new Window { Width = 400, Height = 900, Content = new ScrollViewer { Content = panel } }.Show();
        Dispatcher.UIThread.RunJobs();
        return (panel, folder);
    }

    private static void Show(PerfPanel panel, Folder folder, string run, double pos, bool ramping = false, bool still = false, PerfSelection? selection = null, string view = "shop") =>
        panel.Show(folder.Model, view, folder.Runs!, folder.RunProblems!, run, pos, ramping, still, selection);

    /// <summary>Every piece of text in the panel. A button's label is only in the visual tree once its template is applied, so the window lays itself out first.</summary>
    private static string Text(PerfPanel panel)
    {
        (TopLevel.GetTopLevel(panel) as Window)?.UpdateLayout();
        return string.Join("|", panel.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text));
    }

    private static string Label(PerfPanel panel)
    {
        (TopLevel.GetTopLevel(panel) as Window)?.UpdateLayout();
        return string.Join("", panel.RampButton.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text));
    }

    [AvaloniaFact]
    public void It_says_the_load_the_run_and_where_it_first_struggles()
    {
        var (panel, folder) = Open();
        Show(panel, folder, "ramp", 3);
        Assert.Equal("100 req/s", panel.LoadText);
        Assert.Equal("Tested", panel.LoadNote);
        Assert.Equal(3, panel.SliderMaximum);
        Assert.Equal(3, panel.SliderValue);
        var text = Text(panel);
        Assert.Contains("First struggles at 100 req/s: Worker at 97% of capacity", text);
        Assert.Contains("Go there", text);
        Assert.Contains("Click a shape or a line.", text);
        Assert.NotNull(panel.Picker); // there is more than one run
    }

    [AvaloniaFact]
    public void Between_two_tested_loads_it_says_so_and_worked_out_numbers_follow_the_position()
    {
        var (panel, folder) = Open();
        Show(panel, folder, "ramp", 1);
        panel.SetPos(1.5, true);
        Assert.Equal("38 req/s", panel.LoadText); // 37.5, written as a tie goes in the browser too
        Assert.Equal("Between 25 and 50, estimated", panel.LoadNote);
        Assert.Equal(1.5, panel.SliderValue);
        Assert.Equal("Pause", Label(panel));
        panel.SetPos(2, false);
        Assert.Equal("Tested", panel.LoadNote);
        Assert.Equal("Ramp", Label(panel));
    }

    [AvaloniaFact]
    public void It_reads_out_the_frame_it_is_given_and_does_not_work_the_numbers_out_again()
    {
        var (panel, folder) = Open();
        var run = folder.Runs!["ramp"];
        Show(panel, folder, "ramp", 3, selection: new PerfSelection("worker"));
        Assert.Equal([("Busy", "97%"), ("Failing", "1%")], panel.Readings);
        // A frame worked out at the lowest load, given with a position at the highest: what the panel reads out is the frame's, so it did not work them out for itself.
        var low = Perf.FrameAt(folder.Model, run, PerfView.LoadAt(run, 0), "shop");
        panel.SetPos(3, false, low);
        Assert.Equal("100 req/s", panel.LoadText); // the load comes from the position
        Assert.Equal(PerfView.Metrics["util"].Show(low.Box("worker")!.Util!.Value), panel.Readings[0].Value);
        Assert.NotEqual("97%", panel.Readings[0].Value);
    }

    [AvaloniaFact]
    public void Showing_it_again_with_another_pick_keeps_the_position_and_does_not_tell_the_reader_the_slider_moved()
    {
        var (panel, folder) = Open();
        var picked = new List<double>();
        panel.LevelPicked += picked.Add;
        Show(panel, folder, "ramp", 2);
        Show(panel, folder, "ramp", 2, selection: new PerfSelection("worker")); // builds the panel again
        Show(panel, folder, "ramp", 2, selection: new PerfSelection(null, "queue", "worker"));
        Assert.Empty(picked); // setting the slider up is not the reader moving it
        Assert.Equal(2, panel.SliderValue);
    }

    [AvaloniaFact]
    public void The_slider_the_picker_and_the_buttons_tell_the_reader_of_the_panel_what_was_picked()
    {
        var (panel, folder) = Open();
        var levels = new List<double>();
        var runs = new List<string>();
        var ramps = 0;
        var used = 0;
        panel.Slid += levels.Add;
        panel.RunPicked += runs.Add;
        panel.RampClicked += () => ramps++;
        panel.Used += () => used++;
        Show(panel, folder, "ramp", 3);
        panel.Slider.Value = 1.4;
        Assert.Equal([1.0], levels); // a load run's slider snaps to a tested level
        panel.Picker!.SelectedIndex = 0;
        Assert.Equal(["calm"], runs);
        panel.RampButton.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
        Assert.Equal(1, ramps);
        Assert.True(used >= 3); // each of them gives the keyboard back to the reader
    }

    [AvaloniaFact]
    public void A_picked_shape_or_line_is_read_out_with_its_numbers_at_this_load()
    {
        var (panel, folder) = Open();
        Show(panel, folder, "ramp", 3, selection: new PerfSelection("worker"));
        Assert.Equal([("Busy", "97%"), ("Failing", "1%")], panel.Readings);
        Show(panel, folder, "ramp", 3, selection: new PerfSelection(null, "queue", "worker"));
        Assert.Equal([("Calls", "5 calls a second"), ("Expected call", "4 s"), ("Slowest 5%", "9 s"), ("Failing", "0%")], panel.Readings);
        panel.SetPos(1, false);
        Assert.Equal("5 calls a second", panel.Readings[0].Value);
        Assert.Equal("0.1 ms", panel.Readings[1].Value);
        Show(panel, folder, "ramp", 3, selection: new PerfSelection("customer"));
        Assert.Empty(panel.Readings);
        Assert.Contains("Nothing measured here or inside it.", Text(panel));
    }

    [AvaloniaFact]
    public void A_number_that_was_not_measured_at_this_load_reads_as_a_dash()
    {
        var (panel, folder) = Open();
        Show(panel, folder, "sparse", 2, selection: new PerfSelection("db"), view: "shop");
        Assert.Contains(panel.Readings, r => r.Label == "Busy");
        panel.SetPos(1, false); // db has no util at level 2: between the first and the third it is worked out
        Assert.DoesNotContain(panel.Readings, r => r.Value == "–" && r.Label == "Busy");
    }

    [AvaloniaFact]
    public void Without_motion_there_is_no_Ramp_button_and_the_hint_does_not_mention_P()
    {
        var (panel, folder) = Open();
        Show(panel, folder, "ramp", 3, still: true);
        Assert.Null(panel.RampButton.Parent);
        Assert.Contains("←|→|Step", Text(panel));
        Assert.DoesNotContain("|P|", Text(panel));
        Show(panel, folder, "ramp", 3, still: false);
        Assert.NotNull(panel.RampButton.Parent);
        Assert.Contains("|P|Ramp", Text(panel));
    }

    [AvaloniaFact]
    public void The_chart_and_the_canvas_marks_are_keyed_by_drawing_them_with_a_name_beside_each()
    {
        var (panel, folder) = Open();
        Show(panel, folder, "ramp", 3);
        var names = panel.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text).ToList();
        Assert.Equal(["Expected call", "Slowest 5%", "First struggles"], names.Where(n => n is "Expected call" or "Slowest 5%" or "First struggles"));
        Assert.Contains("Busy", names);
        Assert.Contains("Waiting", names);
        Assert.Contains("Not measured", names);
        Assert.Contains("A call that fails", names);
        var marks = panel.GetVisualDescendants().OfType<Border>().Where(b => b.Classes.Contains("sw")).SelectMany(b => b.Classes).ToList();
        foreach (var mark in new[] { "p50", "p95", "heat", "queue", "none", "call", "bad", "busy" }) Assert.Contains(mark, marks);
        Assert.Single(panel.GetVisualDescendants().OfType<Avalonia.Controls.Shapes.Line>(), l => l.Classes.Contains("knee"));
        Assert.DoesNotContain("Blue:", string.Join("|", names)); // a legend of colour names is the thing the marks replace

        Show(panel, folder, "calm", 1);
        Assert.DoesNotContain(panel.GetVisualDescendants().OfType<Avalonia.Controls.Shapes.Line>(), l => l.Classes.Contains("knee"));
        Assert.DoesNotContain("First struggles", panel.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text));
    }

    [AvaloniaFact]
    public void A_run_that_never_struggles_says_so_and_the_run_notes_and_problems_are_listed()
    {
        var (panel, folder) = Open();
        Show(panel, folder, "calm", 1);
        var text = Text(panel);
        Assert.Contains("It never struggled in the tested range.", text);
        Assert.Contains("Problems", text.Replace("PROBLEMS", "Problems"));
        Assert.Contains("perf/broken.yaml", text);
        Assert.Contains("needs at least two levels", text);
    }

    [AvaloniaFact]
    public void With_no_run_it_says_so_and_lists_what_is_wrong()
    {
        var (panel, folder) = Open();
        panel.Show(folder.Model, "shop", new IdMap<LoadRun>(), folder.RunProblems!, "", 0, false, false, null);
        var text = Text(panel);
        Assert.Contains("No run could be read.", text);
        Assert.Contains("perf/merge.yaml", text);
        Assert.Equal("", panel.LoadText);
    }

    // ---- a run's source: colour, scale and the marks of how calls fail ---------------------------------------------

    /// <summary>The fixtures' shop with one run that sets a source: a colour, one dot for 50 calls a second, and a dot area from the size of a call.</summary>
    private static (PerfPanel Panel, Folder Folder, TempFolder Temp) OpenScaled(string source = "source: { color: blue, dot: rate / 50, size: bytes / 400 }")
    {
        var temp = new TempFolder();
        File.Copy(Path.Combine(Shop, "model.yaml"), Path.Combine(temp.Path, "model.yaml"));
        Directory.CreateDirectory(Path.Combine(temp.Path, "perf"));
        File.WriteAllText(Path.Combine(temp.Path, "perf", "scaled.yaml"), $$"""
            name: Scaled
            unit: req/s
            {{source}}
            levels:
              - load: 1
                connections:
                  - { from: customer, to: web, rate: 100, p50: 10, bytes: 800 }
                  - { from: orders, to: db, rate: 100, p50: 10, errors: 0.2, failure: lost }
                  - { from: orders, to: gateway, rate: 100, p50: 10, errors: 0.2, failure: rejected }
              - load: 2
                connections:
                  - { from: customer, to: web, rate: 100000, p50: 10, bytes: 800 }
                  - { from: orders, to: db, rate: 100, p50: 10 }
                  - { from: orders, to: gateway, rate: 100, p50: 10 }
            """);
        var folder = FolderLoader.Load(temp.Path);
        var panel = new PerfPanel();
        new Window { Width = 400, Height = 900, Content = new ScrollViewer { Content = panel } }.Show();
        Dispatcher.UIThread.RunJobs();
        return (panel, folder, temp);
    }

    private static string KeyOf(PerfPanel panel)
    {
        (TopLevel.GetTopLevel(panel) as Window)?.UpdateLayout();
        return string.Join("|", panel.KeyLabels);
    }

    [AvaloniaFact]
    public void A_run_with_no_source_has_the_key_it_always_had()
    {
        var (panel, folder) = Open();
        Show(panel, folder, "ramp", 1);
        Assert.Equal("Busy|Waiting|Not measured|A call (slower dots, slower calls)|A call that fails|More calls", KeyOf(panel));
        Show(panel, folder, "ramp", 3);
        Assert.Equal("Busy|Waiting|Not measured|A call (slower dots, slower calls)|A call that fails|More calls", KeyOf(panel));
    }

    [AvaloniaFact]
    public void The_key_draws_the_scale_a_bigger_call_and_the_kinds_of_failing_call_that_are_on_screen()
    {
        var (panel, folder, temp) = OpenScaled();
        using var _ = temp;
        panel.Show(folder.Model, "shop", folder.Runs!, folder.RunProblems!, "scaled", 0, false, false, null);
        Assert.Equal("Busy|Waiting|Not measured|A call (slower dots, slower calls)|Lost call|Rejected call|More calls|1 dot = 50 calls/s|Bigger call", KeyOf(panel));
    }

    [AvaloniaFact]
    public void The_key_says_scaled_down_when_a_line_is_past_the_cap_and_the_marks_follow_the_position_in_place()
    {
        var (panel, folder, temp) = OpenScaled();
        using var _ = temp;
        panel.Show(folder.Model, "shop", folder.Runs!, folder.RunProblems!, "scaled", 0, false, false, null);
        var slider = panel.Slider;
        panel.SetPos(1, false);
        Assert.Equal(1, panel.SliderValue);
        Assert.Equal("Busy|Waiting|Not measured|A call (slower dots, slower calls)|A call that fails|More calls|1 dot = 50 calls/s|Bigger call|Scaled down", KeyOf(panel));
        Assert.Same(slider, panel.Slider);
    }

    [AvaloniaFact]
    public void A_selected_line_says_it_is_scaled_down_while_it_is()
    {
        var (panel, folder, temp) = OpenScaled();
        using var _ = temp;
        var selection = new PerfSelection(null, "customer", "web");
        panel.Show(folder.Model, "shop", folder.Runs!, folder.RunProblems!, "scaled", 0, false, false, selection);
        Assert.False(panel.ScaledDownShown);
        Assert.Contains(panel.Readings, r => r.Label == "Size of a call" && r.Value == "800 B");
        panel.SetPos(1, false);
        Assert.True(panel.ScaledDownShown);
        panel.SetPos(0, false);
        Assert.False(panel.ScaledDownShown);
    }

    [AvaloniaFact]
    public void With_reduced_motion_no_traffic_is_drawn_so_the_key_says_nothing_of_a_source()
    {
        var (panel, folder, temp) = OpenScaled();
        using var _ = temp;
        panel.Show(folder.Model, "shop", folder.Runs!, folder.RunProblems!, "scaled", 1, false, true, new PerfSelection(null, "customer", "web"));
        Assert.Equal("Busy|Waiting|Not measured|A call (slower dots, slower calls)|A call that fails|More calls", KeyOf(panel));
        Assert.False(panel.ScaledDownShown);
    }

    [AvaloniaFact]
    public void A_source_with_only_a_colour_adds_nothing_to_the_words_of_the_key()
    {
        var (panel, folder, temp) = OpenScaled("source: { color: teal }");
        using var _ = temp;
        panel.Show(folder.Model, "shop", folder.Runs!, folder.RunProblems!, "scaled", 0, false, false, null);
        Assert.Equal("Busy|Waiting|Not measured|A call (slower dots, slower calls)|Lost call|Rejected call|More calls", KeyOf(panel));
    }
}
