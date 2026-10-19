using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>The card at the bottom while a flow plays: which step, who talks to whom, what happens, and Back, Next and Stop.</summary>
internal sealed class PlayerCard : Border
{
    public event Action? Back;
    public event Action? Next;
    public event Action? Stop;
    public event Action? Auto;
    public event Action? Replay;

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

    /// <summary>One segment a step, filled up to the step shown.</summary>
    private static Control Progress(int index, int count)
    {
        var grid = new Grid { ColumnSpacing = 3, Margin = new Thickness(0, 2) };
        for (var i = 0; i < count; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Star));
            var segment = new Border();
            segment.Classes.Add("seg");
            if (i <= index) segment.Classes.Add("done");
            Grid.SetColumn(segment, i);
            grid.Children.Add(segment);
        }
        return grid;
    }

    public void Show(string flowName, int index, int count, string ends, string text, string? description, bool auto = false, bool moves = false)
    {
        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(Chrome.Chips(Chrome.Chip(flowName, Icons.Play), Chrome.Chip($"Step {index + 1} of {count}", null, "accent")));
        column.Children.Add(Progress(index, count));
        column.Children.Add(new TextBlock { Text = ends, FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap });
        column.Children.Add(new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap });
        if (!string.IsNullOrEmpty(description))
        {
            var more = new MarkdownView(description) { IsVisible = false, Margin = new Thickness(0, 4, 0, 0) };
            var header = new Button { Content = "▸ More" };
            header.Classes.Add("disclosure");
            header.Click += (_, _) =>
            {
                more.IsVisible = !more.IsVisible;
                header.Content = more.IsVisible ? "▾ More" : "▸ More";
            };
            column.Children.Add(new StackPanel { Children = { header, more } });
        }
        var buttons = new DockPanel { Margin = new Thickness(0, 6, 0, 0), LastChildFill = false };
        var stop = Tool(Icons.Close, "Stop", () => Stop?.Invoke());
        stop.Margin = new Thickness(16, 0, 0, 0);
        DockPanel.SetDock(stop, Dock.Right);
        buttons.Children.Add(stop);
        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { Tool(Icons.ArrowLeft, "Back", () => Back?.Invoke(), index > 0), Tool(Icons.ArrowRight, "Next", () => Next?.Invoke(), index < count - 1, primary: true) } };
        left.Children.Add(auto ? Tool(Icons.Pause, "Pause", () => Auto?.Invoke()) : Tool(Icons.Play, "Autoplay", () => Auto?.Invoke()));
        if (moves) left.Children.Add(Tool(Icons.Reload, null, () => Replay?.Invoke(), name: "Replay this step"));
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

/// <summary>A field over the canvas that finds a box anywhere in the model by name. ↑ and ↓ move, Enter picks, Esc or leaving the field closes it.</summary>
internal sealed class SearchBox : Border
{
    private readonly Model _model;
    private readonly Action<string> _pick;
    private readonly Action _close;
    private readonly TextBox _input = new() { PlaceholderText = "Find a shape by name", Classes = { "bare" } };
    private readonly StackPanel _results = new() { Margin = new Thickness(0, 6, 0, 0) };
    private List<string> _found = [];
    private int _at;

    public SearchBox(Model model, Action<string> pick, Action close, string query = "")
    {
        (_model, _pick, _close) = (model, pick, close);
        Classes.Add("card");
        HorizontalAlignment = HorizontalAlignment.Center;
        VerticalAlignment = VerticalAlignment.Top;
        Width = 420;
        MaxWidth = 10000;
        Margin = new Thickness(16, 12);
        Padding = new Thickness(8);
        var glass = Icons.Make(Icons.Search, "rowicon", 18);
        glass.VerticalAlignment = VerticalAlignment.Center;
        glass.Margin = new Thickness(6, 0, 4, 0);
        var field = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], Children = { glass, _input } };
        Grid.SetColumn(_input, 1);
        Child = new StackPanel { Children = { field, _results } };
        Avalonia.Automation.AutomationProperties.SetName(_input, "Find a shape by name");
        _input.TextChanged += (_, _) =>
        {
            _at = 0;
            Rebuild();
        };
        _input.KeyDown += OnKey;
        _input.LostFocus += (_, _) => _close();
        _input.Text = query;
        // Once it is on screen: a control can't take the focus before it has been laid out.
        AttachedToVisualTree += (_, _) => Avalonia.Threading.Dispatcher.UIThread.Post(() => _input.Focus(), Avalonia.Threading.DispatcherPriority.Loaded);
    }

    private void Rebuild()
    {
        var query = _input.Text ?? "";
        _found = Navigation.FindObjects(_model, query);
        _at = Math.Max(0, Math.Min(_at, _found.Count - 1));
        _results.Children.Clear();
        if (query.Trim() == "") return;
        if (_found.Count == 0)
        {
            _results.Children.Add(new TextBlock { Text = "Nothing called that.", Classes = { "muted" }, Margin = new Thickness(4, 2) });
            return;
        }
        for (var i = 0; i < _found.Count; i++)
        {
            var id = _found[i];
            var parent = Views.ParentOf(_model, id);
            var o = _model.Objects[id];
            var where = $"{o.Type}{(parent == Names.Root ? "" : $" in {Views.NameOf(_model, parent)}")}";
            var row = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 10,
                Children =
                {
                    Chrome.ObjectTile(_model, o, 26),
                    new TextBlock { Text = Views.NameOf(_model, id), FontWeight = FontWeight.SemiBold, VerticalAlignment = VerticalAlignment.Center },
                    new TextBlock { Text = where, Classes = { "muted" }, VerticalAlignment = VerticalAlignment.Center },
                },
            };
            // Not focusable, so a click doesn't take the focus from the field (which would close the box before the click lands).
            var button = new Button { Content = row, Focusable = false };
            button.Classes.Add("result");
            if (i == _at) button.Classes.Add("at");
            button.Click += (_, _) => _pick(id);
            _results.Children.Add(button);
        }
    }

    private void OnKey(object? sender, KeyEventArgs e)
    {
        switch (e.Key)
        {
            case Key.Down:
                _at = Math.Min(_at + 1, _found.Count - 1);
                Rebuild();
                break;
            case Key.Up:
                _at = Math.Max(_at - 1, 0);
                Rebuild();
                break;
            case Key.Enter when _found.Count > 0:
                _pick(_found[_at]);
                break;
            case Key.Escape:
                _close();
                break;
            default:
                return;
        }
        e.Handled = true;
    }
}

