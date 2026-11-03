using System.Diagnostics;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;
using static Flowy.App.Tests.EditModeTests;

namespace Flowy.App.Tests;

/// <summary>
/// The player card keeps the size of its tallest stop, so its top edge and its buttons stay put as the flow plays; Back plays a step that moves again before it
/// goes back, Back and Next end Play, and Play sits between them; and the bar takes a click a few pixels off its cells. ui/src/Player.tsx does the same (browser-tests/player.spec.ts).
/// </summary>
public class PlayerSizeTests
{
    private const string Source = """
        payloads:
          basket: { name: Basket, about: What the app sends., example: { language: json, text: '{ "id": 1 }' } }
          receipt: { name: Receipt, about: What comes back. }
        objects:
          shop: { type: system, name: Shop }
          app: { type: app, in: shop, name: App }
          api: { type: app, in: shop, name: API }
        connections:
          - { from: app, to: api, label: REST }
        """;

    private const string Flow = """
        name: Checkout
        view: shop
        steps:
          - { from: app, text: Opens }
          - from: app
            to: api
            text: Sends the basket with every line the customer picked, the address to bring it to and a note for the kitchen, then waits for the total
            animation: call
            payload: basket
            reply: receipt
            description: The API checks the basket before it answers.
          - { from: api, to: app, text: Answers, animation: send }
        """;

    /// <summary>A repeat over the middle steps: they have the group's words over the bar, the first and the last have none.</summary>
    private const string Grouped = """
        name: Retry
        view: shop
        groups:
          tries: { kind: repeat, times: 3, text: Backs off 1 s, 2 s and 4 s between tries }
        steps:
          - { from: app, text: Opens }
          - { from: app, to: api, text: Asks for the total, animation: call, group: tries }
          - { from: api, text: Gives up for now, group: tries }
          - { from: app, to: api, text: Answers, animation: send }
        """;

    private static (TempFolder Temp, Window Window, ReaderView Reader) Open()
    {
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(Path.Combine(dir, "flows"));
        File.WriteAllText(Path.Combine(dir, "model.yaml"), Source);
        File.WriteAllText(Path.Combine(dir, "flows", "checkout.yaml"), Flow);
        File.WriteAllText(Path.Combine(dir, "flows", "retry.yaml"), Grouped);
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        reader.GoTo("shop");
        return (temp, window, reader);
    }

