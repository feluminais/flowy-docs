using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>The Sketches group under the Explorer's tree, New sketch, and the Sketch mark on the bar of a sketch, on small models.</summary>
public class SketchesTests
{
    private const string Plain = "objects:\n  thing:\n    type: system\n    name: Thing\nconnections: []\n";

    /// <summary>A repo with a model called Plum in flowy/ and, when <paramref name="sketch"/> is not null, a sketch of that name in it. Returns the model folder.</summary>
    private static string Setup(TempFolder temp, string? sketch = "Group orders")
    {
        var model = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(model);
        File.WriteAllText(Path.Combine(model, "model.yaml"), "name: Plum\n" + Plain);
        if (sketch is not null) Sketches.Create(model, sketch);
        return model;
    }

    private static async Task<ReaderView> Open(string dir, bool explorer = true)
    {
        TestApp.NoMotion();
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        if (explorer) reader.ClickRail(PanelTab.Explorer);
        await reader.Settled;
        AvaloniaHeadlessPlatform.ForceRenderTimerTick(3);
        Dispatcher.UIThread.RunJobs();
        return reader;
    }

    [AvaloniaFact]
    public async Task The_group_lists_the_sketches_with_their_count()
    {
        using var temp = new TempFolder();
        var model = Setup(temp);
        Sketches.Create(model, "Another idea");
        var reader = await Open(model);
        Assert.True(reader.SketchesGroup.IsVisible);
        Assert.Equal(["Another idea", "Group orders"], reader.SketchesGroup.RowNames);
        Assert.Equal("2", reader.SketchesGroup.CountText);
        Assert.False(reader.SketchesGroup.NoSketchesShown);
        Assert.True(reader.SketchesGroup.NewButton.IsEnabled);
    }

    [AvaloniaFact]
    public async Task A_sketch_kept_in_the_old_drafts_folder_is_listed_and_opened_from_there()
    {
        using var temp = new TempFolder();
        var model = Setup(temp, sketch: null);
        Directory.CreateDirectory(Path.Combine(model, "drafts", "old-idea"));
        File.WriteAllText(Path.Combine(model, "drafts", "old-idea", "model.yaml"), "name: Old idea\n" + Plain);
        var reader = await Open(model);
        Assert.Equal(["Old idea"], reader.SketchesGroup.RowNames);
        var asked = new List<string>();
        reader.ModelPicked += asked.Add;
        reader.SketchesGroup.PressRow("Old idea");
        Assert.Equal([Path.Combine(model, "drafts", "old-idea")], asked);
        var inside = await Open(asked[0]);
        Assert.Equal("Plum", inside.SketchOwner);
        Assert.False(inside.SketchesGroup.IsVisible);
    }

    [AvaloniaFact]
    public async Task With_no_sketches_the_group_says_so_above_the_button()
    {
        using var temp = new TempFolder();
        var reader = await Open(Setup(temp, sketch: null));
        Assert.True(reader.SketchesGroup.IsVisible);
        Assert.Empty(reader.SketchesGroup.RowNames);
        Assert.Equal("0", reader.SketchesGroup.CountText);
        Assert.True(reader.SketchesGroup.NoSketchesShown);
    }

    [AvaloniaFact]
    public async Task A_row_asks_for_the_sketch_in_a_window_of_its_own()
    {
        using var temp = new TempFolder();
        var model = Setup(temp);
        var reader = await Open(model);
        var asked = new List<string>();
        reader.ModelPicked += asked.Add;
        reader.SketchesGroup.PressRow("Group orders");
        Assert.Equal([Sketches.DirOf(model, "group-orders")], asked);
    }

    [AvaloniaFact]
    public async Task New_sketch_asks_for_a_name_and_Add_makes_the_sketch_and_opens_it()
    {
        using var temp = new TempFolder();
        var model = Setup(temp, sketch: null);
        var reader = await Open(model);
        var asked = new List<string>();
        reader.ModelPicked += asked.Add;
        var group = reader.SketchesGroup;
        Assert.False(group.Naming);
        group.PressNew();
        Assert.True(group.Naming);
        Assert.False(group.NoSketchesShown);
        Assert.False(group.AddButton.IsEnabled); // nothing typed yet
        group.NameBox.Text = "Ünïcode Café";
        Dispatcher.UIThread.RunJobs(); // the box reports a change a moment later
        Assert.True(group.AddButton.IsEnabled);
        group.PressAdd();
        var made = Sketches.DirOf(model, "unicode-cafe");
        Assert.Equal([made], asked);
        Assert.Equal("name: Ünïcode Café\npairs: separate\nobjects: {}\nconnections: []\n", File.ReadAllText(Path.Combine(made, "model.yaml")).Replace("\r\n", "\n"));
        Assert.False(group.Naming);
    }

