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

/// <summary>Two flows side by side in the app: the panes, the focus, the keys, the picker, and what closes the comparison. Runs on a copy of Plum, the demo model.</summary>
public class CompareTests
{
    private static string Plum => Path.Combine(Repo.Root, "docs", "demo", "flowy");

    /// <summary>A reader on a copy of Plum, with <paramref name="change"/> applied to the copy's files first (a path under flowy/ and a new text for it).</summary>
    private static (TempFolder Temp, Window Window, ReaderView Reader) Open(Func<string, string, string>? change = null, double width = 1200)
    {
        TestApp.NoMotion();
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        foreach (var file in Directory.GetFiles(Plum, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(Plum, file).Replace('\\', '/');
            var target = Path.Combine(dir, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.WriteAllText(target, change?.Invoke(rel, File.ReadAllText(file)) ?? File.ReadAllText(file));
        }
        var reader = new ReaderView();
        var window = new Window { Width = width, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        EditModeTests.Settle(window);
        return (temp, window, reader);
    }

    /// <summary>The refund that is not recorded holds a compare tag naming the refund that is.</summary>
    private static string Linked(string rel, string text) => rel == "flows/refund-not-recorded.yaml" ? "compare: refund\n" + text : text;

    private static void Press(Window w, Key key, PhysicalKey physical) => EditModeTests.Press(w, key, physical);

    private static void Click(Window window, Point at)
    {
        window.MouseDown(at, MouseButton.Left);
        window.MouseUp(at, MouseButton.Left);
        Dispatcher.UIThread.RunJobs();
    }

    [AvaloniaFact]
    public void Two_flows_on_different_views_open_in_two_panes_titled_with_their_own_names()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        Assert.Equal(["Support refunds an order", "The refund is not recorded"], view.Panes.Select(p => p.TitleText).ToArray());
        Assert.NotEqual(reader.Folder!.Model.Flows["refund"].View, reader.Folder.Model.Flows["refund-not-recorded"].View);
        Assert.All(view.Panes, p => Assert.True(p.Canvas.Scene!.Boxes.Count > 0));
        Assert.True(view.Panes[0].Focused);
        Assert.False(view.Panes[1].Focused);
        Assert.Null(reader.PlayingFlowId); // the single flow player is off while comparing
        Assert.False(reader.Card.IsVisible);
        Assert.True(view.Bar.SwapButton.IsEnabled);
        Assert.Equal("One canvas that flips between the flows", ToolTip.GetTip(view.Bar.SwapButton));
        Assert.False(view.Bar.FlowsShown); // the flows' names are Swap's
        Assert.All(view.Panes, p => Assert.False(p.Card.CompareButton is not null)); // a pane's card has no Compare button
    }

    [AvaloniaFact]
    public void Stepping_one_pane_leaves_the_other_where_it_was()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var (left, right) = (reader.CompareShown!.Panes[0], reader.CompareShown.Panes[1]);
        left.Step(1);
        left.Step(1);
        Assert.Equal((2, 0), (left.StopNow, right.StopNow));
        Press(window, Key.Right, PhysicalKey.ArrowRight); // the first pane has the focus
        Assert.Equal((3, 0), (left.StopNow, right.StopNow));
        reader.CompareShown.FocusPane(right.Key);
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Press(window, Key.End, PhysicalKey.End);
        Assert.Equal((3, right.StopCount - 1), (left.StopNow, right.StopNow));
        Press(window, Key.Home, PhysicalKey.Home);
        Assert.Equal((3, 0), (left.StopNow, right.StopNow));
    }

    [AvaloniaFact]
    public void Clicking_a_pane_focuses_it_and_a_box_shows_in_the_shared_details_without_covering_a_pane()
    {
        var (temp, window, reader) = Open(width: 1800);
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        var right = view.Panes[1];
        Click(window, EditModeTests.Where(window, right.Canvas, "stripe", 20, 10));
        EditModeTests.Settle(window);
        Assert.True(right.Focused);
        Assert.False(view.Panes[0].Focused);
        Assert.Equal("stripe", reader.SelectedBoxId);
        Assert.True(reader.HasPanel);
        Assert.NotNull(reader.CompareShown); // a pick leaves the comparison open
        var panelLeft = reader.PanelWidthsOnScreen.Details;
        Assert.True(panelLeft > 0);
        Assert.True(view.Bounds.Width + panelLeft <= reader.Bounds.Width, "the panes stop where the details panel starts");
        // A second click on the shape the panel shows closes the panel, as on the single canvas.
        EditModeTests.Settle(window);
        var again = EditModeTests.Where(window, right.Canvas, "stripe", 20, 10);
        Click(window, again);
        Assert.False(reader.HasPanel);
    }

    [AvaloniaFact]
    public void A_line_clicked_in_a_pane_carries_the_view_that_pane_draws()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var model = reader.Folder!.Model;
        var right = reader.CompareShown!.Panes[1];
        var edge = right.Canvas.Scene!.Edges.First();
        var view = model.Flows["refund-not-recorded"].View!;
        reader.ComparePicked(right.Key, new ReaderView.Side.Line(edge.From, edge.To, view));
        EditModeTests.Settle(window);
        Assert.True(reader.HasPanel);
        Assert.NotNull(reader.CompareShown);
        Assert.True(right.Focused);
        // The same line picked again from the same pane closes the panel; the shapes it joins are read in the pane's view, not the one the reader is in.
        reader.ComparePicked(right.Key, new ReaderView.Side.Line(edge.From, edge.To, view));
        Assert.False(reader.HasPanel);
        Assert.NotEqual(view, reader.View);
    }

    [AvaloniaFact]
    public void The_two_panes_stack_in_a_narrow_window_and_keep_their_zoom_when_it_resizes()
    {
        var (temp, window, reader) = Open(width: 760);
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        Assert.True(view.Stacked);
        Assert.True(view.Panes[1].Bounds.Y > view.Panes[0].Bounds.Y);
        view.Panes[0].Canvas.ZoomBy(2);
        EditModeTests.Settle(window);
        var zoom = view.Panes[0].Canvas.Viewport.Zoom;
        window.Width = 1300;
        EditModeTests.Settle(window);
        Assert.False(view.Stacked);
        Assert.Equal(view.Panes[0].Bounds.Y, view.Panes[1].Bounds.Y);
        Assert.Equal(zoom, view.Panes[0].Canvas.Viewport.Zoom, 3); // a resize does not fit it again
    }

