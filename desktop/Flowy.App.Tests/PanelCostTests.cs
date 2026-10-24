using System.Text;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>What the panels and the folder do not do any more: draw a long list or a big table whole, redraw for a folder that did not change, colour the same code twice.</summary>
public class PanelCostTests
{
    private static (TempFolder Temp, string Dir, Window Window, ReaderView Reader) Open(string model, string? analysis = null)
    {
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(Path.Combine(dir, "failures"));
        File.WriteAllText(Path.Combine(dir, "model.yaml"), model);
        if (analysis is not null) File.WriteAllText(Path.Combine(dir, "failures", "ordering.yaml"), analysis);
        var reader = new ReaderView();
        var window = new Window { Width = 1280, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        Settle();
        return (temp, dir, window, reader);
    }

    private static void Settle()
    {
        Dispatcher.UIThread.RunJobs();
        AvaloniaHeadlessPlatform.ForceRenderTimerTick(2);
        Dispatcher.UIThread.RunJobs();
    }

    private static string Shapes(int count, string extra = "")
    {
        var text = new StringBuilder("objects:\n  shop:\n    type: system\n    name: Shop\n");
        for (var i = 0; i < count; i++) text.Append($"  app-{i}:\n    type: app\n    in: shop\n    name: App {i}\n");
        return text + extra;
    }

    [AvaloniaFact]
    public void A_folder_read_again_that_did_not_change_is_not_drawn_again_and_one_that_did_is()
    {
        var (temp, dir, _, reader) = Open(Shapes(5));
        using var _ = temp;
        var scene = reader.Canvas.Scene;
        var again = FolderLoader.Load(dir);
        Assert.True(FolderSame.Is(reader.Folder!, again));
        reader.Reload(again); // what the watch does after the app's own save
        Assert.Same(scene, reader.Canvas.Scene);
        File.AppendAllText(Path.Combine(dir, "model.yaml"), "  app-new:\n    type: app\n    in: shop\n    name: New\n");
        reader.Reload(FolderLoader.Load(dir));
        Assert.NotSame(scene, reader.Canvas.Scene);
        Assert.NotNull(reader.Folder!.Model.GetObject("app-new"));
    }

    [AvaloniaFact]
    public void A_banner_is_cleared_by_a_read_that_says_the_same()
    {
        var (temp, dir, _, reader) = Open(Shapes(3));
        using var _ = temp;
        reader.SetBanner("A file could not be read.");
        reader.Reload(FolderLoader.Load(dir));
        Assert.Null(reader.BannerText);
    }

    [AvaloniaFact]
    public void The_shapes_no_analysis_covers_come_a_page_at_a_time()
    {
        var (temp, _, window, reader) = Open(Shapes(250), "name: Ordering\nscope: root\nmodes:\n  one:\n    mode: It breaks\n    on: app-0\n    severity: 5\n    occurrence: 3\n    detection: 4\n");
        using var _ = temp;
        window.KeyPress(Key.M, RawInputModifiers.None, PhysicalKey.M, null);
        Settle();
        var panel = reader.FailuresPanelNow;
        var left = panel.Buttons.First(b => (AutomationProperties.GetName(b) ?? "").StartsWith("Not analysed"));
        left.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        Settle();
        int Rows() => panel.Buttons.Count(b => b.Classes.Contains("failrow"));
        var first = Rows();
        Assert.InRange(first, 90, 110); // a page, not 250
        var more = panel.Buttons.First(b => (AutomationProperties.GetName(b) ?? "").StartsWith("Show "));
        more.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        Settle();
        Assert.Equal(first + 100, Rows());
    }

    [AvaloniaFact]
    public void A_table_far_past_the_limits_is_cut_and_says_how_much()
    {
        var table = new StringBuilder("  big-db:\n    type: store\n    in: shop\n    name: Big DB\n    data:\n      - name: events\n        columns: [id, kind]\n        rows:\n");
        for (var r = 0; r < 300; r++) table.Append($"          - [e{r}, k{r}]\n");
        var (temp, _, _, reader) = Open(Shapes(1, table.ToString()));
        using var _ = temp;
        reader.OpenObject("big-db");
        Settle();
        var heads = reader.Panel.GetVisualDescendants().OfType<Avalonia.Controls.Primitives.ToggleButton>().Where(b => b.Classes.Contains("datahead")).ToList();
        heads[0].IsChecked = true;
        Settle();
        var words = reader.Panel.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text ?? "").ToList();
        Assert.Contains($"{300 - DataView.DrawRows} more rows", words);
        Assert.Contains("e0", words);
        Assert.DoesNotContain("e299", words);
    }

    [AvaloniaFact]
    public void The_same_code_is_coloured_once()
    {
        var code = string.Join('\n', Enumerable.Range(0, 20).Select(i => $"public int Fee{i}(int km) => km * {i} + Rate;"));
        var first = CodeInk.Runs(code, "csharp");
        Assert.True(first.Count > 1, "the code is coloured");
        Assert.Same(first, CodeInk.Runs(code, "csharp"));
        Assert.NotSame(first, CodeInk.Runs(code + "\n", "csharp")); // other code, other answer
        Assert.Single(CodeInk.Runs("whatever", "text"));
    }

    [AvaloniaFact]
    public void The_problems_list_is_made_when_it_is_opened_and_a_page_at_a_time()
    {
        var lines = new StringBuilder("connections:\n");
        for (var i = 0; i < 250; i++) lines.Append($"  - {{ from: app-0, to: ghost-{i} }}\n");
        var (temp, _, _, reader) = Open(Shapes(2, lines.ToString()));
        using var _ = temp;
        var button = reader.ProblemsButtonNow;
        var flyout = Assert.IsType<Flyout>(button.Flyout);
        Assert.Null(flyout.Content); // not made while it is shut
        flyout.ShowAt(button);
        Settle();
        var list = Assert.IsType<ScrollViewer>(flyout.Content);
        var rows = ((StackPanel)list.Content!).Children.OfType<Button>().Count(b => b.Classes.Contains("result"));
        Assert.InRange(rows, 90, 110);
        flyout.Hide();
    }
}
