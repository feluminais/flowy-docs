using Avalonia;
using Avalonia.Automation;
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

/// <summary>Recording a flow, and editing one: pick the two boxes of a step with the pointer, type what happens, reorder, delete.</summary>
public class RecorderTests
{
    private static (TempFolder Temp, string Dir, Window Window, ReaderView Reader) Open(Action<string>? prepare = null)
    {
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        var source = Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "edit", "flowy");
        foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
        {
            var target = Path.Combine(dir, Path.GetRelativePath(source, file));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.WriteAllText(target, File.ReadAllText(file));
        }
        prepare?.Invoke(dir);
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        reader.SetEditing(true);
        Settle(window);
        return (temp, dir, window, reader);
    }

    private static void Settle(Window window)
    {
        window.UpdateLayout();
        Dispatcher.UIThread.RunJobs();
        AvaloniaHeadlessPlatform.ForceRenderTimerTick(3);
        Dispatcher.UIThread.RunJobs();
    }

    private static async Task Until(Func<bool> done)
    {
        for (var i = 0; i < 500 && !done(); i++) await Task.Delay(10);
        Assert.True(done(), "gave up waiting");
    }

    private static void Click(Window window, ReaderView reader, string id)
    {
        Settle(window);
        var at = ((Visual)reader.Canvas.BoxControlFor(id)!).TranslatePoint(new Point(100, 25), window)!.Value;
        window.MouseDown(at, MouseButton.Left);
        window.MouseUp(at, MouseButton.Left);
    }

    private static void Press(Button b) => b.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));

    private static Button Labelled(Control root, string content) => root.GetVisualDescendants().OfType<Button>().First(b => Avalonia.Automation.AutomationProperties.GetName(b) == content);

    private static Button Named(Control root, string name, int nth = 0) =>
        root.GetVisualDescendants().OfType<Button>().Where(b => AutomationProperties.GetName(b) == name).ElementAt(nth);

    private static string FlowFile(string dir, string id) => File.ReadAllText(Path.Combine(dir, "flows", $"{id}.yaml"));

    private static void EditFlow(ReaderView reader, string id) => reader.OpenFlowById(id);

    [AvaloniaFact]
    public void In_edit_mode_the_Flows_tab_edits_instead_of_playing_and_new_flow_is_in_the_bar()
    {
        var (temp, _, _, reader) = Open();
        using var _ = temp;
        Assert.NotNull(Labelled(reader, "New flow"));
        reader.ClickRail(PanelTab.Flows);
        Assert.Contains(reader.Navigator.Flows.Listed, f => f.Id == "browse");
        reader.Navigator.Flows.Open("browse");
        Assert.Equal("browse", reader.RecordingNow!.Id); // opened for editing, not played
        Assert.Null(reader.PlayingFlowId);
        reader.SetEditing(false);
        reader.ClickRail(PanelTab.Flows);
        reader.Navigator.Flows.Open("browse");
        Assert.Equal("browse", reader.PlayingFlowId);
        Assert.Null(reader.RecordingNow);
    }

    [AvaloniaFact]
    public async Task A_new_flow_is_named_then_each_step_is_two_clicks_and_a_line_of_text()
    {
        var (temp, dir, window, reader) = Open();
        using var _ = temp;
        Press(Labelled(reader, "New flow"));
        Assert.Equal("", reader.RecordingNow!.Id);
        reader.Panel.CurrentRecorder!.StartNamed("Customer pays");
        Assert.Equal("customer-pays", reader.RecordingNow!.Id);
        Assert.False(File.Exists(Path.Combine(dir, "flows", "customer-pays.yaml"))); // nothing is saved until there is a step

        Click(window, reader, "customer");
        Assert.Equal("customer", reader.RecordingNow!.From);
        Click(window, reader, "pay");
        Assert.Equal("pay", reader.RecordingNow!.To);
        Assert.NotNull(reader.Panel.CurrentRecorder!.StepBox);
        await reader.Panel.CurrentRecorder.SubmitStepAsync("Pays");
        await Until(() => File.Exists(Path.Combine(dir, "flows", "customer-pays.yaml")));
        var file = FlowFile(dir, "customer-pays");
        Assert.Contains("name: Customer pays\nview: root\nsteps:\n  - from: customer\n    to: pay\n    text: Pays\n", file);
        Assert.Null(reader.RecordingNow!.From); // ready for the next step
        await Until(() => reader.Panel.CurrentRecorder!.StepTexts.Count == 1);

        // The same box twice is a step it does on its own: no "to".
        Click(window, reader, "customer");
        Click(window, reader, "customer");
        await reader.Panel.CurrentRecorder!.SubmitStepAsync("Waits for the receipt");
        await Until(() => reader.Folder!.Model.Flows["customer-pays"].Steps.Count == 2);
        var step = reader.Folder!.Model.Flows["customer-pays"].Steps[1];
        Assert.Equal("customer", step.From);
        Assert.Null(step.To);
        Assert.Equal("Waits for the receipt", step.Text);
        Assert.True(reader.CanUndo);
    }

    [AvaloniaFact]
    public async Task Escape_or_a_click_on_empty_canvas_forgets_a_half_picked_step_and_a_blank_text_adds_nothing()
    {
        var (temp, dir, window, reader) = Open();
        using var _ = temp;
        EditFlow(reader, "browse");
        Click(window, reader, "customer");
        Assert.Equal("customer", reader.RecordingNow!.From);
        window.KeyPress(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);
        Assert.Null(reader.RecordingNow!.From);
        Assert.True(reader.HasPanel); // the panel stays: only the pick went

        Click(window, reader, "customer");
        Click(window, reader, "shop");
        var before = FlowFile(dir, "browse");
        await reader.Panel.CurrentRecorder!.SubmitStepAsync("   ");
        Assert.Equal(before, FlowFile(dir, "browse"));
        var empty = new Point(60, 70); // past the navigator's rail on the left
        window.MouseDown(empty, MouseButton.Left);
        window.MouseUp(empty, MouseButton.Left);
        Assert.Null(reader.RecordingNow!.From);
    }

    [AvaloniaFact]
    public async Task An_existing_flows_steps_can_be_reworded_with_their_hand_written_keys_kept()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        EditFlow(reader, "order");
        var recorder = reader.Panel.CurrentRecorder!;
        Assert.Equal(["Places an order", "Takes payment"], recorder.StepTexts.Select(t => t.Text));
        recorder.StepTexts[0].Text = "Orders";
        await recorder.StepTexts[0].Commit();
        await Until(() => FlowFile(dir, "order").Contains("text: Orders"));
        var file = FlowFile(dir, "order");
        Assert.Contains("note: x", file); // a step's own extra key
        Assert.Contains("owner: product", file); // the flow's
        Assert.Same(recorder, reader.Panel.CurrentRecorder); // updated in place
    }

    [AvaloniaFact]
    public async Task A_steps_detail_is_added_and_an_empty_one_removes_the_key()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        EditFlow(reader, "order");
        var recorder = reader.Panel.CurrentRecorder!;
        Assert.Equal("Details about it.\n", recorder.StepDetails[1].Text);
        recorder.StepDetails[1].Text = "";
        await recorder.StepDetails[1].Commit();
        await Until(() => !FlowFile(dir, "order").Contains("description"));
        recorder = reader.Panel.CurrentRecorder!;
        recorder.StepDetails[0].Text = "Why it matters.\n\nAnd more.";
        await recorder.StepDetails[0].Commit();
        await Until(() => FlowFile(dir, "order").Contains("description: |-\n      Why it matters."));
    }

    [AvaloniaFact]
    public async Task A_step_moves_up_and_down_and_is_deleted_and_the_buttons_know_the_ends()
    {
        var (temp, dir, _, reader) = Open(dir =>
        {
            Directory.CreateDirectory(Path.Combine(dir, "failures"));
            File.WriteAllText(Path.Combine(dir, "failures", "ordering.yaml"), "name: Ordering\nmodes:\n  rejected: { mode: Payment rejected, on: api, flow: order, step: 2 }\n");
        });
        using var _ = temp;
        EditFlow(reader, "order");
        var recorder = reader.Panel.CurrentRecorder!;
        Assert.False(Named(recorder, "Move up", 0).IsEnabled);
        Assert.False(Named(recorder, "Move down", 1).IsEnabled);
        Press(Named(recorder, "Move down", 0));
        await Until(() => reader.Folder!.Model.Flows["order"].Steps[0].Text == "Takes payment");
        Assert.Equal(["Takes payment", "Places an order"], reader.Folder!.Model.Flows["order"].Steps.Select(s => s.Text));
        Assert.Equal("1", reader.Folder.Model.Failures["ordering"].Modes["rejected"].Step);
        await Until(() => reader.Panel.CurrentRecorder!.StepTexts[0].Text == "Takes payment"); // the rows were rebuilt for the new order

        Press(Named(reader.Panel.CurrentRecorder!, "Delete step", 0));
        await Until(() => reader.Folder!.Model.Flows["order"].Steps.Count == 1);
        Assert.Equal("Places an order", reader.Folder.Model.Flows["order"].Steps[0].Text);
        Assert.DoesNotContain("Takes payment", FlowFile(dir, "order"));
    }

    [AvaloniaFact]
    public async Task A_flow_is_renamed_and_deleted_and_undo_brings_the_file_back()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        EditFlow(reader, "browse");
        var recorder = reader.Panel.CurrentRecorder!;
        recorder.FlowNameField!.Text = "Customer looks around";
        await recorder.FlowNameField.Commit();
        await Until(() => FlowFile(dir, "browse").Contains("name: Customer looks around"));

        Press(Labelled(reader.Panel.CurrentRecorder!, "Delete flow"));
        await Until(() => !File.Exists(Path.Combine(dir, "flows", "browse.yaml")));
        await Until(() => !reader.HasPanel); // the panel closes once the delete has been saved: a moment after the file goes
        await reader.UndoAsync();
        Assert.True(File.Exists(Path.Combine(dir, "flows", "browse.yaml")));
        Assert.Contains("name: Customer looks around", FlowFile(dir, "browse"));
    }

    [AvaloniaFact]
    public void Leaving_edit_mode_closes_the_recorder_and_plays_flows_again()
    {
        var (temp, _, _, reader) = Open();
        using var _ = temp;
        EditFlow(reader, "order");
        Assert.True(reader.HasPanel);
        reader.SetEditing(false);
        Assert.False(reader.HasPanel);
        reader.Play("order");
        Assert.Equal("order", reader.PlayingFlowId);
    }

    [AvaloniaFact]
    public void While_recording_boxes_are_not_dragged_and_the_picked_boxes_are_drawn_selected()
    {
        var (temp, _, window, reader) = Open();
        using var _ = temp;
        EditFlow(reader, "browse");
        Click(window, reader, "customer");
        Click(window, reader, "shop");
        Settle(window);
        Assert.False(reader.Canvas.Editable);
        Assert.Contains("selected", ((Control)reader.Canvas.BoxControlFor("customer")!).Classes);
    }

    [AvaloniaFact]
    public async Task A_stretch_of_steps_is_grouped_and_a_step_joins_the_group_from_its_own_list()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        EditFlow(reader, "order");
        Assert.True(await reader.Panel.CurrentRecorder!.AddGroupAsync("Retry the payment", "repeat", 2, 2));
        await Until(() => FlowFile(dir, "order").Contains("groups:"));
        var file = FlowFile(dir, "order");
        Assert.Contains("groups:\n  retry-the-payment:\n    kind: repeat\n    times: 3\n    text: Retry the payment\n", file);
        Assert.Contains("    text: Takes payment\n    description: |\n      Details about it.\n    group: retry-the-payment\n", file);
        Assert.Contains("owner: product", file); // the flow's own extra key

        var recorder = reader.Panel.CurrentRecorder!;
        Assert.Equal(["retry-the-payment"], recorder.GroupIds);
        Assert.Equal(["", "retry-the-payment"], recorder.StepGroupBoxes[0].Items.Cast<string>());
        Assert.False(recorder.StepLanes[1].IsVisible); // a repeat has no lanes
        recorder.StepGroupBoxes[0].SelectedItem = "retry-the-payment";
        await Until(() => reader.Folder!.Model.Flows["order"].Steps[0].Group == "retry-the-payment");
        Assert.Equal("retry-the-payment", reader.Folder!.Model.Flows["order"].Steps[1].Group);
        Assert.Null(reader.Folder.Model.Flows["order"].Steps[0].Lane);
    }

    [AvaloniaFact]
    public async Task A_branch_gets_a_lane_for_every_step_and_a_lane_is_renamed_and_an_empty_one_joins_the_lane_before()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        EditFlow(reader, "order");
        Assert.True(await reader.Panel.CurrentRecorder!.AddGroupAsync("", "branch", 1, 2));
        await Until(() => FlowFile(dir, "order").Contains("lane: Lane 2"));
        var file = FlowFile(dir, "order");
        Assert.Contains("groups:\n  branch:\n    kind: branch\n", file);
        Assert.Contains("    group: branch\n    lane: Lane 1\n", file);
        var recorder = reader.Panel.CurrentRecorder!;
        Assert.True(recorder.StepLanes[0].IsVisible);

        recorder.StepLanes[1].Text = "The card is declined";
        await recorder.StepLanes[1].Commit();
        await Until(() => FlowFile(dir, "order").Contains("lane: The card is declined"));

        recorder = reader.Panel.CurrentRecorder!;
        recorder.StepLanes[1].Text = "  ";
        await recorder.StepLanes[1].Commit();
        await Until(() => reader.Folder!.Model.Flows["order"].Steps[1].Lane is null or "");
        Assert.DoesNotContain("The card is declined", FlowFile(dir, "order"));
    }

    [AvaloniaFact]
    public async Task Deleting_the_step_that_starts_a_lane_hands_the_label_on_to_the_next_step_of_the_group()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        EditFlow(reader, "order");
        await reader.Panel.CurrentRecorder!.AddGroupAsync("Pick", "branch", 1, 2);
        await Until(() => FlowFile(dir, "order").Contains("lane: Lane 2"));
        var recorder = reader.Panel.CurrentRecorder!;
        recorder.StepLanes[1].Text = "";
        await recorder.StepLanes[1].Commit();
        await Until(() => !FlowFile(dir, "order").Contains("lane: Lane 2"));

        Press(Named(reader.Panel.CurrentRecorder!, "Delete step", 0));
        await Until(() => reader.Folder!.Model.Flows["order"].Steps.Count == 1);
        var step = reader.Folder!.Model.Flows["order"].Steps[0];
        Assert.Equal(("pick", "Lane 1"), (step.Group, step.Lane)); // the step left behind starts the lane now
        Assert.Contains("groups:\n  pick:", FlowFile(dir, "order"));
    }

