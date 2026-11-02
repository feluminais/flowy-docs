using System.Globalization;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Controls.Primitives;
using Avalonia.Input.Platform;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The Code section of a shape's panel: each snippet with its title, the language it is shown in, a button that copies it, and the code in
/// colour. The twin of <c>CodeSection</c> in ui/src/Code.tsx. A fenced block in a description that names a language is drawn by the same
/// <see cref="Block"/>.
/// </summary>
internal static class CodeView
{
    /// <summary>The section for a shape with snippets; null for one without.</summary>
    public static Control? Build(FlowyObject o, Func<string, IBrush> resource)
    {
        var snippets = Snippets.Of(o);
        if (snippets.Count == 0) return null;
        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(Chrome.Section(Icons.Code, "Code", snippets.Count));
        foreach (var snippet in snippets) section.Children.Add(One(snippet, resource));
        AutomationProperties.SetName(section, "Code");
        return section;
    }

    private static Control One(Snippet snippet, Func<string, IBrush> resource) => Titled(snippet.Title ?? "", snippet.Text, snippet.Language, resource);

    /// <summary>
    /// Some code with a title over it, the language it is shown in and a button that copies it. With <paramref name="maxHeight"/> the code scrolls past that height
    /// (a payload's schema can run to hundreds of lines).
    /// </summary>
    public static Control Titled(string title, string code, string? named, Func<string, IBrush> resource, double? maxHeight = null)
    {
        var (language, _) = CodeInk.LanguageFor(code, named);
        var text = string.Join('\n', Snippets.CodeLines(code));
        var header = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 8 };
        header.Children.Add(new TextBlock { Text = title, FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center });
        if (language is not null)
        {
            var chip = new TextBlock { Text = language.Name, FontSize = 12, Foreground = resource("MutedBrush"), VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(chip, 1);
            header.Children.Add(chip);
        }
        var copy = CopyButton(text);
        Grid.SetColumn(copy, 2);
        header.Children.Add(copy);
        return new StackPanel { Spacing = 4, Children = { header, Block(text, language?.Id, resource, maxHeight: maxHeight) } };
    }

    private static Button CopyButton(string text)
    {
        var button = new Button { Content = Icons.Make(Icons.Copy, "rowicon", 14), VerticalAlignment = VerticalAlignment.Center };
        button.Classes.Add("tool");
        AutomationProperties.SetName(button, "Copy");
        ToolTip.SetTip(button, "Copy");
        button.Click += async (_, _) =>
        {
            // A copy that didn't reach the clipboard says so on the button, as the browser's does, rather than reaching the "Something went wrong" banner.
            var copied = false;
            if (TopLevel.GetTopLevel(button)?.Clipboard is { } clipboard)
            {
                try
                {
                    await clipboard.SetTextAsync(text);
                    copied = true;
                }
                catch (Exception)
                {
                    // the clipboard wasn't available
                }
            }
            if (copied) button.Content = Icons.Make(Icons.Check, "rowicon", 14);
            ToolTip.SetTip(button, copied ? "Copied" : "Couldn't copy");
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1500) };
            timer.Tick += (_, _) =>
            {
                timer.Stop();
                button.Content = Icons.Make(Icons.Copy, "rowicon", 14);
                ToolTip.SetTip(button, "Copy");
            };
            timer.Start();
        };
        return button;
    }

    private static string BrushName(TokenKind kind) => $"Tok{kind}Brush";

    /// <summary>
    /// Code as a box of coloured text, with a <see cref="CodeBar"/> under it to scroll along when a line is long. <paramref name="language"/> is one of our ids, or
    /// null for plain text.
    /// </summary>
    public static Control Block(string text, string? language, Func<string, IBrush> resource, double size = 12.5, double? maxHeight = null)
    {
        var block = new SelectableTextBlock { FontFamily = Fonts.Mono, FontSize = size, TextWrapping = TextWrapping.NoWrap };
        foreach (var run in CodeInk.Runs(text, language))
        {
            var piece = new Run(Tabs(run.Text));
            // A run of no kind has no colour of its own, so it takes the text's. (Setting null would draw it with no brush at all.)
            if (run.Kind is { } kind) piece.Foreground = resource(BrushName(kind));
            block.Inlines!.Add(piece);
        }
        // The box scrolls along but draws no bar of its own: that one widens over the last line under the pointer. The bar below takes its place.
        var scroller = maxHeight is { } most
            ? new ScrollViewer { HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, MaxHeight = most, Content = block, Classes = { "payloadcode" } }
            : new ScrollViewer { HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden, Content = block };
        var box = new Border
        {
            Background = resource("BoxBrush"), BorderBrush = resource("LineBrush"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(6), Padding = new Thickness(10, 8),
            Child = scroller,
        };
        return new StackPanel { Spacing = 2, Children = { box, new CodeBar(scroller, resource) } };
    }

    /// <summary>A tab as four spaces: the text box draws a tab as one narrow gap, which breaks the columns of indented code.</summary>
    private static string Tabs(string text) => text.Replace("\t", "    ", false, CultureInfo.InvariantCulture);
}
