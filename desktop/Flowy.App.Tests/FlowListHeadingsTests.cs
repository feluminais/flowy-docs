using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>What the Flows list calls its two parts, on the Plum demo: the flows that play on the view you are on, and all the others.</summary>
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
    public void The_flows_on_this_view_come_under_This_view_and_the_rest_under_Other_views()
    {
        var (window, reader) = Open();
        reader.GoTo("delivery");
        reader.ClickRail(PanelTab.Flows);
        var texts = Texts(window, reader);
        Assert.Contains("THIS VIEW", texts);
        Assert.Contains("OTHER VIEWS", texts);
        Assert.DoesNotContain(texts, t => t.StartsWith("IN ", StringComparison.Ordinal) || t == "EVERYWHERE ELSE");
    }

    [AvaloniaFact]
    public void The_Linked_key_is_not_on_the_foot_while_no_listed_flow_is_in_a_pair()
    {
        var (window, reader) = Open();
        reader.ClickRail(PanelTab.Flows);
        window.UpdateLayout();
        Assert.False(reader.Navigator.Flows.LinkedKeyShown); // the Plum demo tags no flow
        Assert.DoesNotContain(reader.Navigator.Flows.GetVisualDescendants().OfType<Control>(), c => Avalonia.Automation.AutomationProperties.GetName(c) == "Linked" && c.IsVisible);
    }

    [AvaloniaFact]
    public void A_view_with_no_flow_of_its_own_says_so_without_counting_the_others_again()
    {
        var (window, reader) = Open();
        reader.GoTo("notifications");
        reader.ClickRail(PanelTab.Flows);
        var texts = Texts(window, reader);
        Assert.Contains("No flows on this view.", texts);
        Assert.DoesNotContain(texts, t => t.Contains("elsewhere", StringComparison.Ordinal));
        Assert.Contains("OTHER VIEWS", texts); // their number is on this heading
    }
}