[AvaloniaFact]
    public async Task Deleting_the_last_member_of_a_group_removes_the_group_from_the_file()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        EditFlow(reader, "order");
        await reader.Panel.CurrentRecorder!.AddGroupAsync("Pick", "branch", 2, 2);
        await Until(() => FlowFile(dir, "order").Contains("groups:"));
        Press(Named(reader.Panel.CurrentRecorder!, "Delete step", 1));
        await Until(() => reader.Folder!.Model.Flows["order"].Steps.Count == 1);
        var file = FlowFile(dir, "order");
        Assert.DoesNotContain("groups:", file);
        Assert.Contains("owner: product", file);
        Assert.Contains("note: x", file);
    }

    [AvaloniaFact]
    public async Task A_group_changes_kind_keeps_its_text_and_a_times_that_is_not_2_to_99_is_refused_with_the_old_one_back()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        EditFlow(reader, "order");
        await reader.Panel.CurrentRecorder!.AddGroupAsync("Retry", "repeat", 1, 2);
        await Until(() => FlowFile(dir, "order").Contains("kind: repeat"));
        var recorder = reader.Panel.CurrentRecorder!;
        Assert.Equal("3", recorder.GroupTimes("retry")!.Text);

        recorder.GroupTimes("retry")!.Text = "1";
        await recorder.GroupTimes("retry")!.Commit();
        Assert.Contains("times must be a whole number from 2 to 99", reader.NoticeText);
        Assert.Equal("3", recorder.GroupTimes("retry")!.Text);
        Assert.Contains("times: 3", FlowFile(dir, "order"));

        recorder.GroupTimes("retry")!.Text = "5";
        await recorder.GroupTimes("retry")!.Commit();
        await Until(() => FlowFile(dir, "order").Contains("times: 5"));

        await reader.Panel.CurrentRecorder!.GroupKind("retry").Choose("branch");
        await Until(() => FlowFile(dir, "order").Contains("kind: branch"));
        var file = FlowFile(dir, "order");
        Assert.DoesNotContain("times:", file);
        Assert.Contains("text: Retry", file);
        Assert.Contains("lane: Lane 1", file);
        Assert.Null(reader.Panel.CurrentRecorder!.GroupTimes("retry")); // a branch has no times
    }

    [AvaloniaFact]
    public async Task A_step_opens_another_flow_and_removing_a_group_takes_the_lanes_with_it()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        EditFlow(reader, "order");
        var recorder = reader.Panel.CurrentRecorder!;
        Assert.Equal(["", "browse"], recorder.StepFlowBoxes[0].Items.Cast<string>());
        recorder.StepFlowBoxes[0].SelectedItem = "browse";
        await Until(() => reader.Folder!.Model.Flows["order"].Steps[0].FlowId == "browse");
        Assert.Contains("flow: browse", FlowFile(dir, "order"));
        reader.Panel.CurrentRecorder!.StepFlowBoxes[0].SelectedItem = "";
        await Until(() => reader.Folder!.Model.Flows["order"].Steps[0].FlowId is null);
        Assert.DoesNotContain("flow:", FlowFile(dir, "order"));

        await reader.Panel.CurrentRecorder!.AddGroupAsync("Pick", "parallel", 1, 2);
        await Until(() => FlowFile(dir, "order").Contains("kind: parallel"));
        Press(reader.Panel.CurrentRecorder!.GroupRemove("pick"));
        await Until(() => !FlowFile(dir, "order").Contains("groups:"));
        var file = FlowFile(dir, "order");
        Assert.DoesNotContain("lane:", file);
        Assert.DoesNotContain("group:", file);
        Assert.Contains("text: Takes payment", file);
    }

    [AvaloniaFact]
    public async Task Saving_a_lane_or_a_choice_leaves_the_rows_alone_so_the_next_field_keeps_the_focus()
    {
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        EditFlow(reader, "order");
        await reader.Panel.CurrentRecorder!.AddGroupAsync("Pick", "branch", 1, 2);
        await Until(() => FlowFile(dir, "order").Contains("lane: Lane 2"));
        var recorder = reader.Panel.CurrentRecorder!;
        var (first, second) = (recorder.StepTexts[0], recorder.StepTexts[1]);

        recorder.StepLanes[1].Text = "The card is declined";
        await recorder.StepLanes[1].Commit();
        await Until(() => FlowFile(dir, "order").Contains("lane: The card is declined"));
        Assert.Same(recorder, reader.Panel.CurrentRecorder);
        Assert.Same(first, reader.Panel.CurrentRecorder!.StepTexts[0]); // the rows were not built again
        Assert.Same(second, reader.Panel.CurrentRecorder!.StepTexts[1]);

        reader.Panel.CurrentRecorder!.StepFlowBoxes[0].SelectedItem = "browse";
        await Until(() => reader.Folder!.Model.Flows["order"].Steps[0].FlowId == "browse");
        Assert.Same(first, reader.Panel.CurrentRecorder!.StepTexts[0]);
        Assert.Equal("browse", reader.Panel.CurrentRecorder!.StepFlowBoxes[0].SelectedItem);

        reader.Panel.CurrentRecorder!.StepGroupBoxes[1].SelectedItem = "";
        await Until(() => reader.Folder!.Model.Flows["order"].Steps[1].Group is null);
        Assert.Same(second, reader.Panel.CurrentRecorder!.StepTexts[1]);
        Assert.False(reader.Panel.CurrentRecorder!.StepLanes[1].IsVisible); // a step with no group has no lane
    }

    [AvaloniaFact]
    public async Task A_times_outside_2_to_99_is_refused_even_when_the_file_already_has_a_bad_one()
    {
        var (temp, dir, _, reader) = Open(dir => File.WriteAllText(Path.Combine(dir, "flows", "hollow.yaml"),
            "name: Hollow\nview: root\ngroups:\n  retry:\n    kind: repeat\n    times: \"1\"\nsteps:\n  - { from: customer, to: shop, text: Asks, group: retry }\n  - { from: shop, to: customer, text: Answers, group: retry }\n"));
        using var _ = temp;
        EditFlow(reader, "hollow");
        var recorder = reader.Panel.CurrentRecorder!;
        recorder.GroupTimes("retry")!.Text = "100";
        await recorder.GroupTimes("retry")!.Commit();
        Assert.Contains("times must be a whole number from 2 to 99", reader.NoticeText);
        Assert.Contains("times: \"1\"", FlowFile(dir, "hollow"));
        Assert.Equal("1", recorder.GroupTimes("retry")!.Text);

        recorder.GroupTimes("retry")!.Text = " 7 ";
        await recorder.GroupTimes("retry")!.Commit();
        await Until(() => FlowFile(dir, "hollow").Contains("times: 7"));
    }
}
