using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Interactivity;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>Where the keyboard goes, and what shows it: Esc peels one layer, a click never draws a keyboard cue, and code that moves the focus saves nothing.</summary>
public class FocusTests
{
    private const string Model = """
        objects:
          shop:
            type: system
            name: Shop
          api:
            type: service
            in: shop
            name: Order API
        connections: []
        """;

    private static (TempFolder Temp, string Dir, Window Window, ReaderView Reader) OpenEditing(string id)
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
        reader.GoTo("shop");
        reader.OpenObject(id);
        EditModeTests.Settle(window);
        return (temp, dir, window, reader);
    }

    private static (Window Window, ReaderView Reader) OpenPlum()
    {
        var dir = Path.Combine(Repo.Root, "docs", "demo", "flowy");
        var reader = new ReaderView();
        var window = new Window { Width = 1100, Height = 700, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        return (window, reader);
    }

    private static void Esc(Window w) => EditModeTests.Press(w, Key.Escape, PhysicalKey.Escape);

    private static IInputElement? Focused(Window w) => w.FocusManager?.GetFocusedElement();

    private static string FileText(string dir) => File.ReadAllText(Path.Combine(dir, "model.yaml"));

    [AvaloniaFact]
    public void Esc_in_a_field_takes_back_the_typing_then_leaves_the_field_then_closes_the_panel()
    {
        var (temp, dir, window, reader) = OpenEditing("api");
        using var _ = temp;
        var before = FileText(dir);
        var name = reader.Panel.CurrentObjectEditor!.NameField;
        name.Box.Focus(NavigationMethod.Pointer);
        name.Text = "Half typed";

        Esc(window);
        Assert.Equal("Order API", name.Text);
        Assert.Same(name.Box, Focused(window));

        Esc(window);
        Assert.Same(reader, Focused(window));
        Assert.True(reader.HasPanel);

        Esc(window);
        Assert.False(reader.HasPanel);
        EditModeTests.Settle(window);
        Assert.Equal(before, FileText(dir));
    }

    [AvaloniaFact]
    public async Task A_field_saves_when_the_reader_moves_on_but_not_when_code_moves_the_focus()
    {
        var (temp, dir, window, reader) = OpenEditing("api");
        using var _ = temp;
        var before = FileText(dir);
        var name = reader.Panel.CurrentObjectEditor!.NameField;
        name.Box.Focus(NavigationMethod.Pointer);
        name.Text = "Not yet";
        reader.Focus(); // code, as when a panel hands the keyboard back
        EditModeTests.Settle(window);
        Assert.Equal(before, FileText(dir));

        name.Box.Focus(NavigationMethod.Pointer);
        name.Text = "Orders";
        reader.Focus(NavigationMethod.Pointer); // a click on the diagram
        await EditModeTests.Until(() => FileText(dir).Contains("name: Orders"));
    }

    [AvaloniaFact]
    public async Task A_press_on_the_diagram_saves_a_field_with_the_caret_in_it_and_takes_the_keyboard_out()
    {
        var (temp, dir, window, reader) = OpenEditing("api");
        using var _ = temp;
        var name = reader.Panel.CurrentObjectEditor!.NameField;
        name.Box.Focus(NavigationMethod.Pointer);
        name.Text = "Orders";
        var blank = new Point(120, 700); // the diagram, away from every shape and from the panel
        window.MouseDown(blank, MouseButton.Left);
        window.MouseUp(blank, MouseButton.Left);
        Assert.False(name.Box.IsFocused);
        await EditModeTests.Until(() => FileText(dir).Contains("name: Orders", StringComparison.Ordinal));
    }

    [AvaloniaFact]
    public void The_keyboard_stays_on_the_player_button_it_was_on_when_the_card_is_built_again()
    {
        var (window, reader) = OpenPlum();
        reader.OpenFlowById("deliver-order");
        EditModeTests.Settle(window);
        Button Next() => reader.Card.Laid().GetVisualDescendants().OfType<Button>().First(b => Avalonia.Automation.AutomationProperties.GetName(b) == "Next");
        var before = Next();
        Assert.True(before.Focus(NavigationMethod.Tab));
        before.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent)); // a step: the card is made again
        EditModeTests.Settle(window);
        var after = Next();
        Assert.NotSame(before, after);
        Assert.Same(after, Focused(window));
    }

    [AvaloniaFact]
    public void The_keyboard_stays_on_a_folder_of_the_flows_list_when_it_folds()
    {
        var (window, reader) = OpenPlum();
        reader.ClickRail(PanelTab.Flows);
        EditModeTests.Settle(window);
        var flows = reader.Navigator.Flows;
        Button Folder() => flows.GetVisualDescendants().OfType<Button>().First(b => b.Tag is string tag && tag.StartsWith("folder:", StringComparison.Ordinal));
        var folder = Folder();
        var tag = (string)folder.Tag!;
        Assert.True(folder.Focus(NavigationMethod.Tab));
        folder.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
        EditModeTests.Settle(window);
        Assert.Same(flows.GetVisualDescendants().OfType<Button>().First(b => b.Tag as string == tag), Focused(window));
    }

    [AvaloniaFact]
    public void Ctrl_K_with_search_open_keeps_the_query_and_selects_it()
    {
        var (window, reader) = OpenPlum();
        reader.OpenSearch("refund");
        var box = reader.SearchNow;
        EditModeTests.Settle(window);
        reader.OpenSearch();
        Assert.Same(box, reader.SearchNow);
        Assert.Equal("refund", box!.Query);
    }

    [AvaloniaFact]
    public void The_tab_cue_of_a_box_is_not_the_selected_look()
    {
        var (window, reader) = OpenPlum();
        EditModeTests.Settle(window);
        var box = reader.Canvas.GetVisualDescendants().OfType<Flowy.App.Canvas.BoxControl>().First(b => b.IsVisible);
        Assert.True(box.Focus(NavigationMethod.Tab));
        var outline = box.GetVisualDescendants().OfType<Avalonia.Controls.Shapes.Path>().First(p => p.Classes.Contains("outline"));
        Assert.NotNull(outline.StrokeDashArray); // dashed, where a picked box is solid
        Assert.NotEmpty(outline.StrokeDashArray!);
    }

    [AvaloniaFact]
    public void The_opacity_halo_shows_for_Tab_and_not_for_a_click()
    {
        var (temp, _, window, reader) = OpenEditing("api");
        using var _ = temp;
        var bar = reader.Panel.CurrentObjectEditor!.OpacityBar;
        bar.Focus(NavigationMethod.Pointer);
        Assert.False(bar.Halo);
        reader.Focus();
        bar.Focus(NavigationMethod.Tab);
        Assert.True(bar.Halo);
        reader.Focus();
        Assert.False(bar.Halo);
    }

    [AvaloniaFact]
    public void Esc_in_the_icon_filter_empties_it_first_then_closes_the_grid()
    {
        var (temp, _, window, reader) = OpenEditing("api");
        using var _ = temp;
        var icons = reader.Panel.CurrentObjectEditor!.IconChoice;
        icons.Open(true);
        EditModeTests.Settle(window);
        icons.FilterBox.Text = "cart";
        Esc(window);
        Assert.True(icons.IsOpen);
        Assert.Equal("", icons.FilterBox.Text);
        Esc(window);
        Assert.False(icons.IsOpen);
        Assert.Same(icons.Row, Focused(window));
    }

    [AvaloniaFact]
    public void Esc_in_search_empties_the_field_first_and_a_press_outside_closes_it()
    {
        var (window, reader) = OpenPlum();
        EditModeTests.Press(window, Key.K, PhysicalKey.K, RawInputModifiers.Control);
        Dispatcher.UIThread.RunJobs(); // the field takes the focus once it is on screen
        window.KeyTextInput("refunds");
        Esc(window);
        Assert.True(reader.SearchOpen);
        Esc(window);
        Assert.False(reader.SearchOpen);

        EditModeTests.Press(window, Key.K, PhysicalKey.K, RawInputModifiers.Control);
        Dispatcher.UIThread.RunJobs();
        window.MouseDown(new Point(550, 650), MouseButton.Left);
        window.MouseUp(new Point(550, 650), MouseButton.Left);
        Assert.False(reader.SearchOpen);
    }

    [AvaloniaFact]
    public void The_tree_ring_shows_for_keys_and_goes_with_a_click()
    {
        var (window, reader) = OpenPlum();
        reader.ClickRail(PanelTab.Explorer);
        EditModeTests.Settle(window);
        var explorer = reader.Navigator.Explorer;
        Assert.True(explorer.List.ContainerFromIndex(0)!.Focus(NavigationMethod.Tab)); // Tab lands on a row
        Assert.True(explorer.KeyRing);

        var row = explorer.List.GetRealizedContainers().Skip(2).First();
        var at = row.TranslatePoint(new Point(40, row.Bounds.Height / 2), window)!.Value;
        window.MouseDown(at, MouseButton.Left);
        window.MouseUp(at, MouseButton.Left);
        Assert.False(explorer.KeyRing);

        EditModeTests.Settle(window);
        Assert.True(explorer.Holds(Focused(window))); // the row drawn again keeps the keyboard
        EditModeTests.Press(window, Key.Down, PhysicalKey.ArrowDown);
        Assert.True(explorer.KeyRing);
    }

    [AvaloniaFact]
    public void Esc_on_a_new_draft_name_puts_the_keyboard_back_on_New()
    {
        using var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "model.yaml"), Model);
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        reader.ClickRail(PanelTab.Explorer);
        EditModeTests.Settle(window);
        var group = reader.DraftsGroup;
        group.PressNew();
        EditModeTests.Settle(window);
        Assert.Same(group.NameBox, Focused(window));
        Esc(window);
        EditModeTests.Settle(window);
        Assert.False(group.Naming);
        Assert.Same(group.NewButton, Focused(window));
    }

    [AvaloniaFact]
    public void Tab_skips_the_reader_itself()
    {
        var reader = new ReaderView();
        Assert.True(reader.Focusable);
        Assert.False(reader.IsTabStop);
    }
}
