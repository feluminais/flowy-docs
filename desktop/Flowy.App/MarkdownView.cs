using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.Core;
using Markdig;
using Markdig.Syntax;
using Markdig.Syntax.Inlines;

namespace Flowy.App;

/// <summary>
/// Markdown from a model, drawn with Avalonia's own text controls. Descriptions come from files nobody here wrote, so: raw HTML is dropped,
/// an image is shown as its description in brackets and never fetched, and a link opens only if it is an http or https address.
/// </summary>
internal sealed class MarkdownView : StackPanel
{
    private static readonly MarkdownPipeline Pipeline = new MarkdownPipelineBuilder().Build();
    // A description this long is a document, and drawing it all would stall the window.
    internal const int MaxLength = 20_000;

    private readonly double _size;

    public MarkdownView(string markdown, double fontSize = 14)
    {
        _size = fontSize;
        Spacing = 12;
        if (markdown.Length > MaxLength) markdown = markdown[..MaxLength] + "…";
        MarkdownDocument document;
        try
        {
            document = Markdown.Parse(markdown, Pipeline);
        }
        catch (ArgumentException)
        {
            // Markdig refuses text nested a hundred levels deep. It is shown as it was typed.
            Children.Add(new SelectableTextBlock { Text = markdown, FontSize = fontSize, TextWrapping = TextWrapping.Wrap });
            return;
        }
        foreach (var block in document) Add(Children, block);
    }

    private IBrush Resource(string key) => AppTheme.AppBrush(key);

    private void Add(Avalonia.Controls.Controls target, Block block)
    {
        switch (block)
        {
            case ParagraphBlock p:
                target.Add(Text(p.Inline, _size, FontWeight.Normal));
                break;
            case HeadingBlock h:
                target.Add(Text(h.Inline, h.Level switch { 1 => _size + 6, 2 => _size + 4, 3 => _size + 2, _ => _size }, FontWeight.SemiBold));
                break;
            case ListBlock list:
                target.Add(List(list));
                break;
            case CodeBlock code:
                target.Add(Code(code));
                break;
            case QuoteBlock quote:
            {
                var inner = new StackPanel { Spacing = 8 };
                foreach (var b in quote) Add(inner.Children, b);
                target.Add(new Border { BorderBrush = Resource("LineBrush"), BorderThickness = new Thickness(3, 0, 0, 0), Padding = new Thickness(10, 0, 0, 0), Child = inner, Opacity = 0.85 });
                break;
            }
            case ThematicBreakBlock:
                target.Add(new Border { Height = 1, Background = Resource("LineBrush"), Margin = new Thickness(0, 4) });
                break;
            // HtmlBlock and anything else Markdown can hold: not drawn.
        }
    }

