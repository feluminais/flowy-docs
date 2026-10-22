using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Media;
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
                  - {name: id, type: uuid, key: primary}
                  - {name: customer_id, to: customers}
                  - {name: status, type: "text?"}
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
          wide:
            type: store
            in: shop
            name: Long names
            data:
              - name: snapshot_of_every_archived_line_2024_q3_with_a_very_long_name
                limits: Kept 7 years, then archived
                columns: [id]
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

    /// <summary>The same model in edit mode, with the form of one box open: the box's id, and where it sits (the shop, or the top level).</summary>
    private static (TempFolder Temp, string Dir, Window Window, ReaderView Reader) OpenEditing(string id, bool inShop = true)
    {
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "model.yaml"), Model);
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        reader.SetEditing(true);
        if (inShop) reader.GoTo("shop");
        reader.OpenObject(id);
        EditModeTests.Settle(window);
        return (temp, dir, window, reader);
    }

    private static string FileText(string dir) => File.ReadAllText(Path.Combine(dir, "model.yaml"));

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
        Assert.Contains("uuid", words); // a type sits under its column's name
        Assert.Contains("text", words);
        Assert.Contains("NULL", words); // "text?" can be empty
        Assert.Contains("o_1042", words);
        Assert.Contains("total", words);
        Assert.Contains("Cents, not decimals. Rounding broke the first tax run.", words);
        Assert.DoesNotContain("4 columns", words); // the count is for a closed entry
    }

    [AvaloniaFact]
    public void A_column_note_is_purple_the_colour_of_knowledge_and_not_the_warning_amber()
    {
        var (temp, reader) = Open("orders-db");
        using var _ = temp;
        Color Theme(string key) =>
            Application.Current!.TryGetResource(key, reader.ActualThemeVariant, out var found) ? Assert.IsAssignableFrom<ISolidColorBrush>(found).Color : throw new InvalidOperationException(key);
        var note = reader.Panel.GetVisualDescendants().OfType<TextBlock>().Single(t => t.Text == "Cents, not decimals. Rounding broke the first tax run.");
        Assert.Equal(Theme("KnowFgBrush"), Assert.IsAssignableFrom<ISolidColorBrush>(note.Foreground).Color);
        Assert.NotEqual(Theme("WarnFgBrush"), Theme("KnowFgBrush"));
        var dot = reader.Panel.GetVisualDescendants().OfType<Avalonia.Controls.Shapes.Ellipse>().First(e => e.Classes.Contains("datadot"));
        Assert.Equal(Theme("KnowBrush"), Assert.IsAssignableFrom<ISolidColorBrush>(dot.Fill).Color);
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
    public void A_long_entry_name_wraps_and_never_runs_under_the_limits()
    {
        var (temp, reader) = Open("wide");
        using var _ = temp;
        var texts = reader.Panel.GetVisualDescendants().OfType<TextBlock>().ToList();
        var name = texts.Single(t => t.Text == "snapshot_of_every_archived_line_2024_q3_with_a_very_long_name");
        var limits = texts.Single(t => t.Text == "Kept 7 years, then archived");
        var nameRight = name.TranslatePoint(new Avalonia.Point(name.Bounds.Width, 0), reader.Panel)!.Value.X;
        var limitsLeft = limits.TranslatePoint(new Avalonia.Point(0, 0), reader.Panel)!.Value.X;
        Assert.True(nameRight <= limitsLeft + 0.5, $"the name ends at {nameRight}, the limits start at {limitsLeft}");
    }

    [AvaloniaFact]
    public void An_entry_the_reader_opened_stays_open_when_the_panel_is_drawn_again()
    {
        var (temp, reader) = Open("orders-db");
        using var _ = temp;
        Heads(reader)[2].IsChecked = true;
        Heads(reader)[0].IsChecked = false;
        Settle(reader);
        reader.OpenObject("orders-db"); // what a changed file or a new theme does: the panel is built again
        Settle(reader);
        Assert.Equal([false, false, true], Heads(reader).Select(h => h.IsChecked == true));
    }

    [AvaloniaFact]
    public void Only_a_store_has_the_section()
    {
        var (temp, reader) = Open("loose");
        using var _ = temp;
        Assert.DoesNotContain("DATA", Shown(reader));
        Assert.Empty(Heads(reader));
    }

    [AvaloniaFact]
    public async Task The_box_holds_the_lines_the_file_holds_and_a_change_is_saved_with_its_row_on_one_line()
    {
        var (temp, dir, _, reader) = OpenEditing("orders-db");
        using var _ = temp;
        var form = reader.Panel.CurrentObjectEditor!;
        Assert.StartsWith("- name: orders\n  kind: table\n  limits: Kept 7 years, then archived\n", form.DataField.Text);
        Assert.Contains("    - [o_1042, c_77, placed, 2490]\n", form.DataField.Text);
        form.DataField.Text = form.DataField.Text.Replace("c_77, placed", "c_77, cancelled");
        await form.DataField.Commit();
        await EditModeTests.Until(() => FileText(dir).Contains("cancelled"));
        Assert.Contains("          - [o_1042, c_77, cancelled, 2490]\n", FileText(dir));
    }

    [AvaloniaFact]
    public async Task Broken_text_and_a_short_row_are_refused_with_the_reason_and_the_typed_text_stays()
    {
        var (temp, dir, _, reader) = OpenEditing("orders-db");
        using var _ = temp;
        var form = reader.Panel.CurrentObjectEditor!;
        var before = FileText(dir);

        form.DataField.Text = "- [a";
        await form.DataField.Commit();
        Assert.StartsWith("data", reader.NoticeText);
        Assert.Equal("- [a", form.DataField.Text);
        Assert.Equal(before, FileText(dir));

        form.DataField.Text = "- name: x\n  columns: [a, b]\n  rows:\n    - [1]\n";
        await form.DataField.Commit();
        Assert.Contains("row 1 has 1 cell but there are 2 columns", reader.NoticeText);
        Assert.StartsWith("- name: x", form.DataField.Text);
        Assert.Equal(before, FileText(dir));
    }

    [AvaloniaFact]
    public async Task Text_with_only_comments_is_refused_like_any_data_that_is_not_a_list_and_stays()
    {
        var (temp, dir, _, reader) = OpenEditing("orders-db");
        using var _ = temp;
        var form = reader.Panel.CurrentObjectEditor!;
        var before = FileText(dir);
        form.DataField.Text = "# nothing here";
        await form.DataField.Commit();
        Assert.Contains("data must be a list of entries", reader.NoticeText);
        Assert.Equal("# nothing here", form.DataField.Text);
        Assert.Equal(before, FileText(dir));
    }

    [AvaloniaFact]
    public async Task Blank_text_removes_the_data_and_undo_brings_it_back()
    {
        var (temp, dir, window, reader) = OpenEditing("orders-db");
        using var _ = temp;
        var form = reader.Panel.CurrentObjectEditor!;
        form.DataField.Text = "";
        await form.DataField.Commit();
        await EditModeTests.Until(() => reader.Folder!.Model.GetObject("orders-db")!.Data is null);
        Assert.DoesNotContain("name: order_items", FileText(dir));

        window.Focus();
        EditModeTests.Press(window, Key.Z, PhysicalKey.Z, RawInputModifiers.Control);
        await EditModeTests.Until(() => reader.Folder!.Model.GetObject("orders-db")!.Data is not null);
        Assert.Contains("name: order_items", FileText(dir));
    }

    [AvaloniaFact]
    public void A_store_has_the_data_box_and_a_system_has_none_unless_it_holds_data_that_must_go()
    {
        var (temp, _, _, store) = OpenEditing("orders-db");
        using var _ = temp;
        Assert.True(store.Panel.CurrentObjectEditor!.DataField.IsEffectivelyVisible);

        var (temp2, _, _, plain) = OpenEditing("shop", inShop: false);
        using var __ = temp2;
        Assert.False(plain.Panel.CurrentObjectEditor!.DataField.IsEffectivelyVisible);

        var (temp3, _, _, loose) = OpenEditing("loose", inShop: false);
        using var ___ = temp3;
        Assert.True(loose.Panel.CurrentObjectEditor!.DataField.IsEffectivelyVisible);
    }
}
