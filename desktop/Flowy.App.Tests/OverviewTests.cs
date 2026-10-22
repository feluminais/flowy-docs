using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>The Overview: what Details shows at the top level with nothing picked. The system's name and what it is, in the reading view and in edit mode.</summary>
public class OverviewTests
{
    private static string TextOf(TextBlock t) => t.Inlines is { Count: > 0 } inlines ? string.Concat(inlines.OfType<Run>().Select(r => r.Text)) : t.Text ?? "";

    private static List<string> Texts(Control root) => root.GetVisualDescendants().OfType<TextBlock>().Select(TextOf).Where(t => t != "").ToList();

    private static (TempFolder Temp, string Dir, Window Window, ReaderView Reader) Open(string head)
    {
        var (temp, dir, window, reader) = EditModeTests.Open();
        File.WriteAllText(Path.Combine(dir, "model.yaml"), head + EditModeTests.Model(dir));
        reader.Load(FolderLoader.Load(dir), dir);
        EditModeTests.Settle(window);
        return (temp, dir, window, reader);
    }

    /// <summary>The rail button toggles Details, so only press it while Details is closed.</summary>
    private static void ShowDetails(ReaderView reader, Window window)
    {
        if (!reader.DetailsOpenNow) reader.ClickRail(PanelTab.Details);
        EditModeTests.Settle(window);
    }

    [AvaloniaFact]
    public void The_overview_shows_the_name_and_what_the_system_is()
    {
        var (temp, _, window, reader) = Open("name: Plum\nabout: Food delivery for **hungry** people.\n");
        using var _ = temp;
        ShowDetails(reader, window);
        var texts = Texts(reader.Panel);
        Assert.Contains("Plum", texts);
        Assert.DoesNotContain("Overview", texts);
        Assert.Contains(texts, t => t.Contains("Food delivery for"));
        Assert.DoesNotContain("Click a shape.", texts); // the description already says what to look at
    }

    [AvaloniaFact]
    public void Without_a_name_the_overview_is_called_Overview_and_says_what_to_do()
    {
        var (temp, _, window, reader) = Open("");
        using var _ = temp;
        ShowDetails(reader, window);
        var texts = Texts(reader.Panel);
        Assert.Contains("Overview", texts);
        Assert.Contains("Click a shape.", texts);
    }

    [AvaloniaFact]
    public async Task In_edit_mode_the_name_and_about_save_and_clearing_them_removes_the_keys()
    {
        var (temp, dir, window, reader) = Open("");
        using var _ = temp;
        reader.SetEditing(true);
        ShowDetails(reader, window);
        var form = reader.Panel.CurrentProjectEditor!;
        form.NameField.Text = "Plum";
        await form.NameField.Commit();
        await EditModeTests.Until(() => reader.Folder!.Model.ProjectName == "Plum");
        form.AboutField.Text = "Food delivery.";
        await form.AboutField.Commit();
        await EditModeTests.Until(() => reader.Folder!.Model.ProjectAbout == "Food delivery.");
        Assert.StartsWith("name: Plum\nabout: Food delivery.\nlines: curved\nowner: platform-team\n", EditModeTests.Model(dir).Replace("\r\n", "\n"));
        Assert.Same(form, reader.Panel.CurrentProjectEditor); // the same form, so the next field keeps its focus
        Assert.Equal("Plum", form.Title);

        form.NameField.Text = "";
        await form.NameField.Commit();
        await EditModeTests.Until(() => reader.Folder!.Model.ProjectName == "");
        Assert.DoesNotMatch(@"(?m)^name:", EditModeTests.Model(dir));
        Assert.Equal("Overview", form.Title);
    }
}
