using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.LogicalTree;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;
using Path = Avalonia.Controls.Shapes.Path;

namespace Flowy.App.Tests;

/// <summary>
/// Shape states on the canvas (desktop/fixtures/cases/states): what a box draws for a state, the roll-up on a container, the key under the player, the State
/// line in Details, the loops that run only while a state that loops is showing, and the picker in a step's edit form.
/// </summary>
public class StateTests
{
    private static string Case => System.IO.Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "states", "flowy");

    private static string PerfCase => System.IO.Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "perf", "flowy");

    /// <summary>Motion on for as long as it is held: the tests run on one thread and share the environment, so what one leaves behind the next would inherit.</summary>
    private sealed class Motion : IDisposable
    {
        private Motion() => Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0");

        public static Motion On() => new();

        public void Dispose() => Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
    }

    private static (CanvasView Canvas, Folder Folder) OpenCanvas(string view, string dir = "")
    {
        var folder = FolderLoader.Load(dir == "" ? Case : dir);
        var canvas = new CanvasView();
        new Window { Width = 1000, Height = 700, Content = canvas }.Show();
        canvas.SetScene(SceneBuilder.Build(folder.Model, view, null, folder.Problems, new Focus()), "straight", []);
        Dispatcher.UIThread.RunJobs();
        return (canvas, folder);
    }

    private static (Window Window, ReaderView Reader) OpenReader()
    {
        var reader = new ReaderView();
        var window = new Window { Width = 1280, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(Case), Case);
        reader.GoTo("shop");
        Dispatcher.UIThread.RunJobs();
        return (window, reader);
    }

    private static Dictionary<string, StateMark> Marks(Folder folder, params (string Id, string State)[] states) =>
        States.Marks(folder.Model, states.ToDictionary(s => s.Id, s => s.State)).ToDictionary(kv => kv.Key, kv => kv.Value);

    private static BoxControl Box(CanvasView canvas, string id) => (BoxControl)canvas.BoxControlFor(id)!;

    private static IEnumerable<string> Words(Control root) => root.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text ?? "");

    /// <summary>The words of the key on the player's card: one for each swatch.</summary>
    private static List<string> Keyed(ReaderView reader) =>
        reader.Card.GetVisualDescendants().OfType<StateSwatch>().Select(s => ((TextBlock)((StackPanel)s.Parent!).Children[1]).Text ?? "").ToList();

    /// <summary>The text in a panel, found through the logical tree: its content is in a scroll viewer that makes no visuals before a layout.</summary>
    private static List<string> PanelWords(Control root) => root.GetLogicalDescendants().OfType<TextBlock>().Select(t => t.Text ?? "").ToList();

    [AvaloniaFact]
    public void A_stopped_shape_shows_the_state_class_and_the_glyph_and_a_running_one_shows_neither()
    {
        var (canvas, folder) = OpenCanvas("shop");
        canvas.ShowStates(Marks(folder, ("api", "stopped"), ("web", "running")));
        var api = Box(canvas, "api");
        Assert.Contains("state-stopped", api.Classes);
        Assert.Contains("stated", api.Classes);
        Assert.Equal(("stopped", false, true, true, false), api.StateShown);
        Assert.Equal(["Stopped"], api.GetVisualDescendants().OfType<StateGlyph>().Select(g => Avalonia.Automation.AutomationProperties.GetName(g)));
        var web = Box(canvas, "web"); // Running draws nothing
        Assert.Equal((null, false, false, false, false), web.StateShown);
        Assert.DoesNotContain(web.Classes, c => c.StartsWith("state-") || c == "stated");
        Assert.Empty(web.GetVisualDescendants().OfType<StateGlyph>());
        canvas.ShowStates(null); // reduced motion: gone at once
        Assert.Equal((null, false, false, false, false), api.StateShown);
        Assert.DoesNotContain(api.Classes, c => c.StartsWith("state-") || c == "stated");
        Assert.Empty(api.GetVisualDescendants().OfType<StateGlyph>());
    }

    [AvaloniaFact]
    public void Each_state_is_told_by_its_glyph_and_its_name()
    {
        var (canvas, folder) = OpenCanvas("shop");
        foreach (var state in States.Names.Where(n => n != "running"))
        {
            canvas.ShowStates(Marks(folder, ("db", state)));
            var glyph = Box(canvas, "db").GetVisualDescendants().OfType<StateGlyph>().Single();
            Assert.Equal(States.Labels[state], Avalonia.Automation.AutomationProperties.GetName(glyph));
            Assert.Contains("state-" + state, glyph.Classes);
        }
    }

    [AvaloniaFact]
    public void A_container_with_a_stopped_child_shows_the_inside_mark_and_one_with_a_state_of_its_own_shows_that()
    {
        var (canvas, folder) = OpenCanvas("root");
        canvas.ShowStates(Marks(folder, ("orders", "stopped")));
        var shop = Box(canvas, "shop");
        Assert.Equal(("stopped", true, false, true, false), shop.StateShown); // the glyph on a dashed ring, no second outline
        Assert.Contains("state-inside", shop.Classes);
        Assert.DoesNotContain("stated", shop.Classes);
        Assert.Equal(["Stopped inside"], shop.GetVisualDescendants().OfType<StateGlyph>().Select(g => Avalonia.Automation.AutomationProperties.GetName(g)));
        canvas.ShowStates(Marks(folder, ("orders", "stopped"), ("shop", "degraded")));
        Assert.Equal(("degraded", false, true, true, false), shop.StateShown);
        Assert.Contains("stated", shop.Classes);
        Assert.DoesNotContain("state-inside", shop.Classes);
    }

    [AvaloniaFact]
    public void A_state_beats_the_strain_colour_on_the_same_shape()
    {
        var (canvas, folder) = OpenCanvas("shop", PerfCase);
        canvas.ShowLoad(Perf.TrafficFor(folder.Model, folder.Runs!["ramp"], 100, "shop"));
        var worker = Box(canvas, "worker");
        Path Strain() => worker.GetVisualDescendants().OfType<Path>().First(p => p.Classes.Contains("strain"));
        Assert.True(worker.PerfShown.Strained);
        Assert.True(Strain().IsVisible);
        canvas.ShowStates(new Dictionary<string, StateMark> { ["worker"] = new("stopped", false) });
        Assert.True(worker.PerfShown.Strained); // the load is still on it, under the state
        Assert.False(Strain().IsVisible);
        canvas.ShowStates(null);
        Assert.True(Strain().IsVisible);
    }

    [AvaloniaFact]
    public void A_state_loops_only_while_one_that_loops_is_on_screen_and_never_with_reduced_motion()
    {
        var (canvas, folder) = OpenCanvas("shop");
        var api = Box(canvas, "api");
        canvas.ShowStates(Marks(folder, ("api", "starting")));
        Assert.False(api.StateShown.Looping); // motion is reduced: the still look only
        using (Motion.On())
        {
            canvas.ShowStates(null);
            Assert.False(api.StateShown.Looping); // no state, no clock
            foreach (var state in new[] { "starting", "restarting", "degraded" })
            {
                canvas.ShowStates(Marks(folder, ("api", state)));
                Assert.True(api.StateShown.Looping, state);
            }
            foreach (var state in new[] { "stopping", "stopped" })
            {
                canvas.ShowStates(Marks(folder, ("api", state)));
                Assert.False(api.StateShown.Looping, state);
            }
            canvas.ShowStates(Marks(folder, ("api", "starting")));
            canvas.ShowStates(null);
            Assert.False(api.StateShown.Looping); // taking the state away stops the loop
        }
    }

    [AvaloniaFact]
    public void Playing_a_flow_draws_each_stop_s_states_and_stepping_back_takes_them_away_again()
    {
        var (window, reader) = OpenReader();
        reader.Play("hold", 0);
        Assert.Equal([new KeyValuePair<string, StateMark>("stripe", new StateMark("starting", false))], reader.Canvas.StatesShown); // the flow's start: Stripe, drawn beside the shop
        reader.Play("hold", 1); // orders stops: it is inside the API, which the shop view draws
        Assert.Equal(new StateMark("stopped", true), reader.Canvas.StatesShown["api"]);
        Assert.Equal(new StateMark("starting", false), reader.Canvas.StatesShown["stripe"]); // and what held from the start holds
        reader.Play("hold", 3); // the API restarts and the web app is not well: both are the shape's own
        Assert.Equal(new StateMark("restarting", false), reader.Canvas.StatesShown["api"]);
        Assert.Equal(new StateMark("degraded", false), reader.Canvas.StatesShown["web"]);
        window.KeyPress(Key.Left, RawInputModifiers.None, PhysicalKey.ArrowLeft, null);
        Assert.Equal(new StateMark("stopped", true), reader.Canvas.StatesShown["api"]); // the state at a stop is worked out from the start, so back needs no undo
        Assert.DoesNotContain("web", reader.Canvas.StatesShown.Keys);
        window.KeyPress(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);
        Assert.Null(reader.PlayingFlowId);
        Assert.Empty(reader.Canvas.StatesShown);
    }

    [AvaloniaFact]
    public void The_key_lists_only_the_states_on_screen_each_with_its_name()
    {
        var (_, reader) = OpenReader();
        reader.Play("hold", 0);
        Assert.Equal(["Starting"], Keyed(reader)); // Stripe starts out starting, and it is drawn beside the shop
        reader.Play("hold", 1);
        Assert.Equal(["Starting", "Stopped inside"], Keyed(reader));
        reader.Play("hold", 3);
        Assert.Equal(["Starting", "Restarting", "Degraded"], Keyed(reader)); // in the order of the six, not of the shapes
        reader.Play("hold", 4); // Stripe and the API are running again; the web app is still not well
        Assert.Equal(["Degraded"], Keyed(reader));
        reader.GoTo("root");
        reader.Play("numbered", 0);
        Assert.Equal(["Starting", "Stopped", "Degraded"], Keyed(reader)); // a shape that is not drawn here, or not in a state, has no mark
    }

    [AvaloniaFact]
    public void The_key_puts_the_states_in_the_order_of_the_six_with_a_shape_s_own_before_one_it_holds()
    {
        var marks = new[] { new StateMark("degraded", false), new StateMark("stopped", true), new StateMark("stopped", false), new StateMark("starting", false), new StateMark("degraded", false) };
        Assert.Equal(["Starting", "Stopped", "Stopped inside", "Degraded"], StateKey.Distinct(marks).Select(StateKey.Word));
        Assert.Null(StateKey.Of([]));
    }

    [AvaloniaFact]
    public void Details_names_the_state_of_the_shape_it_shows()
    {
        var (_, reader) = OpenReader();
        reader.Play("hold", 3);
        reader.Select("api");
        Assert.Contains("State", PanelWords(reader.Panel));
        Assert.Contains("Restarting", PanelWords(reader.Panel));
        reader.Select("db"); // Running: no State line
        Assert.DoesNotContain("State", PanelWords(reader.Panel));
        reader.Select("orders"); // stopped, but inside the API and not drawn on this view: Details says what the canvas shows
        Assert.DoesNotContain("State", PanelWords(reader.Panel));
    }

    private static async Task Until(Func<bool> done)
    {
        for (var i = 0; i < 500 && !done(); i++) await Task.Delay(10);
        Assert.True(done(), "gave up waiting");
    }

    [AvaloniaFact]
    public async Task The_edit_form_offers_a_state_for_each_end_of_a_step_and_a_pick_is_one_edit_that_None_takes_back()
    {
        using var temp = new TempFolder();
        var dir = System.IO.Path.Combine(temp.Path, "flowy");
        foreach (var file in Directory.GetFiles(Case, "*", SearchOption.AllDirectories))
        {
            var target = System.IO.Path.Combine(dir, System.IO.Path.GetRelativePath(Case, file));
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(target)!);
            File.WriteAllText(target, File.ReadAllText(file));
        }
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        reader.SetEditing(true);
        reader.OpenFlowById("repeat");
        Dispatcher.UIThread.RunJobs();
        var recorder = reader.Panel.CurrentRecorder!;
        Assert.Equal(["web", "api"], recorder.StepStatePickers(0).Select(p => p.Shape)); // the two ends of the step
        Assert.Equal(["api"], recorder.StepStatePickers(2).Select(p => p.Shape).Where(s => s == "api")); // one tile row for each end
        var (_, tiles) = recorder.StepStatePickers(0)[1];
        Assert.Equal(["", "running", "starting", "stopping", "stopped", "restarting", "degraded"], tiles.Ids);
        Assert.Equal("starting", recorder.StepStatePickers(0)[1].Tiles.Chosen); // what the file says

        Assert.True(await tiles.Choose("stopped"));
        await Until(() => reader.Folder!.Model.Flows["repeat"].Steps[0].States is OrderedDictionary<string, object?> m && m.TryGetValue("api", out var v) && v as string == "stopped");
        Assert.Equal("stopped", reader.Panel.CurrentRecorder!.StepStatePickers(0)[1].Tiles.Chosen);

        Assert.True(await reader.Panel.CurrentRecorder!.StepStatePickers(0)[1].Tiles.Choose(""));
        await Until(() => reader.Folder!.Model.Flows["repeat"].Steps[0].States is null);
        Assert.DoesNotContain("states:", File.ReadAllText(System.IO.Path.Combine(dir, "flows", "repeat.yaml")).Split("\n  - ")[1]);
    }

    [AvaloniaFact]
    public void A_pick_keeps_every_other_entry_of_the_step_and_leaves_out_what_is_not_text()
    {
        var step = new OrderedDictionary<string, object?>
        {
            ["from"] = "web",
            ["states"] = new OrderedDictionary<string, object?> { ["web"] = "degraded", ["api"] = "starting", ["db"] = new List<object?>() },
        };
        Assert.Equal(["web", "api"], Recorder.StatesWith(step, "db", "").Keys);
        var next = Recorder.StatesWith(step, "api", "running");
        Assert.Equal(["web", "api"], next.Keys);
        Assert.Equal("running", next["api"]);
        Assert.Equal(["web"], Recorder.StatesWith(step, "api", "").Keys);
    }
}
