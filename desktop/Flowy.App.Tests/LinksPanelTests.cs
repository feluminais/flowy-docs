using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>The Links section of a box's panel, as a person uses it: what is listed, what each entry would open, and that a click asks for exactly that.</summary>
public class LinksPanelTests
{
    private const string Model = """
        objects:
          shop:
            type: system
            name: Shop
            links:
              - { title: Runbook, url: docs/runbook.md }
              - { title: Batch job, url: docs/run.bat }
              - { title: Status, url: "https://status.example.com" }
              - { title: Gone, url: docs/gone.md }
              - { url: docs/ }
        connections: []
        """;

    private static (TempFolder Temp, ReaderView Reader, List<LinkAction> Actions, string Root) Open()
    {
        var temp = new TempFolder();
        var root = temp.Path;
        Directory.CreateDirectory(Path.Combine(root, "docs"));
        File.WriteAllText(Path.Combine(root, "docs", "runbook.md"), "x");
        File.WriteAllText(Path.Combine(root, "docs", "run.bat"), "x");
        var dir = Path.Combine(root, "flowy");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "model.yaml"), Model);
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        var actions = new List<LinkAction>();
        reader.LinkRunner = a =>
        {
            actions.Add(a);
            return Task.FromResult<string?>(null);
        };
        reader.Load(FolderLoader.Load(dir), dir);
        reader.OpenObject("shop");
        // The panel's content joins the visual tree once the window has been laid out.
        window.UpdateLayout();
        Dispatcher.UIThread.RunJobs();
        AvaloniaHeadlessPlatform.ForceRenderTimerTick(3);
        Dispatcher.UIThread.RunJobs();
        return (temp, reader, actions, root);
    }

    private static List<Button> Buttons(ReaderView reader) => reader.Panel.GetVisualDescendants().OfType<Button>().ToList();

    private static Button Link(ReaderView reader, string text) =>
        Buttons(reader).Single(b => b.Classes.Contains("link") && (b.Content as TextBlock)?.Text == text);

    private static void Click(Button b) => b.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));

    [AvaloniaFact]
    public void Each_link_opens_as_LinkOpening_decides()
    {
        var (temp, reader, actions, root) = Open();
        using var _ = temp;
        Click(Link(reader, "Runbook"));
        Click(Link(reader, "Batch job"));
        Click(Link(reader, "Status"));
        Click(Link(reader, "docs/"));
        Assert.Equal(
            [
                new LinkAction(LinkKind.DefaultApp, Path.Combine(root, "docs", "runbook.md")),
                new LinkAction(LinkKind.ShowInFolder, Path.Combine(root, "docs", "run.bat")),
                new LinkAction(LinkKind.Web, "https://status.example.com"),
                new LinkAction(LinkKind.Folder, Path.Combine(root, "docs")),
            ],
            actions);
    }

    [AvaloniaFact]
    public void A_link_to_something_that_is_not_there_is_text_not_a_button()
    {
        var (temp, reader, _, _) = Open();
        using var _ = temp;
        Assert.DoesNotContain(Buttons(reader), b => (b.Content as TextBlock)?.Text == "Gone");
        Assert.Contains(reader.Panel.GetVisualDescendants().OfType<TextBlock>(), t => t.Text == "Gone");
    }

    [AvaloniaFact]
    public void A_file_has_a_button_that_shows_it_in_its_folder()
    {
        var (temp, reader, actions, root) = Open();
        using var _ = temp;
        var show = Buttons(reader).Where(b => Avalonia.Automation.AutomationProperties.GetName(b) == "Show in folder").ToList();
        Assert.Single(show); // the runbook: the batch file is shown in its folder by a click already, a web address and a folder have none, and a missing one is no button
        Click(show[0]);
        Assert.Equal([new LinkAction(LinkKind.ShowInFolder, Path.Combine(root, "docs", "runbook.md"))], actions);
    }

    [AvaloniaFact]
    public void A_chosen_app_opens_any_file_in_the_repo_and_is_read_at_the_click()
    {
        var (temp, reader, actions, root) = Open();
        using var _ = temp;
        var app = Path.Combine(root, "editor.exe");
        File.WriteAllText(app, "");
        reader.CustomApp = () => app;
        Click(Link(reader, "Batch job"));
        Assert.Equal([new LinkAction(LinkKind.CustomApp, Path.Combine(root, "docs", "run.bat"), app)], actions);
    }
}
