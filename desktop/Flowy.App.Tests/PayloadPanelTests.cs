using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;
using static Flowy.App.Tests.EditModeTests;

namespace Flowy.App.Tests;

/// <summary>What a line carries and a step sends, as the panels and the player card show it: rows that fold out to the about, the shape and the example (ui/src/Payloads.tsx draws the same).</summary>
public class PayloadPanelTests
{
    private static readonly string LongShape = string.Join("\n", Enumerable.Range(0, 300).Select(i => $"          field{i}: string"));

    private static string Source => $$"""
        payloads:
          basket:
            name: Basket
            about: What the app sends to place an order.
            shape:
              language: typescript
              text: |
        {{LongShape}}
            example:
              language: json
              text: '{ "id": 1 }'
          receipt:
            name: Receipt
            about: What comes back.
        objects:
          shop: { type: system, name: Shop }
          app: { type: app, in: shop, name: App }
          api: { type: app, in: shop, name: API }
        connections:
          - { from: app, to: api, label: REST, payloads: [basket] }
        """;

    private const string Flow = """
        name: Checkout
        view: shop
        steps:
          - { from: app, to: api, text: Places the order, animation: call, payload: basket, reply: receipt }
          - { from: app, to: api, text: Asks for something odd, payload: nope }
        """;

    private static (TempFolder Temp, Window Window, ReaderView Reader) Open(string extraConnection = "")
    {
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(Path.Combine(dir, "flows"));
        File.WriteAllText(Path.Combine(dir, "model.yaml"), Source + extraConnection);
        File.WriteAllText(Path.Combine(dir, "flows", "checkout.yaml"), Flow);
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 900, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        reader.GoTo("shop");
        return (temp, window, reader);
    }

    private static IEnumerable<string> Words(Control root) =>
        root.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text ?? string.Concat(t.Inlines?.OfType<Run>().Select(r => r.Text) ?? [])).Where(t => t != "");

    private static List<Button> Rows(Control root) =>
        [.. root.GetVisualDescendants().OfType<Button>().Where(b => b.Classes.Contains("payload"))];

    [AvaloniaFact]
    public void A_connections_payloads_fold_out_under_it_closed()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenObject("app");
        Settle(window);
        Assert.Equal(["Basket", "Receipt"], Rows(reader.Panel).Select(AutomationProperties.GetName)); // the receipt only the checkout flow sends back, once for the line
        var basket = Rows(reader.Panel)[0];
        Assert.DoesNotContain("What the app sends to place an order.", Words(reader.Panel));
        basket.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
        Settle(window);
        var words = Words(reader.Panel).ToList();
        Assert.Contains("What the app sends to place an order.", words);
        Assert.Contains("Shape", words);
        Assert.Contains("Example", words);
    }

    [AvaloniaFact]
    public void The_line_panel_lists_what_the_line_carries_the_first_open()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenLine("app", "api");
        Settle(window);
        Assert.Equal(["Basket", "Receipt"], Rows(reader.Panel).Select(AutomationProperties.GetName));
        Assert.Contains("PAYLOADS", Words(reader.Panel).Select(w => w.ToUpperInvariant()));
        Assert.Contains("What the app sends to place an order.", Words(reader.Panel)); // the first is open
        Assert.DoesNotContain("What comes back.", Words(reader.Panel));
        var receipt = Rows(reader.Panel)[1].GetVisualAncestors().OfType<StackPanel>().First(p => p.Classes.Contains("payloadrow"));
        Assert.Equal("Checkout, step 1 reply", ToolTip.GetTip(receipt) as string);
    }

    [AvaloniaFact]
    public void A_long_shape_scrolls_inside_240_and_keeps_the_panel_its_width()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.OpenLine("app", "api");
        Settle(window);
        var scroller = reader.Panel.GetVisualDescendants().OfType<ScrollViewer>().First(s => s.Classes.Contains("payloadcode"));
        Assert.Equal(240, scroller.MaxHeight);
        Assert.True(scroller.Bounds.Height <= 240.5);
        Assert.True(reader.Panel.Bounds.Width <= 420, $"the panel is {reader.Panel.Bounds.Width} wide");
    }

    [AvaloniaFact]
    public void A_line_that_runs_both_ways_lists_what_only_steps_send_once()
    {
        var (temp, window, reader) = Open("\n  - { from: api, to: app, label: pushes }\n");
        using var _ = temp;
        reader.OpenObject("app");
        Settle(window);
        Assert.Equal(["Basket", "Receipt"], Rows(reader.Panel).Select(AutomationProperties.GetName)); // Receipt once, not under both the Out and the In row
        Assert.Equal("Comes back", AutomationProperties.GetHelpText(Rows(reader.Panel)[1]));
    }

    [AvaloniaFact]
    public void The_player_card_shows_what_a_step_sends_and_what_comes_back()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.Play("checkout");
        Settle(window);
        var card = window.GetVisualDescendants().OfType<PlayerCard>().First();
        Assert.Equal(["Basket", "Receipt"], Rows(card).Select(AutomationProperties.GetName));
    }

    [AvaloniaFact]
    public void An_unknown_payload_id_draws_nothing()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.Play("checkout", 1);
        Settle(window);
        var card = window.GetVisualDescendants().OfType<PlayerCard>().First();
        Assert.Empty(Rows(card));
    }
}
