using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The panel at the right of the canvas: a box's description, code and connections, or the connections one line stands for. It shows one
/// thing at a time. Pointing at a connection lights its line on the canvas; the other box's name opens its panel.
/// </summary>
internal sealed class SidePanel : Border
{
    private static readonly FontFamily Mono = new("Cascadia Mono, Consolas, Menlo, monospace");

    public const double Width380 = 380;

    public event Action? Closed;

    public SidePanel()
    {
        Classes.Add("panel");
        Width = Width380;
        HorizontalAlignment = HorizontalAlignment.Right;
        IsVisible = false;
        Focusable = false;
    }

    private IBrush Resource(string key) =>
        this.TryFindResource(key, ActualThemeVariant, out var found) && found is IBrush b ? b : Brushes.Gray;

    public void Clear()
    {
        IsVisible = false;
        Child = null;
    }

    private void Show(Control content)
    {
        var close = new Button { Content = "×", HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 6, 8, 0), FontSize = 22 };
        close.Classes.Add("close");
        close.Click += (_, _) => Closed?.Invoke();
        Avalonia.Automation.AutomationProperties.SetName(close, "Close");
        Child = new Grid
        {
            Children =
            {
                new ScrollViewer { Content = new StackPanel { Margin = new Thickness(20, 16, 20, 20), Children = { content } }, VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto },
                close,
            },
        };
        IsVisible = true;
    }

    private Control Heading(string text) => new TextBlock { Text = text, FontSize = 18, FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 32, 0) };

    private Control Muted(string text, double size = 14) => new TextBlock { Text = text, FontSize = size, Foreground = Resource("MutedBrush"), TextWrapping = TextWrapping.Wrap };

    private Control Problems(IEnumerable<string> messages)
    {
        var list = messages.ToList();
        if (list.Count == 0) return new Panel();
        var items = new StackPanel { Spacing = 2 };
        foreach (var m in list) items.Children.Add(new TextBlock { Text = "• " + m, Foreground = Resource("WarnFgBrush"), TextWrapping = TextWrapping.Wrap });
        return new Border { Background = Resource("WarnBgBrush"), CornerRadius = new CornerRadius(6), Padding = new Thickness(10, 8), Child = items };
    }

    private Button Link(string text, Action click, bool mono = false)
    {
        var button = new Button { Content = new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap, FontFamily = mono ? Mono : FontFamily.Default, FontSize = mono ? 13 : 14 } };
        button.Classes.Add("link");
        button.Click += (_, _) => click();
        return button;
    }

    private static string Describe(Model model, Connection c) => $"{Views.NameOf(model, c.From ?? "")} → {Views.NameOf(model, c.To ?? "")}";

    /// <summary>A box: its name, type and tech, any problems, its description, the files it lives in, and every line out and in.</summary>
    public void ShowObject(Model model, string id, IReadOnlyList<Problem> problems, string? codeBase, Action<string> pick, Action<string?> hover)
    {
        if (model.GetObject(id) is not { } o)
        {
            Clear();
            return;
        }
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(Heading(string.IsNullOrEmpty(o.Name) ? id : o.Name));
        column.Children.Add(Muted($"{(Model.IsExternal(o) ? "external " : "")}{o.Type}{(string.IsNullOrEmpty(o.Tech) ? "" : $" · {o.Tech}")}"));
        column.Children.Add(Problems(Navigation.ProblemsOf(model, problems, id).Select(p => p.Message)));
        column.Children.Add(string.IsNullOrEmpty(o.Description) ? Muted("No description yet.") : new MarkdownView(o.Description));

        var paths = o.Code is List<object?> code ? code.OfType<string>().ToList() : [];
        if (paths.Count > 0)
        {
            var list = new StackPanel { Spacing = 4 };
            foreach (var path in paths)
            {
                // A path the checks flag (../..) is shown, not linked: the address would be built from it.
                var address = codeBase is null || !Checks.IsRepoPath(path) ? null : codeBase + CodeLinks.EncodePath(path);
                list.Children.Add(address is not null && WebAddress.IsSafe(address)
                    ? Link(path, () => Open(address), mono: true)
                    : new TextBlock { Text = path, FontFamily = Mono, FontSize = 13, TextWrapping = TextWrapping.Wrap });
            }
            column.Children.Add(list);
        }

        var (outgoing, incoming) = Navigation.LinesOf(model, id);
        if (outgoing.Count > 0) column.Children.Add(Lines(model, "Out", "→", outgoing, pick, hover));
        if (incoming.Count > 0) column.Children.Add(Lines(model, "In", "←", incoming, pick, hover));
        Show(column);
    }

    private Control Lines(Model model, string title, string arrow, List<BoxLine> lines, Action<string> pick, Action<string?> hover)
    {
        var section = new StackPanel { Spacing = 4, Margin = new Thickness(0, 8, 0, 0) };
        section.Children.Add(new TextBlock { Text = title, FontSize = 12, FontWeight = FontWeight.SemiBold, Foreground = Resource("MutedBrush"), Margin = new Thickness(0, 0, 0, 2) });
        foreach (var line in lines)
        {
            var lineId = SceneBuilder.LineId(line.From, line.To);
            var details = new StackPanel { Spacing = 2 };
            details.Children.Add(Link(Views.NameOf(model, line.Other), () => pick(line.Other)));
            if (line.Connections.Count == 1)
            {
                var c = line.Connections[0];
                details.Children.Add(string.IsNullOrEmpty(c.Label) ? Muted("no label") : new TextBlock { Text = c.Label, TextWrapping = TextWrapping.Wrap });
                if (c.From != line.From || c.To != line.To) details.Children.Add(Muted(Describe(model, c), 12));
            }
            else details.Children.Add(Disclosure($"{line.Connections.Count} connections", model, line.Connections));
            var row = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 8, Background = Brushes.Transparent, Margin = new Thickness(-8, 0), Children = { new TextBlock { Text = arrow, Foreground = Resource("MutedBrush"), Margin = new Thickness(8, 6, 0, 0), VerticalAlignment = VerticalAlignment.Top }, details } };
            Grid.SetColumn(details, 1);
            details.Margin = new Thickness(0, 4, 8, 4);
            row.PointerEntered += (_, _) => hover(lineId);
            row.PointerExited += (_, _) => hover(null);
            section.Children.Add(row);
        }
        return section;
    }

    /// <summary>"N connections", opening to list each with its label and the boxes inside it that it joins.</summary>
    private Control Disclosure(string title, Model model, IReadOnlyList<Connection> connections)
    {
        var items = new StackPanel { Spacing = 8, Margin = new Thickness(0, 6, 0, 0), IsVisible = false };
        foreach (var c in connections)
        {
            var item = new StackPanel { Spacing = 0 };
            item.Children.Add(string.IsNullOrEmpty(c.Label) ? Muted("no label") : new TextBlock { Text = c.Label, TextWrapping = TextWrapping.Wrap });
            item.Children.Add(Muted(Describe(model, c), 12));
            items.Children.Add(item);
        }
        var header = new Button { Content = $"▸ {title}" };
        header.Classes.Add("disclosure");
        header.Click += (_, _) =>
        {
            items.IsVisible = !items.IsVisible;
            header.Content = $"{(items.IsVisible ? "▾" : "▸")} {title}";
        };
        return new StackPanel { Children = { header, items } };
    }

    /// <summary>A line in the view: the connections it stands for, each with its label and problems.</summary>
    public void ShowLine(Model model, string view, string from, string to, IReadOnlyList<Problem> problems)
    {
        var lines = Navigation.ConnectionsOf(model, view, from, to);
        if (lines.Count == 0)
        {
            Clear();
            return;
        }
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(Heading($"{Views.NameOf(model, from)} → {Views.NameOf(model, to)}"));
        foreach (var (index, c) in lines)
        {
            var section = new StackPanel { Spacing = 4 };
            if (c.From != from || c.To != to) section.Children.Add(Muted(Describe(model, c)));
            section.Children.Add(string.IsNullOrEmpty(c.Label) ? Muted("No label") : new TextBlock { Text = c.Label, TextWrapping = TextWrapping.Wrap });
            section.Children.Add(Problems(problems.Where(p => p.Connection == index).Select(p => p.Message)));
            column.Children.Add(section);
        }
        Show(column);
    }

    private void Open(string address)
    {
        if (TopLevel.GetTopLevel(this) is { } top) _ = top.Launcher.LaunchUriAsync(new Uri(address));
    }
}
