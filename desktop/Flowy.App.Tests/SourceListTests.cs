using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>A code path as a person uses it: the path as text, a button named for the editor that opens the project at the file's line, and Show in folder for a folder.</summary>
public class SourceListTests
{
    private const string Model = """
        objects:
          shop:
            type: system
            name: Shop
            code: [src/orders.ts:42, src/]
        connections: []
        """;

    private static readonly EditorApp Code = new("vscode", "VS Code", "code.exe", EditorFamily.VsCode);

    private static (TempFolder Temp, ReaderView Reader, List<LinkAction> Actions, string Root) Open(EditorApp? editor)
    {
        var temp = new TempFolder();
        var root = temp.Path;
        Directory.CreateDirectory(Path.Combine(root, "src"));
        File.WriteAllText(Path.Combine(root, "src", "orders.ts"), "x");
        var dir = Path.Combine(root, "flowy");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "model.yaml"), Model);
        var reader = new ReaderView { CodeEditor = () => editor };
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
        window.UpdateLayout();
        Dispatcher.UIThread.RunJobs();
        AvaloniaHeadlessPlatform.ForceRenderTimerTick(3);
        Dispatcher.UIThread.RunJobs();
        return (temp, reader, actions, root);
    }

    private static List<Button> Buttons(ReaderView reader) => reader.Panel.GetVisualDescendants().OfType<Button>().ToList();

    private static Button Named(ReaderView reader, string name) => Buttons(reader).First(b => Avalonia.Automation.AutomationProperties.GetName(b) == name);

    private static void Click(Button b) => b.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));

    [AvaloniaFact]
    public void A_path_is_text_and_its_editor_button_opens_the_project_at_the_line()
    {
        var (temp, reader, actions, root) = Open(Code);
        using var _ = temp;
        Assert.Contains(reader.Panel.GetVisualDescendants().OfType<TextBlock>(), t => t.Text == "src/orders.ts:42");
        Click(Named(reader, "VS Code"));
        var file = Path.Combine(root, "src", "orders.ts");
        var action = Assert.Single(actions);
        Assert.Equal((LinkKind.Editor, file, "code.exe"), (action.Kind, action.Target, action.App));
        Assert.Equal([Path.GetFullPath(root), "-g", $"{file}:42"], action.Arguments);
    }

    [AvaloniaFact]
    public void A_folder_and_a_computer_with_no_editor_show_the_path_in_its_folder()
    {
        var (temp, reader, actions, root) = Open(null);
        using var _ = temp;
        var shows = Buttons(reader).Where(b => Avalonia.Automation.AutomationProperties.GetName(b) == SourceList.Words.ShowInFolder).ToList();
        Assert.Equal(2, shows.Count);
        shows.ForEach(Click);
        Assert.Equal([new LinkAction(LinkKind.ShowInFolder, Path.Combine(root, "src", "orders.ts")), new LinkAction(LinkKind.Folder, Path.Combine(root, "src"))], actions);
    }
}
