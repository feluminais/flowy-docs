using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The YAML tab of the navigator: the model's files as text, read only. A tab for each file, the open flow's file first (the model's when a shape is
/// selected), and the selected shape's lines tinted in model.yaml and brought into view. The browser's YAML tab (ui/src/Yaml.tsx) shows the same files,
/// in the same order, and adds the history of changes, which the desktop does not keep.
/// </summary>
internal sealed class YamlPanel : Grid
{
    /// <summary>Every line is this tall, so a line's place in the text is known without measuring it.</summary>
    internal const double Row = 20;

    private readonly StackPanel _tabs = new() { Orientation = Orientation.Horizontal, Spacing = 2 };
    private readonly ScrollViewer _text = new() { HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Focusable = true };
    private readonly TextBlock _numbers = new() { FontFamily = Fonts.Mono, FontSize = 12.5, LineHeight = Row, TextAlignment = TextAlignment.Right, Width = 32, Margin = new Thickness(0, 0, 12, 0) };
    private readonly SelectableTextBlock _code = new() { FontFamily = Fonts.Mono, FontSize = 12.5, LineHeight = Row, TextWrapping = TextWrapping.NoWrap };
    private readonly Border _block = new() { VerticalAlignment = VerticalAlignment.Top, IsVisible = false, IsHitTestVisible = false };
    private readonly TextBlock _note = new() { FontStyle = FontStyle.Italic, FontSize = 12.5, Margin = new Thickness(0, 8, 0, 0), TextWrapping = TextWrapping.Wrap, IsVisible = false };

    private List<YamlFile> _files = [];
    private object? _readFrom; // the folder the files were read for: a new load reads them again
    private string? _chosen; // the file picked on its tab; null: the one the context gives
    private (string? Flow, string? Selected) _context;
    private (string Path, string? Selected)? _shown;

    public YamlPanel()
    {
        AreaStyles.Add(this, "Yaml");
        RowDefinitions = [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Star)];
        Margin = new Thickness(16, 8, 16, 12);

        var lockIcon = Icons.Make(Icons.Lock, "sectionicon", 14);
        lockIcon.VerticalAlignment = VerticalAlignment.Center;
        var readOnly = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(0, 0, 0, 6), Children = { lockIcon, new TextBlock { Text = "Read only", FontSize = 12.5, VerticalAlignment = VerticalAlignment.Center } } };
        readOnly.Classes.Add("yreadonly");

        _tabs.Classes.Add("navtabs");
        _tabs.Classes.Add("yfiles");
        AutomationProperties.SetName(_tabs, "Files");
        var tabStrip = new Border { Child = new ScrollViewer { HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, Content = _tabs } };
        tabStrip.Classes.Add("ytabs");
        SetRow(tabStrip, 1);

        _numbers.Classes.Add("ynum");
        _block.Classes.Add("yblock");
        _note.Classes.Add("ynote");
        var lines = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], Children = { _numbers, _code } };
        SetColumn(_code, 1);
        _text.Content = new Panel { Margin = new Thickness(0, 6, 8, 6), Children = { _block, new StackPanel { Children = { lines, _note } } } };
        SetRow(_text, 2);

        Children.Add(readOnly);
        Children.Add(tabStrip);
        Children.Add(_text);
    }

    /// <summary>
    /// Shows the files of the folder in <paramref name="dir"/>. They are read again only when <paramref name="folder"/> is another load. A new flow or selection
    /// shows its own file and brings the selected shape's lines into view.
    /// </summary>
    public void Show(string dir, object folder, string? flow, string? selected)
    {
        if (!ReferenceEquals(folder, _readFrom))
        {
            _files = YamlFiles.Read(dir);
            _readFrom = folder;
            _shown = null; // the text may have changed under the same file and selection
        }
        if (_context != (flow, selected))
        {
            _context = (flow, selected);
            _chosen = null; // a new context shows its own file
        }
        Draw();
    }

    private void Draw()
    {
        var paths = _files.Select(f => f.Path).ToList();
        var (flow, selected) = _context;
        var fallback = selected is not null && paths.Contains(FolderLayout.ModelFile) ? FolderLayout.ModelFile : YamlFiles.DefaultFile(paths, flow);
        var path = _chosen is not null && paths.Contains(_chosen) ? _chosen : fallback;

        _tabs.Children.Clear();
        foreach (var p in paths)
        {
            var tab = new Button { Content = YamlFiles.TabName(p), FontSize = 12.5, MinHeight = 28 };
            tab.Classes.Add("navtab");
            tab.Classes.Set("on", p == path);
            ToolTip.SetTip(tab, p);
            AutomationProperties.SetName(tab, p);
            var picked = p;
            tab.Click += (_, _) =>
            {
                _chosen = picked;
                Draw();
            };
            _tabs.Children.Add(tab);
        }

        if (_shown == (path, selected)) return; // the same text and block: leave the scroll where the reader put it
        var newFile = _shown?.Path != path;
        _shown = (path, selected);
        var file = _files.FirstOrDefault(f => f.Path == path);
        var lines = file?.Text is { } text ? YamlFiles.LinesOf(text) : [];
        _numbers.Text = string.Join('\n', Enumerable.Range(1, lines.Count));
        _code.Text = string.Join('\n', lines);
        AutomationProperties.SetName(_text, path);
        _note.Text = file?.Note ?? (file is null ? "No YAML files here" : null);
        _note.IsVisible = _note.Text is not null;

        var block = path == FolderLayout.ModelFile && selected is not null && file?.Text is { } model ? YamlFiles.BlockOf(model, selected) : null;
        _block.IsVisible = block is not null;
        if (block is { } b)
        {
            _block.Margin = new Thickness(-4, (b.Start - 1) * Row, 0, 0);
            _block.Height = (b.End - b.Start + 1) * Row;
        }
        // The shape's lines come into view a third of the way down; a new file without them starts at the top. Placed once the text is laid out,
        // when the height it is seen at is known.
        if (block is not null || newFile)
            Avalonia.Threading.Dispatcher.UIThread.Post(() =>
                _text.Offset = new Vector(0, block is { } at ? Math.Max(0, (at.Start - 1) * Row - _text.Viewport.Height / 3) : 0), Avalonia.Threading.DispatcherPriority.Loaded);
    }

    // What a test can look at.
    internal IReadOnlyList<string> Tabs => _tabs.Children.OfType<Button>().Select(b => AutomationProperties.GetName(b) ?? "").ToList();

    internal string? Open => _shown?.Path;

    internal string Text => _code.Text ?? "";

    internal (int Start, int End)? Block => _block.IsVisible ? ((int)(_block.Margin.Top / Row) + 1, (int)((_block.Margin.Top + _block.Height) / Row)) : null;

    internal string? Note => _note.IsVisible ? _note.Text : null;

    internal void PickFile(string path)
    {
        _chosen = path;
        Draw();
    }
}
