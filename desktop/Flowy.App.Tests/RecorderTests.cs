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
    private static (TempFolder Temp, string Dir, Window Window, ReaderView Reader) Open()
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

    private static void EditFlow(ReaderView reader, string id)
    {
        var index = reader.Folder!.Model.Flows.Keys.ToList().IndexOf(id);
        reader.FlowPicker.SelectedIndex = index;
        Dispatcher.UIThread.RunJobs(); // the picker acts once its own event is over
    }

    [AvaloniaFact]
    public void In_edit_mode_the_flow_picker_edits_instead_of_playing_and_new_flow_is_in_the_bar()
    {
        var (temp, _, _, reader) = Open();
        using var _ = temp;
        Assert.Equal("Edit a flow", reader.FlowPicker.PlaceholderText);
        Assert.NotNull(Labelled(reader, "New flow"));
        reader.SetEditing(false);
        Assert.Equal("Play a flow", reader.FlowPicker.PlaceholderText);
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
        var empty = new Point(4, 70);
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
        var (temp, dir, _, reader) = Open();
        using var _ = temp;
        EditFlow(reader, "order");
        var recorder = reader.Panel.CurrentRecorder!;
        Assert.False(Named(recorder, "Move up", 0).IsEnabled);
        Assert.False(Named(recorder, "Move down", 1).IsEnabled);
        Press(Named(recorder, "Move down", 0));
        await Until(() => reader.Folder!.Model.Flows["order"].Steps[0].Text == "Takes payment");
        Assert.Equal(["Takes payment", "Places an order"], reader.Folder!.Model.Flows["order"].Steps.Select(s => s.Text));
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
        Assert.False(reader.HasPanel);
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
}
