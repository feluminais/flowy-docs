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
        Assert.False(view.Bar.SwapButton.IsEnabled);
        Assert.Equal("Swap is not built yet", ToolTip.GetTip(view.Bar.SwapButton));
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

    private static Button FindButton(Control root, string name) =>
        root.GetVisualDescendants().OfType<Button>().First(b => Avalonia.Automation.AutomationProperties.GetName(b) == name);
}
