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

    /// <summary>A copy of Plum in <paramref name="temp"/> (its <c>flowy</c> folder, which is returned), with <paramref name="change"/> applied to its files.</summary>
    private static string CopyOfPlum(TempFolder temp, Func<string, string, string>? change = null)
    {
        var dir = Path.Combine(temp.Path, "flowy");
        foreach (var file in Directory.GetFiles(Plum, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(Plum, file).Replace('\\', '/');
            var target = Path.Combine(dir, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            var text = Untagged(File.ReadAllText(file));
            File.WriteAllText(target, change?.Invoke(rel, text) ?? text);
        }
        return dir;
    }

    /// <summary>A reader on a copy of Plum, with <paramref name="change"/> applied to the copy's files first (a path under flowy/ and a new text for it).</summary>
    private static (TempFolder Temp, Window Window, ReaderView Reader) Open(Func<string, string, string>? change = null, double width = 1200)
    {
        TestApp.NoMotion();
        var temp = new TempFolder();
        var dir = CopyOfPlum(temp, change);
        var reader = new ReaderView();
        var window = new Window { Width = width, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        EditModeTests.Settle(window);
        return (temp, window, reader);
    }

    /// <summary>
    /// The text without a top-level <c>compare:</c> key, short or long form. Plum now tags two pairs of its own (refund and together-measured); these tests need a folder with no pair, and
    /// add the tags they are about themselves.
    /// </summary>
    private static string Untagged(string text) => System.Text.RegularExpressions.Regex.Replace(text, @"^compare:[^\r\n]*\r?\n(?:[ \t]+[^\r\n]*\r?\n|\r?\n(?=[ \t]))*", "", System.Text.RegularExpressions.RegexOptions.Multiline);

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
    public void Double_clicking_a_shape_that_opens_zooms_that_pane_into_it_and_leaves_the_other_pane_alone()
    {
        var (temp, window, reader) = Open(width: 1800);
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        var (left, right) = (view.Panes[0], view.Panes[1]);
        var (leftLevel, rightLevel) = (left.Level, right.Level);
        Assert.False(right.CrumbsShown);
        Assert.False(right.Inside);
        var at = EditModeTests.Where(window, right.Canvas, "order-api", 20, 10);
        Click(window, at);
        Click(window, at);
        EditModeTests.Settle(window);
        Assert.Equal("order-api", right.Level);
        Assert.True(right.Inside);
        Assert.True(right.CrumbsShown);
        Assert.Equal(leftLevel, left.Level);
        Assert.False(left.Inside);
        Assert.False(reader.HasPanel); // the first click of a double-click opens no panel
        Assert.NotNull(reader.CompareShown);
        Assert.Equal("order-api", right.Canvas.Scene!.View);
        Assert.Equal("order-api", right.Canvas.Scene.Boxes.First(b => !b.Outsider).Object.In);
    }

    [AvaloniaFact]
    public void Esc_takes_a_zoomed_pane_back_up_and_a_second_Esc_closes_the_comparison()
    {
        var (temp, window, reader) = Open(width: 1800);
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        var right = view.Panes[1];
        var own = right.Level;
        var at = EditModeTests.Where(window, right.Canvas, "order-api", 20, 10);
        Click(window, at);
        Click(window, at);
        EditModeTests.Settle(window);
        Assert.Equal("order-api", right.Level);
        Press(window, Key.Escape, PhysicalKey.Escape);
        EditModeTests.Settle(window);
        Assert.Equal(own, right.Level);
        Assert.False(right.CrumbsShown);
        Assert.NotNull(reader.CompareShown);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Null(reader.CompareShown);
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

    /// <summary>
    /// The animations' clock, moved by hand. On the wall clock an animation ends when the machine says, so a test that asks "is it still under way" after a sleep is a race, and a slow frame
    /// can step over a part of it altogether. <see cref="Pass"/> lets time go by in frames of 10 ms. Every read of the clock moves it on a little: the headless window only asks for another
    /// frame when the last one changed what is drawn, so a frame that saw the same time as the one before it (a key press runs a few of its own) would end the chain of frames.
    /// </summary>
    private sealed class ManualClock : IDisposable
    {
        private double _now;

        public ManualClock() => Flowy.App.Canvas.Anim.TestClock = () => _now += 0.5;

        public void Pass(double milliseconds)
        {
            for (var left = milliseconds; left > 0; left -= 10)
            {
                _now += Math.Min(10, left);
                AvaloniaHeadlessPlatform.ForceRenderTimerTick();
                Dispatcher.UIThread.RunJobs();
            }
        }

        public void Dispose() => Flowy.App.Canvas.Anim.TestClock = null;
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
        using var clock = new ManualClock(); // by hand, so a slow frame can't step over a part of the swap
        try
        {
            stage.Swap();
            Assert.True(stage.Swapping);
            Assert.Null(stage.CardShown); // the card is the flow's once it is on
            // First the lines fade out (150 ms); then the boxes of both diagrams are on the stage, the old ones fading and no lines drawn.
            clock.Pass(SwapPlans.FadeMs + 30);
            Assert.True(stage.Swapping);
            Assert.Empty(stage.Canvas.Scene!.Edges);
            Assert.Equal(0, stage.LinesNow);
            Assert.All(onlyA, id => Assert.Contains(id, stage.Canvas.BoxPresence.Keys));
            clock.Pass(SwapPlans.SwapMs / 3); // a third of the way through the glide
            Assert.True(stage.Swapping);
            Assert.Contains(stage.Canvas.BoxPresence.Values, p => p is > 0 and < 1);
            clock.Pass(SwapPlans.SwapMs + 2 * SwapPlans.FadeMs); // longer than the rest of it
            Assert.False(stage.Swapping);
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
        using var clock = new ManualClock();
        try
        {
            // The second press comes while the lines are still fading out; each later one comes a little further into the glide.
            for (var i = 0; i < presses; i++)
            {
                Press(window, Key.X, PhysicalKey.X);
                clock.Pass(120 * (i + 1));
                Assert.True(stage.Swapping);
            }
            clock.Pass(SwapPlans.SwapMs + 2 * SwapPlans.FadeMs); // longer than any swap takes
            Assert.False(stage.Swapping);
            Assert.Equal(endsOn, stage.OnKey);
            AssertDrawn(stage);
            Assert.True(On(reader.CompareShown!.Bar.FlowButtons[endsOn == "refund" ? 0 : 1]));
        }
        finally
        {
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
        Assert.Equal(["No step changes"], same.Words);
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
    public void Each_pair_keeps_its_own_note_and_typing_on_one_never_replaces_another()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        reader.PrefillNote("About the refunds");
        reader.OpenCompareById("refund", "place-order"); // another pair replaces the comparison without asking
        EditModeTests.Settle(window);
        Assert.Null(reader.NoteDraftNow); // it starts with none
        reader.PrefillNote("About the order");
        Assert.Equal("About the refunds", reader.NoteDraftFor("flow", "refund-not-recorded", "refund")); // the first pair's is still there, whichever way round it is asked
        Assert.Equal("About the order", reader.NoteDraftFor("flow", "refund", "place-order"));

        // Discard on the pair on show drops its note and no other.
        reader.TryCloseCompare();
        ClickBar(reader.AskShown!.Discard);
        Assert.Null(reader.CompareNow);
        Assert.Null(reader.NoteDraftFor("flow", "refund", "place-order"));
        Assert.Equal("About the refunds", reader.NoteDraftFor("flow", "refund", "refund-not-recorded"));
        reader.OpenCompareById("refund-not-recorded", "refund");
        EditModeTests.Settle(window);
        Assert.Equal("About the refunds", reader.CompareShown!.Note.Field.Text);

        // Read again, the same folder keeps the notes (they are by pair); another folder has none.
        reader.Load(FolderLoader.Load(Dir(temp)), Dir(temp));
        Assert.Null(reader.CompareNow);
        Assert.Equal("About the refunds", reader.NoteDraftFor("flow", "refund", "refund-not-recorded"));
        reader.Load(FolderLoader.Load(Plum), Plum);
        Assert.False(reader.HoldsNote);
    }

    [AvaloniaFact]
    public void Leaving_the_folder_asks_when_any_pair_holds_a_note_and_Discard_drops_them_all()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        reader.PrefillNote("About the refunds");
        reader.OpenCompareById("refund", "place-order"); // the note is no longer on the pair on show
        EditModeTests.Settle(window);
        reader.PrefillNote("About the order");
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var left = false;
        Assert.True(reader.UnlessNotesKept(() => left = true));
        Assert.False(left);
        Assert.Equal("Discard the note?", Avalonia.Automation.AutomationProperties.GetName(reader.AskShown!)); // it names no pair
        ClickBar(reader.AskShown!.Keep);
        Assert.False(left);
        Assert.True(reader.HoldsNote);
        reader.TryCloseCompare(); // the pair on show holds a note: this asks the usual question, and Keep leaves the comparison
        ClickBar(reader.AskShown!.Keep);
        Assert.NotNull(reader.CompareNow);

        Assert.True(reader.UnlessNotesKept(() => left = true));
        ClickBar(reader.AskShown!.Discard);
        Assert.True(left);
        Assert.False(reader.HoldsNote); // every pair's, not just the one on show
        Assert.False(reader.UnlessNotesKept(() => { })); // nothing left to lose
    }

    [AvaloniaFact]
    public void Closing_the_window_or_opening_another_folder_with_a_note_nobody_saved_asks_first()
    {
        TestApp.NoMotion();
        using var temp = new TempFolder();
        var dir = CopyOfPlum(temp);
        var shell = new Shell(null);
        var window = shell.Show(dir);
        var reader = window.Reader;
        EditModeTests.Settle(window);
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        reader.PrefillNote("Still to say");

        window.Close();
        Assert.True(window.IsVisible); // the close was held back
        Assert.NotNull(reader.AskShown);
        ClickBar(reader.AskShown!.Keep);
        Assert.True(window.IsVisible);
        Assert.Equal("Still to say", reader.NoteDraftNow);

        window.Open(Plum); // another folder in this window asks too; Keep stays where it is
        Assert.Equal(dir, window.Dir);
        ClickBar(reader.AskShown!.Keep);
        Assert.Equal(dir, window.Dir);
        window.Open(dir); // the same folder read again does not ask
        Assert.Null(reader.AskShown);
        Assert.True(reader.HoldsNote);

        window.Close();
        ClickBar(reader.AskShown!.Discard);
        Assert.False(window.IsVisible); // Discard closes it for real
        Assert.Empty(shell.Windows);
    }

    [AvaloniaFact]
    public async Task The_note_field_is_read_only_while_a_save_runs_and_keeps_what_was_typed_when_the_save_fails()
    {
        var (temp, window, reader) = Open(Linked);
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var note = reader.CompareShown!.Note;
        ClickBar(note.NoteButton!);
        note.Field.Text = "Edited";
        var gate = new TaskCompletionSource<bool>();
        note.Save = (_, _) => gate.Task;
        ClickBar(note.SaveButton!);
        Assert.True(note.Field.IsReadOnly); // what is typed now would be dropped when the save lands
        gate.SetResult(false);
        await EditModeTests.Until(() => !note.Field.IsReadOnly);
        Assert.Equal("Edited", note.Field.Text);
        Assert.Equal("Edited", reader.NoteDraftNow);
    }

    [AvaloniaFact]
    public void Closing_the_comparison_stops_the_Autoplay_of_its_panes_and_of_the_swap_canvas()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenCompareById("refund", "refund-not-recorded");
        EditModeTests.Settle(window);
        var pane = reader.CompareShown!.Panes[0];
        Press(window, Key.P, PhysicalKey.P);
        Assert.True(pane.Playback.Auto);
        ClickBar(reader.CompareShown.Bar.CloseButton);
        Assert.Null(reader.CompareNow);
        Assert.False(pane.Playback.Auto); // the detached pane's timer must not go on stepping

        reader.OpenCompareById("refund", "refund-not-recorded", swap: true);
        EditModeTests.Settle(window);
        var stage = reader.CompareShown!.Stage!;
        Press(window, Key.P, PhysicalKey.P);
        Assert.True(stage.Flow("refund").Playback.Auto);
        ClickBar(reader.CompareShown.Bar.CloseButton);
        Assert.False(stage.Flow("refund").Playback.Auto);
        Assert.False(stage.Flow("refund-not-recorded").Playback.Auto);
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

    // ---- two runs --------------------------------------------------------------------------------------------------

    private const string Dinner = "dinner-rush";
    private const string Batched = "eta-batched";

    private static string RunText(TempFolder temp, string id) => File.ReadAllText(Path.Combine(temp.Path, "flowy", "perf", id + ".yaml"));

    /// <summary>The batched run holds a tag that names the dinner rush, with a note or without.</summary>
    /// <summary>Every file is given LF line breaks, so the text of a run can be compared as it is written; the batched run gets <paramref name="tag"/> at its end, when there is one.</summary>
    private static Func<string, string, string> BatchedTags(string? tag = "compare: dinner-rush\n") =>
        (rel, text) => text.Replace("\r\n", "\n") + (rel == "perf/eta-batched.yaml" ? tag : null);

    private static string Place(PerfComparePane pane) => pane.Panel.LoadText;

    [AvaloniaFact]
    public void Two_runs_open_as_two_panes_each_with_its_own_place_along_its_run()
    {
        var (temp, window, reader) = Open(BatchedTags(null));
        using var _ = temp;
        reader.OpenRunCompareById(Dinner, Batched);
        EditModeTests.Settle(window);
        Assert.Equal(new CompareState("run", Dinner, Batched, "side"), reader.CompareNow);
        var view = reader.CompareShown!;
        Assert.Equal(["Dinner rush", "Dinner rush, ETA calls batched"], view.RunPanes.Select(p => p.TitleText).ToArray());
        Assert.All(view.RunPanes, p => Assert.True(p.Canvas.Scene!.Boxes.Count > 0));
        Assert.True(view.RunPanes[0].Focused);
        Assert.False(view.RunPanes[1].Focused);
        Assert.False(reader.PerfOpenNow); // the panel leaves: each pane has its own
        Assert.Null(reader.PlayingFlowId);
        var (left, right) = (view.RunPanes[0], view.RunPanes[1]);
        Assert.NotSame(left.Session, right.Session);
        Assert.Null(left.Panel.Picker); // the run is the pane's own: no picker and no Compare in its header
        Assert.Null(left.Panel.CompareButton);
        Assert.NotNull(left.Canvas.Load);
        Assert.NotNull(right.Canvas.Load);

        // Moving one run does not move the other.
        var (before, rightAt) = (Place(left), right.Session.Pos);
        left.Session.StepLevel(0);
        Assert.Equal(0, left.Session.Pos);
        Assert.NotEqual(before, Place(left));
        Assert.Equal(rightAt, right.Session.Pos);
        var rightText = Place(right);
        left.Step(1);
        Assert.Equal(1, left.Session.Pos);
        Assert.Equal(rightText, Place(right));
    }

    [AvaloniaFact]
    public void The_Performance_keys_reach_the_focused_pane_only_and_the_keys_of_a_flow_stay_out()
    {
        var (temp, window, reader) = Open(BatchedTags(null));
        using var _ = temp;
        reader.OpenRunCompareById(Dinner, Batched);
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        var (left, right) = (view.RunPanes[0], view.RunPanes[1]);
        var (leftAt, rightAt) = (left.Session.Pos, right.Session.Pos);
        Press(window, Key.Left, PhysicalKey.ArrowLeft);
        Assert.Equal((leftAt - 1, rightAt), (left.Session.Pos, right.Session.Pos));
        Press(window, Key.R, PhysicalKey.R); // Replay is a flow's key: left to the reader
        Press(window, Key.Right, PhysicalKey.ArrowRight);
        Assert.Equal((leftAt, rightAt), (left.Session.Pos, right.Session.Pos));

        // A press in the other pane gives it the focus, and the keys follow.
        Click(window, right.TranslatePoint(new Point(30, 14), window)!.Value);
        Assert.True(right.Focused);
        Assert.False(left.Focused);
        Press(window, Key.Home, PhysicalKey.Home);
        Assert.Equal((leftAt, 0), (left.Session.Pos, right.Session.Pos));
        Press(window, Key.End, PhysicalKey.End);
        Assert.Equal((leftAt, right.Session.Run!.Levels.Count - 1), (left.Session.Pos, right.Session.Pos));
        Press(window, Key.F, PhysicalKey.F); // F fits the focused pane: it neither throws nor moves a run
        Assert.Equal(leftAt, left.Session.Pos);

        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0");
        try
        {
            Press(window, Key.P, PhysicalKey.P);
            Assert.True(right.Session.Ramping);
            Assert.False(left.Session.Ramping);
            Press(window, Key.P, PhysicalKey.P);
            Assert.False(right.Session.Ramping);
        }
        finally
        {
            Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        }
    }

    [AvaloniaFact]
    public void Swap_for_runs_is_one_pane_at_full_width_and_each_run_keeps_its_own_place_across_swaps()
    {
        var (temp, window, reader) = Open(BatchedTags(null));
        using var _ = temp;
        reader.OpenRunCompareById(Dinner, Batched, swap: true);
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        var stage = view.RunStage!;
        Assert.Empty(view.RunPanes);
        Assert.Equal(Dinner, stage.OnKey);
        Assert.Equal("Dinner rush", stage.TitleText);
        Assert.True(stage.Body.Beside); // one pane at full width: the panel sits beside the canvas
        Assert.Same(stage.Run(Dinner).Panel, stage.Body.PanelShown);
        Assert.Equal(["Dinner rush", "Dinner rush, ETA calls batched"], FlowNames(view.Bar));
        var (dinnerAt, batchedAt) = (stage.Run(Dinner).Session.Pos, stage.Run(Batched).Session.Pos);

        Press(window, Key.Left, PhysicalKey.ArrowLeft); // acts on the run on show
        Assert.Equal((dinnerAt - 1, batchedAt), (stage.Run(Dinner).Session.Pos, stage.Run(Batched).Session.Pos));
        Press(window, Key.X, PhysicalKey.X);
        Assert.False(stage.Swapping); // reduced motion cuts
        Assert.Equal(Batched, stage.OnKey);
        Assert.Equal("Dinner rush, ETA calls batched", stage.TitleText);
        Assert.Same(stage.Run(Batched).Panel, stage.Body.PanelShown);
        Press(window, Key.Home, PhysicalKey.Home);
        Assert.Equal((dinnerAt - 1, 0), (stage.Run(Dinner).Session.Pos, stage.Run(Batched).Session.Pos));
        Press(window, Key.X, PhysicalKey.X);
        Assert.Equal(Dinner, stage.OnKey);
        Assert.Equal((dinnerAt - 1, 0), (stage.Run(Dinner).Session.Pos, stage.Run(Batched).Session.Pos)); // each kept its own place
        Assert.True(On(view.Bar.FlowButtons[0]));
        Assert.NotNull(stage.Canvas.Load); // the run on show draws its load
    }

    [AvaloniaFact]
    public void A_run_that_goes_off_in_Swap_stops_its_ramp()
    {
        var (temp, window, reader) = Open(BatchedTags(null));
        using var _ = temp;
        reader.OpenRunCompareById(Dinner, Batched, swap: true);
        EditModeTests.Settle(window);
        var stage = reader.CompareShown!.RunStage!;
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0");
        try
        {
            Press(window, Key.P, PhysicalKey.P);
            Assert.True(stage.Run(Dinner).Session.Ramping);
            Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1"); // the swap itself cuts, so no animation is left running behind the test
            stage.Swap();
            Assert.False(stage.Run(Dinner).Session.Ramping);
            Assert.False(stage.Run(Batched).Session.Ramping);
        }
        finally
        {
            Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        }
    }

    [AvaloniaFact]
    public void With_motion_a_swap_of_runs_fades_the_traffic_out_hands_the_canvas_over_and_fades_it_back_in()
    {
        var (temp, window, reader) = Open(BatchedTags(null));
        using var _ = temp;
        reader.OpenRunCompareById(Dinner, Batched, swap: true);
        EditModeTests.Settle(window);
        var stage = reader.CompareShown!.RunStage!;
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0");
        using var clock = new ManualClock();
        try
        {
            Assert.Equal(300, SwapPlans.CrossfadeDuration(false));
            Press(window, Key.X, PhysicalKey.X);
            Assert.True(stage.Swapping);
            Assert.Equal(Batched, stage.OnKey); // the name and the panel are the new run's from the start
            clock.Pass(100); // the first third: the old run's traffic is going
            Assert.True(stage.Swapping);
            Assert.InRange(stage.Canvas.TrafficOpacity, 0.01, 0.99);
            Assert.True(stage.Run(Dinner).Drawing);
            Assert.False(stage.Run(Batched).Drawing);
            clock.Pass(100); // past the middle: the canvas is the new run's, and its traffic is coming
            Assert.True(stage.Swapping);
            Assert.True(stage.Run(Batched).Drawing);
            Assert.False(stage.Run(Dinner).Drawing);
            Assert.InRange(stage.Canvas.TrafficOpacity, 0.01, 0.99);
            clock.Pass(400);
            Assert.False(stage.Swapping);
            Assert.Equal(1, stage.Canvas.TrafficOpacity);
            Assert.NotNull(stage.Canvas.Load);
        }
        finally
        {
            Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        }
    }

    [AvaloniaFact]
    public void Swap_sides_and_the_way_to_view_keep_each_runs_session()
    {
        var (temp, window, reader) = Open(BatchedTags(null));
        using var _ = temp;
        reader.OpenRunCompareById(Dinner, Batched);
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        var (dinner, batched) = (view.RunPanes[0].Session, view.RunPanes[1].Session);
        dinner.StepLevel(1);
        batched.StepLevel(2);
        ClickBar(view.Bar.FlipButton);
        EditModeTests.Settle(window);
        Assert.Equal(new CompareState("run", Batched, Dinner, "side"), reader.CompareNow);
        Assert.Equal([Batched, Dinner], view.RunPanes.Select(p => p.RunId).ToArray());
        Assert.Same(batched, view.RunPanes[0].Session);
        Assert.Same(dinner, view.RunPanes[1].Session);
        Assert.Equal((2, 1), (batched.Pos, dinner.Pos));

        ClickBar(view.Bar.SwapButton);
        EditModeTests.Settle(window);
        var stage = view.RunStage!;
        Assert.Equal(Batched, stage.OnKey); // Swap starts on the run whose pane has the focus: the first, which is the batched run now
        Assert.Same(dinner, stage.Run(Dinner).Session);
        Assert.Same(batched, stage.Run(Batched).Session);
        Assert.Equal((2, 1), (batched.Pos, dinner.Pos));
        ClickBar(view.Bar.SideButton);
        EditModeTests.Settle(window);
        Assert.Null(view.RunStage);
        Assert.Same(batched, view.RunPanes[0].Session);
        Assert.Equal((2, 1), (view.RunPanes[0].Session.Pos, view.RunPanes[1].Session.Pos));
        Assert.Equal(1, view.RunPanes[1].Panel.SliderValue); // the panel is the run's own in both ways of viewing
    }

    [AvaloniaFact]
    public void The_Details_panel_is_shared_a_shape_is_outlined_in_both_panes_and_both_follow_the_level()
    {
        var (temp, window, reader) = Open(BatchedTags(null));
        using var _ = temp;
        reader.GoTo("delivery");
        reader.OpenRunCompareById(Dinner, Batched);
        EditModeTests.Settle(window);
        var view = reader.CompareShown!;
        Assert.All(view.RunPanes, p => Assert.Equal("delivery", p.Canvas.Scene!.View)); // both draw the level the reader is on
        reader.ComparePicked(view.RunPanes[1].Key, new ReaderView.Side.Box("dispatch"));
        EditModeTests.Settle(window);
        Assert.Equal("dispatch", reader.SelectedBoxId);
        Assert.True(reader.HasPanel); // one Details panel
        Assert.All(view.RunPanes, p => Assert.Equal(["dispatch"], p.Canvas.SelectedNow.ToArray())); // outlined in both
        Assert.All(view.RunPanes, p => Assert.NotEmpty(p.Panel.Readings)); // each panel reads the shape out for its own run
        Assert.True(view.RunPanes[1].Focused);
        reader.GoTo(Names.Root); // going to another level moves both panes; the comparison stays
        EditModeTests.Settle(window);
        Assert.NotNull(reader.CompareNow);
        Assert.All(view.RunPanes, p => Assert.Equal(Names.Root, p.Canvas.Scene!.View));
    }

    [AvaloniaFact]
    public void The_marks_of_changes_are_for_flows_only_so_the_switch_is_greyed_out_with_the_reason()
    {
        var (temp, window, reader) = Open(BatchedTags(null));
        using var _ = temp;
        reader.SetShowChanges(true);
        reader.OpenRunCompareById(Dinner, Batched);
        EditModeTests.Settle(window);
        var bar = reader.CompareShown!.Bar;
        Assert.False(bar.ChangesButton.IsEnabled);
        Assert.Equal("Not for runs", ToolTip.GetTip(bar.ChangesButton));
        Assert.False(On(bar.ChangesButton));
        Assert.Null(bar.KeyShown);
        Assert.Equal("Two runs next to each other", ToolTip.GetTip(bar.SideButton));
        Assert.Equal("One canvas that flips between the runs", ToolTip.GetTip(bar.SwapButton));
        reader.TryCloseCompare();
        reader.OpenCompareById("refund", "refund-not-recorded"); // for flows the switch is as it was
        EditModeTests.Settle(window);
        Assert.True(reader.CompareShown!.Bar.ChangesButton.IsEnabled);
        Assert.Equal("Two flows next to each other", ToolTip.GetTip(reader.CompareShown.Bar.SideButton));
    }

    [AvaloniaFact]
    public void A_run_that_is_not_there_gives_the_notice_and_no_comparison_and_the_launch_option_says_the_same()
    {
        var (temp, window, reader) = Open(BatchedTags(null));
        using var _ = temp;
        reader.OpenRunCompareById(Dinner, "nope");
        Assert.Null(reader.CompareNow);
        Assert.Equal("That run can't open.", reader.NoticeText);
        Assert.False(reader.PerfOpenNow);

        reader.OpenRunCompareById("nope", Batched, swap: true);
        Assert.Null(reader.CompareNow);
    }

    [AvaloniaFact]
    public async Task The_launch_option_run_colon_a_comma_b_opens_two_runs_and_a_third_part_opens_them_in_Swap()
    {
        var (temp, window, reader) = Open(BatchedTags());
        using var _ = temp;
        await new LaunchScript(window, reader).RunAsync(LaunchOptions.Parse(["--compare", "run:eta-batched,dinner-rush"]));
        Assert.Equal(new CompareState("run", Dinner, Batched, "side"), reader.CompareNow); // the one that holds the tag reads second
        reader.TryCloseCompare();
        await new LaunchScript(window, reader).RunAsync(LaunchOptions.Parse(["--compare", "run:dinner-rush,eta-batched,swap", "--swapped"]));
        Assert.Equal(new CompareState("run", Dinner, Batched, "swap"), reader.CompareNow);
        EditModeTests.Settle(window);
        Assert.Equal(Batched, reader.CompareShown!.RunStage!.OnKey);
        reader.TryCloseCompare();
        await new LaunchScript(window, reader).RunAsync(LaunchOptions.Parse(["--compare", "run:dinner-rush,nope"]));
        Assert.Null(reader.CompareNow);
        Assert.Equal("That run can't open.", reader.NoticeText);
        await new LaunchScript(window, reader).RunAsync(LaunchOptions.Parse(["--compare", "refund,refund-not-recorded"]));
        Assert.Equal("flow", reader.CompareNow!.Kind); // without run: it is still two flows
    }

    [AvaloniaFact]
    public void Two_runs_do_not_mix_with_edit_mode_or_a_playing_flow()
    {
        var (temp, window, reader) = Open(BatchedTags(null));
        using var _ = temp;
        reader.SetEditing(true);
        reader.OpenRunCompareById(Dinner, Batched);
        Assert.Null(reader.CompareNow); // never while editing
        reader.SetEditing(false);
        reader.GoTo("root");
        reader.Play("refund", 1);
        EditModeTests.Settle(window);
        Assert.Equal("refund", reader.PlayingFlowId);
        reader.OpenRunCompareById(Dinner, Batched);
        EditModeTests.Settle(window);
        Assert.Null(reader.PlayingFlowId); // the flow waits behind the panes
        Assert.False(reader.Card.IsVisible);
        reader.SetEditing(true); // starting to edit ends the comparison
        Assert.Null(reader.CompareNow);
    }

    [AvaloniaFact]
    public void A_pane_puts_its_panel_beside_the_canvas_when_it_is_wide_and_under_it_when_it_is_narrow()
    {
        var (temp, window, reader) = Open(BatchedTags(null));
        using var _ = temp;
        reader.OpenRunCompareById(Dinner, Batched);
        EditModeTests.Settle(window);
        Assert.All(reader.CompareShown!.RunPanes, p => Assert.False(p.Body.Beside)); // two panes side by side, each narrow
        reader.TryCloseCompare();
        var (temp2, window2, reader2) = Open(width: 800);
        using var _2 = temp2;
        reader2.OpenRunCompareById(Dinner, Batched);
        EditModeTests.Settle(window2);
        var view = reader2.CompareShown!;
        Assert.True(view.Stacked); // under about 900 px the panes stack, each wide and short
        Assert.All(view.RunPanes, p => Assert.True(p.Body.Beside));
    }

    [AvaloniaFact]
    public void The_run_picker_and_the_header_show_Linked_for_the_runs_in_a_pair()
    {
        var (temp, window, reader) = Open(BatchedTags());
        using var _ = temp;
        reader.OpenTab("performance");
        EditModeTests.Settle(window);
        var panel = reader.PerfPanelNow;
        Assert.Equal(["Dinner rush", "Dinner rush, ETA calls batched"], panel.RunChoices.Where(c => c.Linked).Select(c => c.Name).Order().ToArray());
        Assert.Equal(7, panel.RunChoices.Count);
        Assert.Equal(2, panel.RunChoices.Count(c => c.Linked));
        reader.PickRunById("orders-only");
        EditModeTests.Settle(window);
        Assert.Null(reader.PerfPanelNow.LinkedMark); // not in a pair
        reader.PickRunById(Batched);
        EditModeTests.Settle(window);
        Assert.NotNull(reader.PerfPanelNow.LinkedMark);
    }

    [AvaloniaFact]
    public void Compare_in_the_run_header_opens_a_picker_over_the_runs_with_the_linked_one_first_and_picking_opens_the_comparison()
    {
        var (temp, window, reader) = Open(BatchedTags("compare: dinner-rush\n"));
        using var _ = temp;
        reader.OpenTab("performance");
        reader.PickRunById(Dinner);
        EditModeTests.Settle(window);
        var panel = reader.PerfPanelNow;
        Assert.True(panel.CompareButton!.IsEnabled);
        ClickBar(panel.CompareButton);
        EditModeTests.Settle(window);
        Assert.Equal("compare", panel.PickerOpen);
        var rows = panel.RunPicker!.Rows;
        Assert.Equal(Batched, rows[0].Id); // the run that tags this one is listed first
        Assert.Equal("after", rows[0].Side);
        Assert.DoesNotContain(rows, c => c.Id == Dinner); // never itself
        Assert.Equal(["orders-only", "pings-climbing", "stripe-outage", "together", "together-measured"], rows.Skip(1).Select(c => c.Id).Order().ToArray()); // then every other run
        ClickBar(FindButton(panel.RunPicker, "Dinner rush, ETA calls batched"));
        EditModeTests.Settle(window);
        Assert.Equal(new CompareState("run", Dinner, Batched, "side"), reader.CompareNow);
        Assert.False(reader.PerfOpenNow);
        Assert.Null(reader.PerfPanelNow.RunPicker);
    }

    [AvaloniaFact]
    public void A_tag_to_a_run_that_is_not_there_is_listed_greyed_out_as_Missing_and_still_opens_the_picker()
    {
        var (temp, window, reader) = Open(BatchedTags("compare: ghost\n"));
        using var _ = temp;
        reader.OpenTab("performance");
        reader.PickRunById(Batched);
        EditModeTests.Settle(window);
        ClickBar(reader.PerfPanelNow.CompareButton!);
        EditModeTests.Settle(window);
        var rows = reader.PerfPanelNow.RunPicker!.Rows;
        Assert.Equal(new CompareChoice("ghost", "ghost", "before", true), rows[0]);
        Assert.False(FindButton(reader.PerfPanelNow.RunPicker, "ghost").IsEnabled);
        Assert.Null(reader.PerfPanelNow.LinkedMark); // a tag to nothing links nothing
    }

    [AvaloniaFact]
    public void C_with_the_Performance_panel_open_opens_the_first_linked_run_directly_else_the_picker()
    {
        var (temp, window, reader) = Open(BatchedTags());
        using var _ = temp;
        reader.OpenTab("performance");
        reader.PickRunById(Batched);
        EditModeTests.Settle(window);
        Press(window, Key.C, PhysicalKey.C);
        EditModeTests.Settle(window);
        Assert.Equal(new CompareState("run", Dinner, Batched, "side"), reader.CompareNow); // the holder of the tag reads second
        Assert.False(reader.PerfOpenNow);
        Press(window, Key.C, PhysicalKey.C); // C again closes it
        Assert.Null(reader.CompareNow);

        reader.OpenTab("performance");
        reader.PickRunById("orders-only");
        EditModeTests.Settle(window);
        Press(window, Key.C, PhysicalKey.C);
        Assert.Null(reader.CompareNow);
        Assert.Equal("compare", reader.PerfPanelNow.PickerOpen); // no linked run: the picker, over the runs
        EditModeTests.Settle(window); // its field takes the keyboard once it is on screen
        Press(window, Key.Escape, PhysicalKey.Escape); // Esc closes the picker first
        Assert.Null(reader.PerfPanelNow.RunPicker);
        Assert.True(reader.PerfOpenNow);
    }

    [AvaloniaFact]
    public async Task Link_with_writes_only_the_compare_line_of_that_run_file_and_Unlink_gives_the_file_back()
    {
        var (temp, window, reader) = Open(BatchedTags(null));
        using var _ = temp;
        var (dinnerBefore, batchedBefore) = (RunText(temp, Dinner), RunText(temp, Batched));
        reader.SetEditing(true); // linking is done while editing: the Performance tab lists the runs
        reader.OpenTab("performance");
        EditModeTests.Settle(window);
        var links = reader.RunLinksNow;
        Assert.True(links.LinkButtonOf(Batched)!.IsEnabled);
        Assert.False(links.UnlinkButtonOf(Batched)!.IsEnabled);
        Assert.Equal("Not linked", ToolTip.GetTip(links.UnlinkButtonOf(Batched)!));
        ClickBar(links.LinkButtonOf(Batched)!);
        EditModeTests.Settle(window);
        Assert.Equal(Batched, links.PickerOpen);
        ClickBar(FindButton(links.RunPicker!, "Dinner rush"));
        await EditModeTests.Until(() => RunText(temp, Batched).Contains("compare: dinner-rush"));
        Assert.Equal(batchedBefore + "compare: dinner-rush\n", RunText(temp, Batched)); // one line added, nothing else touched
        Assert.Equal(dinnerBefore, RunText(temp, Dinner));
        Assert.Empty(Directory.GetFiles(temp.Path, "*.tmp", SearchOption.AllDirectories));
        await EditModeTests.Until(() => links.IsLinked(Batched)); // the folder is read again
        Assert.Equal(new CompareTag("dinner-rush"), reader.Folder!.Runs![Batched].Compare);
        Assert.Null(links.RunPicker);

        // Unlink: no note, so it goes at once, and the file is as it was.
        Assert.True(links.UnlinkButtonOf(Batched)!.IsEnabled);
        ClickBar(links.UnlinkButtonOf(Batched)!);
        await EditModeTests.Until(() => !RunText(temp, Batched).Contains("compare"));
        Assert.Equal(batchedBefore, RunText(temp, Batched));
        Assert.Null(reader.UnlinkAskShown);
    }

    [AvaloniaFact]
    public void The_Performance_tab_lists_the_runs_to_link_while_editing_and_the_header_has_no_Link_with()
    {
        var (temp, window, reader) = Open(BatchedTags());
        using var _ = temp;
        reader.OpenTab("performance");
        reader.PickRunById(Batched);
        EditModeTests.Settle(window);
        Assert.NotNull(reader.PerfPanelNow.CompareButton); // looking at a run: Compare, and no Link with
        Assert.All(reader.PerfPanelNow.GetVisualDescendants().OfType<Button>(), b => Assert.NotEqual("Link with", Avalonia.Automation.AutomationProperties.GetName(b)));
        reader.SetEditing(true);
        EditModeTests.Settle(window);
        Assert.True(reader.PerfOpenNow == false);
        var links = reader.RunLinksNow;
        Assert.NotNull(links.LinkButtonOf(Dinner));
        Assert.NotNull(links.LinkButtonOf(Batched));
        Assert.True(links.IsLinked(Batched) == (reader.Folder!.Runs![Batched].Compare is not null));
        Assert.True(reader.Rail.Shown.First(i => i.Name.StartsWith("Performance")).Enabled); // the tab is there while editing, and lists the runs
        Assert.True(reader.RunsOpenNow);
    }

    [AvaloniaFact]
    public async Task Unlink_asks_first_when_the_link_holds_a_note_and_Keep_leaves_the_file_as_it_is()
    {
        var (temp, window, reader) = Open(BatchedTags("compare:\n  with: dinner-rush\n  note: Batching the calls\n"));
        using var _ = temp;
        var tagged = RunText(temp, Batched);
        reader.SetEditing(true);
        reader.OpenTab("performance");
        EditModeTests.Settle(window);
        ClickBar(reader.RunLinksNow.UnlinkButtonOf(Batched)!);
        EditModeTests.Settle(window);
        var ask = reader.UnlinkAskShown!;
        Assert.Equal("Remove the link and its note", Avalonia.Automation.AutomationProperties.GetName(ask));
        Assert.Equal(tagged, RunText(temp, Batched)); // nothing is written until it is answered
        ClickBar(ask.Keep);
        Assert.Null(reader.UnlinkAskShown);
        await Task.Delay(50);
        Assert.Equal(tagged, RunText(temp, Batched));

        ClickBar(reader.RunLinksNow.UnlinkButtonOf(Batched)!);
        Press(window, Key.Escape, PhysicalKey.Escape); // Esc is Keep
        Assert.Null(reader.UnlinkAskShown);
        Assert.Equal(tagged, RunText(temp, Batched));

        ClickBar(reader.RunLinksNow.UnlinkButtonOf(Batched)!);
        ClickBar(reader.UnlinkAskShown!.Discard); // Remove
        await EditModeTests.Until(() => !RunText(temp, Batched).Contains("compare"));
        Assert.DoesNotContain("note", RunText(temp, Batched).Replace("notes", ""));
        Assert.Null(reader.UnlinkAskShown);
    }

    [AvaloniaFact]
    public void A_folder_that_cannot_be_written_cannot_be_edited_so_the_header_has_Compare_and_no_Link_with()
    {
        var (temp, window, reader) = Open(BatchedTags());
        using var _ = temp;
        reader.CanEdit = false; // a sample inside the install
        reader.SetEditing(true);
        Assert.False(reader.Editing); // so there is no list of runs to link from
        reader.OpenTab("performance");
        reader.PickRunById(Batched);
        EditModeTests.Settle(window);
        var panel = reader.PerfPanelNow;
        Assert.True(panel.CompareButton!.IsEnabled); // comparing writes nothing
        Assert.Null(reader.RunLinksNow.LinkButtonOf(Batched));
        reader.OpenRunCompareById(Dinner, Batched);
        EditModeTests.Settle(window);
        var note = reader.CompareShown!.Note;
        Assert.False(note.NoteButton!.IsEnabled); // the note strip says the same
        Assert.Equal("This page can't save", ToolTip.GetTip(note.NoteButton));
    }

    [AvaloniaFact]
    public async Task A_run_file_that_changed_since_it_was_read_is_not_written_and_says_so()
    {
        var (temp, window, reader) = Open(BatchedTags(null));
        using var _ = temp;
        var path = Path.Combine(temp.Path, "flowy", "perf", Batched + ".yaml");
        reader.BeforeRunWrite = () => File.AppendAllText(path, "# edited elsewhere\n");
        var saved = await reader.WriteRunTagForTest(Batched, new CompareTag(Dinner));
        Assert.False(saved);
        Assert.Equal("This file changed outside Flowy. Reloaded.", reader.NoticeText);
        Assert.DoesNotContain("compare:", RunText(temp, Batched));
        Assert.EndsWith("# edited elsewhere\n", RunText(temp, Batched)); // the other writer's change stays
        reader.BeforeRunWrite = null;
        Assert.True(await reader.WriteRunTagForTest(Batched, new CompareTag(Dinner)));
        Assert.EndsWith("# edited elsewhere\ncompare: dinner-rush\n", RunText(temp, Batched));
        Assert.False(await reader.WriteRunTagForTest(Batched, new CompareTag(Batched))); // the refusals are a flow's, in the same words
        Assert.Equal("run \"eta-batched\" cannot compare with itself", reader.NoticeText);
        Assert.False(await reader.WriteRunTagForTest(Batched, new CompareTag("nope")));
        Assert.Equal("unknown run \"nope\"", reader.NoticeText);
    }

    [AvaloniaFact]
    public async Task A_run_that_adds_other_runs_can_be_linked_too_and_still_loads()
    {
        var (temp, window, reader) = Open(BatchedTags(null));
        using var _ = temp;
        var added = RunText(temp, "together");
        Assert.Contains("adds:", added);
        Assert.True(await reader.WriteRunTagForTest("together", new CompareTag("together-measured")));
        Assert.Equal(added + "compare: together-measured\n", RunText(temp, "together"));
        Assert.Equal(new CompareTag("together-measured"), reader.Folder!.Runs!["together"].Compare);
        Assert.Empty(reader.Folder.RunProblems!); // it still plays
        reader.OpenRunCompareById("together", "together-measured");
        EditModeTests.Settle(window);
        Assert.Equal(new CompareState("run", "together-measured", "together", "side"), reader.CompareNow); // the one that holds the tag reads second
        Assert.All(reader.CompareShown!.RunPanes, p => Assert.NotNull(p.Canvas.Load));
    }

    [AvaloniaFact]
    public void A_ramp_ends_with_its_comparison()
    {
        var (temp, window, reader) = Open(BatchedTags(null));
        using var _ = temp;
        reader.OpenRunCompareById(Dinner, Batched);
        EditModeTests.Settle(window);
        var left = reader.CompareShown!.RunPanes[0].Session;
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0");
        try
        {
            Press(window, Key.P, PhysicalKey.P);
            Assert.True(left.Ramping);
            Press(window, Key.T, PhysicalKey.T); // another tab in front of the comparison stops it too
            Assert.False(left.Ramping);
            Press(window, Key.T, PhysicalKey.T);
            Press(window, Key.C, PhysicalKey.C);
            Assert.Null(reader.CompareNow);
        }
        finally
        {
            Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        }
    }

    [AvaloniaFact]
    public async Task A_note_on_a_pair_of_runs_is_written_into_the_run_that_holds_the_tag()
    {
        var (temp, window, reader) = Open(BatchedTags());
        using var _ = temp;
        var (dinnerBefore, batchedBefore) = (RunText(temp, Dinner), RunText(temp, Batched));
        reader.OpenRunCompareById(Dinner, Batched);
        EditModeTests.Settle(window);
        var note = reader.CompareShown!.Note;
        Assert.Null(note.PairButton); // the pair is tagged already
        ClickBar(note.NoteButton!);
        EditModeTests.Settle(window);
        note.Field.Text = "Batching halves the calls";
        EditModeTests.Settle(window);
        ClickBar(note.SaveButton!);
        await EditModeTests.Until(() => RunText(temp, Batched).Contains("Batching halves"));
        Assert.Equal(batchedBefore.Replace("compare: dinner-rush\n", "") + "compare:\n  with: dinner-rush\n  note: \"Batching halves the calls\"\n", RunText(temp, Batched)); // a one-line note is double-quoted
        Assert.Equal(dinnerBefore, RunText(temp, Dinner));
        await EditModeTests.Until(() => reader.CompareShown!.Note.SavedView is not null); // the strip shows it once the folder is read again
        Assert.NotNull(reader.CompareNow);
    }

    [AvaloniaFact]
    public async Task Save_as_pair_on_two_untagged_runs_tags_the_one_on_the_right()
    {
        var (temp, window, reader) = Open(BatchedTags(null));
        using var _ = temp;
        reader.OpenRunCompareById(Dinner, Batched);
        EditModeTests.Settle(window);
        var note = reader.CompareShown!.Note;
        Assert.Equal("Link these runs", ToolTip.GetTip(note.PairButton!));
        ClickBar(note.PairButton!);
        EditModeTests.Settle(window);
        Assert.Equal(["Tag Dinner rush, ETA calls batched as the newer of Dinner rush"], note.ConfirmLines);
        ClickBar(note.SaveButton!);
        await EditModeTests.Until(() => RunText(temp, Batched).Contains("compare: dinner-rush"));
        Assert.DoesNotContain("compare", RunText(temp, Dinner));
    }

    [AvaloniaFact]
    public void Closing_the_run_comparison_with_an_unsaved_note_asks_first_and_a_run_that_goes_away_closes_it()
    {
        var (temp, window, reader) = Open(BatchedTags());
        using var _ = temp;
        reader.OpenRunCompareById(Dinner, Batched);
        EditModeTests.Settle(window);
        reader.PrefillNote("Draft");
        EditModeTests.Settle(window);
        reader.TryCloseCompare();
        Assert.NotNull(reader.AskShown); // the same question as for flows
        Press(window, Key.Escape, PhysicalKey.Escape); // Keep
        Assert.NotNull(reader.CompareNow);
        File.Delete(Path.Combine(temp.Path, "flowy", "perf", Batched + ".yaml")); // a change on disk takes a run away
        reader.Reload(FolderLoader.Load(Path.Combine(temp.Path, "flowy")));
        Assert.Null(reader.CompareNow);
        Assert.True(reader.HoldsNote); // closed without asking, and the draft is kept for when the pair is compared again
    }

    // ---- Linked in the lists, Compare on a row, and Compare with in the flow form -----------------------------------------

    private static IEnumerable<Control> Named(Control root, string name) =>
        root.GetVisualDescendants().OfType<Control>().Where(c => Avalonia.Automation.AutomationProperties.GetName(c) == name);

    private static IEnumerable<string> Words(Control root) => root.GetVisualDescendants().OfType<TextBlock>().Where(t => t.IsVisible).Select(t => t.Text ?? "");

    private static string FlowFile(TempFolder temp, string id) => File.ReadAllText(Path.Combine(temp.Path, "flowy", "flows", $"{id}.yaml"));

    /// <summary>The tagged pair with a note on it, as the form's tests need: the refund that is not recorded is the newer, and says why.</summary>
    private static string LinkedWithNote(string rel, string text) =>
        rel == "flows/refund-not-recorded.yaml" ? "compare: { with: refund, note: \"The ledger write was missed\" }\n" + text : text;

    [AvaloniaFact]
    public void The_Flows_tab_marks_both_flows_of_a_pair_and_shows_the_Linked_key_only_while_one_is_listed()
    {
        var (temp, window, reader) = Open(Linked);
        using var _ = temp;
        reader.ClickRail(PanelTab.Flows);
        EditModeTests.Settle(window);
        var flows = reader.Navigator.Flows;
        Assert.Equal(["refund", "refund-not-recorded"], flows.Listed.Where(f => f.Linked).Select(f => f.Id).Order());
        Assert.Equal(2, Named(flows, "Linked").Count(c => c.IsVisible && c is not TextBlock)); // a mark on each row of the pair, named for a screen reader
        Assert.True(flows.LinkedKeyShown);
        Assert.Contains("Linked", Words(flows));
        flows.Filter = "unanswered"; // only a flow that is in no pair is left on the list
        EditModeTests.Settle(window);
        Assert.Equal(["no-courier-answers"], flows.Listed.Select(f => f.Id));
        Assert.False(flows.LinkedKeyShown);
        Assert.DoesNotContain(Named(flows, "Linked"), c => c.IsVisible);
    }

    [AvaloniaFact]
    public void A_folder_with_no_pair_shows_no_Linked_mark_and_no_key_in_either_list()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.ClickRail(PanelTab.Flows);
        EditModeTests.Settle(window);
        Assert.False(reader.Navigator.Flows.LinkedKeyShown);
        Assert.All(reader.Navigator.Flows.Listed, f => Assert.False(f.Linked));
        reader.ClickRail(PanelTab.Explorer);
        EditModeTests.Settle(window);
        Assert.False(reader.Navigator.Explorer.LinkedKeyShown);
        Assert.DoesNotContain(reader.Navigator.Explorer.Rows, r => r.Linked == true);
    }

    [AvaloniaFact]
    public void The_Explorer_marks_the_pair_on_its_flow_rows_and_shows_the_Linked_key_while_one_is_among_the_rows()
    {
        var (temp, window, reader) = Open(Linked);
        using var _ = temp;
        reader.ClickRail(PanelTab.Explorer);
        var explorer = reader.Navigator.Explorer;
        explorer.Filter = "refund";
        EditModeTests.Settle(window);
        Assert.Equal(["flow:refund", "flow:refund-not-recorded"], explorer.Rows.Where(r => r.Linked == true).Select(r => r.Key).Order());
        Assert.All(explorer.Rows.Where(r => r.Kind == "shape"), r => Assert.Null(r.Linked));
        Assert.True(explorer.LinkedKeyShown);
        Assert.Equal(2, Named(explorer, "Linked").Count(c => c.IsVisible && c is not TextBlock));
        explorer.Filter = "stripe"; // a filter that leaves no flow of a pair
        EditModeTests.Settle(window);
        Assert.DoesNotContain(explorer.Rows, r => r.Linked == true);
        Assert.False(explorer.LinkedKeyShown);
    }

    [AvaloniaFact]
    public void Partners_in_one_view_are_listed_together_in_the_Flows_tab()
    {
        // The refund that is not recorded plays in the same view as the payment that is captured; tagging that one lists it right after.
        var (temp, window, reader) = Open((rel, text) => rel == "flows/stripe-outage.yaml" ? "compare: announce-order\n" + text : text);
        using var _ = temp;
        reader.ClickRail(PanelTab.Flows);
        EditModeTests.Settle(window);
        var ordering = reader.Navigator.Flows.Listed.Select(f => f.Id).SkipWhile(id => id != "announce-order").Take(2).ToList();
        Assert.Equal(["announce-order", "stripe-outage"], ordering);
    }

    [AvaloniaFact]
    public void The_Compare_button_on_a_row_of_a_linked_flow_opens_the_comparison_and_leaves_the_row_alone()
    {
        var (temp, window, reader) = Open(Linked);
        using var _ = temp;
        reader.ClickRail(PanelTab.Flows);
        EditModeTests.Settle(window);
        var flows = reader.Navigator.Flows;
        Assert.Null(flows.CompareOff);
        var button = flows.CompareButtonOf("refund-not-recorded")!;
        Assert.Equal("Compare with another flow", ToolTip.GetTip(button));
        ClickBar(button);
        EditModeTests.Settle(window);
        Assert.Equal(new CompareState("flow", "refund", "refund-not-recorded", "side"), reader.CompareNow); // the one that holds the tag reads second
        Assert.Null(reader.PickerShown);
        Assert.Null(reader.PlayingFlowId); // the comparison, not the flow's own player
    }

    [AvaloniaFact]
    public void The_Compare_button_on_a_row_of_a_flow_with_no_link_opens_the_picker_under_the_tabs_and_a_pick_opens_the_comparison()
    {
        var (temp, window, reader) = Open(Linked);
        using var _ = temp;
        reader.ClickRail(PanelTab.Flows);
        EditModeTests.Settle(window);
        ClickBar(reader.Navigator.Flows.CompareButtonOf("place-order")!);
        EditModeTests.Settle(window);
        var picker = reader.PickerShown!;
        Assert.Same(picker, reader.Navigator.Picker);
        Assert.Equal(("place-order", true), reader.PickerFor);
        Assert.Null(reader.CompareNow);
        Assert.DoesNotContain(picker.Rows, c => c.Id == "place-order"); // not with itself
        // A second press on the same button closes it; a press on another row's moves it there.
        ClickBar(reader.Navigator.Flows.CompareButtonOf("place-order")!);
        Assert.Null(reader.PickerShown);
        Assert.Null(reader.Navigator.Picker);
        ClickBar(reader.Navigator.Flows.CompareButtonOf("place-order")!);
        ClickBar(reader.Navigator.Flows.CompareButtonOf("capture-payment")!);
        Assert.Equal(("capture-payment", true), reader.PickerFor);
        picker = reader.PickerShown!;
        EditModeTests.Settle(window);
        ClickBar(Named(picker, "Customer places an order").OfType<Button>().Single());
        EditModeTests.Settle(window);
        Assert.Equal(new CompareState("flow", "capture-payment", "place-order", "side"), reader.CompareNow);
        Assert.Null(reader.PickerShown);
        Assert.Null(reader.Navigator.Picker);
    }

    [AvaloniaFact]
    public void The_picker_of_a_row_stays_while_no_flow_plays_and_Esc_closes_it()
    {
        var (temp, window, reader) = Open(Linked);
        using var _ = temp;
        reader.ClickRail(PanelTab.Flows);
        EditModeTests.Settle(window);
        reader.CompareRow("place-order");
        Assert.NotNull(reader.PickerShown);
        reader.ClickRail(PanelTab.Explorer); // a redraw with no flow to show on the player: that must not take the flyout of a row away
        reader.ClickRail(PanelTab.Flows);
        EditModeTests.Settle(window);
        Assert.NotNull(reader.PickerShown);
        Assert.Same(reader.PickerShown, reader.Navigator.Picker);
        Press(window, Key.Escape, PhysicalKey.Escape);
        Assert.Null(reader.PickerShown);
        Assert.Null(reader.Navigator.Picker);
    }

    [AvaloniaFact]
    public void Playing_a_flow_from_its_row_still_works_beside_its_Compare_button()
    {
        var (temp, window, reader) = Open(Linked);
        using var _ = temp;
        reader.ClickRail(PanelTab.Flows);
        EditModeTests.Settle(window);
        reader.Navigator.Flows.Open("place-order");
        Assert.Equal("place-order", reader.PlayingFlowId);
        reader.ClickRail(PanelTab.Explorer);
        reader.ToggleRow("ordering", true);
        EditModeTests.Settle(window);
        reader.Navigator.Explorer.Pick("flow:capture-payment");
        Assert.Equal("capture-payment", reader.PlayingFlowId);
    }

    [AvaloniaFact]
    public void In_edit_mode_the_row_Compare_buttons_stay_and_are_greyed_out_with_the_reason_and_do_nothing()
    {
        var (temp, window, reader) = Open(Linked);
        using var _ = temp;
        reader.ClickRail(PanelTab.Flows);
        reader.SetEditing(true);
        EditModeTests.Settle(window);
        var flows = reader.Navigator.Flows;
        Assert.Equal("Not while editing", flows.CompareOff);
        var button = flows.CompareButtonOf("refund-not-recorded")!;
        Assert.True(button.IsVisible);
        Assert.Contains("off", button.Classes);
        Assert.True(button.Focusable);
        Assert.Equal("Not while editing", ToolTip.GetTip(button));
        ClickBar(button);
        Assert.Null(reader.CompareNow);
        Assert.Null(reader.PickerShown);
        reader.ClickRail(PanelTab.Explorer);
        reader.Navigator.Explorer.Filter = "refund";
        EditModeTests.Settle(window);
        Assert.Equal("Not while editing", reader.Navigator.Explorer.CompareOff);
        var row = reader.Navigator.Explorer.CompareButtonOf("refund")!;
        Assert.Contains("off", row.Classes);
        Assert.Equal("Not while editing", ToolTip.GetTip(row));
        reader.SetEditing(false);
        EditModeTests.Settle(window);
        Assert.Null(reader.Navigator.Explorer.CompareOff); // the rows are drawn again without it
        Assert.DoesNotContain("off", reader.Navigator.Explorer.CompareButtonOf("refund")!.Classes);
    }

    [AvaloniaFact]
    public void With_one_flow_only_the_row_Compare_button_says_there_is_no_other_flow()
    {
        TestApp.NoMotion();
        using var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        var source = Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "compare", "flowy");
        Directory.CreateDirectory(Path.Combine(dir, "flows"));
        File.Copy(Path.Combine(source, "model.yaml"), Path.Combine(dir, "model.yaml"));
        File.Copy(Path.Combine(source, "flows", "checkout.yaml"), Path.Combine(dir, "flows", "checkout.yaml"));
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        reader.ClickRail(PanelTab.Flows);
        EditModeTests.Settle(window);
        Assert.Equal("No other flow", reader.Navigator.Flows.CompareOff);
        var button = reader.Navigator.Flows.CompareButtonOf("checkout")!;
        Assert.Equal("No other flow", ToolTip.GetTip(button));
        ClickBar(button);
        Assert.Null(reader.PickerShown);
    }

    [AvaloniaFact]
    public void Enter_on_a_Compare_button_in_the_Explorer_presses_it_and_does_not_open_the_row()
    {
        var (temp, window, reader) = Open(Linked);
        using var _ = temp;
        reader.ClickRail(PanelTab.Explorer);
        var explorer = reader.Navigator.Explorer;
        explorer.Filter = "refund";
        EditModeTests.Settle(window);
        var button = explorer.CompareButtonOf("refund-not-recorded")!;
        button.Focus();
        Press(window, Key.Enter, PhysicalKey.Enter);
        EditModeTests.Settle(window);
        Assert.NotNull(reader.CompareNow); // its own Enter: the pair opened, and the flow did not play on its own
        Assert.Null(reader.PlayingFlowId);
    }

    // ---- the flow form's Compare with --------------------------------------------------------------------------------

    /// <summary>Edit mode on a copy of Plum with <paramref name="flow"/>'s form open: the form's Compare with is the picker.</summary>
    private static (TempFolder Temp, Window Window, ReaderView Reader, PartnerPicker Picker) OpenForm(string flow, Func<string, string, string>? change = null)
    {
        var (temp, window, reader) = Open(change);
        reader.SetEditing(true);
        reader.OpenFlowById(flow);
        EditModeTests.Settle(window);
        return (temp, window, reader, reader.Panel.CurrentRecorder!.PartnerPicker!);
    }

    [AvaloniaFact]
    public async Task Picking_a_partner_in_the_flow_form_writes_the_tag_as_one_edit_that_undo_takes_back()
    {
        var (temp, window, reader, picker) = OpenForm("refund");
        using var _ = temp;
        Assert.Null(picker.Partner);
        Assert.DoesNotContain("refund", picker.OfferedIds); // a flow can't compare with itself
        Assert.Equal(19, picker.OfferedIds.Count); // every other flow: Plum's twenty less this one
        ClickBar(picker.TileOf("place-order")!);
        await EditModeTests.Until(() => FlowFile(temp, "refund").Contains("compare: place-order"));
        await EditModeTests.Until(() => reader.Panel.CurrentRecorder!.PartnerPicker!.Partner is not null);
        EditModeTests.Settle(window);
        var now = reader.Panel.CurrentRecorder!.PartnerPicker!;
        Assert.Equal(new PartnerTile("place-order", "Customer places an order", "Ordering"), now.Partner);
        Assert.True(now.IsRinged("place-order"));
        await reader.UndoAsync(); // one edit: one undo
        await EditModeTests.Until(() => !FlowFile(temp, "refund").Contains("compare"));
        await EditModeTests.Until(() => reader.Panel.CurrentRecorder!.PartnerPicker!.Partner is null);
    }

    [AvaloniaFact]
    public async Task Changing_the_partner_keeps_the_note_of_the_link_and_is_one_edit()
    {
        var (temp, window, reader, picker) = OpenForm("refund-not-recorded", LinkedWithNote);
        using var _ = temp;
        Assert.Equal("refund", picker.Partner!.Id);
        ClickBar(picker.TileOf("place-order")!);
        await EditModeTests.Until(() => FlowFile(temp, "refund-not-recorded").Contains("with: place-order"));
        Assert.Contains("The ledger write was missed", FlowFile(temp, "refund-not-recorded"));
        Assert.DoesNotContain("with: refund,", FlowFile(temp, "refund-not-recorded"));
        await reader.UndoAsync();
        await EditModeTests.Until(() => FlowFile(temp, "refund-not-recorded").Contains("with: refund"));
        Assert.Contains("The ledger write was missed", FlowFile(temp, "refund-not-recorded"));
        EditModeTests.Settle(window);
    }

    [AvaloniaFact]
    public async Task Removing_a_link_with_no_note_is_one_click_and_one_undo_brings_it_back()
    {
        var (temp, window, reader, picker) = OpenForm("refund-not-recorded", Linked);
        using var _ = temp;
        Assert.True(picker.RemoveButton!.IsEnabled);
        ClickBar(picker.RemoveButton!);
        Assert.False(picker.Asking);
        await EditModeTests.Until(() => !FlowFile(temp, "refund-not-recorded").Contains("compare"));
        await reader.UndoAsync();
        await EditModeTests.Until(() => FlowFile(temp, "refund-not-recorded").Contains("compare: refund"));
        EditModeTests.Settle(window);
    }

    [AvaloniaFact]
    public async Task Removing_a_link_that_has_a_note_asks_first_and_Keep_or_Esc_leaves_it_as_it_is()
    {
        var (temp, window, reader, picker) = OpenForm("refund-not-recorded", LinkedWithNote);
        using var _ = temp;
        Assert.False(picker.Asking);
        ClickBar(picker.RemoveButton!);
        EditModeTests.Settle(window);
        Assert.True(picker.Asking);
        Assert.Contains("Remove the link and its note", Words(picker));
        Assert.False(picker.RemoveButton!.IsEnabled);
        Assert.Contains("The ledger write was missed", FlowFile(temp, "refund-not-recorded")); // nothing has changed yet
        ClickBar(picker.KeepButton!);
        Assert.False(picker.Asking);
        Assert.True(picker.RemoveButton.IsEnabled);
        ClickBar(picker.RemoveButton);
        EditModeTests.Settle(window);
        Assert.True(picker.KeepButton!.IsFocused); // Keep is the answer the keyboard is on
        Press(window, Key.Escape, PhysicalKey.Escape); // Esc answers with Keep
        Assert.False(picker.Asking);
        Assert.NotNull(reader.Panel.CurrentRecorder); // and does not close the form
        Assert.Contains("The ledger write was missed", FlowFile(temp, "refund-not-recorded"));
        ClickBar(picker.RemoveButton);
        ClickBar(picker.ConfirmButton!);
        await EditModeTests.Until(() => !FlowFile(temp, "refund-not-recorded").Contains("compare"));
        await reader.UndoAsync(); // the note comes back with the link
        await EditModeTests.Until(() => FlowFile(temp, "refund-not-recorded").Contains("The ledger write was missed"));
    }

    [AvaloniaFact]
    public void The_form_lists_the_flows_that_compare_with_it_and_a_tile_opens_that_flows_form()
    {
        var (temp, window, reader, picker) = OpenForm("refund", Linked);
        using var _ = temp;
        Assert.Null(picker.Partner);
        Assert.Equal(["refund-not-recorded"], picker.ComparedByIds);
        Assert.Contains("Compared by", Words(picker));
        ClickBar(picker.ComparedByTileOf("refund-not-recorded")!);
        EditModeTests.Settle(window);
        Assert.Equal("refund-not-recorded", reader.RecordingNow!.Id);
        var other = reader.Panel.CurrentRecorder!.PartnerPicker!;
        Assert.Equal("refund", other.Partner!.Id);
        Assert.Empty(other.ComparedByIds);
    }

    [AvaloniaFact]
    public async Task A_tag_to_a_flow_that_is_not_there_shows_as_Missing_and_can_be_removed_or_replaced()
    {
        var (temp, window, reader, picker) = OpenForm("refund", (rel, text) => rel == "flows/refund.yaml" ? "compare: nowhere\n" + text : text);
        using var _ = temp;
        Assert.Equal(new PartnerTile("nowhere", "nowhere", "", true), picker.Partner);
        Assert.Contains("Missing", Words(picker));
        Assert.DoesNotContain("nowhere", picker.OfferedIds); // only flows that are there are offered
        Assert.True(picker.RemoveButton!.IsEnabled);
        ClickBar(picker.TileOf("deliver-order")!);
        await EditModeTests.Until(() => FlowFile(temp, "refund").Contains("compare: deliver-order"));
        await EditModeTests.Until(() => reader.Panel.CurrentRecorder!.PartnerPicker!.Partner is { Id: "deliver-order", Missing: false });
        EditModeTests.Settle(window);
    }

    [AvaloniaFact]
    public void The_search_narrows_the_tiles_by_name_and_keeps_its_text_across_a_pick()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.OpenFlowById("refund");
        EditModeTests.Settle(window);
        var picker = reader.Panel.CurrentRecorder!.PartnerPicker!;
        picker.Find.Text = "courier";
        EditModeTests.Settle(window);
        Assert.Equal(["courier-pings-lost", "deliver-order", "follow-the-courier", "no-courier-answers"], picker.OfferedIds.Order()); // the name or the id has it
        picker.Find.Text = "zzz";
        EditModeTests.Settle(window);
        Assert.Empty(picker.OfferedIds);
        Assert.Contains("Nothing called that", Words(picker));
        picker.Find.Text = "";
        EditModeTests.Settle(window);
        Assert.Equal(19, picker.OfferedIds.Count);
    }

    [AvaloniaFact]
    public void A_flow_with_no_file_yet_has_the_section_greyed_out_with_the_reason()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        ClickBar(Named(reader, "New flow").OfType<Button>().First());
        EditModeTests.Settle(window);
        var picker = reader.Panel.CurrentRecorder!.PartnerPicker!;
        Assert.Equal("Name the flow first", picker.Off);
        Assert.False(picker.RemoveButton?.IsEnabled ?? false);
        Assert.False(picker.Find.IsEffectivelyEnabled);
        Assert.All(picker.OfferedIds, id => Assert.False(picker.TileOf(id)!.IsEnabled));
        Assert.Equal("Name the flow first", ToolTip.GetTip(picker.TileOf(picker.OfferedIds[0])!));
        reader.Panel.CurrentRecorder!.StartNamed("Customer pays");
        EditModeTests.Settle(window);
        Assert.Equal("Record a step first", reader.Panel.CurrentRecorder!.PartnerPicker!.Off);
    }
}
