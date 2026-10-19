using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>The flow a step says its story continues in: its id and name, and whether it can play (it has steps, and its view opens).</summary>
internal sealed record LinkedFlow(string Id, string Name, bool Playable);

/// <summary>One step of the stop on show, as the card tells it. <c>Lane</c> is "" unless the stop is in a parallel group.</summary>
internal sealed record PlayerStep(string Ends, string Text, string? Description, string Lane, LinkedFlow? Link);

/// <summary>Everything the card shows: where the flow is (a stop of <c>Count</c>), the group the stop is in, the progress bar, the steps, and the trail back.</summary>
internal sealed record PlayerView(
    string FlowName, int Stop, int Count, string? Kind, Caption Caption, Progress Progress, bool Auto, bool Moving, (string Name, int Step)? Trail, IReadOnlyList<PlayerStep> Steps);

/// <summary>The card at the bottom while a flow plays: which stop, the group it is in, who talks to whom, what happens, and Back, Next and Stop.</summary>
internal sealed class PlayerCard : Border
{
    public event Action? Back;
    public event Action? Next;
    public event Action? Stop;
    public event Action? Auto;
    public event Action? Replay;
    /// <summary>The reader chose to open the flow a step continues in.</summary>
    public event Action<string>? OpenFlow;
    /// <summary>The reader chose to go back to the flow this one was opened from.</summary>
    public event Action? BackToFlow;

    public PlayerCard()
    {
        Classes.Add("card");
        HorizontalAlignment = HorizontalAlignment.Center;
        VerticalAlignment = VerticalAlignment.Bottom;
        MaxWidth = 520;
        Margin = new Thickness(16, 0, 16, 24);
        IsVisible = false;
    }

    private Button Tool(string icon, string? text, Action click, bool enabled = true, bool primary = false, string? name = null)
    {
        var button = new Button { IsEnabled = enabled };
        button.Classes.Add("tool");
        if (primary) button.Classes.Add("primary");
        Chrome.Fill(button, icon, text, name);
        button.Click += (_, _) => click();
        return button;
    }