    private Control List(ListBlock list)
    {
        var rows = new StackPanel { Spacing = 4 };
        var number = int.TryParse(list.OrderedStart, out var start) ? start : 1;
        foreach (var item in list.OfType<ListItemBlock>())
        {
            var content = new StackPanel { Spacing = 6 };
            foreach (var b in item) Add(content.Children, b);
            var row = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 8, Margin = new Thickness(8, 0, 0, 0) };
            var marker = new TextBlock { Text = list.IsOrdered ? $"{number++}." : "•", Foreground = Resource("MutedBrush"), VerticalAlignment = VerticalAlignment.Top, FontSize = _size };
            Grid.SetColumn(content, 1);
            row.Children.Add(marker);
            row.Children.Add(content);
            rows.Children.Add(row);
        }
        return rows;
    }

    private Control Code(CodeBlock code)
    {
        var text = code.Lines.Lines is null ? "" : string.Join('\n', code.Lines.Lines.Take(code.Lines.Count).Select(l => l.Slice.ToString()));
        // A fence that names a language Flowy knows is drawn in colour, as in the browser; one that names none stays as it is.
        if (code is FencedCodeBlock { Info: { } info } && Snippets.LanguageOf(info.Split(' ', 2)[0]) is { } language)
            return CodeView.Block(string.Join('\n', Snippets.CodeLines(text)), language.Id, Resource, _size - 1);
        return new Border
        {
            Background = Resource("BoxBrush"), BorderBrush = Resource("LineBrush"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(6), Padding = new Thickness(10, 8),
            Child = new ScrollViewer
            {
                HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
                Content = new SelectableTextBlock { Text = text, FontFamily = Fonts.Mono, FontSize = _size - 1 },
            },
        };
    }

    private sealed record LinkRange(int Start, int End, string Address);

    private SelectableTextBlock Text(ContainerInline? inline, double size, FontWeight weight)
    {
        var block = new SelectableTextBlock { FontSize = size, FontWeight = weight, TextWrapping = TextWrapping.Wrap, LineHeight = Math.Round(size * 1.55) };
        var links = new List<LinkRange>();
        var offset = 0;
        Inlines(block.Inlines!, inline, bold: false, italic: false, links, ref offset);
        if (links.Count > 0) WireLinks(block, links);
        return block;
    }

    private void Inlines(InlineCollection target, ContainerInline? container, bool bold, bool italic, List<LinkRange> links, ref int offset)
    {
        if (container is null) return;
        foreach (var inline in container)
        {
            switch (inline)
            {
                case LiteralInline literal:
                    Append(target, literal.Content.ToString(), bold, italic, ref offset);
                    break;
                case HtmlEntityInline entity:
                    Append(target, entity.Transcoded.ToString(), bold, italic, ref offset);
                    break;
                case LineBreakInline lineBreak:
                    if (lineBreak.IsHard)
                    {
                        target.Add(new LineBreak());
                        offset += 1;
                    }
                    else Append(target, " ", bold, italic, ref offset);
                    break;
                case CodeInline code:
                {
                    var run = new Run(code.Content) { FontFamily = Fonts.Mono, FontSize = _size - 1 };
                    target.Add(run);
                    offset += code.Content.Length;
                    break;
                }
                case EmphasisInline emphasis:
                    Inlines(target, emphasis, bold || emphasis.DelimiterCount >= 2, italic || emphasis.DelimiterCount == 1, links, ref offset);
                    break;
                case LinkInline { IsImage: true } image:
                {
                    // Never fetched: the description of the picture, in brackets, stands in for it.
                    var alt = string.Concat(image.Descendants<LiteralInline>().Select(l => l.Content.ToString()));
                    Append(target, $"[{(alt == "" ? "image" : alt)}]", bold, italic, ref offset, muted: true);
                    break;
                }
                case LinkInline link:
                {
                    var start = offset;
                    var safe = WebAddress.IsSafe(link.Url);
                    var before = target.Count;
                    Inlines(target, link, bold, italic, links, ref offset);
                    if (safe)
                    {
                        for (var i = before; i < target.Count; i++) Style(target[i]);
                        links.Add(new LinkRange(start, offset, link.Url!));
                    }
                    break;
                }
                case AutolinkInline auto:
                {
                    var start = offset;
                    var run = new Run(auto.Url);
                    target.Add(run);
                    offset += auto.Url.Length;
                    if (WebAddress.IsSafe(auto.Url))
                    {
                        Style(run);
                        links.Add(new LinkRange(start, offset, auto.Url));
                    }
                    break;
                }
                case ContainerInline other:
                    Inlines(target, other, bold, italic, links, ref offset);
                    break;
                // HtmlInline: not drawn.
            }
        }
    }

    private void Style(Avalonia.Controls.Documents.Inline run)
    {
        run.Foreground = Resource("AccentBrush");
        run.TextDecorations = TextDecorations.Underline;
    }

    private void Append(InlineCollection target, string text, bool bold, bool italic, ref int offset, bool muted = false)
    {
        var run = new Run(text);
        if (bold) run.FontWeight = FontWeight.SemiBold;
        if (italic) run.FontStyle = FontStyle.Italic;
        if (muted) run.Foreground = Resource("MutedBrush");
        target.Add(run);
        offset += text.Length;
    }

    /// <summary>A click on a link opens it in the browser, unless the reader was selecting text. The pointer is a hand over a link.</summary>
    private static void WireLinks(SelectableTextBlock block, List<LinkRange> links)
    {
        LinkRange? At(Point p)
        {
            if (block.TextLayout is not { } layout) return null;
            var hit = layout.HitTestPoint(p);
            return hit.IsInside ? links.FirstOrDefault(l => hit.TextPosition >= l.Start && hit.TextPosition < l.End) : null;
        }
        block.PointerMoved += (_, e) =>
        {
            var link = At(e.GetPosition(block));
            block.Cursor = link is null ? new Cursor(StandardCursorType.Ibeam) : new Cursor(StandardCursorType.Hand);
            // Where a click would go, since the words of a link can say anything.
            ToolTip.SetTip(block, link?.Address);
        };
        block.PointerReleased += async (_, e) =>
        {
            if (e.InitialPressMouseButton != MouseButton.Left || block.SelectionStart != block.SelectionEnd) return;
            if (At(e.GetPosition(block)) is not { } link || TopLevel.GetTopLevel(block) is not { } top) return;
            await top.Launcher.LaunchUriAsync(new Uri(link.Address));
        };
    }
}
