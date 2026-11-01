using System.Diagnostics;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.LogicalTree;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.App.Canvas;
using Flowy.Core;
using Xunit;
using Rect = Avalonia.Rect;

namespace Flowy.App.Tests;

/// <summary>
/// The payload card on a paused dot, as browser-tests/dot-card.spec.ts drives the browser's: web → api is a call that sends Order and gets Receipt back, api → db a send
/// with nothing named. Motion is on, so these are heavy.
/// </summary>
[Trait("Weight", "Heavy")]
public class DotCardTests
{
    private const string Source = """
        payloads:
          order: { name: Order, about: What the web app sends. }
          receipt: { name: Receipt, about: What comes back. }
        objects:
          shop: { type: system, name: Shop }
          web: { type: app, in: shop, name: Web app }
          api: { type: app, in: shop, name: API }
          db: { type: store, in: shop, name: Orders DB }
        connections:
          - { from: web, to: api, label: REST }
          - { from: api, to: db, label: saves }
        """;

    private const string Flow = """
        name: Checkout
        view: shop
        steps:
          - { from: web, to: api, text: Places the order, animation: call, payload: order, reply: receipt }
          - { from: api, to: db, text: Saves it, animation: send }
        """;

    private static (TempFolder Temp, Window Window, ReaderView Reader) Open(string source = Source)
    {
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0");
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(Path.Combine(dir, "flows"));
        File.WriteAllText(Path.Combine(dir, "model.yaml"), source);
        File.WriteAllText(Path.Combine(dir, "flows", "checkout.yaml"), Flow);
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 800, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        reader.GoTo("shop");
        return (temp, window, reader);
    }

    /// <summary>Lets frames and timers run until <paramref name="done"/>, or a few seconds pass. A headless window draws no frames of its own.</summary>
    private static void Run(Func<bool> done, double seconds = 10)
    {
        var clock = Stopwatch.StartNew();
        while (clock.Elapsed < TimeSpan.FromSeconds(seconds) && !done())
        {
            AvaloniaHeadlessPlatform.ForceRenderTimerTick();
            Dispatcher.UIThread.RunJobs();
            Thread.Sleep(5);
        }
    }

    private static void Finish() => Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1"); // the other tests turn motion off

    /// <summary>Plays step <paramref name="step"/> and pauses it while its first dot (or its answer's, with <paramref name="reply"/>) is on its way.</summary>
    private static void PauseMidSend(ReaderView reader, int step = 0, bool reply = false)
    {
        reader.Play("checkout", step);
        var beat = reader.Canvas.PlayingBeats.First(b => b.Do == "blob" && (b.Tone == "reply") == reply);
        Run(() => reader.Canvas.Clock.Elapsed > beat.At + beat.Dur / 3.0);
        reader.Canvas.Clock.Pause();
        reader.Canvas.Clock.Seek(beat.At + beat.Dur / 2.0);
        Run(() => reader.Canvas.DotsOnScreen.Count > 0, 2);
    }

    private static Point Middle(Rect r) => new(r.X + r.Width / 2, r.Y + r.Height / 2);

    private static string? Heading(DotCard card) => AutomationProperties.GetName(card);

