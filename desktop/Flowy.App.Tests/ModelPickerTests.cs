using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>The picker for the repo's other models: there when the repo holds several, off when it holds one, and it opens a model in a window of its own.</summary>
public class ModelPickerTests
{
    private static string Model(TempFolder temp, string rel)
    {
        var dir = Path.Combine(temp.Path, rel);
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "model.yaml"), "objects:\n  thing:\n    type: system\n    name: Thing\nconnections: []\n");
        return dir;
    }

    private static async Task<ReaderView> Open(string dir)
    {
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        for (var i = 0; i < 100 && reader.Models.Count == 0; i++)
        {
            await Task.Delay(20);
            Dispatcher.UIThread.RunJobs();
        }
        AvaloniaHeadlessPlatform.ForceRenderTimerTick(3);
        Dispatcher.UIThread.RunJobs();
        return reader;
    }

    [AvaloniaFact]
    public async Task A_repo_with_several_models_shows_the_picker_on_this_one()
    {
        using var temp = new TempFolder();
        var top = Model(temp, "flowy");
        Model(temp, Path.Combine("services", "billing", "flowy"));
        var reader = await Open(top);
        Assert.True(reader.ModelPicker.IsVisible);
        Assert.Equal(2, reader.ModelPicker.ItemCount);
        Assert.Equal(0, reader.ModelPicker.SelectedIndex);
    }

    [AvaloniaFact]
    public async Task The_pickers_on_the_bar_take_no_focus_so_the_keys_stay_the_readers()
    {
        using var temp = new TempFolder();
        var reader = await Open(Model(temp, "flowy"));
        Assert.False(reader.ModelPicker.Focusable);
        Assert.False(reader.LinePicker.Focusable);
    }

    [AvaloniaFact]
    public async Task A_repo_with_one_model_has_no_picker()
    {
        using var temp = new TempFolder();
        var reader = await Open(Model(temp, "flowy"));
        Assert.False(reader.ModelPicker.IsVisible);
    }

    [AvaloniaFact]
    public async Task Picking_a_model_asks_for_its_window_and_this_window_keeps_its_own()
    {
        using var temp = new TempFolder();
        var top = Model(temp, "flowy");
        var billing = Model(temp, Path.Combine("services", "billing", "flowy"));
        var reader = await Open(top);
        var asked = new List<string>();
        reader.ModelPicked += asked.Add;
        reader.ModelPicker.SelectedIndex = 1;
        Assert.Equal([Path.GetFullPath(billing)], asked);
        Assert.Equal(0, reader.ModelPicker.SelectedIndex);
    }
}
