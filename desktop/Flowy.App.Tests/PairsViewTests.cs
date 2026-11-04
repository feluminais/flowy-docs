using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Headless.XUnit;
using Avalonia.LogicalTree;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>
/// How the desktop lets a project say whether a pair of shapes is drawn as one line or a line for each connection (desktop/fixtures/cases/pairs): the two drawn tiles of the Overview in
/// edit mode, and the label field a drag opens where each connection has a line of its own. The words and what the ops write are core's, which the fixtures pin against the browser; these
/// hold what the app does with them. Headless: no window opens of its own, and nothing here plays an animation or drives a whole reader.
/// </summary>
public class PairsViewTests
{
    private static string Dir => Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "pairs", "flowy");

    private static EditDoc Doc() => EditDoc.Parse(File.ReadAllText(Path.Combine(Dir, "model.yaml")), null, []);

    private static (SidePanel Panel, Window Window, Func<EditDoc> Doc) Edit(Model model, EditDoc start)
    {
        var doc = start;
        var panel = new SidePanel();
        var window = new Window { Width = 400, Height = 900, Content = panel };
        window.Show();
        panel.ShowProjectEditor(model, new OutlineTotals(1, 0, 0), op =>
        {
            doc = op(doc);
            return Task.FromResult(true);
        });
        window.UpdateLayout();
        return (panel, window, () => doc);
    }

    [AvaloniaFact]
    public async Task The_overview_offers_merged_and_separate_as_drawn_tiles_and_a_pick_writes_pairs()
    {
        var (panel, _, doc) = Edit(FolderLoader.Load(Dir).Model, Doc());
        var choice = panel.CurrentProjectEditor!.PairsChoice;
        Assert.Equal(["merged", "separate"], choice.Ids);
        Assert.Equal("Separate", choice.ChosenName); // the folder says pairs: separate
        Assert.Equal(["Merged", "Separate"], choice.GetLogicalDescendants().OfType<TextBlock>().Select(t => t.Text ?? "").Where(t => t is "Merged" or "Separate").Distinct().Order());
        var swatches = choice.GetLogicalDescendants().OfType<PairsSwatch>().ToList();
        Assert.Equal(["merged", "separate"], swatches.Select(s => s.Mode));
        Assert.Equal([1, 3], swatches.Select(s => s.Lines)); // one line between two boxes, then a line for each connection

        Assert.True(await choice.Choose("merged"));
        Assert.False(doc().Meta.ContainsKey("pairs")); // merged is the default, so the key goes
        Assert.True(await choice.Choose("separate"));
        Assert.Equal("separate", doc().Meta["pairs"]);
    }

    [AvaloniaFact]
    public void The_tile_of_the_mode_a_project_has_is_ringed_and_follows_the_model()
    {
        var merged = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "edit", "flowy")).Model;
        var (panel, _, _) = Edit(merged, Doc());
        var choice = panel.CurrentProjectEditor!.PairsChoice;
        Assert.Equal("merged", choice.Chosen);
        panel.ShowProjectEditor(FolderLoader.Load(Dir).Model, new OutlineTotals(1, 0, 0), op => Task.FromResult(true));
        Assert.Same(choice, panel.CurrentProjectEditor!.PairsChoice); // the same form, so a pick keeps its focus
        Assert.Equal("separate", choice.Chosen);
        Assert.Equal(Names.PairsField, Avalonia.Automation.AutomationProperties.GetName(choice.GetLogicalDescendants().OfType<UniformGrid>().Single()));
    }

    [AvaloniaFact]
    public void A_connections_label_field_takes_the_cursor_when_asked_and_a_connection_with_no_form_does_not()
    {
        var folder = FolderLoader.Load(Dir);
        var panel = new SidePanel();
        var window = new Window { Width = 400, Height = 900, Content = panel };
        window.Show();
        panel.ShowLineEditor(folder.Model, "root", "management", "cloud", [], op => Task.FromResult(true), () => { }, (_, _) => { });
        window.UpdateLayout();
        var form = panel.CurrentLineEditor!;
        var fetch = folder.Model.Connections.ToList().FindIndex(c => c.Label == "Fetch update");
        Assert.True(form.FocusLabel(fetch));
        Assert.True(form.Labels.Single().Box.IsFocused);
        Assert.False(form.FocusLabel(0)); // a connection of another pair has no form here
    }

    [AvaloniaFact]
    public void A_reader_opens_a_line_with_the_cursor_in_the_label_of_the_connection_it_is_told()
    {
        var (temp, _, window, reader) = EditModeTests.Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.GoTo("shop");
        EditModeTests.Settle(window);
        var rest = reader.Folder!.Model.Connections.ToList().FindIndex(c => c.Label == "REST");
        reader.OpenLine("web", "api", rest);
        EditModeTests.Settle(window);
        var form = reader.Panel.CurrentLineEditor!;
        Assert.True(form.Labels.Single().Box.IsFocused);
        Assert.Equal("REST", form.Labels.Single().Text);
    }
}