    /// <summary>
    /// How far a flow has got: a cell for each stop, filled up to the stop shown, a branch's lanes on rows of their own, and under them a
    /// bracket for each group. A cell says its lane and a bracket says what its group means when you point at it.
    /// </summary>
    private static Control Bar(Progress progress, int now)
    {
        Grid Columns()
        {
            var grid = new Grid { ColumnSpacing = 3 };
            for (var c = 0; c < progress.Cols; c++) grid.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Star));
            return grid;
        }
        var cells = Columns();
        cells.RowSpacing = 0;
        cells.Margin = new Thickness(0, 2, 0, 0);
        for (var r = 0; r < Math.Max(1, progress.Rows); r++) cells.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        foreach (var cell in progress.Cells)
        {
            var segment = new Border();
            segment.Classes.Add("seg");
            if (cell.Stop <= now) segment.Classes.Add("done");
            // A strip four pixels high is hard to point at, so each sits in a taller one that takes the pointer.
            var hit = new Border { Background = Brushes.Transparent, Padding = new Thickness(0, 3), Child = segment };
            if (cell.Title != "") ToolTip.SetTip(hit, cell.Title);
            Grid.SetColumn(hit, cell.Col);
            Grid.SetRow(hit, cell.Row);
            cells.Children.Add(hit);
        }
        var bar = new StackPanel { Children = { cells } };
        if (progress.Brackets.Count == 0) return bar;
        var brackets = Columns();
        brackets.Margin = new Thickness(0, -3, 0, 4);
        foreach (var b in progress.Brackets)
        {
            var label = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 3, HorizontalAlignment = HorizontalAlignment.Center };
            label.Children.Add(Icons.Make(Icons.ForKind(b.Kind), "chipicon", 11));
            label.Children.Add(new TextBlock { Text = b.Text, FontSize = 10.5, Classes = { "muted" } });
            var bracket = new Border { Child = label, Padding = new Thickness(0, 1, 0, 0), Background = Brushes.Transparent };
            bracket.Classes.Add("bracket");
            ToolTip.SetTip(bracket, b.Title);
            Grid.SetColumn(bracket, b.From);
            Grid.SetColumnSpan(bracket, b.To - b.From + 1);
            brackets.Children.Add(bracket);
        }
        bar.Children.Add(brackets);
        return bar;
    }

    private Control Block(PlayerStep step, bool lane)
    {
        var block = new StackPanel { Spacing = 4 };
        if (step.Lane != "")
        {
            var name = new TextBlock { Text = step.Lane };
            name.Classes.Add("lane");
            block.Children.Add(name);
        }
        block.Children.Add(new TextBlock { Text = step.Ends, FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap });
        block.Children.Add(new TextBlock { Text = step.Text, TextWrapping = TextWrapping.Wrap });
        if (!string.IsNullOrEmpty(step.Description))
        {
            var more = new MarkdownView(step.Description) { IsVisible = false, Margin = new Thickness(0, 4, 0, 0) };
            var header = new Button { Content = "▸ More" };
            header.Classes.Add("disclosure");
            header.Click += (_, _) =>
            {
                more.IsVisible = !more.IsVisible;
                header.Content = more.IsVisible ? "▾ More" : "▸ More";
            };
            block.Children.Add(new StackPanel { Children = { header, more } });
        }
        if (step.Link is { } link)
        {
            var open = Tool(Icons.Route, $"Open flow: {link.Name}", () => OpenFlow?.Invoke(link.Id), link.Playable);
            open.HorizontalAlignment = HorizontalAlignment.Left;
            block.Children.Add(open);
        }
        if (!lane) return block;
        var framed = new Border { Child = block, Padding = new Thickness(10, 0, 0, 0), BorderThickness = new Thickness(3, 0, 0, 0) };
        framed.Classes.Add("laneblock");
        return framed;
    }

    public void Show(PlayerView v)
    {
        var column = new StackPanel { Spacing = 8 };
        if (v.Trail is { } trail)
        {
            var back = Tool(Icons.ArrowLeft, $"Back to “{trail.Name}”, step {trail.Step}", () => BackToFlow?.Invoke());
            back.Classes.Add("trail");
            back.HorizontalAlignment = HorizontalAlignment.Stretch;
            back.HorizontalContentAlignment = HorizontalAlignment.Left;
            column.Children.Add(back);
        }
        var chips = new List<Control> { Chrome.Chip(v.FlowName, Icons.Play), Chrome.Chip($"Step {v.Stop + 1} of {v.Count}", null, "accent") };
        if (v.Caption.Chip != "") chips.Add(Chrome.Chip(v.Caption.Chip, Icons.ForKind(v.Kind)));
        column.Children.Add(Chrome.Chips([.. chips]));
        if (v.Caption.Tabs.Count > 0)
        {
            var tabs = new WrapPanel { Orientation = Orientation.Horizontal };
            for (var i = 0; i < v.Caption.Tabs.Count; i++)
            {
                var tab = new Border { Child = new TextBlock { Text = v.Caption.Tabs[i] }, Margin = new Thickness(0, 0, 6, 4) };
                tab.Classes.Add("tab");
                if (i == v.Caption.Tab) tab.Classes.Add("on");
                tabs.Children.Add(tab);
            }
            column.Children.Add(tabs);
        }
        if (v.Caption.Text != "") column.Children.Add(new TextBlock { Text = v.Caption.Text, FontSize = 12.5, TextWrapping = TextWrapping.Wrap, Classes = { "muted" } });
        column.Children.Add(Bar(v.Progress, v.Stop));
        foreach (var step in v.Steps) column.Children.Add(Block(step, v.Steps.Count > 1));
        var buttons = new DockPanel { Margin = new Thickness(0, 6, 0, 0), LastChildFill = false };
        var stop = Tool(Icons.Close, "Stop", () => Stop?.Invoke());
        stop.Margin = new Thickness(16, 0, 0, 0);
        DockPanel.SetDock(stop, Dock.Right);
        buttons.Children.Add(stop);
        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { Tool(Icons.ArrowLeft, "Back", () => Back?.Invoke(), v.Stop > 0), Tool(Icons.ArrowRight, "Next", () => Next?.Invoke(), v.Stop < v.Count - 1, primary: true) } };
        left.Children.Add(v.Auto ? Tool(Icons.Pause, "Pause", () => Auto?.Invoke()) : Tool(Icons.Play, "Autoplay", () => Auto?.Invoke()));
        if (v.Moving) left.Children.Add(Tool(Icons.Reload, null, () => Replay?.Invoke(), name: "Replay this step"));
        buttons.Children.Add(left);
        column.Children.Add(buttons);
        Child = column;
        IsVisible = true;
    }

    public void Clear()
    {
        IsVisible = false;
        Child = null;
    }
}
