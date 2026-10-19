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
        Assert.Equal("a tested level", panel.LoadNote);
        Assert.Equal(3, panel.SliderMaximum);
        Assert.Equal(3, panel.SliderValue);
        var text = Text(panel);
        Assert.Contains("First struggles at 100 req/s: Worker at 97% of capacity", text);
        Assert.Contains("Go there", text);
        Assert.Contains("Click a shape or a line to see its numbers.", text);
        Assert.NotNull(panel.Picker); // there is more than one run
    }

    [AvaloniaFact]
    public void Between_two_tested_loads_it_says_so_and_worked_out_numbers_follow_the_position()
    {
        var (panel, folder) = Open();
        Show(panel, folder, "ramp", 1);
        panel.SetPos(1.5, true);
        Assert.Equal("38 req/s", panel.LoadText); // 37.5, written as a tie goes in the browser too
        Assert.Equal("between 25 and 50, worked out from the two", panel.LoadNote);
        Assert.Equal(1.5, panel.SliderValue);
        Assert.Equal("Pause", Label(panel));
        panel.SetPos(2, false);
        Assert.Equal("a tested level", panel.LoadNote);
        Assert.Equal("Ramp", Label(panel));
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
        panel.LevelPicked += levels.Add;
        panel.RunPicked += runs.Add;
        panel.RampClicked += () => ramps++;
        panel.Used += () => used++;
        Show(panel, folder, "ramp", 3);
        panel.Slider.Value = 1.4;
        Assert.Equal([1.0], levels); // snapped to a tested level
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
        Assert.Equal([("Calls", "5 calls a second"), ("Typical", "4 s"), ("Slowest 1 in 20", "9 s"), ("Failing", "0%")], panel.Readings);
        panel.SetPos(1, false);
        Assert.Equal("5 calls a second", panel.Readings[0].Value);
        Assert.Equal("0.1 ms", panel.Readings[1].Value);
        Show(panel, folder, "ramp", 3, selection: new PerfSelection("customer"));
        Assert.Empty(panel.Readings);
        Assert.Contains("Nothing was measured here, or inside it.", Text(panel));
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
        Assert.Contains("← → step the levels", Text(panel));
        Assert.DoesNotContain("P ramps up", Text(panel));
        Show(panel, folder, "ramp", 3, still: false);
        Assert.NotNull(panel.RampButton.Parent);
        Assert.Contains("P ramps up", Text(panel));
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
}
