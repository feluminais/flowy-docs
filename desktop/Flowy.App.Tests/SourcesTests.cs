using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>
/// The Performance panel and canvas for a run with several sources of requests, on the fixtures' small shop: a run that adds others and a run tested together. A block for
/// each dial, the dial the keys act on, a ramp for each, what the key says, what the canvas draws and what a picked shape reads out.
/// </summary>
public class SourcesTests
{
    private static string Shop => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "perf", "flowy");

    /// <summary>Motion on for as long as it is held, as in the other Performance tests.</summary>
    private sealed class Motion : IDisposable
    {
        private Motion() => Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0");

        public static Motion On() => new();

        public void Dispose() => Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
    }

    private static string Part(string name, string unit, string source, int[] loads, double[] util, double rate, string from) =>
        $"name: {name}\nunit: {unit}\n{source}levels:\n"
        + string.Concat(loads.Select((load, i) => FormattableString.Invariant($"  - load: {load}\n    overall: {{ p50: 10, p95: 20 }}\n    objects: {{ db: {{ util: {util[i]} }} }}\n    connections: [{{ from: {from}, to: db, rate: {rate * (i + 1)}, p50: 3, bytes: 100 }}]\n")));

    private static readonly string Orders = Part("Customer orders", "orders/min", "source: { color: blue, dot: rate / 5, size: bytes / 100 }\n", [100, 200, 300], [0.2, 0.4, 0.6], 10, "orders");

    private static readonly string Pings = Part("Courier pings", "pings/s", "source: { color: green, dot: rate / 5 }\n", [50, 100, 200], [0.1, 0.3, 0.7], 5, "auth");

    private const string Grid = "name: Both at once\nsources:\n  orders: { name: Customer orders, unit: orders/min, color: blue, dot: rate / 5 }\n  pings: { name: Courier pings, unit: pings/s, color: green, dot: rate / 5 }\nlevels:\n"
        + "  - load: { orders: 100, pings: 50 }\n    objects: { db: { util: 0.2 } }\n    connections: [{ from: orders, to: db, rate: 15, by: { orders: { rate: 10 }, pings: { rate: 5 } } }]\n"
        + "  - load: { orders: 100, pings: 100 }\n    objects: { db: { util: 0.5 } }\n    connections: [{ from: orders, to: db, rate: 20, by: { orders: { rate: 10 }, pings: { rate: 10 } } }]\n"
        + "  - load: { orders: 200, pings: 50 }\n    objects: { db: { util: 0.6 } }\n    connections: [{ from: orders, to: db, rate: 25, by: { orders: { rate: 20 }, pings: { rate: 5 } } }]\n"
        + "  - load: { orders: 200, pings: 100 }\n    objects: { db: { util: 0.95 } }\n    connections: [{ from: orders, to: db, rate: 30, by: { orders: { rate: 20 }, pings: { rate: 10 } } }]\n";

    /// <summary>The shop's model with some runs beside it.</summary>
    private static (Window Window, ReaderView Reader, TempFolder Folder) Open(params (string Id, string Text)[] runs)
    {
        var temp = new TempFolder();
        File.Copy(Path.Combine(Shop, "model.yaml"), Path.Combine(temp.Path, "model.yaml"));
        Directory.CreateDirectory(Path.Combine(temp.Path, "perf"));
        foreach (var (id, text) in runs) File.WriteAllText(Path.Combine(temp.Path, "perf", $"{id}.yaml"), text);
        var reader = new ReaderView();
        var window = new Window { Width = 1280, Height = 900, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(temp.Path), temp.Path);
        Dispatcher.UIThread.RunJobs();
        return (window, reader, temp);
    }

    private static (Window Window, ReaderView Reader, TempFolder Folder) Added() =>
        Open(("orders", Orders), ("pings", Pings), ("together", "name: Orders and pings, added\nadds: [orders, pings]\n"));

    private static void Press(Window w, Key key, PhysicalKey physical) => w.KeyPress(key, RawInputModifiers.None, physical, null);

    private static void Click(Button button) => button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));

    private static string Text(ReaderView reader)
    {
        (TopLevel.GetTopLevel(reader) as Window)?.UpdateLayout();
        return string.Join("|", reader.PerfPanelNow.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text));
    }

    private static string ButtonText(Button b) => string.Join("", b.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text));

    private static void OpenPerf(ReaderView reader, Window window, string run)
    {
        reader.PickRunById(run);
        Press(window, Key.T, PhysicalKey.T);
        window.UpdateLayout();
    }

    [AvaloniaFact]
    public void A_run_that_adds_others_has_a_block_for_each_dial_and_says_how_it_was_measured()
    {
        var (window, reader, temp) = Added();
        using var _ = temp;
        OpenPerf(reader, window, "together");
        var panel = reader.PerfPanelNow;
        Assert.Equal("Added from separate runs", panel.ModeText);
        var dials = panel.DialLines;
        Assert.Equal(["Customer orders", "Courier pings"], dials.Select(d => d.Name));
        Assert.All(dials, d => Assert.Equal("Tested", d.Note));
        
        Assert.Equal([2.0, 2.0], dials.Select(d => d.Slider.Maximum)); // 3 loads each: a position along each
        Assert.Contains("Orders and pings, added", string.Join("|", panel.RunChoices.Select(c => c.Name)));
        Assert.True(Text(reader).Contains("First struggles with Customer orders at 300 orders/min and Courier pings at 200 pings/s: Orders DB at 130% of capacity"), Text(reader));
        Assert.Contains("Go there", Text(reader));
        Assert.Null(reader.PerfPanelNow.RampButton.Parent); // the one Ramp of a single run is not there: each dial has its own
    }

    [AvaloniaFact]
    public void The_panel_opens_where_everything_first_struggles_when_every_dial_rises_together_and_Go_there_returns_to_it()
    {
        var (window, reader, temp) = Added();
        using var _ = temp;
        OpenPerf(reader, window, "together");
        var (places, active) = reader.PerfPlaces;
        Assert.Equal([2.0, 2.0], places); // orders at 300 and pings at 200: the last step, each along its own loads
        Assert.Equal(0, active);
        Press(window, Key.Home, PhysicalKey.Home);
        Assert.Equal([0.0, 2.0], reader.PerfPlaces.Places);
        var go = reader.PerfPanelNow.GetVisualDescendants().OfType<Button>().First(b => b.Classes.Contains("link"));
        Click(go);
        Assert.Equal([2.0, 2.0], reader.PerfPlaces.Places);
    }

    [AvaloniaFact]
    public void The_arrow_keys_Home_and_End_act_on_the_active_dial_and_pressing_a_slider_makes_it_the_active_one()
    {
        var (window, reader, temp) = Added();
        using var _ = temp;
        OpenPerf(reader, window, "together");
        Press(window, Key.Left, PhysicalKey.ArrowLeft);
        Assert.Equal([1.0, 2.0], reader.PerfPlaces.Places);
        var dials = reader.PerfPanelNow.DialLines;
        Assert.Equal("200 orders/min", dials[0].Load);
        Assert.Equal([true, false], dials.Select(d => d.Active));
        // A press on the second dial's slider (at its thumb, so the value stays): it is the dial the keys act on now.
        window.UpdateLayout();
        var slider = dials[1].Slider;
        var thumb = slider.TranslatePoint(new Point(slider.Bounds.Width - 4, slider.Bounds.Height / 2), window)!.Value;
        window.MouseDown(thumb, MouseButton.Left);
        window.MouseUp(thumb, MouseButton.Left);
        Assert.Equal(1, reader.PerfPlaces.Active);
        Assert.Equal([false, true], reader.PerfPanelNow.DialLines.Select(d => d.Active));
        Press(window, Key.Left, PhysicalKey.ArrowLeft);
        Assert.Equal([1.0, 1.0], reader.PerfPlaces.Places);
        Press(window, Key.Home, PhysicalKey.Home);
        Assert.Equal([1.0, 0.0], reader.PerfPlaces.Places);
        Press(window, Key.End, PhysicalKey.End);
        Assert.Equal([1.0, 2.0], reader.PerfPlaces.Places);
        Assert.Equal("200 pings/s", reader.PerfPanelNow.DialLines[1].Load);
    }

    [AvaloniaFact]
    public void Moving_a_slider_moves_that_dial_and_makes_it_active_and_the_chart_follows_it_with_the_other_held()
    {
        var (window, reader, temp) = Added();
        using var _ = temp;
        OpenPerf(reader, window, "together");
        reader.PerfPanelNow.DialLines[1].Slider.Value = 1;
        Assert.Equal([2.0, 1.0], reader.PerfPlaces.Places);
        Assert.Equal(1, reader.PerfPlaces.Active);
        reader.FlushSlide();
        Assert.Equal("100 pings/s", reader.PerfPanelNow.DialLines[1].Load);
        Assert.Equal([("Courier pings", "Customer orders held at 300 orders/min")], reader.PerfPanelNow.AlongTexts.Take(1));
        reader.PerfPanelNow.DialLines[0].Slider.Value = 0.4; // a drag to between two loads goes there
        Assert.Equal([0.4, 1.0], reader.PerfPlaces.Places);
        Assert.Equal(0, reader.PerfPlaces.Active);
    }

    [AvaloniaFact]
    public void Each_dial_has_its_own_Ramp_that_runs_that_dial_alone_and_moves_when_another_is_pressed()
    {
        using var motion = Motion.On();
        var (window, reader, temp) = Added();
        using var _ = temp;
        OpenPerf(reader, window, "together");
        Press(window, Key.Home, PhysicalKey.Home);
        var dials = reader.PerfPanelNow.DialLines;
        Assert.Equal([0.0, 2.0], reader.PerfPlaces.Places);
        Click(dials[1].Ramp);
        Assert.True(reader.PerfState.Ramping);
        Assert.Equal(1, reader.PerfPlaces.Active);
        window.UpdateLayout();
        Assert.Equal(["Ramp", "Pause"], reader.PerfPanelNow.DialLines.Select(d => ButtonText(d.Ramp)));
        Thread.Sleep(300);
        reader.TickRamp();
        var (places, _) = reader.PerfPlaces;
        Assert.Equal(0.0, places[0]); // the other dial is held
        Assert.InRange(places[1], -0.995, -0.85); // it was at its top, so the ramp started again from no load
        Click(dials[0].Ramp); // the ramp moves to the first dial
        Assert.True(reader.PerfState.Ramping);
        Assert.Equal(0, reader.PerfPlaces.Active);
        Press(window, Key.P, PhysicalKey.P); // P acts on the active dial: it stops the ramp
        Assert.False(reader.PerfState.Ramping);
        window.UpdateLayout();
        Assert.All(reader.PerfPanelNow.DialLines, d => Assert.Equal("Ramp", ButtonText(d.Ramp)));
    }

    [AvaloniaFact]
    public void The_canvas_draws_a_line_for_each_source_in_its_colour_and_the_key_names_each()
    {
        using var motion = Motion.On();
        var (window, reader, temp) = Added();
        using var _ = temp;
        OpenPerf(reader, window, "together");
        reader.GoTo("shop"); // where orders and auth, both inside Web, reach the database along one line
        var lines = reader.Canvas.Load!.Lines;
        var shared = lines.Where(l => l.From == "web" && l.To == "db").ToList();
        Assert.Equal(["orders", "pings"], shared.Select(l => l.Source));
        Assert.Equal(["blue", "green"], shared.Select(l => l.Color));
        Assert.Equal([-0.5, 0.5], shared.Select(l => l.Offset));
        Assert.Equal(shared[0].Width, shared[1].Width);
        Assert.Equal(1.0, reader.Canvas.Load!.Boxes["db"].Strain); // 0.6 and 0.8 added: past full, drawn at full
        var key = string.Join("|", reader.PerfPanelNow.KeyLabels);
        Assert.Contains("Customer orders|1 dot = 5 calls/s|Bigger call|Courier pings|1 dot = 5 calls/s", key);
    }

    [AvaloniaFact]
    public void A_shape_added_past_its_capacity_says_so_and_a_run_tested_together_never_does()
    {
        var (window, reader, temp) = Added();
        using var _ = temp;
        OpenPerf(reader, window, "together");
        reader.GoTo("shop");
        reader.Select("db");
        window.UpdateLayout();
        Assert.Equal("Added use is over 100%", reader.PerfPanelNow.OverShown);
        Assert.Contains(("Busy", "130%"), reader.PerfPanelNow.Readings);
        Press(window, Key.Home, PhysicalKey.Home);
        Assert.Null(reader.PerfPanelNow.OverShown); // orders at the lowest, pings at its highest: 0.2 + 0.7 is not over it
        Assert.Contains(("Busy", "90%"), reader.PerfPanelNow.Readings);
    }

    [AvaloniaFact]
    public void A_run_tested_together_says_so_and_blends_between_its_tested_combinations()
    {
        var (window, reader, temp) = Open(("both", Grid));
        using var _ = temp;
        OpenPerf(reader, window, "both");
        var panel = reader.PerfPanelNow;
        Assert.Equal("Tested together", panel.ModeText);
        Assert.Equal([1.0, 1.0], panel.DialLines.Select(d => d.Slider.Maximum));
        reader.PerfPanelNow.DialLines[0].Slider.Value = 0; // orders at 100, pings still at 100
        Assert.Equal([0.0, 1.0], reader.PerfPlaces.Places);
        reader.FlushSlide();
        Assert.Equal(0.5, reader.Canvas.Load!.Boxes["db"].Strain!.Value, 2);
    }

    [AvaloniaFact]
    public void Without_motion_the_dials_have_no_Ramp_and_the_key_says_nothing_of_a_source()
    {
        var (window, reader, temp) = Added();
        using var _ = temp;
        OpenPerf(reader, window, "together");
        var panel = reader.PerfPanelNow;
        Assert.Null(panel.DialLines[0].Ramp.Parent);
        Assert.DoesNotContain("Courier pings|1 dot", string.Join("|", panel.KeyLabels));
        Assert.DoesNotContain("←|→", Text(reader));
        Assert.DoesNotContain("|P|", Text(reader));
        Press(window, Key.P, PhysicalKey.P);
        Assert.False(reader.PerfState.Ramping);
        Assert.NotEmpty(reader.Canvas.Load!.Boxes); // the colours and the numbers stay
    }

    [AvaloniaFact]
    public void A_run_of_one_source_beside_runs_with_several_is_the_panel_it_always_was()
    {
        var (window, reader, temp) = Added();
        using var _ = temp;
        OpenPerf(reader, window, "orders");
        var panel = reader.PerfPanelNow;
        Assert.Null(panel.ModeText);
        Assert.Empty(panel.DialLines);
        Assert.Equal("300 orders/min", panel.LoadText);
        reader.PickRunById("together");
        window.UpdateLayout();
        reader.PickRunById("orders");
        window.UpdateLayout();
        Assert.Empty(reader.PerfPanelNow.DialLines);
        Assert.Equal("300 orders/min", reader.PerfPanelNow.LoadText);
    }

    [AvaloniaFact]
    public void A_picture_can_put_each_dial_at_a_load()
    {
        var (window, reader, temp) = Added();
        using var _ = temp;
        OpenPerf(reader, window, "together");
        reader.GoToLoads([200, 100]);
        Assert.Equal([1.0, 1.0], reader.PerfPlaces.Places);
        reader.GoToLoads([250, 150]);
        Assert.Equal([1.5, 1.5], reader.PerfPlaces.Places);
        Assert.Equal("Between 200 and 300, estimated", reader.PerfPanelNow.DialLines[0].Note);
        Assert.Equal("Between 100 and 200, estimated", reader.PerfPanelNow.DialLines[1].Note);
    }
}
