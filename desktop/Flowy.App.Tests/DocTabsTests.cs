using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>The tabs of a window, on small models: one window holds many models, and a sketch sits beside its model.</summary>
public class DocTabsTests
{
    private const string Plain = "objects:\n  thing:\n    type: system\n    name: Thing\nconnections: []\n";

    /// <summary>A repo with a model in flowy/, with the sketches named. Returns the model folder.</summary>
    private static string Model(TempFolder temp, string repo, string? name, params string[] sketches)
    {
        var model = Path.Combine(temp.Path, repo, "flowy");
        Directory.CreateDirectory(model);
        File.WriteAllText(Path.Combine(model, "model.yaml"), (name is null ? "" : $"name: {name}\n") + Plain);
        foreach (var sketch in sketches) Sketches.Create(model, sketch);
        return model;
    }

    private static string Sketch(string model, string id) => Sketches.DirOf(model, id);

    private static void Settle(Window window) => EditModeTests.Settle(window);

    private static List<TabPlace> Places(params string[] keys) => [.. keys.Select(k => k.Split('/') is [var owner, var key] ? new TabPlace(key, owner) : new TabPlace(k, null))];

    [Fact]
    public void A_sketch_goes_after_the_last_tab_of_its_models_group()
    {
        var tabs = Places("a", "a/s", "b");
        Assert.Equal(2, TabGroups.InsertAt(tabs, new TabPlace("t", "a")));
        Assert.Equal(3, TabGroups.InsertAt(tabs, new TabPlace("t", "b")));
    }

    [Fact]
    public void A_model_goes_in_front_of_its_open_sketches_and_anything_else_at_the_end()
    {
        var tabs = Places("a", "b/s", "c");
        Assert.Equal(1, TabGroups.InsertAt(tabs, new TabPlace("b", null)));
        Assert.Equal(3, TabGroups.InsertAt(tabs, new TabPlace("d", null)));
        Assert.Equal(3, TabGroups.InsertAt(tabs, new TabPlace("t", "d")));
    }

    [Fact]
    public void The_tab_before_in_the_group_takes_over_else_the_next_else_the_one_before()
    {
        var tabs = Places("a", "a/s", "b", "c");
        Assert.Equal(0, TabGroups.Heir(tabs, 1));
        Assert.Equal(3, TabGroups.Heir(tabs, 2));
        Assert.Equal(1, TabGroups.Heir(tabs, 0));
        Assert.Equal(2, TabGroups.Heir(tabs, 3));
        Assert.Equal(-1, TabGroups.Heir(Places("a"), 0));
    }

    [Fact]
    public void A_model_takes_its_sketches_to_another_window_and_a_sketch_goes_alone()
    {
        var tabs = Places("a", "a/s", "b");
        Assert.Equal(["a", "s"], tabs.Where(t => TabGroups.TravelsWith(tabs[0], t)).Select(t => t.Key));
        Assert.Equal(["s"], tabs.Where(t => TabGroups.TravelsWith(tabs[1], t)).Select(t => t.Key));
    }

    [AvaloniaFact]
    public void A_second_model_opens_in_a_tab_of_the_same_window_and_opening_it_again_adds_none()
    {
        TestApp.NoMotion();
        using var temp = new TempFolder();
        var plum = Model(temp, "plum", "Plum");
        var other = Model(temp, "other", "Other");
        var shell = new Shell(null);
        var window = shell.Show(plum);
        Assert.Same(window, shell.Show(other));
        Assert.Same(window, shell.Show(plum));
        Assert.Single(shell.Windows);
        Assert.Equal([["Plum"], ["Other"]], window.Strip.GroupsShown);
        Assert.Equal("Plum", window.Strip.ActiveShown);
        Assert.Equal(plum, window.Dir);
        Assert.Equal("plum - Flowy Docs", window.Title);
        window.Close();
        Assert.Empty(shell.Windows);
    }

    [AvaloniaFact]
    public void A_sketch_opens_beside_its_model_whichever_tab_asked()
    {
        TestApp.NoMotion();
        using var temp = new TempFolder();
        var plum = Model(temp, "plum", "Plum", "Group orders", "Embedded");
        var other = Model(temp, "other", "Other");
        var shell = new Shell(null);
        var window = shell.Show(plum);
        shell.Show(other);
        Assert.Same(window, shell.Show(Sketch(plum, "group-orders")));
        shell.Show(Sketch(plum, "embedded"));
        Assert.Equal([["Plum", "Group orders", "Embedded"], ["Other"]], window.Strip.GroupsShown);
        Assert.Equal("Embedded", window.Strip.ActiveShown);
        window.Close();
    }

