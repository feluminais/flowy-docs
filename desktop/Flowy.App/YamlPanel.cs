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
    private readonly ScrollViewer _text = new() { HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Focusable = true, IsTabStop = false }; // the arrows scroll it once a click has put the keyboard in it; Tab goes past
    private readonly TextBlock _numbers = new() { FontFamily = Fonts.Mono, FontSize = 12.5, LineHeight = Row, TextAlignment = TextAlignment.Right, Width = 32, Margin = new Thickness(0, 0, 12, 0) };
    private readonly SelectableTextBlock _code = new() { FontFamily = Fonts.Mono, FontSize = 12.5, LineHeight = Row, TextWrapping = TextWrapping.NoWrap };
    private readonly Border _block = new() { VerticalAlignment = VerticalAlignment.Top, IsVisible = false, IsHitTestVisible = false };
    private readonly TextBlock _note = new() { FontStyle = FontStyle.Italic, FontSize = 12.5, Margin = new Thickness(0, 8, 0, 0), TextWrapping = TextWrapping.Wrap, IsVisible = false };

    /// <summary>A long file is drawn this many lines at a time: one text block with every line of a big file makes the panel slow to lay out and to scroll.</summary>
    internal const int LinesPage = 2000;

    private readonly Button _more = new() { HorizontalAlignment = HorizontalAlignment.Left, IsVisible = false, Classes = { "link" } };
    private readonly Dictionary<string, Button> _tabButtons = [];
    private List<string> _lines = [];
    private int _limit;
    private List<YamlFile> _files = [];
    private Action? _cancelRead; // cancels the read in flight: a newer one calls it, and only the latest is applied
    private int _reads; // how many reads were started; the one that finishes with the latest number is the one shown
    private string? _readFailure;
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
        _text.Content = new Panel { Margin = new Thickness(0, 6, 8, 6), Children = { _block, new StackPanel { Children = { lines, _note, _more } } } };
        SetRow(_text, 2);

        _more.Click += (_, _) =>
        {
            _limit += LinesPage;
            ShowLines();
        };
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
            _readFrom = folder;
            Read(dir);
        }
        if (_context != (flow, selected))
        {
            _context = (flow, selected);
            _chosen = null; // a new context shows its own file
        }
        Draw();
    }

    /// <summary>
    /// Reads the files off the UI thread: a folder of hundreds of files must not freeze the window. The files already on show stay until the new ones are in; a read
    /// that a newer one overtook is dropped.
    /// </summary>
    private async void Read(string dir)
    {
        _cancelRead?.Invoke();
        using var source = new CancellationTokenSource();
        _cancelRead = () =>
        {
            try
            {
                source.Cancel();
            }
            catch (ObjectDisposedException)
            {
                // the read it belonged to has finished
            }
        };
        var mine = ++_reads;
        try
        {
            var files = await Task.Run(() => YamlFiles.Read(dir), source.Token);
            if (mine != _reads) return;
            _files = files;
            _readFailure = null;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            if (mine != _reads) return;
            _files = [];
            _readFailure = $"Can't read the files: {e.Message}";
        }
        _cancelRead = null;
        _shown = null; // the text may have changed under the same file and selection
        Draw();
    }

    private void Draw()
    {
        var paths = _files.Select(f => f.Path).ToList();
        var (flow, selected) = _context;
        var fallback = selected is not null && paths.Contains(FolderLayout.ModelFile) ? FolderLayout.ModelFile : YamlFiles.DefaultFile(paths, flow);
        var path = _chosen is not null && paths.Contains(_chosen) ? _chosen : fallback;

        // The tabs are made when the list of files changes, not at every step: a rebuilt tab under the keyboard would take it with it.
        if (!paths.SequenceEqual(_tabButtons.Keys))
        {
            _tabs.Children.Clear();
            _tabButtons.Clear();
            foreach (var p in paths)
            {
                var tab = new Button { Content = YamlFiles.TabName(p), FontSize = 12.5, MinHeight = 28 };
                tab.Classes.Add("navtab");
                ToolTip.SetTip(tab, p);
                AutomationProperties.SetName(tab, p);
                var picked = p;
                tab.Click += (_, _) =>
                {
                    _chosen = picked;
                    Draw();
                };
                _tabs.Children.Add(tab);
                _tabButtons[p] = tab;
            }
        }
        foreach (var (p, tab) in _tabButtons) tab.Classes.Set("on", p == path);

        if (_shown == (path, selected)) return; // the same text and block: leave the scroll where the reader put it
        var newFile = _shown?.Path != path;
        _shown = (path, selected);
        var file = _files.FirstOrDefault(f => f.Path == path);
        _lines = file?.Text is { } text ? YamlFiles.LinesOf(text) : [];
        var block = path == FolderLayout.ModelFile && selected is not null && file?.Text is { } model ? YamlFiles.BlockOf(model, selected) : null;
        _limit = Math.Max(LinesPage, block?.End ?? 0); // the selected shape's lines are always among those drawn
        ShowLines();
        AutomationProperties.SetName(_text, path);
        _note.Text = file?.Note ?? (file is null ? (_cancelRead is not null ? "Reading files" : _readFailure ?? "No YAML files here") : null);
        _note.IsVisible = _note.Text is not null;

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

    /// <summary>Draws the first <see cref="_limit"/> lines of the open file, and under them a button for the next page while there are more.</summary>
    private void ShowLines()
    {
        var count = Math.Min(_lines.Count, _limit);
        _numbers.Text = string.Join('\n', Enumerable.Range(1, count));
        _code.Text = string.Join('\n', _lines.Take(count));
        var left = _lines.Count - count;
        _more.IsVisible = left > 0;
        if (left <= 0) return;
        _more.Content = $"Show {Math.Min(LinesPage, left)} more";
        AutomationProperties.SetName(_more, $"Show {Math.Min(LinesPage, left)} more, {left} left");
    }

    // What a test can look at.
    internal IReadOnlyList<string> Tabs => _tabs.Children.OfType<Button>().Select(b => AutomationProperties.GetName(b) ?? "").ToList();

    internal string? Open => _shown?.Path;

    internal string Text => _code.Text ?? "";

    /// <summary>The button that draws the next page of a long file, or null when every line is drawn.</summary>
    internal Button? MoreButton => _more.IsVisible ? _more : null;

    /// <summary>The tab button of a file, for a test.</summary>
    internal Button? TabButton(string path) => _tabButtons.GetValueOrDefault(path);

    /// <summary>True while the files are being read.</summary>
    internal bool Reading => _cancelRead is not null;

    internal (int Start, int End)? Block => _block.IsVisible ? ((int)(_block.Margin.Top / Row) + 1, (int)((_block.Margin.Top + _block.Height) / Row)) : null;

    internal string? Note => _note.IsVisible ? _note.Text : null;

    internal void PickFile(string path)
    {
        _chosen = path;
        Draw();
    }
}
