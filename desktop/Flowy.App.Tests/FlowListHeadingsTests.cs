using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>What the Flows list shows, on the Plum demo: the flows under the folders they are filed in, and the key for a flow in a pair.</summary>
public class FlowListHeadingsTests
{
    private static (Window Window, ReaderView Reader) Open()
    {
        var dir = Path.Combine(Repo.Root, "docs", "demo", "flowy");
        TestApp.NoMotion();
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        Dispatcher.UIThread.RunJobs();
        return (window, reader);
    }

    /// <summary>Every piece of text in the list. A row's words are in the visual tree only once the window has laid itself out.</summary>
    private static List<string> Texts(Window window, ReaderView reader)
    {
        window.UpdateLayout();
        return reader.Navigator.Flows.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text ?? "").ToList();
    }

    [AvaloniaFact]
    public void The_flows_come_under_the_folders_they_are_filed_in()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Flows);
        var texts = Texts(window, reader);
        foreach (var folder in new[] { "delivery", "ordering", "payments", "stripe" }) Assert.Contains(folder, texts);
        Assert.DoesNotContain("THIS VIEW", texts);
        Assert.DoesNotContain("OTHER VIEWS", texts);
        var listed = reader.Navigator.Flows.Listed;
        Assert.Contains(listed, f => f.Id == "stripe-outage" && f.Folder == "payments/stripe");
        Assert.True(listed.Select(f => f.Folder).Distinct().Count() > 2);
    }

    [AvaloniaFact]
    public void Clicking_a_folder_folds_it_and_the_flows_in_it_leave_the_list()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Flows);
        window.UpdateLayout();
        var flows = reader.Navigator.Flows;
        Assert.Contains(flows.Listed, f => f.Folder == "payments/stripe");
        var folder = flows.GetVisualDescendants().OfType<Button>().First(b => Avalonia.Automation.AutomationProperties.GetName(b) == "payments/stripe");
        folder.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
        Dispatcher.UIThread.RunJobs();
        Assert.DoesNotContain(flows.Listed, f => f.Folder == "payments/stripe");
        Assert.Contains(flows.Listed, f => f.Folder == "payments");
    }

    [AvaloniaFact]
    public void The_tags_in_use_are_buttons_with_a_count_and_the_most_used_come_first()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Flows);
        window.UpdateLayout();
        var flows = reader.Navigator.Flows;
        Assert.Equal(["error path:9", "happy path:7", "edge case:3", "background:2", "recovery:2"], flows.TagButtons.Select(t => $"{t.Tag}:{t.Count}"));
        var buttons = flows.GetVisualDescendants().OfType<Button>().Where(b => b.Classes.Contains("tagchip")).ToList();
        Assert.Equal(5, buttons.Count);
        Assert.Equal(20, flows.Listed.Count);
    }

    [AvaloniaFact]
    public void Pressing_a_tag_keeps_the_flows_that_have_it_and_pressing_it_again_lets_them_back()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Flows);
        var flows = reader.Navigator.Flows;
        flows.ToggleTag("Error Path"); // whatever the case
        Dispatcher.UIThread.RunJobs();
        window.UpdateLayout();
        Assert.Equal(9, flows.Listed.Count);
        Assert.All(flows.Listed, f => Assert.Contains("error path", f.Tags));
        Assert.Contains("9 of 20 flows", Texts(window, reader));
        var chip = flows.GetVisualDescendants().OfType<Button>().First(b => Avalonia.Automation.AutomationProperties.GetName(b) == "error path");
        Assert.Contains("on", chip.Classes);
        flows.ToggleTag("recovery"); // any of the tags: every recovery flow is an error path as well
        Assert.Equal(9, flows.Listed.Count);
        flows.ToggleTag("error path");
        Assert.Equal(2, flows.Listed.Count);
        flows.ToggleTag("recovery");
        Assert.Equal(20, flows.Listed.Count);
        Assert.Empty(flows.PickedTags);
    }

    [AvaloniaFact]
    public void A_flow_row_has_its_tags_under_its_name_and_the_search_finds_a_tag_or_a_folder()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Flows);
        Assert.Contains("happy path", Texts(window, reader));
        reader.Navigator.Flows.Filter = "background";
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(["announce-order", "stripe-webhook"], reader.Navigator.Flows.Listed.Select(f => f.Id).Order());
        reader.Navigator.Flows.Filter = "stripe";
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(["payments", "payments/stripe"], reader.Navigator.Flows.Folders.Select(f => f.Path));
        reader.Navigator.Flows.ToggleTag("happy path");
        Assert.Empty(reader.Navigator.Flows.Listed);
        Assert.Contains("No flow matches “stripe”.", Texts(window, reader));
    }

    [AvaloniaFact]
    public void The_Compare_pair_key_is_on_the_foot_while_a_listed_flow_is_in_a_pair()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Flows);
        window.UpdateLayout();
        Assert.True(reader.Navigator.Flows.LinkedKeyShown); // the Plum demo tags the refund flow; a folder with no pair is CompareTests'
        Assert.Contains(reader.Navigator.Flows.GetVisualDescendants().OfType<TextBlock>(), t => t.Text == "Compare pair" && t.IsVisible);
        // the mark on each row of the pair says which flow it is compared with, for a screen reader and in its tooltip
        var names = reader.Navigator.Flows.GetVisualDescendants().OfType<Control>().Where(c => c.IsVisible && Avalonia.Automation.AutomationProperties.GetName(c) is { } n && n.StartsWith("Compared with")).ToList();
        Assert.Equal(["Compared with Support refunds an order", "Compared with The refund is not recorded"], names.Select(c => Avalonia.Automation.AutomationProperties.GetName(c)).Order());
        Assert.All(names, c => Assert.Equal(Avalonia.Automation.AutomationProperties.GetName(c), ToolTip.GetTip(c)));
    }

    [AvaloniaFact]
    public void A_filter_with_no_match_says_so()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Flows);
        reader.Navigator.Flows.Filter = "zzz no flow has this";
        Dispatcher.UIThread.RunJobs();
        var texts = Texts(window, reader);
        Assert.Contains("No flow matches “zzz no flow has this”.", texts);
        Assert.Empty(reader.Navigator.Flows.Listed);
    }
}