    [AvaloniaFact]
    public async Task A_row_of_the_Sketches_group_and_the_name_on_a_sketchs_bar_stay_in_the_window()
    {
        TestApp.NoMotion();
        using var temp = new TempFolder();
        var plum = Model(temp, "plum", "Plum", "Group orders");
        var shell = new Shell(null);
        var window = shell.Show(plum);
        window.Reader.ClickRail(PanelTab.Explorer);
        await window.Reader.Settled;
        Settle(window);
        window.Reader.SketchesGroup.PressRow("Group orders");
        Assert.Single(shell.Windows);
        Assert.Equal([["Plum", "Group orders"]], window.Strip.GroupsShown);
        Assert.Equal("Plum", window.Reader.SketchOwner);
        window.Reader.PressOwner();
        Assert.Equal("Plum", window.Strip.ActiveShown);
        window.Close();
    }

    [AvaloniaFact]
    public void Keys_go_to_the_tab_on_show()
    {
        TestApp.NoMotion();
        using var temp = new TempFolder();
        var plum = Model(temp, "plum", "Plum");
        var other = Model(temp, "other", "Other");
        var shell = new Shell(null);
        var window = shell.Show(plum);
        var first = window.Reader;
        shell.Show(other);
        var second = window.Reader;
        Assert.NotSame(first, second);
        Assert.False(first.IsVisible);
        Assert.True(second.IsVisible);
        Settle(window);
        EditModeTests.Press(window, Key.E, PhysicalKey.E);
        Settle(window);
        Assert.False(first.Editing);
        Assert.True(second.Editing);
        window.Strip.Press("Plum");
        Assert.True(first.IsVisible);
        Assert.False(second.IsVisible);
        Assert.Same(first, window.Reader);
        Assert.True(second.Editing); // a tab is as it was left
        window.Close();
    }

    [AvaloniaFact]
    public void Ctrl_Tab_goes_along_the_row_and_round_and_Shift_goes_back()
    {
        TestApp.NoMotion();
        using var temp = new TempFolder();
        var shell = new Shell(null);
        var window = shell.Show(Model(temp, "a", "A"));
        shell.Show(Model(temp, "b", "B"));
        shell.Show(Model(temp, "c", "C"));
        Settle(window);
        Assert.Equal("C", window.Strip.ActiveShown);
        EditModeTests.Press(window, Key.Tab, PhysicalKey.Tab, Avalonia.Input.RawInputModifiers.Control);
        Assert.Equal("A", window.Strip.ActiveShown);
        EditModeTests.Press(window, Key.Tab, PhysicalKey.Tab, Avalonia.Input.RawInputModifiers.Control | Avalonia.Input.RawInputModifiers.Shift);
        Assert.Equal("C", window.Strip.ActiveShown);
        window.Close();
    }

    [AvaloniaFact]
    public void Closing_a_sketch_goes_back_to_its_model()
    {
        TestApp.NoMotion();
        using var temp = new TempFolder();
        var plum = Model(temp, "plum", "Plum", "Group orders");
        var shell = new Shell(null);
        var window = shell.Show(plum);
        shell.Show(Model(temp, "other", "Other"));
        shell.Show(Sketch(plum, "group-orders"));
        window.Strip.PressClose("Group orders");
        Assert.Equal("Plum", window.Strip.ActiveShown);
        Assert.Equal([["Plum"], ["Other"]], window.Strip.GroupsShown);
        window.Close();
    }

    [AvaloniaFact]
    public void Closing_a_model_leaves_its_sketch_open_saying_whose_it_is()
    {
        TestApp.NoMotion();
        using var temp = new TempFolder();
        var plum = Model(temp, "plum", "Plum", "Group orders");
        var shell = new Shell(null);
        var window = shell.Show(plum);
        shell.Show(Sketch(plum, "group-orders"));
        window.Strip.PressClose("Plum");
        Assert.Equal([["Group orders (sketch of Plum)"]], window.Strip.GroupsShown);
        shell.Show(plum); // it comes back in front of its sketch
        Assert.Equal([["Plum", "Group orders"]], window.Strip.GroupsShown);
        window.Close();
    }

    [AvaloniaFact]
    public void Closing_the_last_tab_brings_the_welcome_back_and_the_window_takes_the_next_folder()
    {
        TestApp.NoMotion();
        using var temp = new TempFolder();
        var plum = Model(temp, "plum", "Plum");
        var shell = new Shell(null);
        var window = shell.Show(plum);
        window.CloseActiveTab();
        Assert.True(window.IsVisible);
        Assert.True(window.WelcomeShown);
        Assert.False(window.Strip.IsVisible);
        Assert.Null(window.Dir);
        Assert.Equal("Flowy Docs", window.Title);
        Assert.Empty(shell.Windows);
        window.Open(plum);
        Assert.False(window.WelcomeShown);
        Assert.Equal(plum, window.Dir);
        window.Close();
    }

