using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Chrome;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform;

namespace Flowy.App;

/// <summary>
/// The window's top row. On Windows the window draws into its title bar, so the icon, the menu and the window's title share one row in the app's colours, with the
/// full screen, minimize, maximize and close buttons Avalonia draws on the right (coloured in Styles.axaml). The empty part of the row moves the window, and a double click maximizes it.
/// Where the window is not drawn into its title bar (macOS, Linux, a --shot picture, the tests) the row is the menu alone, as it always was.
/// </summary>
internal sealed class TitleRow : Border
{
    /// <summary>The width of the four buttons Avalonia's Fluent theme draws on the right (45 each, 2 apart), which the row leaves free.</summary>
    internal const double CaptionWidth = 4 * 45 + 3 * 2;

    private readonly Image _icon = new() { Width = 16, Height = 16, Margin = new Thickness(12, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock _title = new() { Classes = { "muted" }, FontSize = 12, VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
    private readonly Control _captions = new Panel { Width = CaptionWidth };
    private readonly Window _window;

    public TitleRow(Window window, NativeMenuBar menu)
    {
        _window = window;
        AreaStyles.Add(this, "TitleRow");
        Classes.Add("titlerow");
        menu.VerticalAlignment = VerticalAlignment.Center;
        // Inside a title bar a press moves the window unless the control says it takes input itself.
        WindowDecorationProperties.SetElementRole(menu, WindowDecorationsElementRole.User);
        var row = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,Auto,*,Auto") };
        Grid.SetColumn(menu, 1);
        Grid.SetColumn(_title, 2);
        Grid.SetColumn(_captions, 3);
        row.Children.AddRange([_icon, menu, _title, _captions]);
        Child = row;
        Show(window.IsExtendedIntoWindowDecorations, window.WindowDecorationMargin);
        window.PropertyChanged += (_, e) =>
        {
            if (e.Property == Window.IsExtendedIntoWindowDecorationsProperty || e.Property == Window.WindowDecorationMarginProperty || e.Property == Window.WindowStateProperty)
                Show(window.IsExtendedIntoWindowDecorations, window.WindowDecorationMargin);
            else if (e.Property == Window.TitleProperty) _title.Text = window.Title;
        };
    }

    /// <summary>Whether the row is the window's title bar now (it holds the title and moves the window), or the menu alone. For a test.</summary>
    internal bool IsTitleBar => _title.IsVisible;

    /// <summary>Lays the row out as the window's title bar when the window is drawn into it, at the height Windows gives that bar; otherwise as the menu alone.</summary>
    internal void Show(bool extended, Thickness margin)
    {
        // Full screen has no title bar to share.
        var bar = extended && _window.WindowState != WindowState.FullScreen;
        _icon.IsVisible = _title.IsVisible = _captions.IsVisible = bar;
        Classes.Set("extended", bar);
        WindowDecorationProperties.SetElementRole(this, bar ? WindowDecorationsElementRole.TitleBar : WindowDecorationsElementRole.None);
        MinHeight = bar ? Math.Max(margin.Top, 30) : 0;
        _title.Text = _window.Title;
        if (bar) _icon.Source ??= new Bitmap(AssetLoader.Open(new Uri("avares://FlowyDocs/Assets/icon.png")));
    }
}
