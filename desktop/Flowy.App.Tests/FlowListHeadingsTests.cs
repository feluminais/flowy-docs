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
    public void The_Linked_key_is_on_the_foot_while_a_listed_flow_is_in_a_pair()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Flows);
        window.UpdateLayout();
        Assert.True(reader.Navigator.Flows.LinkedKeyShown); // the Plum demo tags the refund flow; a folder with no pair is CompareTests'
        Assert.Contains(reader.Navigator.Flows.GetVisualDescendants().OfType<Control>(), c => Avalonia.Automation.AutomationProperties.GetName(c) == "Linked" && c.IsVisible);
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
