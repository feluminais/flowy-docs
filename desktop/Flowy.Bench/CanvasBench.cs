using System.Diagnostics;
using System.Text;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Input;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using Flowy.App;
using Flowy.Core;

namespace Flowy.Bench;

/// <summary>The headless platform with Skia drawing, so a frame is really rasterised (on the processor).</summary>
public static class BenchApp
{
    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<Flowy.App.App>().UseSkia().UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = false });
}

/// <summary>dotnet run -c Release --project desktop/Flowy.Bench -- canvas [boxes]: what the desktop canvas costs for a big view, per step of pan, hover, drag and wheel.</summary>
internal static class CanvasBench
{
    public static void Run(int boxes)
    {
        var root = Path.Combine(Path.GetTempPath(), $"flowy-canvas-bench-{Environment.ProcessId}");
        var dir = Path.Combine(root, "flowy");
        Directory.CreateDirectory(dir);
        try
        {
            var rnd = new Random(11);
            var sb = new StringBuilder("objects:\n  sys-0:\n    type: system\n    name: Big system\n");
            for (var i = 0; i < boxes; i++) sb.Append($"  app-{i}:\n    type: app\n    in: sys-0\n    name: App {i}\n    tech: Node\n    description: The app-{i} service, which does one thing.\n");
            sb.Append("connections:\n");
            var seen = new HashSet<(int, int)>();
            var lines = new List<(int From, int To)>();
            while (lines.Count < boxes * 3 / 2)
            {
                var (f, t) = (rnd.Next(boxes), rnd.Next(boxes));
                if (f == t || !seen.Add((f, t))) continue;
                lines.Add((f, t));
                sb.Append(rnd.NextDouble() < 0.3 ? $"  - {{ from: app-{f}, to: app-{t}, label: calls }}\n" : $"  - {{ from: app-{f}, to: app-{t} }}\n");
            }
            File.WriteAllText(Path.Combine(dir, "model.yaml"), sb.ToString());
            var layout = new StringBuilder("sys-0:\n");
            for (var i = 0; i < boxes; i++) layout.Append($"  app-{i}: [{i % 15 * 260}, {i / 15 * 140}]\n");
            File.WriteAllText(Path.Combine(dir, "layout.yaml"), layout.ToString());

            using var session = HeadlessUnitTestSession.StartNew(typeof(BenchApp));
            session.Dispatch(() => Measure(dir, boxes, lines), CancellationToken.None).GetAwaiter().GetResult();
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }

    private static void Measure(string dir, int boxes, List<(int From, int To)> lines)
    {
        Console.WriteLine($"{boxes} boxes, {lines.Count} lines");
        var reader = new ReaderView();
        var window = new Window { Width = 1400, Height = 900, Content = reader };
        window.Show();
        double Time(Action act) { var sw = Stopwatch.StartNew(); act(); return sw.Elapsed.TotalMilliseconds; }
        void Row(string what, double ms, string? more = null) => Console.WriteLine($"{what,-52}{ms,9:0.00} ms{(more is null ? "" : "   " + more)}");
        void Settle() { Dispatcher.UIThread.RunJobs(); AvaloniaHeadlessPlatform.ForceRenderTimerTick(); Dispatcher.UIThread.RunJobs(); }
        using var target = new RenderTargetBitmap(new PixelSize(1400, 900));
        double Frame() => Time(() => target.Render(window));

        var folder = FolderLoader.Load(dir);
        if (Environment.GetEnvironmentVariable("OPENSPLIT") is not null)
        {
            var scene = SceneBuilder.Build(folder.Model, "sys-0");
            Row("  build the scene", Time(() => SceneBuilder.Build(folder.Model, "sys-0")));
            var made = new List<Flowy.App.Canvas.BoxControl>();
            Row("  make the box controls", Time(() => { foreach (var b in scene.Boxes) made.Add(new Flowy.App.Canvas.BoxControl(b)); }));
            var cv = new Flowy.App.Canvas.CanvasView();
            var w2 = new Window { Width = 1400, Height = 900, Content = cv };
            w2.Show();
            Row("  set the scene on a canvas (make + attach)", Time(() => cv.SetScene(scene, "straight", [])));
            Row("  layout and styles", Time(() => Dispatcher.UIThread.RunJobs()));
            w2.Close();
            foreach (var kind in new[] { "Grid", "Path", "TextBlock", "Border" })
            {
                var holder = new Avalonia.Controls.Canvas();
                var w4 = new Window { Width = 1400, Height = 900, Content = holder };
                w4.Show();
                var items = Enumerable.Range(0, 9000).Select(_ => kind switch { "Grid" => (Control)new Grid(), "Path" => new Avalonia.Controls.Shapes.Path { Width = 10, Height = 10 }, "TextBlock" => new TextBlock { Text = "x" }, _ => new Border() }).ToList();
                Row($"  attach 9000 plain {kind}", Time(() => { foreach (var c in items) holder.Children.Add(c); Dispatcher.UIThread.RunJobs(); }));
                w4.Close();
            }
            foreach (var withClass in new[] { true, false })
            {
                var fresh = scene.Boxes.Select(b => new Flowy.App.Canvas.BoxControl(b)).ToList();
                if (!withClass) foreach (var c in fresh) c.Classes.Remove("box");
                var holder = new Avalonia.Controls.Canvas();
                var w3 = new Window { Width = 1400, Height = 900, Content = holder };
                w3.Show();
                Row($"  attach {fresh.Count} boxes, class box {(withClass ? "on" : "off")}", Time(() => { foreach (var c in fresh) holder.Children.Add(c); Dispatcher.UIThread.RunJobs(); }));
                w3.Close();
            }
        }
        Row("open the view (build scene, make every box)", Time(() => { reader.Load(folder, dir); reader.GoTo("sys-0"); Settle(); }));
        Row("first frame drawn", Frame());
        if (Environment.GetEnvironmentVariable("SHOT") is { } shot) { using var file = File.Create(shot);
#pragma warning disable CS0618
            target.Save(file);
#pragma warning restore CS0618
        }
        Row("a frame drawn again, nothing moved", Median(Frame));

        var canvas = reader.Canvas;
        // The camera: a step of a pan is a move of the view and a frame.
        var view = canvas.Viewport;
        var step = 0;
        var ui = new List<double>();
        var raster = new List<double>();
        for (var i = 0; i < 20; i++)
        {
            ui.Add(Time(() => { canvas.MoveTo(new Viewport(view.X + ++step * 7, view.Y + step * 3, view.Zoom)); Dispatcher.UIThread.RunJobs(); }));
            raster.Add(Frame());
        }
        Row("pan one step: the move", Median(ui));
        Row("pan one step: the frame drawn", Median(raster));

        // Pointing at a line, then away: what the reader redraws.
        var hover = new List<double>();
        var hoverFrame = new List<double>();
        for (var i = 0; i < 20; i++)
        {
            var (f, t) = lines[i];
            var id = SceneBuilder.LineId($"app-{f}", $"app-{t}");
            hover.Add(Time(() => { reader.SetHover(id); Dispatcher.UIThread.RunJobs(); }));
            hoverFrame.Add(Frame());
            reader.SetHover(null);
        }
        Row("point at a line: the redraw of the scene", Median(hover));
        Row("point at a line: the frame drawn", Median(hoverFrame));

        // Edit mode: pick a box up and move it about.
        reader.SetEditing(true);
        Settle();
        canvas.MoveTo(new Viewport(0, 0, 0.6));
        Settle();
        var grab = ((Visual)canvas.BoxControlFor("app-20")!).TranslatePoint(new Point(60, 20), window)!.Value;
        window.MouseDown(grab, MouseButton.Left);
        var drag = new List<double>();
        var dragFrame = new List<double>();
        for (var i = 1; i <= 20; i++)
        {
            var to = new Point(grab.X + i * 5, grab.Y + i * 2);
            drag.Add(Time(() => { window.MouseMove(to, RawInputModifiers.LeftMouseButton); Dispatcher.UIThread.RunJobs(); }));
            dragFrame.Add(Frame());
        }
        window.MouseUp(new Point(grab.X + 100, grab.Y + 40), MouseButton.Left);
        Row("move a box in edit mode: the move", Median(drag));
        Row("move a box in edit mode: the frame drawn", Median(dragFrame));
        reader.SetEditing(false);
        Settle();

        var wheel = new List<double>();
        for (var i = 0; i < 20; i++)
        {
            var notch = i;
            wheel.Add(Time(() => { window.MouseWheel(new Point(700, 450), new Vector(0, notch % 2 == 0 ? 1 : -1)); Dispatcher.UIThread.RunJobs(); }));
            Frame();
        }
        Row("wheel zoom one notch: the move", Median(wheel));
    }

    private static double Median(Func<double> measure, int runs = 7) => Median(Enumerable.Range(0, runs).Select(_ => measure()).ToList());

    private static double Median(List<double> values)
    {
        var sorted = values.Order().ToList();
        return sorted[sorted.Count / 2];
    }
}
