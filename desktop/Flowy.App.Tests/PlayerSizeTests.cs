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
/// goes back, Back and Next leave Autoplay on, and Play sits between them; and the bar takes a click a few pixels off its cells. ui/src/Player.tsx does the same (browser-tests/player.spec.ts).
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
            text: Sends the basket and the address to bring it to, then waits for the total
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

    /// <summary>Two short stops, then one stop with six lanes: far taller than the limit the card keeps room for.</summary>
    private const string Fan = """
        name: Fan out
        view: shop
        groups:
          all: { kind: parallel }
        steps:
          - { from: app, text: Opens }
          - { from: app, to: api, text: Asks for the total, animation: call }
          - { from: api, to: app, text: Checks the stock for every line of the basket before it answers, group: all, lane: Stock }
          - { from: api, to: app, text: Checks the address against the places the kitchen delivers to, group: all, lane: Address }
          - { from: api, to: app, text: Checks the card with the bank and holds the amount, group: all, lane: Card }
          - { from: api, to: app, text: Looks for a courier close to the kitchen who is free, group: all, lane: Courier }
          - { from: api, to: app, text: Works out the price with the offers the customer has, group: all, lane: Price }
          - { from: api, to: app, text: Writes the order down so the kitchen tablet can show it, group: all, lane: Order }
        """;

    private static (TempFolder Temp, Window Window, ReaderView Reader) Open()
    {
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(Path.Combine(dir, "flows"));
        File.WriteAllText(Path.Combine(dir, "model.yaml"), Source);
        File.WriteAllText(Path.Combine(dir, "flows", "checkout.yaml"), Flow);
        File.WriteAllText(Path.Combine(dir, "flows", "retry.yaml"), Grouped);
        File.WriteAllText(Path.Combine(dir, "flows", "fan.yaml"), Fan);
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

    [AvaloniaFact]
    public void A_stop_taller_than_the_limit_makes_the_card_taller_for_that_stop_only()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        var heights = new List<double>();
        for (var k = 0; k < 3; k++)
        {
            reader.Play("fan", k);
            Settle(window);
            Assert.Contains($"Step {k + 1} of 3", Words(reader.Card));
            heights.Add(Math.Round(reader.Card.Bounds.Height));
        }
        Assert.Equal(heights[0], heights[1]); // the short stops share one size, kept at the limit and no more
        Assert.True(heights[2] > heights[0] + 60, $"the six-lane stop is {heights[2]} tall and the short ones {heights[0]}");
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
    public void Back_and_Next_leave_Autoplay_on()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.Play("checkout", 1);
        Run(() => !reader.StepMoving);
        Click(reader.Card, "Autoplay");
        Assert.True(reader.Autoplaying);
        Assert.Contains("on", Named(reader.Card, "Autoplay")!.Classes);
        Click(reader.Card, "Back");
        Assert.True(reader.Autoplaying);
        Assert.Contains("Step 2 of 3", Words(reader.Card));
        Click(reader.Card, "Next");
        Assert.True(reader.Autoplaying);
    }

    [AvaloniaFact]
    public void Play_sits_between_Back_and_Next()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.Play("checkout", 0);
        Settle(window);
        var row = Named(reader.Card, "Back")!.Parent as StackPanel;
        Assert.Equal(["Back", "Play", "Next", "Autoplay"], row!.Children.Select(c => AutomationProperties.GetName(c)).Select(name => name == "Pause" ? "Play" : name));
    }

    [AvaloniaFact]
    public void Space_on_a_button_that_was_clicked_pauses_and_does_not_press_it()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.Play("checkout", 0);
        Settle(window);
        var next = Named(reader.Card, "Next")!;
        Assert.True(next.Focus(NavigationMethod.Pointer));
        window.PressSpace();
        Settle(window);
        Assert.Equal(0, reader.PlayingStep);
        Assert.NotNull(Named(reader.Card, "Play"));
    }

    [AvaloniaFact]
    public void A_button_Tab_came_to_keeps_Space()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.Play("checkout", 0);
        Settle(window);
        var next = Named(reader.Card, "Next")!;
        Assert.True(next.Focus(NavigationMethod.Tab));
        window.PressSpace();
        Settle(window);
        Assert.Equal(1, reader.PlayingStep);
    }

    [AvaloniaFact]
    public void Space_held_down_pauses_once()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.Play("checkout", 0);
        Settle(window);
        for (var i = 0; i < 3; i++) window.KeyPress(Key.Space, RawInputModifiers.None, PhysicalKey.Space, " "); // Windows repeats a key held down
        window.KeyRelease(Key.Space, RawInputModifiers.None, PhysicalKey.Space, " ");
        Settle(window);
        Assert.NotNull(Named(reader.Card, "Play"));
    }

    [AvaloniaFact]
    public void Play_and_Pause_are_one_width_so_Next_stays_put()
    {
        var (temp, window, reader) = Open();
        using var _ = temp;
        reader.Play("checkout", 0);
        window.PressSpace(); // paused before its motion can end
        Settle(window);
        double NextX() => Named(reader.Card, "Next")!.TranslatePoint(new Point(0, 0), window)!.Value.X;
        var play = Named(reader.Card, "Play");
        Assert.NotNull(play);
        var (width, x) = (play.Bounds.Width, NextX());
        window.PressSpace();
        window.UpdateLayout();
        var pause = Named(reader.Card, "Pause");
        Assert.NotNull(pause); // the button changed its word
        Assert.Equal(width, pause.Bounds.Width);
        Assert.Equal(x, NextX());
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