    [AvaloniaFact]
    public void Move_to_New_Window_takes_a_model_with_its_sketches_and_the_tab_stays_as_it_was()
    {
        TestApp.NoMotion();
        using var temp = new TempFolder();
        var plum = Model(temp, "plum", "Plum", "Group orders");
        var other = Model(temp, "other", "Other");
        var shell = new Shell(null);
        var window = shell.Show(plum);
        var reader = window.Reader;
        shell.Show(Sketch(plum, "group-orders"));
        shell.Show(other);
        var moved = shell.MoveToNewWindow(window, [.. window.Tabs.Where(t => TabGroups.TravelsWith(window.Tabs[0].Place, t.Place))]);
        Assert.NotSame(window, moved);
        Assert.Equal([["Other"]], window.Strip.GroupsShown);
        Assert.Equal([["Plum", "Group orders"]], moved.Strip.GroupsShown);
        Assert.Contains(reader, moved.Tabs.Select(t => t.Reader));
        Assert.Same(moved, shell.Show(plum)); // the shell knows where it went
        moved.Close();
        Assert.Single(shell.Windows);
        Assert.Same(window, shell.Show(other));
        window.Close();
    }

    [AvaloniaFact]
    public void A_sketch_moved_away_from_its_model_says_whose_it_is_and_a_new_sketch_follows_the_model()
    {
        TestApp.NoMotion();
        using var temp = new TempFolder();
        var plum = Model(temp, "plum", "Plum", "Group orders", "Embedded");
        var shell = new Shell(null);
        var window = shell.Show(plum);
        shell.Show(Sketch(plum, "group-orders"));
        var sketch = window.Tabs[1];
        var moved = shell.MoveToNewWindow(window, [sketch]);
        Assert.Equal([["Group orders (sketch of Plum)"]], moved.Strip.GroupsShown);
        Assert.Same(window, shell.Show(Sketch(plum, "embedded"), null, moved));
        moved.Close();
        window.Close();
    }

    [AvaloniaFact]
    public void The_menu_cannot_move_everything_out_of_a_window()
    {
        TestApp.NoMotion();
        using var temp = new TempFolder();
        var plum = Model(temp, "plum", "Plum", "Group orders");
        var shell = new Shell(null);
        var window = shell.Show(plum);
        shell.Show(Sketch(plum, "group-orders"));
        Assert.False(MoveItem(window, "Plum").IsEnabled); // it would take the sketch too
        Assert.True(MoveItem(window, "Group orders").IsEnabled);
        window.Close();
    }

    private static MenuItem MoveItem(MainWindow window, string name) => window.Strip.MenuOf(name).Items.OfType<MenuItem>().First(i => (string?)i.Header == "Move to New Window");

    [AvaloniaFact]
    public async Task A_name_changed_on_disk_changes_the_tab()
    {
        TestApp.NoMotion();
        using var temp = new TempFolder();
        var plum = Model(temp, "plum", "Plum");
        var shell = new Shell(null);
        var window = shell.Show(plum);
        File.WriteAllText(Path.Combine(plum, "model.yaml"), "name: Plum two\n" + Plain);
        await window.Tabs[0].ReloadAsync();
        Assert.Equal([["Plum two"]], window.Strip.GroupsShown);
        window.Close();
    }

    [AvaloniaFact]
    public void A_model_with_no_name_is_called_after_its_repo()
    {
        TestApp.NoMotion();
        using var temp = new TempFolder();
        var window = new Shell(null).Show(Model(temp, "my-repo", null));
        Assert.Equal([["my-repo"]], window.Strip.GroupsShown);
        window.Close();
    }

    [AvaloniaFact]
    public void A_flow_playing_pauses_when_its_tab_goes_out_of_sight()
    {
        TestApp.NoMotion();
        using var temp = new TempFolder();
        var plum = Model(temp, "plum", "Plum");
        File.WriteAllText(Path.Combine(plum, "model.yaml"), "name: Plum\nobjects:\n  a: { type: system, name: A }\n  b: { type: system, name: B }\nconnections:\n  - { from: a, to: b, label: calls }\n");
        Directory.CreateDirectory(Path.Combine(plum, "flows"));
        File.WriteAllText(Path.Combine(plum, "flows", "go.yaml"), "name: Go\nview: root\nsteps:\n  - { from: a, to: b, text: calls }\n");
        var shell = new Shell(null);
        var window = shell.Show(plum);
        Settle(window);
        var reader = window.Reader;
        reader.Play("go", 0);
        Settle(window);
        Assert.False(reader.FlowPaused);
        shell.Show(Model(temp, "other", "Other"));
        Assert.True(reader.FlowPaused);
        window.Close();
    }
}
