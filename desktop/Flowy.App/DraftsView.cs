using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The Drafts group under the Explorer's tree: a row for each draft of the model, which opens it in a window of its own as the Model picker opens a model, and New draft, which asks for a name,
/// makes an empty draft and opens it. A draft is a model of its own in drafts/&lt;id&gt;/ (see <see cref="Drafts"/>), so making one changes no file of the model and needs no edit mode. When the
/// folder can't be written the button is greyed out with the reason in its tooltip, not hidden. Not shown inside a draft: a draft holds none.
/// </summary>
internal sealed class DraftsView : Border
{
    private const double MaxListHeight = 190;

    private readonly TextBlock _count = new() { FontSize = 12, VerticalAlignment = VerticalAlignment.Center, Classes = { "muted" } };
    private readonly TextBlock _none = new() { Text = "No drafts.", FontSize = 13, Margin = new Thickness(8, 0, 0, 4), Classes = { "muted" } };
    private readonly StackPanel _rows = new();
    private readonly Button _new = new();
    private readonly StackPanel _form;
    private readonly TextBox _name = new();
    private readonly Button _add = new();
    private readonly Button _cancel = new();
    private readonly TextBlock _error = new() { FontSize = 12, TextWrapping = TextWrapping.Wrap, IsVisible = false, Classes = { "dangertext" } };
    private string? _dir;
    private IReadOnlyList<DraftInfo> _drafts = [];

    /// <summary>A draft was picked, or made: its folder.</summary>
    public event Action<string>? Opened;

    public DraftsView()
    {
        Classes.Add("navfoot");
        Padding = new Thickness(0, 8, 0, 0);
        Margin = new Thickness(0, 0, FlowsView.Inset, 0);
        IsVisible = false;

        var title = new TextBlock { Text = "Drafts", FontWeight = FontWeight.SemiBold, VerticalAlignment = VerticalAlignment.Center };
        var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(8, 0, 0, 4), Children = { title, _count } };

        _new.Classes.Add("tool");
        _new.HorizontalAlignment = HorizontalAlignment.Left;
        Chrome.Fill(_new, Icons.Plus, "New draft");
        ToolTip.SetShowOnDisabled(_new, true);
        _new.Click += (_, _) => BeginNaming();

        AutomationProperties.SetName(_name, "Draft name");
        _name.TextChanged += (_, _) =>
        {
            _error.IsVisible = false;
            _add.IsEnabled = !string.IsNullOrWhiteSpace(_name.Text);
        };
        _name.KeyDown += (_, e) =>
        {
            if (e.Key == Key.Enter)
            {
                e.Handled = true;
                Make();
            }
            else if (e.Key == Key.Escape)
            {
                e.Handled = true; // the reader's own Esc would clear a navigator field, or step back
                StopNaming();
            }
        };
        _add.Classes.Add("tool");
        _add.Classes.Add("primary");
        Chrome.Fill(_add, Icons.Plus, "Add");
        _add.Click += (_, _) => Make();
        _cancel.Classes.Add("tool");
        Chrome.Fill(_cancel, Icons.Close, "Cancel");
        _cancel.Click += (_, _) => StopNaming();
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, Children = { _add, _cancel } };
        _form = new StackPanel { Spacing = 6, Margin = new Thickness(4, 4, 0, 0), IsVisible = false, Children = { _name, buttons, _error } };

        var list = new ScrollViewer { Content = _rows, MaxHeight = MaxListHeight, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled };
        Child = new StackPanel { Children = { head, _none, list, _new, _form } };
    }

    /// <summary>
    /// Shows the drafts of the model folder <paramref name="modelDir"/>. <paramref name="off"/> is why a draft can't be made now (the button's tooltip), or null. <paramref name="inDraft"/> hides the group,
    /// since a draft holds none. The name being typed stays while the rest is drawn again.
    /// </summary>
    public void Update(string? modelDir, IReadOnlyList<DraftInfo> drafts, string? off, bool inDraft)
    {
        _dir = modelDir;
        IsVisible = !inDraft && modelDir is not null;
        if (!drafts.SequenceEqual(_drafts) || _rows.Children.Count != drafts.Count)
        {
            _drafts = drafts;
            _rows.Children.Clear();
            foreach (var draft in drafts) _rows.Children.Add(Row(draft));
        }
        _count.Text = drafts.Count.ToString(System.Globalization.CultureInfo.InvariantCulture);
        _none.IsVisible = drafts.Count == 0 && !_form.IsVisible;
        _new.IsEnabled = off is null;
        ToolTip.SetTip(_new, off);
        if (off is not null && _form.IsVisible) StopNaming();
    }

    private Control Row(DraftInfo draft)
    {
        var icon = Icons.Make(Icons.Draft, "btnicon", 15);
        icon.VerticalAlignment = VerticalAlignment.Center;
        var name = new TextBlock { Text = draft.Name, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center };
        var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 8, Children = { icon, name } };
        Grid.SetColumn(name, 1);
        var button = new Button { Content = grid, MinHeight = 32 };
        button.Classes.Add("flowrow");
        AutomationProperties.SetName(button, draft.Name);
        button.Click += (_, _) =>
        {
            if (_dir is not null) Opened?.Invoke(Drafts.DirOf(_dir, draft.Id));
        };
        return button;
    }

    private void BeginNaming()
    {
        if (!_new.IsEnabled) return;
        _form.IsVisible = true;
        _new.IsVisible = false;
        _none.IsVisible = false;
        _add.IsEnabled = !string.IsNullOrWhiteSpace(_name.Text);
        Dispatcher.UIThread.Post(() => _name.Focus());
    }

    private void StopNaming()
    {
        _form.IsVisible = false;
        _new.IsVisible = true;
        _none.IsVisible = _drafts.Count == 0;
        _name.Text = "";
        _error.IsVisible = false;
    }

    /// <summary>Adds the draft: writes it and opens it. A reason it can't be written stays under the field.</summary>
    private void Make()
    {
        if (_dir is null || string.IsNullOrWhiteSpace(_name.Text)) return;
        try
        {
            var dir = Drafts.Create(_dir, _name.Text);
            StopNaming();
            Opened?.Invoke(dir);
        }
        catch (OpError e)
        {
            _error.Text = $"Not made: {e.Message}";
            _error.IsVisible = true;
        }
    }

    // What a test can look at.
    internal IEnumerable<string> RowNames => _rows.Children.OfType<Button>().Select(b => AutomationProperties.GetName(b) ?? "");

    internal string CountText => _count.Text ?? "";

    internal bool NoDraftsShown => _none.IsVisible;

    internal Button NewButton => _new;

    internal bool Naming => _form.IsVisible;

    internal TextBox NameBox => _name;

    internal Button AddButton => _add;

    internal Button CancelButton => _cancel;

    internal string? ErrorText => _error.IsVisible ? _error.Text : null;

    internal void PressNew() => _new.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));

    internal void PressRow(string name) => _rows.Children.OfType<Button>().First(b => AutomationProperties.GetName(b) == name).RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));

    internal void PressAdd() => _add.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));

    internal void PressCancel() => _cancel.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
}
