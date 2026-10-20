using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>The Data section of a store's panel, as a person reads it: which entries are open, what the grid and the document show, and what the marks say.</summary>
public class DataPanelTests
{
    private const string Model = """
        objects:
          shop:
            type: system
            name: Shop
          orders-db:
            type: store
            in: shop
            name: Orders DB
            tech: Postgres
            data:
              - name: orders
                kind: table
                limits: Kept 7 years, then archived
                note: One row per order. A refund adds a row to refunds; the order stays.
                columns:
                  - {name: id, key: primary}
                  - {name: customer_id, to: customers}
                  - status
                  - {name: total, note: "Cents, not decimals. Rounding broke the first tax run."}
                rows:
                  - [o_1042, c_77, placed, 2490]
                  - [o_1043, c_12, "", 1380]
                  - [o_1044, c_77, "Ring twice, the bell is broken and the courier should leave it with the neighbour in flat 4", 990]
              - name: order_items
                columns: [order_id, item_id]
                limits: Kept with its order
              - name: baskets
                columns: [id, customer_id, items]
          profiles:
            type: store
            in: shop
            name: Restaurant profiles
            data:
              - name: restaurants
                kind: collection
                sample:
                  _id: r_42
                  tags: [ramen, vegan]
                  hours:
                    mon: 11-22
                notes:
                  hours: Hours live inside the profile.
          short:
            type: store
            in: shop
            name: Short row
            data:
              - name: couriers
                columns: [id, name, zone]
                rows:
                  - [k_1, Dana, north]
                  - [k_2, Ola]
          loose:
            type: system
            name: A system with data
            data:
              - name: orders
                columns: [id]
        connections: []
        """;

    private static (TempFolder Temp, ReaderView Reader) Open(string id)
    {
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "model.yaml"), Model);
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        reader.OpenObject(id);
        window.UpdateLayout();
        Dispatcher.UIThread.RunJobs();
        AvaloniaHeadlessPlatform.ForceRenderTimerTick(3);
        Dispatcher.UIThread.RunJobs();
        return (temp, reader);
    }

    /// <summary>The words on show in the panel: a control inside a closed entry is not on show.</summary>
    private static List<string> Shown(ReaderView reader) =>
        reader.Panel.GetVisualDescendants().OfType<TextBlock>().Where(t => t.IsEffectivelyVisible && !string.IsNullOrEmpty(t.Text)).Select(t => t.Text!).ToList();

    private static List<ToggleButton> Heads(ReaderView reader) =>
        reader.Panel.GetVisualDescendants().OfType<ToggleButton>().Where(b => b.Classes.Contains("datahead")).ToList();

    private static void Settle(ReaderView reader)
    {
        reader.UpdateLayout();
        Dispatcher.UIThread.RunJobs();
        AvaloniaHeadlessPlatform.ForceRenderTimerTick(2);
        Dispatcher.UIThread.RunJobs();
    }

    [AvaloniaFact]
    public void A_store_shows_its_first_entry_open_with_its_grid_marks_note_and_limits()
    {
        var (temp, reader) = Open("orders-db");
        using var _ = temp;
        var words = Shown(reader);
        Assert.Contains("DATA", words);
        Assert.Contains("orders", words);
        Assert.Contains("table", words);
        Assert.Contains("Kept 7 years, then archived", words);
        Assert.Contains("One row per order. A refund adds a row to refunds; the order stays.", words);
        foreach (var heading in new[] { "id", "customer_id", "status", "total" }) Assert.Contains(heading, words);
        Assert.Contains("PK", words);
        Assert.Contains("FK customers", words);
        Assert.Contains("o_1042", words);
        Assert.Contains("total", words);
        Assert.Contains("Cents, not decimals. Rounding broke the first tax run.", words);
        Assert.DoesNotContain("4 columns", words); // the count is for a closed entry
    }

    [AvaloniaFact]
    public void The_other_entries_are_one_line_each_until_opened()
    {
        var (temp, reader) = Open("orders-db");
        using var _ = temp;
        var heads = Heads(reader);
        Assert.Equal([true, false, false], heads.Select(h => h.IsChecked == true));
        var words = Shown(reader);
        Assert.Contains("order_items", words);
        Assert.Contains("2 columns", words);
        Assert.Contains("Kept with its order", words);
        Assert.Contains("baskets", words);
        Assert.Contains("3 columns", words);
        Assert.DoesNotContain("item_id", words);

        heads[1].IsChecked = true;
        Settle(reader);
        words = Shown(reader);
        Assert.Contains("item_id", words);
        Assert.DoesNotContain("2 columns", words);
    }

    [AvaloniaFact]
    public void A_document_lists_its_fields_and_a_dot_ties_a_note_to_its_field()
    {
        var (temp, reader) = Open("profiles");
        using var _ = temp;
        var words = Shown(reader);
        Assert.Contains("collection", words);
        Assert.Contains("_id", words);
        Assert.Contains("r_42", words);
        Assert.Contains("[ramen, vegan]", words);
        Assert.Contains("mon", words);
        Assert.Contains("hours", words);
        Assert.Contains("Hours live inside the profile.", words);
    }

    [AvaloniaFact]
    public void A_short_row_is_drawn_with_an_empty_cell_and_a_long_cell_has_its_whole_text_as_the_tip()
    {
        var (temp, reader) = Open("short");
        using var _ = temp;
        Assert.Contains("Ola", Shown(reader));

        var (temp2, reader2) = Open("orders-db");
        using var __ = temp2;
        var longText = "Ring twice, the bell is broken and the courier should leave it with the neighbour in flat 4";
        var cell = reader2.Panel.GetVisualDescendants().OfType<TextBlock>().Single(t => t.Text == longText);
        Assert.Equal(longText, ToolTip.GetTip(cell));
    }

    [AvaloniaFact]
    public void The_grid_is_named_for_screen_readers_and_the_marks_say_what_they_mean()
    {
        var (temp, reader) = Open("orders-db");
        using var _ = temp;
        var descendants = reader.Panel.GetVisualDescendants().ToList();
        Assert.Contains(descendants.OfType<Control>(), c => AutomationProperties.GetName(c) == "orders rows");
        Assert.Contains(descendants.OfType<Control>(), c => ToolTip.GetTip(c) as string == "Primary key");
        Assert.Contains(descendants.OfType<Control>(), c => ToolTip.GetTip(c) as string == "Foreign key to customers");
    }

    [AvaloniaFact]
    public void Only_a_store_has_the_section()
    {
        var (temp, reader) = Open("loose");
        using var _ = temp;
        Assert.DoesNotContain("DATA", Shown(reader));
        Assert.Empty(Heads(reader));
    }
}
