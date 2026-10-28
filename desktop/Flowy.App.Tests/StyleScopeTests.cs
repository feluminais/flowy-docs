using System.Text.RegularExpressions;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.LogicalTree;
using Avalonia.Styling;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>
/// The styles of an area (Styles/&lt;area&gt;.axaml, see <see cref="AreaStyles"/>) reach only the controls inside the control that loads them. So every control one of
/// them could style must sit inside that control: one drawn anywhere else would quietly lose its look. The scenes are the ones the screenshots are taken in.
/// </summary>
[Trait("Weight", "Heavy")]
public class StyleScopeTests
{
    private static string Plum => Path.Combine(Repo.Root, "docs", "demo");

    private static readonly string[][] Scenes =
    [
        [], ["--view", "ordering"], ["--view", "ordering", "--select", "order-api"], ["--view", "ordering", "--select", "order-api", "--edit"],
        ["--view", "ordering", "--edit", "--delete", "orders-db"], ["--view", "ordering", "--select", "orders-db"], ["--view", "ordering", "--flow", "place-order", "--step", "1"],
        ["--view", "ordering", "--flow", "capture-payment", "--step", "4"], ["--view", "ordering", "--flow", "stripe-outage", "--step", "3"],
        ["--view", "delivery", "--tab", "performance", "--select", "dispatch"], ["--view", "ordering", "--run", "stripe-outage", "--tab", "performance", "--at", "70"],
        ["--view", "delivery", "--run", "together", "--tab", "performance", "--at", "800,400"], ["--view", "ordering", "--tab", "failures", "--select", "stripe-timeout"],
        ["--compare", "refund,refund-not-recorded", "--changes"], ["--compare", "refund,refund-not-recorded,swap", "--changes"], ["--compare", "run:stripe-outage,together"],
        ["--search", "re"], ["--view", "ordering", "--tab", "explorer"], ["--view", "ordering", "--tab", "flows"], ["--view", "ordering", "--tab", "yaml"], ["--shortcuts"],
        ["--view", "ordering", "--edit", "--add"], ["--view", "ordering", "--edit", "--edit-flow", "refund"], ["--view", "ordering", "--line", "web order-api"],
        ["--view", "ordering", "--hover", "web order-api"],
    ];

    /// <summary>A selector as the classes it asks of the control (last) and of the controls above it (the rest, outermost first). Types and pseudo-classes are left out, which can only make the test stricter.</summary>
    private sealed record Wanted(string Area, string Selector, IReadOnlyList<string[]> Above, string[] Own);

    private static List<Wanted> AreaSelectors()
    {
        var all = new List<Wanted>();
        foreach (var (host, area) in AreaStyles.Hosts)
        {
            var text = File.ReadAllText(Path.Combine(Repo.Root, "desktop", "Flowy.App", "Styles", $"{area}.axaml"));
            foreach (Match m in Regex.Matches(text, "<Style Selector=\"([^\"]*)\""))
            {
                foreach (var alt in m.Groups[1].Value.Split(','))
                {
                    var parts = Regex.Replace(alt, @":not\([^)]*\)", "").Replace("/template/", " ").Replace(">", " ").Split(' ', StringSplitOptions.RemoveEmptyEntries)
                        .Select(p => Regex.Matches(p, @"\.([A-Za-z][\w-]*)").Select(c => c.Groups[1].Value).ToArray()).ToList();
                    if (parts[^1].Length == 0 && parts.All(p => p.Length == 0)) continue; // a type alone says nothing about where it is
                    all.Add(new Wanted(host, alt.Trim(), parts[..^1].Where(p => p.Length > 0).ToList(), parts[^1]));
                }
            }
        }
        return all;
    }

    [AvaloniaFact]
    public void Every_area_has_its_file_and_every_file_its_area()
    {
        var files = Directory.GetFiles(Path.Combine(Repo.Root, "desktop", "Flowy.App", "Styles"), "*.axaml").Select(Path.GetFileNameWithoutExtension).Order();
        Assert.Equal(files, AreaStyles.Hosts.Values.Order());
    }

    [AvaloniaFact]
    public void A_control_an_area_style_could_style_sits_inside_that_area()
    {
        TestApp.NoMotion();
        var wanted = AreaSelectors();
        var wrong = new List<string>();
        var folder = FolderLoader.Load(Path.Combine(Plum, "flowy"));
        foreach (var scene in Scenes)
        {
            var reader = new ReaderView();
            var window = new Window { Width = 1280, Height = 1000, Content = reader };
            window.Show();
            reader.Load(folder, Path.Combine(Plum, "flowy"));
            Dispatcher.UIThread.RunJobs();
            new LaunchScript(window, reader).Apply(LaunchOptions.Parse([Plum, .. scene]));
            for (var i = 0; i < 5; i++)
            {
                AvaloniaHeadlessPlatform.ForceRenderTimerTick();
                Dispatcher.UIThread.RunJobs();
            }
            window.UpdateLayout();
            foreach (var control in Everything(window))
            {
                if (control.Classes.Count == 0) continue;
                var above = Above(control).ToList();
                foreach (var w in wanted)
                {
                    if (!w.Own.All(control.Classes.Contains)) continue;
                    if (!w.Above.All(classes => above.Any(a => classes.All(a.Classes.Contains)))) continue;
                    if (above.Any(a => a.GetType().Name == w.Area) || control.GetType().Name == w.Area) continue;
                    wrong.Add($"{w.Selector} (Styles/{AreaStyles.Hosts[w.Area]}.axaml) would style a {control.GetType().Name} outside {w.Area}, in [{string.Join(' ', scene)}]");
                }
            }
            window.Close();
        }
        Assert.True(wrong.Count == 0, string.Join("\n", wrong.Distinct().Take(30)));
    }

    // Every control under the window: the visual tree (template parts too) and the logical tree (an open popup's content).
    private static IEnumerable<Control> Everything(Window window)
    {
        var seen = new HashSet<Control>();
        var stack = new Stack<Control>([window]);
        while (stack.Count > 0)
        {
            var c = stack.Pop();
            if (!seen.Add(c)) continue;
            yield return c;
            foreach (var v in c.GetVisualChildren().OfType<Control>()) stack.Push(v);
            foreach (var l in c.GetLogicalChildren().OfType<Control>()) stack.Push(l);
        }
    }

    // The controls whose styles reach this one, nearest first, as Avalonia walks them.
    private static IEnumerable<StyledElement> Above(Control control)
    {
        for (var at = ((IStyleHost)control).StylingParent; at is StyledElement e; at = ((IStyleHost)e).StylingParent) yield return e;
    }
}