    private static IEnumerable<string> Words(Control root) =>
        root.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text ?? string.Concat(t.Inlines?.OfType<Run>().Select(r => r.Text) ?? [])).Where(t => t != "");

    private static Button? Named(Control root, string name) =>
        root.GetVisualDescendants().OfType<Button>().FirstOrDefault(b => AutomationProperties.GetName(b) == name);

    [AvaloniaTheory]
    [InlineData("checkout", 3)]
    [InlineData("retry", 4)]
    public void The_card_keeps_one_size_and_one_top_edge_through_the_flow(string flow, int count)
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        var seen = new HashSet<(double, double, double)>();
        for (var k = 0; k < count; k++)
        {
            reader.Play(flow, k);
            Settle(window);
            Assert.Contains($"Step {k + 1} of {count}", Words(reader.Card));
            var at = reader.Card.TranslatePoint(new Point(0, 0), window)!.Value;
            seen.Add((Math.Round(at.Y), Math.Round(reader.Card.Bounds.Height), Math.Round(reader.Card.Bounds.Width)));
        }
        Assert.Single(seen);
    }

    /// <summary>Lets frames and timers run until <paramref name="done"/>, or ten seconds pass. A headless window draws no frames of its own.</summary>
    private static void Run(Func<bool> done)
    {
        var clock = Stopwatch.StartNew();
        while (clock.Elapsed < TimeSpan.FromSeconds(10) && !done())
        {
            AvaloniaHeadlessPlatform.ForceRenderTimerTick();
            Dispatcher.UIThread.RunJobs();
            Thread.Sleep(5);
        }
    }

    private static void Click(Control root, string name)
    {
        Named(root, name)!.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        Dispatcher.UIThread.RunJobs();
    }

    [AvaloniaFact]
    public void Back_plays_a_step_that_moves_again_and_a_second_click_goes_to_the_step_before()
    {
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0");
        try
        {
            BackPlaysTheStepAgain();
        }
        finally
        {
            Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1"); // the other tests turn motion off
        }
    }

    private static void BackPlaysTheStepAgain()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.Play("checkout", 0);
        Settle(window);
        var back = Named(reader.Card, "Back")!;
        Assert.False(back.IsEnabled); // nothing moves on the first step, and there is no step before it
        Assert.Equal("Nothing moves on this step", ToolTip.GetTip(back));
        reader.Play("checkout", 1);
        Run(() => !reader.StepMoving);
        Assert.Equal("Replay the step, twice for the one before", ToolTip.GetTip(Named(reader.Card, "Back")!));
        Click(reader.Card, "Back");
        Assert.True(reader.StepMoving);
        Assert.Contains("Step 2 of 3", Words(reader.Card));
        Click(reader.Card, "Back");
        Assert.Contains("Step 1 of 3", Words(reader.Card));
    }

    [AvaloniaFact]
    public void Back_and_Next_end_Play()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.Play("checkout", 1);
        Run(() => !reader.StepMoving);
        Click(reader.Card, "Play");
        Assert.True(reader.Autoplaying);
        Click(reader.Card, "Back");
        Assert.False(reader.Autoplaying);
        Assert.Contains("Step 2 of 3", Words(reader.Card));
        reader.Play("checkout", 0);
        Settle(window);
        Click(reader.Card, "Play");
        Assert.True(reader.Autoplaying);
        Click(reader.Card, "Next");
        Assert.False(reader.Autoplaying);
    }

    [AvaloniaFact]
    public void Play_sits_between_Back_and_Next()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.Play("checkout", 0);
        Settle(window);
        var row = Named(reader.Card, "Back")!.Parent as StackPanel;
        Assert.Equal(["Back", "Play", "Next"], row!.Children.Select(c => AutomationProperties.GetName(c)));
    }

    [AvaloniaFact]
    public void Play_and_Pause_are_one_width_so_Replay_stays_put()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.Play("checkout", 0);
        Settle(window);
        double ReplayX() => Named(reader.Card, "Replay this step")!.TranslatePoint(new Point(0, 0), window)!.Value.X;
        var play = Named(reader.Card, "Play") ?? Named(reader.Card, "Pause");
        Assert.NotNull(play);
        var (width, x) = (play.Bounds.Width, ReplayX());
        window.KeyPress(Key.P, RawInputModifiers.None, PhysicalKey.P, "p");
        Settle(window);
        var other = AutomationProperties.GetName(play) == "Play" ? Named(reader.Card, "Pause") : Named(reader.Card, "Play");
        Assert.NotNull(other); // the button changed its word
        Assert.Equal(width, other.Bounds.Width);
        Assert.Equal(x, ReplayX());
    }

    [AvaloniaFact]
    public void A_click_a_few_pixels_above_a_cell_goes_to_its_step()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.Play("checkout", 0);
        Settle(window);
        var bar = reader.Card.GetVisualDescendants().OfType<Border>().First(b => AutomationProperties.GetName(b) == "Step");
        var cells = bar.GetVisualDescendants().OfType<Border>().Where(b => b.Classes.Contains("seg")).ToList();
        Assert.Equal(3, cells.Count);
        var cell = cells[1];
        var above = cell.TranslatePoint(new Point(cell.Bounds.Width / 2, -6), window)!.Value;
        window.MouseDown(above, MouseButton.Left);
        window.MouseUp(above, MouseButton.Left);
        Settle(window);
        Assert.Contains("Step 2 of 3", Words(reader.Card));
    }
}
