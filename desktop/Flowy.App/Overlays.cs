using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.Core;

namespace Flowy.App;

/// <summary>The card at the bottom while a flow plays: which step, who talks to whom, what happens, and Back, Next and Stop.</summary>
internal sealed class PlayerCard : Border
{
    public event Action? Back;
    public event Action? Next;
    public event Action? Stop;

    public PlayerCard()
    {
        Classes.Add("card");
        HorizontalAlignment = HorizontalAlignment.Center;
        VerticalAlignment = VerticalAlignment.Bottom;
        MaxWidth = 460;
        Margin = new Thickness(16, 0, 16, 24);
        IsVisible = false;
    }

    private Button Tool(string text, Action click, bool enabled = true)
    {
        var button = new Button { Content = text, IsEnabled = enabled };
        button.Classes.Add("tool");
        button.Click += (_, _) => click();
        return button;
    }

    public void Show(string flowName, int index, int count, string ends, string text, string? description)
    {
        var column = new StackPanel { Spacing = 6 };
        column.Children.Add(new TextBlock { Text = $"{flowName} · Step {index + 1} of {count}", Classes = { "muted" }, TextWrapping = TextWrapping.Wrap });
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
        var stop = Tool("Stop", () => Stop?.Invoke());
        DockPanel.SetDock(stop, Dock.Right);
        buttons.Children.Add(stop);
        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { Tool("← Back", () => Back?.Invoke(), index > 0), Tool("Next →", () => Next?.Invoke(), index < count - 1) } };
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
    private readonly TextBox _input = new() { PlaceholderText = "Find a box by name" };
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
        Child = new StackPanel { Children = { _input, _results } };
        Avalonia.Automation.AutomationProperties.SetName(_input, "Find a box by name");
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
            var where = $"{_model.Objects[id].Type}{(parent == Names.Root ? "" : $" in {Views.NameOf(_model, parent)}")}";
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { new TextBlock { Text = Views.NameOf(_model, id) }, new TextBlock { Text = where, Classes = { "muted" } } } };
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
        ("Enter", "Open the selected box"),
        ("Esc", "Close what's open, then go up a level"),
        ("Backspace", "Go up a level"),
        ("Ctrl+K or /", "Find a box"),
        ("F", "Fit the view"),
        ("?", "Show these shortcuts"),
    ];

    private static readonly (string, string)[] Flows =
    [
        ("→  ←", "Next and previous step"),
        ("Home  End", "First and last step"),
        ("Esc", "Stop the flow"),
    ];

    public ShortcutsCard(Action close)
    {
        Classes.Add("card");
        HorizontalAlignment = HorizontalAlignment.Center;
        VerticalAlignment = VerticalAlignment.Top;
        MaxWidth = 440;
        Margin = new Thickness(16, 12);
        var column = new StackPanel { Spacing = 4 };
        AddGroup(column, "Getting around", Reading);
        AddGroup(column, "Flows", Flows);
        var closeButton = new Button { Content = "×", HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, FontSize = 22 };
        closeButton.Classes.Add("close");
        closeButton.Click += (_, _) => close();
        Avalonia.Automation.AutomationProperties.SetName(closeButton, "Close");
        Child = new Grid { Children = { column, closeButton } };
        Avalonia.Automation.AutomationProperties.SetName(this, "Keyboard shortcuts");
    }

    private static void AddGroup(StackPanel into, string title, (string Key, string What)[] keys)
    {
        into.Children.Add(new TextBlock { Text = title, FontSize = 12, FontWeight = FontWeight.SemiBold, Classes = { "muted" }, Margin = new Thickness(0, 10, 0, 4) });
        var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(new GridLength(130)), new ColumnDefinition(GridLength.Star)], RowSpacing = 6, ColumnSpacing = 14 };
        for (var i = 0; i < keys.Length; i++)
        {
            grid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
            var key = new Border { Child = new TextBlock { Text = keys[i].Key, FontSize = 12, FontFamily = new FontFamily("Cascadia Mono, Consolas, Menlo, monospace") }, HorizontalAlignment = HorizontalAlignment.Left };
            key.Classes.Add("kbd");
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
    public Notice(string text, Action dismiss)
    {
        Classes.Add("notice");
        HorizontalAlignment = HorizontalAlignment.Left;
        VerticalAlignment = VerticalAlignment.Top;
        Margin = new Thickness(16, 12);
        MaxWidth = 520;
        var close = new Button { Content = "×", FontSize = 18 };
        close.Classes.Add("close");
        close.Click += (_, _) => dismiss();
        Avalonia.Automation.AutomationProperties.SetName(close, "Dismiss");
        Child = new DockPanel { Children = { new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap }, close } };
        DockPanel.SetDock(close, Dock.Right);
    }
}