/// <summary>What ? opens: the keyboard shortcuts, as the key handler of the reader has them.</summary>
internal sealed class ShortcutsCard : Border
{
    private static readonly (string, string)[] Reading =
    [
        ("Enter", "Open the selected shape"),
        ("Esc", "Close what's open, then go up a level"),
        ("Backspace  Z", "Zoom out: go up a level"),
        ("Ctrl+K  /", "Find a shape"),
        ("F", "Fit the view"),
        ("L", "Show every flow, and play one"),
        ("O", "Show everything as a tree"),
        ("T", "Show a load-test run on the diagram, where there is one"),
        ("E", "Edit mode on and off"),
        ("?", "Show these shortcuts"),
    ];

    private static readonly (string, string)[] Flows =
    [
        ("→  ←", "Next and previous step"),
        ("Home  End", "First and last step"),
        ("P", "Step through the flow on its own, or pause"),
        ("R", "Replay the step"),
        ("Esc", "Stop the flow"),
    ];

    private static readonly (string, string)[] Performance =
    [
        ("→  ←", "Next and previous tested load"),
        ("Home  End", "Lowest and highest tested load"),
        ("P", "Ramp the load up on its own, or pause"),
        ("Esc", "Close the panel"),
    ];

    private static readonly (string, string)[] Editing =
    [
        ("N", "Add a shape here"),
        ("Delete", "Delete the open shape or line"),
        ("Ctrl+Z", "Undo the last change"),
        ("Esc  Backspace", "Straight after dragging a shape: take the drag back"),
        ("Ctrl+Y  Ctrl+Shift+Z", "Redo"),
    ];

    public ShortcutsCard(Action close, bool performance = false)
    {
        Classes.Add("card");
        HorizontalAlignment = HorizontalAlignment.Center;
        VerticalAlignment = VerticalAlignment.Top;
        MaxWidth = 440;
        Margin = new Thickness(16, 12);
        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(new TextBlock { Text = "Keyboard shortcuts", FontSize = 17, FontWeight = FontWeight.SemiBold, Margin = new Thickness(0, 0, 32, 0) });
        AddGroup(column, Icons.Search, "Getting around", Reading);
        AddGroup(column, Icons.Play, "Flows", Flows);
        if (performance) AddGroup(column, Icons.Activity, "Performance", Performance);
        AddGroup(column, Icons.Pencil, "In edit mode", Editing);
        var closeButton = new Button { Content = Icons.Make(Icons.Close, "closeicon", 16), HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top };
        closeButton.Classes.Add("close");
        closeButton.Click += (_, _) => close();
        Avalonia.Automation.AutomationProperties.SetName(closeButton, "Close");
        Child = new Grid { Children = { column, closeButton } };
        Avalonia.Automation.AutomationProperties.SetName(this, "Keyboard shortcuts");
    }

    private static void AddGroup(StackPanel into, string icon, string title, (string Key, string What)[] keys)
    {
        var heading = Chrome.Section(icon, title);
        heading.Margin = new Thickness(2, 12, 0, 4);
        into.Children.Add(heading);
        var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(new GridLength(170)), new ColumnDefinition(GridLength.Star)], RowSpacing = 6, ColumnSpacing = 14 };
        for (var i = 0; i < keys.Length; i++)
        {
            grid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
            // Two spaces between keys that do the same thing: each is its own cap.
            var caps = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, HorizontalAlignment = HorizontalAlignment.Left, VerticalAlignment = VerticalAlignment.Top };
            foreach (var name in keys[i].Key.Split("  "))
            {
                var cap = new Border { Child = new TextBlock { Text = name, FontSize = 12, FontFamily = new FontFamily("Cascadia Mono, Consolas, Menlo, monospace") } };
                cap.Classes.Add("kbd");
                caps.Children.Add(cap);
            }
            var key = caps;
            var what = new TextBlock { Text = keys[i].What, TextWrapping = TextWrapping.Wrap };
            Grid.SetRow(key, i);
            Grid.SetRow(what, i);
            Grid.SetColumn(what, 1);
            grid.Children.Add(key);
            grid.Children.Add(what);
        }
        into.Children.Add(grid);
    }
}

/// <summary>A message in the corner of the canvas that the reader can dismiss.</summary>
internal sealed class Notice : Border
{
    public string Text { get; }

    public Notice(string text, Action dismiss)
    {
        Text = text;
        Classes.Add("notice");
        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Top;
        Margin = new Thickness(16, 12);
        MaxWidth = 520;
        var close = new Button { Content = Icons.Make(Icons.Close, "closeicon", 16), VerticalAlignment = VerticalAlignment.Center };
        close.Classes.Add("close");
        close.Click += (_, _) => dismiss();
        Avalonia.Automation.AutomationProperties.SetName(close, "Dismiss");
        Child = new DockPanel { Children = { new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap }, close } };
        DockPanel.SetDock(close, Dock.Right);
    }
}