    [AvaloniaFact]
    public void Paused_mid_send_the_dot_under_the_pointer_shows_its_payload_beside_it()
    {
        var (temp, _, reader) = Open();
        using var _t = temp;
        try
        {
            PauseMidSend(reader);
            reader.Canvas.HoverDotAt(Middle(reader.Canvas.DotsOnScreen[0]));
            Run(() => false, 0.1);
            var card = reader.Canvas.DotCardNow;
            Assert.NotNull(card);
            Assert.True(card.IsVisible);
            Assert.Equal("Order", Heading(card));
            Assert.Contains(card.GetVisualDescendants().OfType<TextBlock>(), t => t.Text == "Order");
            Assert.Contains(card.GetLogicalDescendants().OfType<Control>(), c => c is MarkdownView);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void While_the_dot_moves_hovering_it_shows_nothing()
    {
        var (temp, _, reader) = Open();
        using var _t = temp;
        try
        {
            reader.Play("checkout", 0);
            var beat = reader.Canvas.PlayingBeats.First(b => b.Do == "blob");
            Run(() => reader.Canvas.Clock.Elapsed > beat.At + beat.Dur / 3.0);
            Assert.False(reader.Canvas.Clock.Paused);
            Assert.Empty(reader.Canvas.DotsOnScreen);
            reader.Canvas.HoverDotAt(new Point(600, 400));
            Assert.Null(reader.Canvas.DotCardNow);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void The_answers_dot_shows_the_reply_with_the_back_arrow()
    {
        var (temp, _, reader) = Open();
        using var _t = temp;
        try
        {
            PauseMidSend(reader, reply: true);
            reader.Canvas.HoverDotAt(Middle(reader.Canvas.DotsOnScreen[0]));
            Run(() => false, 0.1);
            var card = reader.Canvas.DotCardNow!;
            Assert.Equal("Receipt", Heading(card));
            Assert.Equal("Comes back", AutomationProperties.GetHelpText(card));
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void The_card_stays_inside_the_canvas_and_off_the_player_card()
    {
        var (temp, _, reader) = Open();
        using var _t = temp;
        try
        {
            PauseMidSend(reader);
            reader.Canvas.HoverDotAt(Middle(reader.Canvas.DotsOnScreen[0]));
            Run(() => false, 0.2);
            var card = reader.Canvas.DotCardNow!;
            var shown = new Rect(card.TranslatePoint(new Point(0, 0), reader.Canvas)!.Value, card.Bounds.Size);
            Assert.True(new Rect(reader.Canvas.Bounds.Size).Contains(shown), $"{shown} inside {reader.Canvas.Bounds.Size}");
            var player = reader.GetVisualDescendants().OfType<PlayerCard>().First(p => p.IsVisible);
            var bar = new Rect(player.TranslatePoint(new Point(0, 0), reader.Canvas)!.Value, player.Bounds.Size);
            Assert.False(shown.Intersects(bar), $"{shown} off {bar}");
            Assert.True(card.Bounds.Width <= MotionMath.Card.Width && card.Bounds.Height <= MotionMath.Card.Height);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void Play_Esc_a_zoom_or_leaving_it_closes_it()
    {
        var (temp, window, reader) = Open();
        using var _t = temp;
        try
        {
            void Hover()
            {
                reader.Canvas.HoverDotAt(Middle(reader.Canvas.DotsOnScreen[0]));
                Run(() => false, 0.05);
                Assert.NotNull(reader.Canvas.DotCardNow);
            }
            PauseMidSend(reader);
            Hover();
            window.KeyPress(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);
            Assert.Null(reader.Canvas.DotCardNow);
            Assert.Equal(0, reader.PlayingStep); // Esc went to the card, not to the flow
            Hover();
            reader.Canvas.ZoomBy(1.2); // animated: the card goes on its first frame
            Run(() => reader.Canvas.DotCardNow is null, 1);
            Assert.Null(reader.Canvas.DotCardNow);
            Run(() => false, 0.3); // the zoom settles
            Hover();
            reader.Canvas.HoverDotAt(new Point(5, 5));
            Run(() => reader.Canvas.DotCardNow is null, 1);
            Assert.Null(reader.Canvas.DotCardNow);
            Hover();
            reader.Canvas.Clock.Play();
            Assert.Null(reader.Canvas.DotCardNow);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void A_dot_whose_step_sends_nothing_has_no_card()
    {
        var (temp, _, reader) = Open();
        using var _t = temp;
        try
        {
            PauseMidSend(reader, step: 1);
            Assert.NotEmpty(reader.Canvas.DotsOnScreen);
            reader.Canvas.HoverDotAt(Middle(reader.Canvas.DotsOnScreen[0]));
            Run(() => false, 0.1);
            Assert.Null(reader.Canvas.DotCardNow);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void A_long_payload_keeps_the_card_at_380_by_320()
    {
        var shape = string.Join("\n", Enumerable.Range(0, 400).Select(i => $"      field{i}: string"));
        var source = Source.Replace("order: { name: Order, about: What the web app sends. }", $"order:\n    name: Order\n    about: What the web app sends.\n    shape:\n      language: typescript\n      text: |\n        type Order = {{\n{shape.Replace("      ", "          ")}\n        }}");
        var (temp, _, reader) = Open(source);
        using var _t = temp;
        try
        {
            PauseMidSend(reader);
            reader.Canvas.HoverDotAt(Middle(reader.Canvas.DotsOnScreen[0]));
            Run(() => false, 0.2);
            var card = reader.Canvas.DotCardNow!;
            Assert.True(card.Bounds.Width <= 380 && card.Bounds.Height <= 320, card.Bounds.ToString());
            var scroll = card.GetVisualDescendants().OfType<ScrollViewer>().First();
            Assert.True(scroll.Extent.Height > scroll.Viewport.Height);
        }
        finally
        {
            Finish();
        }
    }

    [AvaloniaFact]
    public void With_motion_reduced_there_are_no_dots()
    {
        var (temp, _, reader) = Open();
        using var _t = temp;
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        reader.Play("checkout", 0);
        Run(() => false, 0.3);
        reader.Canvas.Clock.Pause();
        Assert.Empty(reader.Canvas.DotsOnScreen);
        Assert.Null(reader.Canvas.DotCardNow);
    }
}
