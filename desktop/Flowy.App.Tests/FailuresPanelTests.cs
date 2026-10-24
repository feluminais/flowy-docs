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
/// The Failures tab on the left, with Explorer and Flows, on the fixtures' small shop (desktop/fixtures/cases/failures) and on the demo Plum: the rail button, M and
/// Esc, the list and what narrows it, the detail of a mode, what the canvas wears, Show it, Seen in a run and the copy buttons.
/// </summary>
[Trait("Weight", "Heavy")]
public class FailuresPanelTests
{
    private static string Shop => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "failures", "flowy");

    private static string Plum => Path.Combine(Repo.Root, "docs", "demo", "flowy");

    private static (Window Window, ReaderView Reader) Open(string? dir = null, string analysis = "ordering")
    {
        dir ??= Shop;
        var reader = new ReaderView();
        var window = new Window { Width = 1280, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        Dispatcher.UIThread.RunJobs();
        return (window, reader);
    }

    /// <summary>Opens the panel on an analysis, through the picker the reader has.</summary>
    private static void OpenOn(Window window, ReaderView reader, string analysis)
    {
        Press(window, Key.M, PhysicalKey.M);
        var ids = reader.Folder!.Model.Failures.Keys.ToList();
        if (reader.FailuresPanelNow.Picker is { } picker && picker.SelectedIndex != ids.IndexOf(analysis)) picker.SelectedIndex = ids.IndexOf(analysis);
    }

    private static void Press(Window w, Key key, PhysicalKey physical) => w.KeyPress(key, RawInputModifiers.None, physical, null);

    private static void Click(Button button) => button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));

    private static Button Named(ReaderView reader, string name) => reader.FailuresPanelNow.Buttons.First(b => Avalonia.Automation.AutomationProperties.GetName(b) == name);

    private static string Name(RankedMode r, Model model)
    {
        var part = Failures.PartName(model, r.Mode);
        return $"{Failures.BandName(r.Band)}. {part}, {r.Mode.Mode}{(r.Risk is { } n ? $", risk {n}" : "")}";
    }

    [AvaloniaFact]
    public void The_left_rail_has_a_Failures_button_where_there_is_an_analysis_and_the_number_on_it_is_how_many_modes()
    {
        var (_, reader) = Open();
        var count = FailuresView.ModeCount(reader.Folder!.Model);
        Assert.DoesNotContain(reader.DetailsRail.Shown, i => i.Name.StartsWith("Failures")); // Details' rail on the right has Details only
        var item = reader.Rail.Shown.First(i => i.Name.StartsWith("Failures"));
        Assert.Equal($"Failures, {count}", item.Name);
        Assert.True(item.Visible);
        Assert.True(item.Enabled);
        Assert.Equal(count.ToString(), item.Count);
        Assert.False(reader.FailuresOpenNow); // nothing is open until the button is pressed
    }

    [AvaloniaFact]
    public void A_folder_without_an_analysis_still_has_the_Failures_button_and_M_opens_a_panel_that_says_so()
    {
        using var temp = new TempFolder();
        File.WriteAllText(Path.Combine(temp.Path, "model.yaml"), "objects:\n  web:\n    type: app\n    name: Web\n");
        var (window, reader) = Open(temp.Path);
        var item = reader.Rail.Shown.First(i => i.Name.StartsWith("Failures"));
        Assert.True(item.Visible);
        Assert.Equal("Failures", item.Name); // no count while there is nothing to count
        Assert.Null(item.Count);
        Press(window, Key.M, PhysicalKey.M);
        Assert.True(reader.FailuresOpenNow);
        Assert.Contains(reader.FailuresPanelNow.Texts, t => t == "No failure analyses yet.");
    }

    [AvaloniaFact]
    public void M_and_the_button_open_the_tab_beside_Explorer_and_Flows_and_Esc_closes_it()
    {
        var (window, reader) = Open();
        Press(window, Key.M, PhysicalKey.M);
        Assert.True(reader.FailuresOpenNow);
        Assert.Equal(PanelTab.Failures, reader.ShownTabNow);
        Assert.True(reader.HasPanel);
        Assert.False(reader.DetailsOpenNow); // Details is a panel of its own, on the right
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.False(reader.FailuresOpenNow);
        Assert.False(reader.HasPanel);
        reader.ClickRail(PanelTab.Failures);
        Assert.True(reader.FailuresOpenNow);
        reader.ClickRail(PanelTab.Failures);
        Assert.False(reader.FailuresOpenNow);
        Press(window, Key.M, PhysicalKey.M);
        Press(window, Key.M, PhysicalKey.M); // M again closes it
        Assert.False(reader.FailuresOpenNow);
    }

    [AvaloniaFact]
    public void The_Failures_tab_and_Details_are_open_together_and_Performance_and_Failures_never_are()
    {
        var (window, reader) = Open();
        reader.Select("web");
        Assert.True(reader.DetailsOpenNow);
        Press(window, Key.M, PhysicalKey.M);
        Assert.True(reader.FailuresOpenNow);
        Assert.True(reader.DetailsOpenNow); // the tab is on the left and Details on the right: a shape reads out there while the list stays
        Press(window, Key.T, PhysicalKey.T);
        Assert.True(reader.PerfOpenNow);
        Assert.False(reader.FailuresOpenNow); // load and risk would draw over each other
        Press(window, Key.M, PhysicalKey.M);
        Assert.False(reader.PerfOpenNow);
        Assert.True(reader.FailuresOpenNow);
        reader.ClickRail(PanelTab.Explorer); // another tab of the navigator takes its place
        Assert.False(reader.FailuresOpenNow);
        Assert.Equal(PanelTab.Explorer, reader.ShownTabNow);
        Assert.Equal((null, FailLight.None), reader.Canvas.FailureOnBox("db"));
    }

    [AvaloniaFact]
    public void The_list_is_worst_first_with_the_band_in_the_name_of_each_row()
    {
        var (window, reader) = Open();
        OpenOn(window, reader, "ordering");
        var model = reader.Folder!.Model;
        var expected = Failures.Rank(model.Failures["ordering"]).Select(r => Name(r, model)).ToList();
        Assert.Equal(expected, reader.FailuresPanelNow.Rows.Select(r => r.Name));
        Assert.Equal("High. Shop > API > Auth, The login lock is never released, risk 150", expected[0]); // 6 x 5 x 5 outranks the database's 40, though its severity is 10
        Assert.Equal("High. Shop > Orders DB, The database is unreachable, risk 40", expected[1]);
        Assert.DoesNotContain(reader.FailuresPanelNow.Rows, r => r.Current);
    }

    [AvaloniaFact]
    public void Picking_a_mode_shows_its_detail_lights_the_canvas_and_picking_it_again_puts_it_away()
    {
        var (window, reader) = Open();
        OpenOn(window, reader, "ordering");
        reader.GoTo("shop");
        reader.PickModeById("db-down");
        var texts = reader.FailuresPanelNow.Texts;
        Assert.Contains("SHOP > ORDERS DB", texts); // the section's title, in capitals as every title is
        Assert.Contains("The database is unreachable", texts);
        Assert.Contains("Orders can't be saved.", texts);
        Assert.Contains("The primary fails.", texts);
        Assert.Contains("A standby takes over.", texts);
        Assert.Contains("Rehearse the failover. · Platform · Planned", texts);
        Assert.Contains("Web app, API", texts);
        Assert.Contains("40", texts);
        Assert.Contains(" · After: 40 to 20", texts);
        Assert.Contains("1: Nobody notices", texts);
        Assert.Contains("10: Someone loses money", texts);
        Assert.Contains(reader.FailuresPanelNow.Rows, r => r.Current && r.Name.Contains("The database is unreachable"));
        Assert.Equal(("ordering", "db-down", null, false), reader.FailuresState);
        Assert.Equal(FailLight.Fails, reader.Canvas.FailureOnBox("db").Light);
        Assert.Equal(FailLight.Affects, reader.Canvas.FailureOnBox("web").Light);
        Assert.Contains("fails", reader.FailuresPanelNow.KeyMarks); // the key draws the marks the canvas has now
        Assert.Contains("affects", reader.FailuresPanelNow.KeyMarks);
        Assert.Contains("high", reader.FailuresPanelNow.KeyMarks);

        Click(reader.FailuresPanelNow.Buttons.First(b => b.Classes.Contains("failrow") && b.Classes.Contains("current")));
        Assert.Null(reader.FailuresState.Mode);
        Assert.Equal(FailLight.None, reader.Canvas.FailureOnBox("db").Light);
        Assert.DoesNotContain("Orders can't be saved.", reader.FailuresPanelNow.Texts);
    }

    [AvaloniaFact]
    public void A_picked_mode_is_brought_out_from_under_the_tab_that_lists_it()
    {
        var (window, reader) = Open(Plum);
        reader.GoTo("ordering");
        Press(window, Key.M, PhysicalKey.M);
        var stripe = reader.Canvas.RectOf("stripe")!.Value; // Stripe sits at the left of the view, where the tab opens over the canvas
        reader.PickModeById("stripe-timeout"); // its line runs from Order API to Stripe
        var left = reader.Canvas.Viewport.ToScreen(new Pt(stripe.X, stripe.Y)).X;
        Assert.True(left >= reader.Widths.Nav, $"Stripe starts at {left}, under the tab that is {reader.Widths.Nav} wide");
    }

    [AvaloniaFact]
    public void A_mode_the_view_does_not_draw_takes_the_canvas_to_the_view_that_does()
    {
        var (window, reader) = Open();
        OpenOn(window, reader, "ordering");
        reader.GoTo("api");
        reader.PickModeById("web-glitch"); // the page flickers: on Web app, which the API's view does not draw
        Assert.Equal("shop", reader.View);
        Assert.Equal(FailLight.Fails, reader.Canvas.FailureOnBox("web").Light);
    }

    [AvaloniaFact]
    public void The_arrow_keys_step_down_the_list_and_stop_at_its_ends()
    {
        var (window, reader) = Open();
        OpenOn(window, reader, "ordering");
        var model = reader.Folder!.Model;
        var ids = Failures.Rank(model.Failures["ordering"]).Select(r => r.Id).ToList();
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Assert.Equal(ids[0], reader.FailuresState.Mode); // nothing picked: the first
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Assert.Equal(ids[1], reader.FailuresState.Mode);
        Press(window, Key.Left, PhysicalKey.ArrowLeft);
        Press(window, Key.Left, PhysicalKey.ArrowLeft);
        Assert.Equal(ids[0], reader.FailuresState.Mode);
        for (var i = 0; i < ids.Count + 2; i++) Press(window, Key.Right, PhysicalKey.ArrowRight);
        Assert.Equal(ids[^1], reader.FailuresState.Mode);
    }

    [AvaloniaFact]
    public void A_band_button_narrows_the_list_to_it_and_pressing_it_again_widens_it()
    {
        var (window, reader) = Open();
        OpenOn(window, reader, "ordering");
        var model = reader.Folder!.Model;
        var counts = FailuresView.BandCounts(model.Failures["ordering"]);
        Assert.Equal(
            new[] { $"High, {counts[RiskBand.High]}", $"Medium, {counts[RiskBand.Medium]}", $"Low, {counts[RiskBand.Low]}", $"Not rated, {counts[RiskBand.Unrated]}" },
            reader.FailuresPanelNow.BandButtons.Select(b => b.Name));
        Click(Named(reader, $"High, {counts[RiskBand.High]}"));
        Assert.Equal(RiskBand.High, reader.FailuresState.Band);
        Assert.Equal(counts[RiskBand.High], reader.FailuresPanelNow.Rows.Count);
        Assert.All(reader.FailuresPanelNow.Rows, r => Assert.StartsWith("High.", r.Name));
        Assert.True(reader.FailuresPanelNow.BandButtons.First().Pressed);
        Click(Named(reader, $"High, {counts[RiskBand.High]}"));
        Assert.Null(reader.FailuresState.Band);
        Assert.Equal(model.Failures["ordering"].Modes.Count, reader.FailuresPanelNow.Rows.Count);
    }

    [AvaloniaFact]
    public void A_band_and_Not_analysed_replace_each_other_as_one_filter_as_in_the_browser()
    {
        var (window, reader) = Open(Plum);
        Press(window, Key.M, PhysicalKey.M);
        var model = reader.Folder!.Model;
        var left = Failures.Coverage(model, model.Failures["ordering"]).Left.Count;
        Click(Named(reader, $"Not analysed ({left})"));
        Assert.True(reader.FailuresState.Left);
        Click(Named(reader, "High, 2")); // a band leaves the list of shapes for the rows of that band
        Assert.False(reader.FailuresState.Left);
        Assert.Equal(RiskBand.High, reader.FailuresState.Band);
        Assert.All(reader.FailuresPanelNow.Rows, r => Assert.StartsWith("High.", r.Name));
        Click(Named(reader, $"Not analysed ({left})")); // and the shapes leave the band
        Assert.True(reader.FailuresState.Left);
        Assert.Null(reader.FailuresState.Band);
        Assert.DoesNotContain(reader.FailuresPanelNow.BandButtons, x => x.Pressed);
    }

    [AvaloniaFact]
    public void A_shape_picked_on_the_canvas_narrows_the_list_to_what_it_carries_and_the_chip_clears_it()
    {
        var (window, reader) = Open();
        OpenOn(window, reader, "ordering");
        reader.GoTo("shop");
        reader.Select("db");
        Assert.True(reader.FailuresOpenNow); // the tab stays; the pick narrows its list
        Assert.True(reader.DetailsOpenNow); // and Details reads the shape out beside it
        Assert.Equal(2, reader.FailuresPanelNow.Rows.Count); // The database is unreachable, and the one named like something on every object
        Assert.Contains("Shop > Orders DB", reader.FailuresPanelNow.Texts);
        Click(Named(reader, "Clear"));
        Assert.Null(reader.SelectedBoxId);
        Assert.True(reader.FailuresPanelNow.Rows.Count > 2);
    }

    [AvaloniaFact]
    public void Not_analysed_lists_the_shapes_no_mode_names_and_a_click_goes_to_one()
    {
        var (window, reader) = Open();
        OpenOn(window, reader, "empty"); // an analysis with no mode: every shape is left
        var model = reader.Folder!.Model;
        var (analysed, left) = Failures.Coverage(model, model.Failures["empty"]);
        Assert.Equal(5, left.Count);
        Assert.Contains("No failure modes yet.", reader.FailuresPanelNow.Texts);
        Assert.Contains($"Analysed {analysed.Count} of {analysed.Count + left.Count}", reader.FailuresPanelNow.Texts);
        var link = Named(reader, $"Not analysed ({left.Count})");
        Click(link);
        Assert.True(reader.FailuresState.Left);
        Assert.Equal(left.Select(id => Failures.ShapeName(model, id)), reader.FailuresPanelNow.Rows.Select(r => r.Name));
        Click(reader.FailuresPanelNow.Buttons.First(b => b.Classes.Contains("failrow")));
        Assert.NotNull(reader.SelectedBoxId);
        Assert.Contains(reader.SelectedBoxId!, left);
        Assert.True(reader.FailuresOpenNow);
    }

    [AvaloniaFact]
    public void Show_it_plays_the_flow_at_the_step_the_mode_names_and_closes_the_panel()
    {
        var (window, reader) = Open(Plum);
        Press(window, Key.M, PhysicalKey.M);
        var model = reader.Folder!.Model;
        var mode = model.Failures["ordering"].Modes["stripe-timeout"];
        Assert.Equal("capture-payment", mode.Flow);
        reader.PickModeById("stripe-timeout");
        Click(Named(reader, "Show it"));
        Assert.False(reader.FailuresOpenNow);
        Assert.Equal("capture-payment", reader.PlayingFlowId);
        Assert.Equal(Structure.StopIndexOf(Structure.Stops(model.Flows["capture-payment"]), int.Parse(mode.Step!) - 1), reader.PlayingStep);
        Assert.Equal(FailLight.None, reader.Canvas.FailureOnBox("checkout").Light); // no marks while a flow plays
    }

    [AvaloniaFact]
    public void Seen_in_a_run_opens_Performance_on_the_first_level_where_the_part_has_errors()
    {
        var (window, reader) = Open();
        OpenOn(window, reader, "ordering");
        var model = reader.Folder!.Model;
        var run = reader.Folder.Runs!["spike"];
        var mode = model.Failures["ordering"].Modes["mail-timeout"];
        var at = FailuresView.FirstErrorAt(model, run, mode)!.Value;
        reader.PickModeById("mail-timeout");
        Click(Named(reader, "Seen in a run"));
        Assert.False(reader.FailuresOpenNow);
        Assert.True(reader.PerfOpenNow);
        Assert.Equal(("spike", (double)at, false), reader.PerfState);
        Assert.Equal(Failures.HomeView(model, mode), reader.View);
    }

    [AvaloniaFact]
    public void A_mode_with_no_errors_in_its_run_has_no_Seen_in_a_run_button()
    {
        var (window, reader) = Open();
        OpenOn(window, reader, "ordering");
        reader.PickModeById("db-down"); // names no run
        Assert.DoesNotContain(reader.FailuresPanelNow.Buttons, b => Avalonia.Automation.AutomationProperties.GetName(b) == "Seen in a run");
        Assert.Contains(reader.FailuresPanelNow.Buttons, b => Avalonia.Automation.AutomationProperties.GetName(b) == "Show it"); // it does name a flow
    }

    [AvaloniaFact]
    public void The_copy_buttons_copy_the_analysis_as_a_table_and_as_CSV()
    {
        var (window, reader) = Open();
        OpenOn(window, reader, "ordering");
        var model = reader.Folder!.Model;
        var analysis = model.Failures["ordering"];
        Click(Named(reader, "Copy as table"));
        Assert.Equal(Failures.Table(model, analysis, "markdown"), reader.CopiedText);
        Click(Named(reader, "Copy as CSV"));
        Assert.Equal(Failures.Table(model, analysis, "csv"), reader.CopiedText);
    }

    [AvaloniaFact]
    public void While_editing_the_tab_stays_open_and_the_button_stays_enabled_and_the_arrows_leave_the_list_alone()
    {
        var (window, reader) = Open();
        Press(window, Key.M, PhysicalKey.M);
        reader.SetEditing(true);
        Assert.True(reader.FailuresOpenNow);
        var item = reader.Rail.Shown.First(i => i.Name.StartsWith("Failures"));
        Assert.True(item.Visible);
        Assert.True(item.Enabled);
        var before = reader.FailuresState.Mode;
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Assert.Equal(before, reader.FailuresState.Mode); // in edit mode the arrows are the form's, not a step through the list
        Press(window, Key.M, PhysicalKey.M);
        Assert.False(reader.FailuresOpenNow);
        Press(window, Key.M, PhysicalKey.M);
        Assert.True(reader.FailuresOpenNow);
    }

    [AvaloniaFact]
    public void A_folder_with_only_a_broken_analysis_still_has_the_tab_and_it_says_what_is_wrong()
    {
        using var temp = new TempFolder();
        File.WriteAllText(Path.Combine(temp.Path, "model.yaml"), "objects:\n  web:\n    type: app\n    name: Web\n");
        Directory.CreateDirectory(Path.Combine(temp.Path, "failures"));
        File.WriteAllText(Path.Combine(temp.Path, "failures", "broken.yaml"), "name: [oops\n");
        var (window, reader) = Open(temp.Path);
        Assert.True(reader.Rail.Shown.First(i => i.Name.StartsWith("Failures")).Visible);
        Press(window, Key.M, PhysicalKey.M);
        Assert.True(reader.FailuresOpenNow);
        var texts = reader.FailuresPanelNow.Texts;
        Assert.DoesNotContain("No failure analyses yet.", texts);
        Assert.Contains(texts, t => t.StartsWith("failures/broken.yaml"));
    }

    [AvaloniaFact]
    public void About_stays_open_while_a_row_is_picked_as_the_browsers_details_does()
    {
        var (window, reader) = Open(Plum);
        Press(window, Key.M, PhysicalKey.M);
        var about = reader.Folder!.Model.Failures["ordering"].About!;
        bool Shown() => reader.FailuresPanelNow.GetVisualDescendants().OfType<TextBlock>().First(t => t.Text == about).IsVisible;
        Assert.False(Shown());
        Click(reader.FailuresPanelNow.Buttons.First(b => b.Classes.Contains("disclosure")));
        Assert.True(Shown());
        reader.PickModeById("stripe-timeout"); // the panel is built again
        Assert.True(Shown());
        Click(reader.FailuresPanelNow.Buttons.First(b => b.Classes.Contains("disclosure")));
        reader.PickModeById("card-declined");
        Assert.False(Shown());
    }

    [AvaloniaFact]
    public void A_click_on_a_problem_of_an_analysis_opens_the_Failures_panel_at_its_mode()
    {
        var (_, reader) = Open();
        var problem = reader.Folder!.Problems.First(p => p.File == "failures/ordering.yaml" && p.Message.StartsWith("constructor: "));
        reader.JumpToProblem(problem);
        Assert.True(reader.FailuresOpenNow);
        Assert.Equal(("ordering", "constructor", null, false), reader.FailuresState);
        Assert.Equal("shop", reader.View); // the mode is on Orders DB, whose view is Shop
        var file = reader.Folder.Problems.First(p => p.File == "failures/empty.yaml");
        reader.JumpToProblem(file); // a problem of the whole file opens the analysis with no mode picked
        Assert.Equal(("empty", null, null, false), reader.FailuresState);
    }

    [AvaloniaFact]
    public void A_problem_of_an_analysis_while_editing_opens_the_panel_where_it_can_be_fixed()
    {
        var (_, reader) = Open();
        reader.SetEditing(true);
        reader.JumpToProblem(reader.Folder!.Problems.First(p => p.File == "failures/ordering.yaml"));
        Assert.True(reader.FailuresOpenNow);
    }

    /// <summary>The small shop of the delete case (one analysis, five modes, flows that name them), copied so a test may write to it.</summary>
    private static (TempFolder Temp, string Dir, Window Window, ReaderView Reader) OpenEditable(bool empty = false)
    {
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(dir);
        var source = Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "delete", "flowy");
        foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            if (empty && file.Contains("failures")) continue;
            var target = Path.Combine(dir, Path.GetRelativePath(source, file));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.WriteAllText(target, File.ReadAllText(file));
        }
        var reader = new ReaderView();
        var window = new Window { Width = 1280, Height = 900, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        Dispatcher.UIThread.RunJobs();
        reader.SetEditing(true);
        Press(window, Key.M, PhysicalKey.M);
        Dispatcher.UIThread.RunJobs();
        return (temp, dir, window, reader);
    }

    private static async Task WaitFor(Func<bool> done)
    {
        for (var i = 0; i < 200 && !done(); i++)
        {
            Dispatcher.UIThread.RunJobs();
            await Task.Delay(10);
        }
        Assert.True(done());
    }

    private static string Analysis(string dir) => File.ReadAllText(Path.Combine(dir, "failures", "ordering.yaml"));

    [AvaloniaFact]
    public async Task A_rating_picked_in_the_mode_form_is_saved_and_the_risk_follows()
    {
        var (temp, dir, _, reader) = OpenEditable();
        using var _t = temp;
        reader.PickModeById("db-down");
        var form = reader.FailuresPanelNow.ModeFormNow!;
        Assert.True(await form.Press("severity", "7"));
        await WaitFor(() => Analysis(dir).Contains("severity: 7"));
        Assert.Equal("7", form.Ratings["severity"].View.Chosen);
        Assert.Contains(reader.FailuresPanelNow.Texts, t => t == "42"); // 7 x 2 x 3: the risk the form says is the one the list ranks by
    }

    [AvaloniaFact]
    public async Task A_text_field_of_the_mode_is_saved_when_it_is_left_and_a_refused_one_puts_the_old_words_back()
    {
        var (temp, dir, _, reader) = OpenEditable();
        using var _t = temp;
        reader.PickModeById("db-down");
        var form = reader.FailuresPanelNow.ModeFormNow!;
        form.ModeField.Text = "The database burns";
        await form.ModeField.Commit();
        await WaitFor(() => Analysis(dir).Contains("mode: The database burns"));
        form.ModeField.Text = "";
        await form.ModeField.Commit(); // a mode with no words is refused by the checker
        Assert.Equal("The database burns", form.ModeField.Text);
        Assert.Contains("mode: The database burns", Analysis(dir));
    }

    [AvaloniaFact]
    public async Task Add_failure_mode_starts_on_the_shape_picked_on_the_canvas_makes_the_mode_and_picks_it()
    {
        var (temp, dir, window, reader) = OpenEditable();
        using var _t = temp;
        reader.GoTo(Views.ParentOf(reader.Folder!.Model, "cache"));
        reader.OpenObject("cache");
        Dispatcher.UIThread.RunJobs();
        Click(Named(reader, "Add failure mode"));
        var form = reader.FailuresPanelNow.AddFormNow!;
        Assert.Equal("cache", form.ShapeChooser.View.Chosen);
        form.Sentence.Text = "The cache is cold";
        Click(reader.FailuresPanelNow.Buttons.First(b => b.Classes.Contains("primary") && Avalonia.Automation.AutomationProperties.GetName(b) == "Add"));
        await WaitFor(() => reader.FailuresState.Mode == "the-cache-is-cold");
        Assert.Contains("the-cache-is-cold:", Analysis(dir));
        Assert.Contains("on: cache", Analysis(dir));
        Assert.Null(reader.FailuresPanelNow.AddFormNow); // the form is gone once the mode exists
        Assert.NotNull(reader.FailuresPanelNow.ModeFormNow);
    }

    [AvaloniaFact]
    public async Task A_mode_can_be_deleted_from_its_form()
    {
        var (temp, dir, _, reader) = OpenEditable();
        using var _t = temp;
        reader.PickModeById("cache-cold");
        Click(Named(reader, "Delete mode"));
        await WaitFor(() => !Analysis(dir).Contains("cache-cold:"));
        Assert.Null(reader.FailuresState.Mode);
    }

    [AvaloniaFact]
    public async Task Another_analysis_is_made_from_a_name_and_shown()
    {
        var (temp, dir, _, reader) = OpenEditable();
        using var _t = temp;
        Click(Named(reader, "New analysis")); // the fold's heading
        var form = reader.FailuresPanelNow.NewFormNow!;
        form.Box.Text = "Payments";
        Click(reader.FailuresPanelNow.Buttons.First(b => b.Classes.Contains("primary") && Avalonia.Automation.AutomationProperties.GetName(b) == "New analysis"));
        await WaitFor(() => reader.FailuresState.Analysis == "payments");
        Assert.True(File.Exists(Path.Combine(dir, "failures", "payments.yaml")));
        Assert.Contains("name: Payments", File.ReadAllText(Path.Combine(dir, "failures", "payments.yaml")));
    }

    [AvaloniaFact]
    public async Task With_no_analysis_the_panel_offers_the_name_and_without_edit_mode_a_Create_button_turns_it_on()
    {
        var (temp, dir, window, reader) = OpenEditable(empty: true);
        using var _t = temp;
        Assert.NotNull(reader.FailuresPanelNow.NewFormNow);
        reader.SetEditing(false);
        Dispatcher.UIThread.RunJobs();
        Assert.Null(reader.FailuresPanelNow.Buttons.FirstOrDefault(b => Avalonia.Automation.AutomationProperties.GetName(b) == "New analysis"));
        Click(Named(reader, "Create"));
        Assert.True(reader.Editing);
        Assert.NotNull(reader.FailuresPanelNow.NewFormNow);
        await Task.CompletedTask;
    }

    [AvaloniaFact]
    public void The_marks_follow_the_view_and_the_analysis_and_go_when_the_panel_closes()
    {
        var (window, reader) = Open();
        OpenOn(window, reader, "ordering");
        Assert.Equal(new FailureMark(RiskBand.High, 6), reader.Canvas.FailureOnBox("shop").Mark);
        reader.GoTo("shop");
        Assert.Equal(new FailureMark(RiskBand.High, 2), reader.Canvas.FailureOnBox("db").Mark);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Null(reader.Canvas.FailuresShown);
        Assert.Equal((null, FailLight.None), reader.Canvas.FailureOnBox("db"));
    }

    [AvaloniaFact]
    public void Plum_opens_on_its_analysis_with_the_plain_name_and_a_mode_for_every_part_it_names()
    {
        var (window, reader) = Open(Plum);
        Press(window, Key.M, PhysicalKey.M);
        var model = reader.Folder!.Model;
        Assert.Contains("Plum fail scenario", reader.FailuresPanelNow.Texts);
        Assert.Null(reader.FailuresPanelNow.Picker); // one analysis: its name stands as the heading
        Assert.Equal(FailuresView.ModeCount(model), reader.FailuresPanelNow.Rows.Count);
    }

    [AvaloniaFact]
    public void The_shortcut_card_lists_M_and_the_keys_of_the_panel()
    {
        var (_, reader) = Open();
        reader.ShowShortcuts();
        Dispatcher.UIThread.RunJobs();
        var texts = reader.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text ?? "").ToList();
        Assert.Contains("Show how things fail, worst first", texts);
        Assert.Contains("Next and previous failure", texts);
    }
}
