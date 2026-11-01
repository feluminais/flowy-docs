using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Interactivity;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;
using static Flowy.App.Tests.EditModeTests;

namespace Flowy.App.Tests;

/// <summary>The edit forms for payloads, as browser-tests/payloads-edit.spec.ts drives the browser's: a picker on a line and on a step, a payload's form, and a new one made from a name.</summary>
public class PayloadEditTests
{
    private const string Source = """
        payloads:
          order: { name: Order, about: What the web app sends. }
          receipt: { name: Receipt, about: What comes back. }
        objects:
          shop: { type: system, name: Shop }
          web: { type: app, in: shop, name: Web app }
          api: { type: app, in: shop, name: API }
          db: { type: store, in: shop, name: Orders DB }
        connections:
          - { from: web, to: api, label: REST }
          - { from: api, to: db, label: saves }
        """;

    private const string Flow = """
        name: Checkout
        view: shop
        steps:
          - { from: web, to: api, text: Places the order, animation: call }
          - { from: api, to: db, text: Saves it, animation: send }
        """;

    private static (TempFolder Temp, string Dir, Window Window, ReaderView Reader) Open(string carried = "")
    {
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(Path.Combine(dir, "flows"));
        File.WriteAllText(Path.Combine(dir, "model.yaml"), carried == "" ? Source : Source.Replace("label: REST }", $"label: REST, payloads: [{carried}] }}"));
        File.WriteAllText(Path.Combine(dir, "flows", "checkout.yaml"), Flow);
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 1000, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        reader.SetEditing(true);
        reader.GoTo("shop");
        return (temp, dir, window, reader);
    }

    private static Model Saved(string dir) => FolderLoader.Load(dir).Model;

    private static PayloadPicker Picker(Control root, string label) =>
        root.GetVisualDescendants().OfType<PayloadPicker>().First(p => AutomationProperties.GetName(p) == label);

    private static Button Named(Control root, string name) =>
        root.GetVisualDescendants().OfType<Button>().First(b => AutomationProperties.GetName(b) == name);

    private static void Click(Button b) => b.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));

    [AvaloniaFact]
    public async Task A_line_takes_a_payload_from_the_picker_and_lets_it_go()
    {
        var (temp, dir, window, reader) = Open();
        using var _ = temp;
        reader.OpenLine("web", "api");
        Settle(window);
        await Picker(reader.Panel, "Payloads").ToggleAsync("order");
        await Until(() => PayloadEdit.IdsOf(Saved(dir).Connections[0].Payloads).SequenceEqual(["order"]));
        Settle(window);
        // The heading names what is picked, as the tag picker's does.
        Assert.Contains(Picker(reader.Panel, "Payloads").GetVisualDescendants().OfType<TextBlock>(), t => t.Text == "Order" && t.FontWeight == Avalonia.Media.FontWeight.SemiBold);
        await Picker(reader.Panel, "Payloads").ToggleAsync("order");
        await Until(() => Saved(dir).Connections[0].Payloads is null);
    }

    [AvaloniaFact]
    public async Task A_new_payload_made_from_the_picker_is_saved_and_carried_once_it_says_something()
    {
        var (temp, dir, window, reader) = Open();
        using var _ = temp;
        reader.OpenLine("web", "api");
        Settle(window);
        var picker = Picker(reader.Panel, "Payloads");
        picker.AddBox!.Text = "Shipping label";
        picker.AddTyped(picker.AddBox);
        Settle(window);
        var about = reader.Panel.GetVisualDescendants().OfType<StackPanel>().First(s => s.Classes.Contains("payloadnew")).GetVisualDescendants().OfType<FieldBox>().First();
        about.Text = "What the courier prints.";
        await about.Commit();
        await Until(() => Payloads.Of(Saved(dir)).ContainsKey("shipping-label"));
        Assert.Equal(["shipping-label"], PayloadEdit.IdsOf(Saved(dir).Connections[0].Payloads));
        Assert.Equal("What the courier prints.", Payloads.Resolve(Saved(dir), "shipping-label")!.About);
    }

    [AvaloniaFact]
    public async Task The_form_edits_a_payloads_name_and_about()
    {
        var (temp, dir, window, reader) = Open("order");
        using var _ = temp;
        reader.OpenLine("web", "api");
        Settle(window);
        var form = reader.Panel.GetVisualDescendants().OfType<StackPanel>().First(s => s.Classes.Contains("payloadform"));
        var name = form.GetVisualDescendants().OfType<FieldBox>().First();
        name.Text = "Order request";
        await name.Commit();
        await Until(() => Payloads.Resolve(Saved(dir), "order")!.Name == "Order request");
    }

    [AvaloniaFact]
    public async Task Deleting_a_payload_in_use_is_refused_and_says_who_uses_it()
    {
        var (temp, dir, window, reader) = Open("order");
        using var _ = temp;
        reader.OpenLine("web", "api");
        Settle(window);
        var form = reader.Panel.GetVisualDescendants().OfType<StackPanel>().First(s => s.Classes.Contains("payloadform"));
        Click(Named(form, "Delete payload"));
        Settle(window);
        await Until(() => form.GetVisualDescendants().OfType<TextBlock>().Any(t => t.Classes.Contains("refused") && t.IsVisible));
        Assert.Equal("payload \"order\" is used by connection web → api. Change those first.", form.GetVisualDescendants().OfType<TextBlock>().First(t => t.Classes.Contains("refused")).Text);
        Assert.True(Payloads.Of(Saved(dir)).ContainsKey("order"));
    }

    [AvaloniaFact]
    public async Task A_step_takes_a_payload_and_on_a_call_a_reply_on_a_send_the_reply_is_greyed_out_with_the_reason()
    {
        var (temp, dir, window, reader) = Open();
        using var _ = temp;
        reader.OpenFlowById("checkout");
        Settle(window);
        var recorder = reader.Panel.CurrentRecorder!;
        var pickers = recorder.GetVisualDescendants().OfType<PayloadPicker>().ToList();
        await pickers.First(p => AutomationProperties.GetName(p) == "Payload").ToggleAsync("order");
        await Until(() => Saved(dir).Flows["checkout"].Steps[0].Payload as string == "order");
        Settle(window);
        await recorder.GetVisualDescendants().OfType<PayloadPicker>().First(p => AutomationProperties.GetName(p) == "Reply").ToggleAsync("receipt");
        await Until(() => Saved(dir).Flows["checkout"].Steps[0].Reply as string == "receipt");
        Settle(window);
        var sendReply = recorder.GetVisualDescendants().OfType<PayloadPicker>().Where(p => AutomationProperties.GetName(p) == "Reply").ElementAt(1);
        var chip = sendReply.GetVisualDescendants().OfType<Button>().First(b => AutomationProperties.GetName(b) == "Receipt");
        Assert.False(chip.IsEnabled);
        Assert.Equal("A reply needs a call, a callback or a recurse", ToolTip.GetTip(chip));
    }
}
