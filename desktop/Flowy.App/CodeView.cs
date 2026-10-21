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

    private static Control One(Snippet snippet, Func<string, IBrush> resource)
    {
        var (language, _) = CodeInk.LanguageFor(snippet.Text, snippet.Language);
        var text = string.Join('\n', Snippets.CodeLines(snippet.Text));
        var header = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 8 };
        header.Children.Add(new TextBlock { Text = snippet.Title ?? "", FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center });
        if (language is not null)
        {
            var chip = new TextBlock { Text = language.Name, FontSize = 12, Foreground = resource("MutedBrush"), VerticalAlignment = VerticalAlignment.Center };
            Grid.SetColumn(chip, 1);
            header.Children.Add(chip);
        }
        var copy = CopyButton(text);
        Grid.SetColumn(copy, 2);
        header.Children.Add(copy);
        return new StackPanel { Spacing = 4, Children = { header, Block(text, language?.Id, resource) } };
    }

    private static Button CopyButton(string text)
    {
        var button = new Button { Content = Icons.Make(Icons.Copy, "rowicon", 14), VerticalAlignment = VerticalAlignment.Center };
        button.Classes.Add("tool");
        AutomationProperties.SetName(button, "Copy");
        ToolTip.SetTip(button, "Copy");
        button.Click += async (_, _) =>
        {
            if (TopLevel.GetTopLevel(button)?.Clipboard is not { } clipboard) return;
            await clipboard.SetTextAsync(text);
            button.Content = Icons.Make(Icons.Check, "rowicon", 14);
            ToolTip.SetTip(button, "Copied");
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

    /// <summary>Code as a box of coloured text, with a bar to scroll along when a line is long. <paramref name="language"/> is one of our ids, or null for plain text.</summary>
    public static Control Block(string text, string? language, Func<string, IBrush> resource, double size = 12.5)
    {
        var block = new SelectableTextBlock { FontFamily = Fonts.Mono, FontSize = size, TextWrapping = TextWrapping.NoWrap };
        foreach (var run in CodeInk.Runs(text, language))
        {
            var piece = new Run(Tabs(run.Text));
            // A run of no kind has no colour of its own, so it takes the text's. (Setting null would draw it with no brush at all.)
            if (run.Kind is { } kind) piece.Foreground = resource(BrushName(kind));
            block.Inlines!.Add(piece);
        }
        // Room under the last line, so the bar that scrolls a long line does not sit on top of the code.
        block.Margin = new Thickness(0, 0, 0, 10);
        return new Border
        {
            Background = resource("BoxBrush"), BorderBrush = resource("LineBrush"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(6), Padding = new Thickness(10, 8, 10, 0),
            Child = new ScrollViewer { HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, Content = block },
        };
    }

    /// <summary>A tab as four spaces: the text box draws a tab as one narrow gap, which breaks the columns of indented code.</summary>
    private static string Tabs(string text) => text.Replace("\t", "    ", false, CultureInfo.InvariantCulture);
}