    [AvaloniaFact]
    public async Task Enter_in_the_name_field_adds_and_Escape_cancels()
    {
        using var temp = new TempFolder();
        var model = Setup(temp, sketch: null);
        var reader = await Open(model);
        var asked = new List<string>();
        reader.ModelPicked += asked.Add;
        var group = reader.SketchesGroup;
        group.PressNew();
        group.NameBox.Text = "Kept out";
        group.NameBox.RaiseEvent(new KeyEventArgs { RoutedEvent = InputElement.KeyDownEvent, Key = Key.Escape });
        Assert.False(group.Naming);
        Assert.Empty(asked);
        Assert.False(Directory.Exists(Path.Combine(model, "sketches")));
        group.PressNew();
        Assert.Equal("", group.NameBox.Text); // Cancel leaves nothing typed behind
        group.NameBox.Text = "Kept in";
        group.NameBox.RaiseEvent(new KeyEventArgs { RoutedEvent = InputElement.KeyDownEvent, Key = Key.Enter });
        Assert.Equal([Sketches.DirOf(model, "kept-in")], asked);
    }

    [AvaloniaFact]
    public async Task Cancel_closes_the_field_and_makes_nothing()
    {
        using var temp = new TempFolder();
        var model = Setup(temp, sketch: null);
        var reader = await Open(model);
        var group = reader.SketchesGroup;
        group.PressNew();
        group.NameBox.Text = "Nope";
        group.PressCancel();
        Assert.False(group.Naming);
        Assert.True(group.NoSketchesShown);
        Assert.False(Directory.Exists(Path.Combine(model, "sketches")));
    }

    [AvaloniaFact]
    public async Task A_sketch_that_cannot_be_made_says_why_under_the_field()
    {
        using var temp = new TempFolder();
        var model = Setup(temp, sketch: null);
        Directory.CreateDirectory(Path.Combine(model, "sketches"));
        File.WriteAllText(Path.Combine(model, "sketches", "boom"), "a file where the folder would go");
        var reader = await Open(model);
        var asked = new List<string>();
        reader.ModelPicked += asked.Add;
        var group = reader.SketchesGroup;
        group.PressNew();
        group.NameBox.Text = "Boom";
        group.PressAdd();
        Assert.StartsWith("Not made: ", group.ErrorText);
        Assert.Empty(asked);
        Assert.True(group.Naming); // what was typed stays, to fix
        group.NameBox.Text = "Boom 2";
        Dispatcher.UIThread.RunJobs();
        Assert.Null(group.ErrorText);
    }

    [AvaloniaFact]
    public async Task A_model_that_cannot_be_written_greys_the_button_out_and_says_why()
    {
        using var temp = new TempFolder();
        var model = Setup(temp);
        var reader = new ReaderView { CanEdit = false };
        TestApp.NoMotion();
        new Window { Width = 1200, Height = 800, Content = reader }.Show();
        reader.Load(FolderLoader.Load(model), model);
        reader.ClickRail(PanelTab.Explorer);
        await reader.Settled;
        Dispatcher.UIThread.RunJobs();
        var button = reader.SketchesGroup.NewButton;
        Assert.True(button.IsVisible);
        Assert.False(button.IsEnabled);
        Assert.Equal("This page can't save", ToolTip.GetTip(button));
        Assert.Equal(["Group orders"], reader.SketchesGroup.RowNames); // the sketches can still be read
    }

    [AvaloniaFact]
    public async Task A_sketch_added_while_the_window_is_open_shows_up_when_the_folder_is_read_again()
    {
        using var temp = new TempFolder();
        var model = Setup(temp, sketch: null);
        var reader = await Open(model);
        Assert.Empty(reader.SketchesGroup.RowNames);
        Sketches.Create(model, "Late idea");
        reader.Reload(FolderLoader.Load(model)); // the model itself did not change
        await reader.Settled;
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(["Late idea"], reader.SketchesGroup.RowNames);
        Assert.Equal("1", reader.SketchesGroup.CountText);
    }

    [AvaloniaFact]
    public async Task Inside_a_sketch_the_bar_names_the_model_and_says_Sketch_and_the_group_is_not_there()
    {
        using var temp = new TempFolder();
        var model = Setup(temp);
        var sketch = Sketches.DirOf(model, "group-orders");
        var reader = await Open(sketch);
        Assert.Equal("Plum", reader.SketchOwner);
        Assert.False(reader.SketchesGroup.IsVisible);
        Assert.Equal("Back to the model", ToolTip.GetTip(reader.OwnerButtonForTest));
        var asked = new List<string>();
        reader.ModelPicked += asked.Add;
        reader.PressOwner();
        Assert.Equal([Path.GetFullPath(model)], asked);
    }

    [AvaloniaFact]
    public async Task A_sketch_of_a_model_with_no_name_says_Model()
    {
        using var temp = new TempFolder();
        var model = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(model);
        File.WriteAllText(Path.Combine(model, "model.yaml"), Plain);
        var reader = await Open(Sketches.Create(model, "Idea"));
        Assert.Equal("Model", reader.SketchOwner);
    }

    [AvaloniaFact]
    public async Task A_model_has_no_Sketch_mark()
    {
        using var temp = new TempFolder();
        var reader = await Open(Setup(temp));
        Assert.Null(reader.SketchOwner);
    }
}
