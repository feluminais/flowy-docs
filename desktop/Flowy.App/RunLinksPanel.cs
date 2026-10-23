using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.VisualTree;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The Performance tab while editing: each run with Link with and Unlink, which write the <c>compare</c> field of its file (the only thing Flowy writes into a run). The numbers and the
/// canvas wait for editing to end, as the tab's own panel does, so only the links are here. Both buttons are greyed out with the reason as their tooltip when the folder can't be saved,
/// and Unlink takes away the line the run holds: a run that only others link to has none, and the line to remove is on the other run. A port of <c>RunLinks</c> in ui/src/RunLinks.tsx.
/// </summary>
internal sealed class RunLinksPanel : StackPanel
{
    private sealed record Row(Button Link, Button Unlink, StackPanel Host, bool Linked);

    private readonly Dictionary<string, Row> _rows = [];
    private Model? _model;
    private IdMap<LoadRun>? _runs;
    private string? _pickerFor;
    private ComparePicker? _picker;

    public RunLinksPanel() => Spacing = 12;

    /// <summary>The reader pressed Link with on a run and picked another run to link it to.</summary>
    public event Action<string, string>? LinkChosen;

    /// <summary>The reader pressed Unlink on a run.</summary>
    public event Action<string>? Unlinked;

    /// <summary>A control of the panel took the keyboard: the reader gives it back, so the keys work.</summary>
    public event Action? Used;

    /// <summary>The run whose Link with picker is open, if one is.</summary>
    internal string? PickerOpen => _pickerFor;

    internal Control? RunPicker => _picker;

    internal Button? LinkButtonOf(string id) => _rows.TryGetValue(id, out var row) ? row.Link : null;

    internal Button? UnlinkButtonOf(string id) => _rows.TryGetValue(id, out var row) ? row.Unlink : null;

    internal bool IsLinked(string id) => _rows.TryGetValue(id, out var row) && row.Linked;

    /// <summary>Builds the list again for these runs. <paramref name="saveOff"/> is why a link can't be written or taken away (the folder can't be saved), or null.</summary>
    public void Show(Model model, IdMap<LoadRun> runs, string? saveOff)
    {
        var open = _pickerFor;
        _model = model;
        _runs = runs;
        _picker = null;
        _pickerFor = null;
        _rows.Clear();
        Children.Clear();
        Children.Add(Chrome.Section(Icons.Link, "Runs", runs.Count));
        if (runs.Count == 0) Children.Add(new TextBlock { Text = "No runs yet.", Classes = { "muted" }, TextWrapping = TextWrapping.Wrap });
        var linked = CompareChoices.LinkedRuns(RunDrawing.MapOf(runs));
        foreach (var (id, run) in runs)
        {
            var isLinked = linked.Contains(id);
            var unlinkOff = saveOff ?? (run.Compare is not null ? null : isLinked ? "The other run holds the link" : "Not linked");
            var name = new TextBlock { Text = run.Name, FontWeight = FontWeight.SemiBold, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap };
            var head = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 8, Children = { name } };
            if (isLinked)
            {
                var mark = Chrome.Chip("Linked", Icons.Link, "accent");
                Grid.SetColumn(mark, 1);
                head.Children.Add(mark);
            }
            var buttons = new WrapPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            var runId = id;
            var link = new Button { IsEnabled = saveOff is null, Margin = new Thickness(0, 0, 6, 0) };
            CompareBar.Make(link, Icons.Link, "Link with", "Link with", saveOff ?? "Link this run with another", () => TogglePicker(runId));
            var unlink = new Button { IsEnabled = unlinkOff is null, Margin = new Thickness(0, 0, 6, 0) };
            CompareBar.Make(unlink, null, "Unlink", "Unlink", unlinkOff ?? "Take away the link", () =>
            {
                ShowPicker(null);
                Unlinked?.Invoke(runId);
                Used?.Invoke();
            });
            buttons.Children.Add(link);
            buttons.Children.Add(unlink);
            var host = new StackPanel { Spacing = 6, Children = { head, buttons } };
            _rows[id] = new Row(link, unlink, host, isLinked);
            Children.Add(host);
        }
        if (open is not null && runs.Contains(open) && saveOff is null) ShowPicker(open);
    }

    /// <summary>Opens the picker under a run's Link with over the other runs, or closes it when it is the one open. False when the button is greyed out: the reason is in its tooltip.</summary>
    public bool TogglePicker(string id)
    {
        if (!_rows.TryGetValue(id, out var row) || !row.Link.IsEnabled) return false;
        ShowPicker(_pickerFor == id ? null : id);
        return true;
    }

    private void ShowPicker(string? id)
    {
        if (_picker is not null && _pickerFor is not null && _rows.TryGetValue(_pickerFor, out var was)) was.Host.Children.Remove(_picker);
        _picker = null;
        if (_pickerFor is { } before && _rows.TryGetValue(before, out var closed)) closed.Link.Classes.Set("pressed", false);
        _pickerFor = id;
        if (id is null || _model is null || _runs is null || !_rows.TryGetValue(id, out var row)) return;
        row.Link.Classes.Set("pressed", true);
        _picker = new ComparePicker(_model, id, other =>
        {
            ShowPicker(null);
            LinkChosen?.Invoke(id, other);
        }, () =>
        {
            ShowPicker(null);
            Used?.Invoke();
        }, "run", RunDrawing.MapOf(_runs), "Link with");
        row.Host.Children.Add(_picker);
    }

    /// <summary>A press anywhere but on the open run's buttons or the picker closes the picker.</summary>
    public void PressedOutside(object? source)
    {
        if (_picker is null || _pickerFor is null || !_rows.TryGetValue(_pickerFor, out var row) || source is not Visual pressed) return;
        if (ReferenceEquals(pressed, row.Host) || pressed.GetVisualAncestors().Contains(row.Host)) return;
        ShowPicker(null);
    }
}