    [AvaloniaFact]
    public void C_with_a_flow_playing_and_no_linked_flow_opens_the_picker_and_picking_opens_the_comparison_at_the_stop()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.GoTo("root");
        reader.Play("refund", 2);
        EditModeTests.Settle(window);
        Assert.NotNull(reader.Card.CompareButton);
        Assert.True(reader.Card.CompareButton!.IsEnabled);
        Press(window, Key.C, PhysicalKey.C);
        Assert.NotNull(reader.PickerShown);
        Assert.Null(reader.CompareNow);
        Assert.DoesNotContain(reader.PickerShown!.Rows, c => c.Id == "refund"); // never itself
        Assert.Equal("refund-not-recorded", reader.PickerShown.Rows.First(c => c.Id == "refund-not-recorded").Id);
        Press(window, Key.Escape, PhysicalKey.Escape); // the flyout is the innermost layer
        Assert.Null(reader.PickerShown);
        Assert.Equal("refund", reader.PlayingFlowId);
        Press(window, Key.C, PhysicalKey.C);
        Assert.NotNull(reader.PickerShown);
        reader.OpenCompareById("refund", "refund-not-recorded"); // what a pick in the flyout does
        EditModeTests.Settle(window);
        Assert.Null(reader.PickerShown);
        var view = reader.CompareShown!;
        Assert.Equal("refund", view.Panes[0].FlowId);
        Assert.Equal(2, view.Panes[0].StopNow); // the flow that was playing starts at its stop
        Assert.Equal(0, view.Panes[1].StopNow);
        Assert.False(view.Panes[0].Playback.Auto);
    }

    [AvaloniaFact]
    public void C_with_a_linked_flow_opens_the_comparison_directly_and_reads_the_tag_holder_second()
    {
        var (temp, window, reader) = Open(Linked);
        using var _ = temp;
        reader.GoTo(reader.Folder!.Model.Flows["refund-not-recorded"].View!);
        reader.Play("refund-not-recorded", 1);
        EditModeTests.Settle(window);
        Press(window, Key.C, PhysicalKey.C);
        EditModeTests.Settle(window);
        Assert.Null(reader.PickerShown);
        Assert.Equal(new CompareState("flow", "refund", "refund-not-recorded", "side"), reader.CompareNow);
        Assert.Equal(1, reader.CompareShown!.Panes[1].StopNow);
        Press(window, Key.C, PhysicalKey.C); // C again closes it
        Assert.Null(reader.CompareNow);
        Assert.Equal("refund-not-recorded", reader.PlayingFlowId); // and the flow that was playing is back
    }

    [AvaloniaFact]
    public void Swapping_the_sides_moves_the_panes_and_keeps_each_ones_place()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        var (first, second) = (view.Panes[0], view.Panes[1]);
        first.Step(1);
        view.Bar.FlipButton.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
        EditModeTests.Settle(window);
        Assert.Same(second, reader.CompareShown!.Panes[0]);
        Assert.Same(first, reader.CompareShown.Panes[1]);
        Assert.Equal(1, first.StopNow);
        Assert.True(first.Bounds.X > second.Bounds.X);
    }

    [AvaloniaFact]
    public void Esc_closes_a_panel_first_and_then_the_comparison()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        reader.OpenObject("stripe"); // shown from a list: the comparison stays open
        Assert.True(reader.HasPanel);
        Assert.NotNull(reader.CompareShown);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.False(reader.HasPanel);
        Assert.NotNull(reader.CompareShown);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Null(reader.CompareShown);
        Assert.Equal("root", reader.View); // it closed the comparison, not a level
    }

    [AvaloniaFact]
    public void F_fits_the_focused_pane_only()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        view.Panes[0].Canvas.ZoomBy(2);
        view.Panes[1].Canvas.ZoomBy(2);
        EditModeTests.Settle(window);
        var (a, b) = (view.Panes[0].Canvas.Viewport.Zoom, view.Panes[1].Canvas.Viewport.Zoom);
        view.FocusPane(view.Panes[1].Key);
        Press(window, Key.F, PhysicalKey.F);
        EditModeTests.Settle(window);
        Assert.Equal(a, view.Panes[0].Canvas.Viewport.Zoom, 3);
        Assert.NotEqual(b, view.Panes[1].Canvas.Viewport.Zoom);
    }

    [AvaloniaFact]
    public void Edit_mode_blocks_a_comparison_and_ends_one()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.OpenCompareById("refund", "refund-not-recorded");
        Assert.Null(reader.CompareNow);
        Press(window, Key.C, PhysicalKey.C);
        Assert.Equal("Not while editing", reader.NoticeText); // the key is taken, to say why
        reader.SetEditing(false);
        reader.OpenCompareById("refund", "refund-not-recorded");
        Assert.NotNull(reader.CompareShown);
        reader.SetEditing(true);
        Assert.Null(reader.CompareNow);
        Assert.Null(reader.CompareShown);
    }

    [AvaloniaFact]
    public void A_flow_that_cannot_play_does_not_open_and_says_so()
    {
        var (temp, window, reader) = Open((rel, text) => rel == "flows/refund-not-recorded.yaml" ? "name: Nothing yet\nview: root\nsteps: []\n" : text);
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        Assert.Null(reader.CompareNow);
        Assert.Equal("That flow can't play yet.", reader.NoticeText);
    }

    [AvaloniaFact]
    public void Going_to_a_level_by_the_breadcrumb_closes_it_and_a_list_pick_does_not()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        // A row of the Explorer: the Details show the shape, and the comparison stays open (it would go to the shape's own view otherwise).
        reader.PickRow(new OutlineRow("stripe", "shape", "stripe", Names.Root, 1, "Stripe", "system", true, 0, 0, null, false, false, false, false));
        Assert.NotNull(reader.CompareShown);
        Assert.Equal("root", reader.View);
        Assert.Equal("stripe", reader.SelectedBoxId);
        reader.GoTo("ordering");
        Assert.Null(reader.CompareNow);
        Assert.Null(reader.SelectedBoxId);
    }

    [AvaloniaFact]
    public void The_greyed_controls_say_why()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.Play("refund", 0);
        EditModeTests.Settle(window);
        Assert.Equal("Compare with another flow (C)", ToolTip.GetTip(reader.Card.CompareButton!));
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var card = reader.CompareShown!.Panes[0].Card;
        var stop = FindButton(card, "Stop");
        Assert.False(stop.IsEnabled);
        Assert.Equal("Close the comparison to stop", ToolTip.GetTip(stop));
    }

    // ---- Swap ---------------------------------------------------------------------------------------------------

    private static void ClickBar(Button button) => button.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));

    private static bool On(Button name) => name.Classes.Contains("pressed");

    private static string[] FlowNames(CompareBar bar) => [.. bar.FlowButtons.Select(b => ((TextBlock)b.Content!).Text ?? "")];

    /// <summary>Lets frames and timers run until <paramref name="done"/>, or a few seconds pass. A headless window draws no frames of its own.</summary>
    private static void Run(Func<bool> done, double seconds = 10)
    {
        var clock = System.Diagnostics.Stopwatch.StartNew();
        while (clock.Elapsed < TimeSpan.FromSeconds(seconds) && !done())
        {
            AvaloniaHeadlessPlatform.ForceRenderTimerTick();
            Dispatcher.UIThread.RunJobs();
            Thread.Sleep(5);
        }
    }

    /// <summary>The boxes of the canvas where they sit, and how much of each shows, for a comparison of what is drawn with what the flow on show says it should be.</summary>
    private static void AssertDrawn(SwapStage stage)
    {
        var scene = stage.Current.Frame()!.Scene;
        Assert.Equal(scene.Boxes.Select(b => b.Id).Order(), stage.Canvas.Scene!.Boxes.Select(b => b.Id).Order());
        Assert.Equal(scene.Boxes.Select(b => b.Id).Order(), stage.Canvas.BoxPresence.Keys.Order()); // no box of the other flow is left on the stage
        Assert.All(stage.Canvas.BoxPresence.Values, p => Assert.Equal(1, p));
        Assert.Equal(1, stage.LinesNow);
        Assert.False(stage.Swapping);
        foreach (var box in scene.Boxes)
        {
            Assert.Equal(box.Rect, stage.Canvas.RectOf(box.Id)!.Value);
            var control = stage.Canvas.BoxControlFor(box.Id)!;
            Assert.Equal((box.Rect.X, box.Rect.Y), (Avalonia.Controls.Canvas.GetLeft(control), Avalonia.Controls.Canvas.GetTop(control))); // each is where the scene has it
        }
        Assert.NotNull(stage.CardShown);
    }

    [AvaloniaFact]
    public void Swap_opens_one_canvas_on_the_flow_whose_pane_has_the_focus_and_keeps_each_ones_step()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        view.Panes[0].Step(1);
        view.Panes[1].Step(1);
        view.Panes[1].Step(1);
        view.FocusPane(view.Panes[1].Key);
        Assert.Null(view.Stage);
        ClickBar(view.Bar.SwapButton);
        EditModeTests.Settle(window);
        Assert.Equal(new CompareState("flow", "refund", "refund-not-recorded", "swap"), reader.CompareNow);
        var stage = reader.CompareShown!.Stage!;
        Assert.Equal("refund-not-recorded", stage.OnKey); // the pane with the focus
        Assert.Equal("The refund is not recorded", stage.TitleText);
        Assert.Equal((1, 2), (stage.Flow("refund").StopNow, stage.Flow("refund-not-recorded").StopNow)); // each is where its pane was
        Assert.True(view.Bar.FlowsShown);
        Assert.Equal(["Support refunds an order", "The refund is not recorded"], FlowNames(view.Bar));
        Assert.False(On(view.Bar.FlowButtons[0]));
        Assert.True(On(view.Bar.FlowButtons[1]));
        Assert.Equal("The refund is not recorded, on show", Avalonia.Automation.AutomationProperties.GetName(view.Bar.FlowButtons[1]));
        Assert.True(On(view.Bar.SwapButton));
        AssertDrawn(stage);
        // Back to Side by side: each flow is where it was left, and the flow on show has the focus.
        stage.Flow("refund").Step(1);
        ClickBar(view.Bar.SideButton);
        EditModeTests.Settle(window);
        Assert.Equal("side", reader.CompareNow!.Mode);
        Assert.Null(reader.CompareShown!.Stage);
        Assert.Equal((2, 2), (view.Panes[0].StopNow, view.Panes[1].StopNow));
        Assert.True(view.Panes[1].Focused);
        Assert.True(view.Panes[0].Canvas.Scene!.Boxes.Count > 0);
    }

    [AvaloniaFact]
    public void X_swaps_in_Swap_and_does_nothing_in_Side_by_side()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        Press(window, Key.X, PhysicalKey.X);
        EditModeTests.Settle(window);
        Assert.Equal(new CompareState("flow", "refund", "refund-not-recorded", "side"), reader.CompareNow);
        Assert.Null(view.Stage);
        Assert.Equal((0, 0), (view.Panes[0].StopNow, view.Panes[1].StopNow));

        ClickBar(view.Bar.SwapButton);
        EditModeTests.Settle(window);
        var stage = reader.CompareShown!.Stage!;
        Assert.Equal("refund", stage.OnKey);
        Assert.Equal("Support refunds an order", stage.TitleText);
        Assert.True(On(view.Bar.FlowButtons[0]));
        Press(window, Key.X, PhysicalKey.X);
        EditModeTests.Settle(window);
        Assert.Equal("refund-not-recorded", stage.OnKey);
        Assert.Equal("The refund is not recorded", stage.TitleText);
        Assert.False(On(view.Bar.FlowButtons[0]));
        Assert.True(On(view.Bar.FlowButtons[1]));
        Assert.Equal("Swap to Support refunds an order (X)", ToolTip.GetTip(view.Bar.FlowButtons[0]));
        Assert.Equal("The refund is not recorded is on show", ToolTip.GetTip(view.Bar.FlowButtons[1]));
        AssertDrawn(stage);
        Press(window, Key.X, PhysicalKey.X);
        Assert.Equal("refund", stage.OnKey);
        AssertDrawn(stage);
        // The name of the flow that is not on show swaps to it; the one on show does nothing.
        ClickBar(view.Bar.FlowButtons[1]);
        EditModeTests.Settle(window);
        Assert.Equal("refund-not-recorded", stage.OnKey);
        ClickBar(view.Bar.FlowButtons[1]);
        Assert.Equal("refund-not-recorded", stage.OnKey);
        EditModeTests.Press(window, Key.X, PhysicalKey.X, RawInputModifiers.Control); // only a plain X
        Assert.Equal("refund-not-recorded", stage.OnKey);
    }

    [AvaloniaFact]
    public void Each_flow_keeps_its_step_across_swaps_and_across_Swap_sides_and_the_keys_act_on_the_one_on_show()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded", swap: true);
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        var stage = view.Stage!;
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Assert.Equal((2, 0), (stage.Flow("refund").StopNow, stage.Flow("refund-not-recorded").StopNow));
        Press(window, Key.X, PhysicalKey.X);
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Press(window, Key.End, PhysicalKey.End);
        var last = stage.Flow("refund-not-recorded").StopCount - 1;
        Assert.Equal((2, last), (stage.Flow("refund").StopNow, stage.Flow("refund-not-recorded").StopNow));
        Press(window, Key.X, PhysicalKey.X);
        Assert.Equal((2, last), (stage.Flow("refund").StopNow, stage.Flow("refund-not-recorded").StopNow));
        Assert.Equal(2, stage.Current.StopNow);
        Press(window, Key.Home, PhysicalKey.Home);
        Assert.Equal((0, last), (stage.Flow("refund").StopNow, stage.Flow("refund-not-recorded").StopNow));
        Press(window, Key.Right, PhysicalKey.ArrowRight);

        // Swap sides puts the flows on each other's side, but the same two flows stay on the stage, each with its place, and the same one is on show.
        ClickBar(view.Bar.FlipButton);
        EditModeTests.Settle(window);
        Assert.Equal(new CompareState("flow", "refund-not-recorded", "refund", "swap"), reader.CompareNow);
        Assert.Same(stage, reader.CompareShown!.Stage);
        Assert.Equal("refund", stage.OnKey);
        Assert.Equal((1, last), (stage.Flow("refund").StopNow, stage.Flow("refund-not-recorded").StopNow));
        Assert.Equal(["The refund is not recorded", "Support refunds an order"], FlowNames(view.Bar));
        Assert.True(On(view.Bar.FlowButtons[1]));
        Press(window, Key.F, PhysicalKey.F); // F fits the canvas, it does not throw or swap
        Assert.Equal("refund", stage.OnKey);
    }

    [AvaloniaFact]
    public void The_flow_that_goes_off_show_stops_its_Autoplay()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded", swap: true);
        EditModeTests.Settle(window);
        var stage = reader.CompareShown!.Stage!;
        Press(window, Key.P, PhysicalKey.P);
        Assert.True(stage.Flow("refund").Playback.Auto);
        Press(window, Key.X, PhysicalKey.X);
        Assert.False(stage.Flow("refund").Playback.Auto);
        Assert.False(stage.Flow("refund-not-recorded").Playback.Auto);
    }

    [AvaloniaFact]
    public void Reduced_motion_cuts_the_swap_at_once()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded", swap: true);
        EditModeTests.Settle(window);
        var stage = reader.CompareShown!.Stage!;
        Assert.True(Flowy.App.Canvas.MotionSettings.Reduced);
        var first = stage.Canvas.Scene!.Boxes.Select(b => b.Id).ToList();
        stage.Swap();
        Assert.False(stage.Swapping); // no time passes
        Assert.NotEqual(first.Order(), stage.Canvas.Scene!.Boxes.Select(b => b.Id).Order());
        AssertDrawn(stage);
    }

    [AvaloniaFact]
    public void A_swap_glides_the_shapes_both_flows_draw_and_fades_the_rest_and_ends_whole()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded", swap: true);
        EditModeTests.Settle(window);
        var stage = reader.CompareShown!.Stage!;
        var (a, b) = (stage.Flow("refund").Frame()!.Scene, stage.Flow("refund-not-recorded").Frame()!.Scene);
        var shared = a.Boxes.Select(x => x.Id).Intersect(b.Boxes.Select(x => x.Id)).ToList();
        var onlyA = a.Boxes.Select(x => x.Id).Except(b.Boxes.Select(x => x.Id)).ToList();
        Assert.NotEmpty(shared);
        Assert.NotEmpty(onlyA); // the two flows are different views: some shapes leave
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0");
        try
        {
            stage.Swap();
            Assert.True(stage.Swapping);
            Assert.Null(stage.CardShown); // the card is the flow's once it is on
            // First the lines fade out; then the boxes of both diagrams are on the stage, the old ones fading and no lines drawn.
            Run(() => stage.Canvas.Scene!.Edges.Count == 0 || !stage.Swapping);
            Assert.True(stage.Swapping);
            Assert.Equal(0, stage.LinesNow);
            Assert.All(onlyA, id => Assert.Contains(id, stage.Canvas.BoxPresence.Keys));
            Run(() => stage.Canvas.BoxPresence.Values.Any(p => p is > 0 and < 1) || !stage.Swapping);
            Assert.True(stage.Swapping);
            Run(() => !stage.Swapping);
            AssertDrawn(stage);
            Assert.Equal("refund-not-recorded", stage.OnKey);
            Assert.DoesNotContain(onlyA, id => stage.Canvas.BoxPresence.ContainsKey(id));
        }
        finally
        {
            Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        }
    }

    [AvaloniaTheory]
    [InlineData(2, "refund")]
    [InlineData(3, "refund-not-recorded")]
    [InlineData(4, "refund")]
    public void A_swap_pressed_again_while_it_runs_goes_back_from_where_it_is_and_leaves_nothing_half_faded(int presses, string endsOn)
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded", swap: true);
        EditModeTests.Settle(window);
        var stage = reader.CompareShown!.Stage!;
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0");
        // The animation clock is moved by hand: on the wall clock a slow frame could end a swap before the test asked whether it was still under way.
        var now = 0.0;
        // Every read moves it on a little: the headless window only asks for another frame when the last one changed what is drawn, so a frame that sees the same
        // time as the one before it (the key press runs a few of its own) would end the chain of frames and the swap would never get anywhere.
        Flowy.App.Canvas.Anim.TestClock = () => now += 0.5;
        void Pass(double ms)
        {
            for (var left = ms; left > 0; left -= 10)
            {
                now += Math.Min(10, left);
                AvaloniaHeadlessPlatform.ForceRenderTimerTick();
                Dispatcher.UIThread.RunJobs();
            }
        }
        try
        {
            // The second press comes while the lines are still fading out; each later one comes a little further into the glide.
            for (var i = 0; i < presses; i++)
            {
                Press(window, Key.X, PhysicalKey.X);
                Pass(120 * (i + 1));
                Assert.True(stage.Swapping);
            }
            Pass(SwapPlans.SwapMs + 2 * SwapPlans.FadeMs); // longer than any swap takes
            Assert.False(stage.Swapping);
            Assert.Equal(endsOn, stage.OnKey);
            AssertDrawn(stage);
            Assert.True(On(reader.CompareShown!.Bar.FlowButtons[endsOn == "refund" ? 0 : 1]));
        }
        finally
        {
            Flowy.App.Canvas.Anim.TestClock = null;
            Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        }
    }

    [AvaloniaFact]
    public void A_key_during_a_swap_lets_it_finish_first()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded", swap: true);
        EditModeTests.Settle(window);
        var stage = reader.CompareShown!.Stage!;
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0");
        try
        {
            Press(window, Key.X, PhysicalKey.X);
            Assert.True(stage.Swapping);
            Press(window, Key.Right, PhysicalKey.ArrowRight);
            Assert.False(stage.Swapping);
            Assert.Equal(1, stage.Current.StopNow); // the step was taken on the flow that came on
            Assert.Equal(0, stage.Flow("refund").StopNow);
            AssertDrawn(stage);
        }
        finally
        {
            Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        }
    }

    [AvaloniaFact]
    public void The_Details_panel_stays_open_across_a_swap_for_a_shape_in_both_flows_and_closes_for_one_that_is_in_only_one()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded", swap: true);
        EditModeTests.Settle(window);
        var stage = reader.CompareShown!.Stage!;
        var (a, b) = (stage.Flow("refund").Frame()!.Scene, stage.Flow("refund-not-recorded").Frame()!.Scene);
        var shared = a.Boxes.Select(x => x.Id).Intersect(b.Boxes.Select(x => x.Id)).First();
        var onlyA = a.Boxes.Select(x => x.Id).Except(b.Boxes.Select(x => x.Id)).First();
        reader.ComparePicked(CompareView.SwapPick, new ReaderView.Side.Box(shared));
        EditModeTests.Settle(window);
        Assert.Equal(shared, reader.SelectedBoxId);
        Press(window, Key.X, PhysicalKey.X);
        EditModeTests.Settle(window);
        Assert.True(reader.HasPanel);
        Assert.Equal(shared, reader.SelectedBoxId);
        Press(window, Key.X, PhysicalKey.X);
        reader.ComparePicked(CompareView.SwapPick, new ReaderView.Side.Box(onlyA));
        EditModeTests.Settle(window);
        Assert.Equal(onlyA, reader.SelectedBoxId);
        Press(window, Key.X, PhysicalKey.X);
        EditModeTests.Settle(window);
        Assert.False(reader.HasPanel);
        Assert.Null(reader.SelectedBoxId);
        // A second click on what the panel shows closes it, whichever flow is on show.
        reader.ComparePicked(CompareView.SwapPick, new ReaderView.Side.Box(shared));
        Assert.True(reader.HasPanel);
        reader.ComparePicked(CompareView.SwapPick, new ReaderView.Side.Box(shared));
        Assert.False(reader.HasPanel);
    }

    [AvaloniaFact]
    public void A_flow_compared_with_itself_swaps_between_its_two_copies()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund", swap: true);
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        var stage = view.Stage!;
        Assert.Equal(["refund", "refund#1"], stage.Keys.ToArray());
        Assert.Equal(["Support refunds an order", "Support refunds an order (2)"], FlowNames(view.Bar));
        stage.Current.Step(1);
        Press(window, Key.X, PhysicalKey.X);
        Assert.Equal("refund#1", stage.OnKey);
        Assert.Equal((1, 0), (stage.Flow("refund").StopNow, stage.Flow("refund#1").StopNow));
        AssertDrawn(stage);
    }

    [AvaloniaFact]
    public void Opening_swapped_starts_on_the_second_flow()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded", swap: true, swapped: true);
        EditModeTests.Settle(window);
        Assert.Equal("refund-not-recorded", reader.CompareShown!.Stage!.OnKey);
        AssertDrawn(reader.CompareShown.Stage!);
    }

    [AvaloniaFact]
    public void Starting_to_edit_ends_a_comparison_in_Swap_too()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded", swap: true);
        EditModeTests.Settle(window);
        Assert.NotNull(reader.CompareShown!.Stage);
        reader.SetEditing(true);
        Assert.Null(reader.CompareShown);
        Assert.Null(reader.CompareNow);
    }

    // ---- change marks, the key, the note and Save as pair -------------------------------------------------------

    private static string Dir(TempFolder temp) => Path.Combine(temp.Path, "flowy");

    private static Flow FlowOnDisk(TempFolder temp, string id) => FolderLoader.Load(Dir(temp)).Model.Flows[id];

    private static CompareTag? TagOnDisk(TempFolder temp, string id) => Compares.Of(FlowOnDisk(temp, id).CompareRaw);

    /// <summary>The marks a pane draws are the diff's side for its flow: every shape and line the side marks is marked in the kind it says, and no other is.</summary>
    private static void AssertMarks(Flowy.App.Canvas.CanvasView canvas, SideMarks side)
    {
        var scene = canvas.Scene!;
        foreach (var box in scene.Boxes) Assert.Equal(side.Shapes.TryGetValue(box.Id, out var kind) ? kind : null, canvas.ChangeOnBox(box.Id));
        foreach (var edge in scene.Edges) Assert.Equal(side.Lines.TryGetValue(edge.Id, out var kind) ? kind : null, canvas.ChangeOnLine(edge.From, edge.To));
    }

    private static int Marked(Flowy.App.Canvas.CanvasView canvas) =>
        canvas.Scene!.Boxes.Count(b => canvas.ChangeOnBox(b.Id) is not null) + canvas.Scene.Edges.Count(e => canvas.ChangeOnLine(e.From, e.To) is not null);

    /// <summary>Takes the keyboard out of any field and lets what was posted run, so a key pressed next is the reader's.</summary>
    private static void Away(Window window, ReaderView reader)
    {
        EditModeTests.Settle(window);
        reader.Focus();
    }

    [AvaloniaFact]
    public void Show_changes_is_off_until_it_is_turned_on_and_is_remembered_for_the_next_window()
    {
        using var temp = new TempFolder();
        var store = new UserStateStore(Path.Combine(temp.Path, "state.json"));
        var shell = new Shell(store);
        var window = shell.Show(Plum);
        Assert.False(window.Reader.ShowChanges);
        Assert.False(shell.State.ShowChanges);
        window.Reader.OpenCompareById("refund", "refund-not-recorded");
        var bar = window.Reader.CompareShown!.Bar;
        Assert.False(On(bar.ChangesButton));
        Assert.Null(bar.KeyShown); // the key is the marks': there are none to explain
        Assert.True(bar.ChangesButton.IsEnabled);
        ClickBar(bar.ChangesButton);
        Assert.True(window.Reader.ShowChanges);
        Assert.True(On(window.Reader.CompareShown!.Bar.ChangesButton));
        Assert.True(shell.State.ShowChanges);
        window.Close();
        var next = new Shell(new UserStateStore(store.File)).Show(Plum);
        Assert.True(next.Reader.ShowChanges);
        next.Close();
    }

    [AvaloniaFact]
    public void Nothing_is_marked_with_Show_changes_off_and_each_pane_draws_its_own_side_with_it_on_also_after_Swap_sides()
    {
        var (temp, window, reader) = Open(Linked);
        using var _ = temp;
        reader.OpenCompareById("refund-not-recorded", "refund"); // the holder of the tag reads second
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        Assert.Equal(["refund", "refund-not-recorded"], view.Panes.Select(p => p.FlowId).ToArray());
        Assert.All(view.Panes, p => Assert.Equal(0, Marked(p.Canvas)));
        Assert.All(view.Panes, p => Assert.Null(p.Changes));

        reader.SetShowChanges(true);
        EditModeTests.Settle(window);
        var model = reader.Folder!.Model;
        var diff = FlowDiffs.Diff(model.Flows["refund"], model.Flows["refund-not-recorded"]);
        Assert.True(diff.Related);
        AssertMarks(view.Panes[0].Canvas, diff.Older);
        AssertMarks(view.Panes[1].Canvas, diff.Newer);
        Assert.True(Marked(view.Panes[0].Canvas) + Marked(view.Panes[1].Canvas) > 0);
        Assert.NotNull(view.Bar.KeyShown);

        // Swap sides moves the panes, and each flow keeps its marks: the tag holder is still the newer.
        ClickBar(view.Bar.FlipButton);
        EditModeTests.Settle(window);
        view = reader.CompareShown!;
        Assert.Equal(["refund-not-recorded", "refund"], view.Panes.Select(p => p.FlowId).ToArray());
        AssertMarks(view.Panes[0].Canvas, diff.Newer);
        AssertMarks(view.Panes[1].Canvas, diff.Older);

        reader.SetShowChanges(false);
        EditModeTests.Settle(window);
        Assert.All(reader.CompareShown!.Panes, p => Assert.Equal(0, Marked(p.Canvas)));
        Assert.Null(reader.CompareShown.Bar.KeyShown);
    }

    [AvaloniaFact]
    public void Without_a_tag_the_second_flow_is_the_newer_and_Swap_sides_changes_which_is()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        reader.SetShowChanges(true);
        EditModeTests.Settle(window);
        var model = reader.Folder!.Model;
        var view = reader.CompareShown!;
        Assert.Equal(("refund", "refund-not-recorded"), view.Sides);
        AssertMarks(view.Panes[1].Canvas, FlowDiffs.Diff(model.Flows["refund"], model.Flows["refund-not-recorded"]).Newer);
        ClickBar(view.Bar.FlipButton);
        EditModeTests.Settle(window);
        view = reader.CompareShown!;
        Assert.Equal(("refund-not-recorded", "refund"), view.Sides); // no tag says otherwise: the flow on the right is the newer
        AssertMarks(view.Panes[1].Canvas, FlowDiffs.Diff(model.Flows["refund-not-recorded"], model.Flows["refund"]).Newer);
    }

    [AvaloniaFact]
    public void In_Swap_the_flow_on_show_gets_its_side_s_marks_and_the_key_lists_only_its_kinds()
    {
        var (temp, window, reader) = Open(Linked);
        using var _ = temp;
        reader.SetShowChanges(true);
        reader.OpenCompareById("refund-not-recorded", "refund", swap: true);
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        var stage = view.Stage!;
        var diff = FlowDiffs.Diff(reader.Folder!.Model.Flows["refund"], reader.Folder.Model.Flows["refund-not-recorded"]);
        Assert.Equal("refund", stage.OnKey);
        AssertMarks(stage.Canvas, diff.Older);
        Assert.Equal(CompareUi.KeyItems(diff, ["older"]).Items, ((CompareKey)view.Bar.KeyShown!).Kinds);
        Press(window, Key.X, PhysicalKey.X);
        EditModeTests.Settle(window);
        Assert.Equal("refund-not-recorded", stage.OnKey);
        AssertMarks(stage.Canvas, diff.Newer); // the marks follow the flow on show
        Assert.Equal(CompareUi.KeyItems(diff, ["newer"]).Items, ((CompareKey)view.Bar.KeyShown!).Kinds);
    }

    [AvaloniaFact]
    public void The_progress_cells_of_a_marked_flow_take_the_mark_of_their_steps()
    {
        var (temp, window, reader) = Open(Linked);
        using var _ = temp;
        reader.SetShowChanges(true);
        reader.OpenCompareById("refund-not-recorded", "refund");
        EditModeTests.Settle(window);
        var model = reader.Folder!.Model;
        var diff = FlowDiffs.Diff(model.Flows["refund"], model.Flows["refund-not-recorded"]);
        var flow = model.Flows["refund-not-recorded"];
        var stops = Structure.Stops(flow);
        var expected = Captions.ProgressOf(flow, stops).Cells.Select(c => CompareUi.ChangeOfStop(stops[c.Stop].Steps, diff.Newer.Steps)).ToList();
        Assert.Contains(expected, kind => kind is not null);
        var cells = reader.CompareShown!.Panes[1].Card.GetVisualDescendants().OfType<Border>().Where(b => b.Classes.Contains("seg")).ToList();
        Assert.Equal(expected.Count, cells.Count);
        for (var i = 0; i < cells.Count; i++)
        {
            var named = cells[i].Classes.FirstOrDefault(c => c.StartsWith("chg-"));
            Assert.Equal(expected[i] is { } kind ? "chg-" + Flowy.App.Canvas.BoxControl.Word(kind) : null, named);
        }
        reader.SetShowChanges(false);
        EditModeTests.Settle(window);
        Assert.DoesNotContain(reader.CompareShown!.Panes[1].Card.GetVisualDescendants().OfType<Border>().Where(b => b.Classes.Contains("seg")), b => b.Classes.Any(c => c.StartsWith("chg-")));
    }

    [AvaloniaFact]
    public void The_key_lists_only_the_kinds_present_and_says_so_when_there_are_none_or_nothing_is_shared()
    {
        FlowDiff Diff(bool related, SideMarks older, SideMarks newer) => new(related, older, newer);
        var none = new SideMarks(new Dictionary<int, Change>(), new Dictionary<string, Change>(), new Dictionary<string, Change>());
        var added = new SideMarks(new Dictionary<int, Change> { [2] = Change.New }, new Dictionary<string, Change> { ["fee"] = Change.Changed }, new Dictionary<string, Change>());
        string[] both = ["older", "newer"];
        var key = new CompareKey(Diff(true, none, added), both);
        Assert.Equal([Change.New, Change.Changed], key.Kinds);
        Assert.Equal(["New", "Changed"], key.Words);
        Assert.Equal(2, key.GetVisualDescendants().OfType<Border>().Count(b => b.Classes.Contains("sw")));
        Assert.Empty(new CompareKey(Diff(true, none, added), ["older"]).Kinds); // the older flow alone has nothing marked
        var same = new CompareKey(Diff(true, none, none), both);
        Assert.Empty(same.Kinds);
        Assert.Equal(["No changes"], same.Words);
        var apart = new CompareKey(Diff(false, none, none), both);
        Assert.Empty(apart.Kinds);
        Assert.Equal(["Nothing in common"], apart.Words);
        Assert.DoesNotContain(apart.GetVisualDescendants().OfType<Border>(), b => b.Classes.Contains("sw")); // no swatch for words
    }

    [AvaloniaFact]
    public void A_marked_shape_is_lifted_when_dimmed_but_not_when_it_is_in_a_state()
    {
        var (temp, window, reader) = Open(Linked);
        using var _ = temp;
        reader.SetShowChanges(true);
        reader.OpenCompareById("refund-not-recorded", "refund");
        EditModeTests.Settle(window);
        var pane = reader.CompareShown!.Panes[1];
        var marked = pane.Canvas.Scene!.Boxes.First(b => pane.Canvas.ChangeOnBox(b.Id) is not null);
        var control = pane.Canvas.BoxControlFor(marked.Id)!;
        Assert.Contains("marked", control.Classes);
        Assert.Contains("chg-" + Flowy.App.Canvas.BoxControl.Word(pane.Canvas.ChangeOnBox(marked.Id)!.Value), control.Classes);
        control.Classes.Add("dim");
        Assert.Equal(0.6, control.Opacity, 3);
        control.Classes.Add("stated");
        Assert.NotEqual(0.6, control.Opacity); // a shape in a state keeps its own fading
    }

    [AvaloniaFact]
    public async Task A_note_on_a_tagged_pair_is_saved_in_the_newer_flows_file_as_one_edit_that_can_be_undone()
    {
        var (temp, window, reader) = Open(Linked);
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var note = reader.CompareShown!.Note;
        Assert.False(note.Editing);
        Assert.True(note.NoteButton!.IsEnabled);
        Assert.Null(note.PairButton); // a tagged pair is a pair already
        ClickBar(note.NoteButton);
        EditModeTests.Settle(window);
        Assert.True(note.Editing);
        Assert.False(note.SaveButton!.IsEnabled); // nothing to save yet
        note.Field.Text = "Fixed in the new flow";
        Assert.Equal("Fixed in the new flow", reader.NoteDraftNow);
        Assert.True(note.SaveButton!.IsEnabled);
        ClickBar(note.SaveButton);
        await EditModeTests.Until(() => reader.NoteDraftNow is null && reader.CompareShown!.Note.SavedView is not null); // saved: the draft is gone and the saved note is shown
        Assert.Equal(new CompareTag("refund", "Fixed in the new flow"), TagOnDisk(temp, "refund-not-recorded"));
        Assert.Null(TagOnDisk(temp, "refund")); // the line stays with the flow that holds it
        Assert.False(reader.CompareShown!.Note.Editing);
        Assert.True(reader.CanUndo);
        await reader.UndoAsync();
        await EditModeTests.Until(() => TagOnDisk(temp, "refund-not-recorded")?.Note is null);
        Assert.Equal(new CompareTag("refund"), TagOnDisk(temp, "refund-not-recorded")); // one undo takes the whole note back
    }

    [AvaloniaFact]
    public void When_the_folder_cannot_save_the_note_controls_are_greyed_with_the_reason_and_a_saved_note_still_shows()
    {
        var (temp, window, reader) = Open((rel, text) => rel == "flows/refund-not-recorded.yaml" ? "compare:\n  with: refund\n  note: Fixed in v2\n" + text : text);
        using var _ = temp;
        reader.CanEdit = false;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var note = reader.CompareShown!.Note;
        Assert.False(note.NoteButton!.IsEnabled);
        Assert.Equal("This page can't save", ToolTip.GetTip(note.NoteButton));
        Assert.NotNull(note.SavedView); // shown, not editable
        Assert.False(note.Editing);
        reader.OpenCompareById("refund", "place-order");
        EditModeTests.Settle(window);
        var untagged = reader.CompareShown!.Note;
        Assert.False(untagged.PairButton!.IsEnabled);
        Assert.Equal("This page can't save", ToolTip.GetTip(untagged.PairButton));
        Assert.False(untagged.NoteButton!.IsEnabled);
    }

    [AvaloniaFact]
    public void An_untagged_pair_keeps_a_draft_and_closing_asks_first_Keep_keeps_and_Discard_drops()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        // Nothing typed, or only blanks: nothing to lose, so Close just closes.
        ClickBar(view.Note.NoteButton!);
        view.Note.Field.Text = "  \n";
        ClickBar(view.Bar.CloseButton);
        Assert.Null(reader.CompareNow);
        Assert.Null(reader.AskShown);

        // The blank draft was kept, so the editor is back open when the pair is.
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        view = reader.CompareShown!;
        Assert.True(view.Note.Editing);
        Assert.Null(view.Note.SaveButton); // an untagged pair writes with Save as pair
        view.Note.Field.Text = "Because of the fee";
        Assert.Equal("Because of the fee", reader.NoteDraftNow);
        ClickBar(view.Bar.CloseButton);
        var ask = reader.AskShown!;
        Assert.NotNull(reader.CompareNow); // it asked instead
        Assert.Equal("Discard the note?", Avalonia.Automation.AutomationProperties.GetName(ask));
        // Esc is a Keep.
        Away(window, reader);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Null(reader.AskShown);
        Assert.NotNull(reader.CompareNow);
        Assert.Equal("Because of the fee", reader.CompareShown!.Note.Field.Text);
        // Every other way out asks too: C, a level in the breadcrumb, and edit mode.
        Away(window, reader);
        Press(window, Key.C, PhysicalKey.C);
        Assert.NotNull(reader.AskShown);
        Press(window, Key.C, PhysicalKey.C); // one more while it asks is a Keep
        Assert.Null(reader.AskShown);
        reader.GoTo("ordering");
        Assert.NotNull(reader.AskShown);
        Assert.NotNull(reader.CompareNow);
        ClickBar(reader.AskShown!.Keep);
        Assert.Null(reader.AskShown);
        reader.SetEditing(true);
        Assert.NotNull(reader.AskShown);
        Assert.False(reader.Editing);
        ClickBar(reader.AskShown!.Keep);
        Assert.Equal("Because of the fee", reader.NoteDraftNow);
        // Discard drops the note and goes on.
        ClickBar(view.Bar.CloseButton);
        ClickBar(reader.AskShown!.Discard);
        Assert.Null(reader.CompareNow);
        Assert.Null(reader.AskShown);
        Assert.False(reader.HoldsNote);
    }

    [AvaloniaFact]
    public void A_draft_is_kept_when_a_change_on_disk_closes_the_comparison_and_is_back_when_the_pair_is_compared_again()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        ClickBar(reader.CompareShown!.Note.NoteButton!);
        reader.CompareShown.Note.Field.Text = "Still to say";
        var file = Path.Combine(Dir(temp), "flows", "refund-not-recorded.yaml");
        var text = File.ReadAllText(file);
        File.WriteAllText(file, "name: Nothing yet\nview: root\nsteps: []\n");
        reader.Reload(FolderLoader.Load(Dir(temp)));
        Assert.Null(reader.CompareNow); // the flow can't play now
        Assert.Null(reader.AskShown); // and the app did not ask: it was not the reader who closed it
        Assert.True(reader.HoldsNote);
        File.WriteAllText(file, text);
        reader.Reload(FolderLoader.Load(Dir(temp)));
        reader.OpenCompareById("refund-not-recorded", "refund");
        EditModeTests.Settle(window);
        Assert.Equal("Still to say", reader.NoteDraftNow);
        Assert.True(reader.CompareShown!.Note.Editing);
        Assert.Equal("Still to say", reader.CompareShown.Note.Field.Text);
    }

    [AvaloniaFact]
    public async Task Save_as_pair_names_the_flow_that_gets_the_line_and_writes_the_tag_with_the_draft_as_its_note()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var note = reader.CompareShown!.Note;
        Assert.True(note.PairButton!.IsEnabled);
        ClickBar(note.NoteButton!);
        note.Field.Text = "  Because of the fee  ";
        ClickBar(note.PairButton);
        EditModeTests.Settle(window);
        Assert.Equal(["Tag The refund is not recorded as the newer of Support refunds an order"], note.ConfirmLines);
        ClickBar(note.CancelButton!); // the confirm's Cancel goes back to the draft
        Assert.Empty(note.ConfirmLines);
        Assert.Equal("  Because of the fee  ", reader.NoteDraftNow);
        ClickBar(note.PairButton!);
        ClickBar(note.SaveButton!);
        await EditModeTests.Until(() => reader.NoteDraftNow is null && reader.CompareShown!.Note.PairButton is null); // saved, the draft is gone and it is a pair now
        Assert.Equal(new CompareTag("refund", "Because of the fee"), TagOnDisk(temp, "refund-not-recorded")); // the note is trimmed
        Assert.Null(TagOnDisk(temp, "refund"));
    }

    [AvaloniaFact]
    public async Task Save_as_pair_never_replaces_a_link_without_saying_so_and_Swap_sides_changes_who_gets_the_line()
    {
        // The refund that is not recorded links to Place order, and so does the refund to Deliver order: either takes the line only by giving up its link.
        var (temp, window, reader) = Open((rel, text) => rel switch
        {
            "flows/refund-not-recorded.yaml" => "compare: place-order\n" + text,
            "flows/refund.yaml" => "compare: deliver-order\n" + text,
            _ => text,
        });
        using var _ = temp;
        var model = reader.Folder!.Model;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var note = reader.CompareShown!.Note;
        ClickBar(note.PairButton!);
        EditModeTests.Settle(window);
        Assert.Equal(["Tag The refund is not recorded as the newer of Support refunds an order", $"Replaces its link to {model.Flows["place-order"].Name}"], note.ConfirmLines);
        // Swap sides: the flow on the right is the other one, and the line goes to it instead.
        ClickBar(reader.CompareShown.Bar.FlipButton);
        EditModeTests.Settle(window);
        note = reader.CompareShown!.Note;
        Assert.Equal(["Tag Support refunds an order as the newer of The refund is not recorded", $"Replaces its link to {model.Flows["deliver-order"].Name}"], note.ConfirmLines);
        ClickBar(note.SaveButton!);
        await EditModeTests.Until(() => TagOnDisk(temp, "refund")?.With == "refund-not-recorded");
        Assert.Equal(new CompareTag("refund-not-recorded"), TagOnDisk(temp, "refund")); // no draft: the short form
        Assert.Equal("place-order", TagOnDisk(temp, "refund-not-recorded")!.With); // the other flow kept its own link
    }

    [AvaloniaFact]
    public void When_the_newer_flow_links_elsewhere_and_the_older_does_not_the_older_gets_the_line_and_the_confirm_says_so()
    {
        var (temp, window, reader) = Open((rel, text) => rel == "flows/refund-not-recorded.yaml" ? "compare: place-order\n" + text : text);
        using var _ = temp;
        var model = reader.Folder!.Model;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var note = reader.CompareShown!.Note;
        ClickBar(note.PairButton!);
        EditModeTests.Settle(window);
        Assert.Equal(["Tag Support refunds an order as the newer of The refund is not recorded", $"The refund is not recorded already links to {model.Flows["place-order"].Name}"], note.ConfirmLines);
    }

    private static Button FindButton(Control root, string name) =>
        root.GetVisualDescendants().OfType<Button>().First(b => Avalonia.Automation.AutomationProperties.GetName(b) == name);
}
