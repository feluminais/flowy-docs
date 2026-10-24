using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Controls.Shapes;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The Data section of a store's panel: what the store holds, drawn the way a developer pictures it. A table is column headings over its sample rows;
/// a document is its fields, indented; each entry has its limits on one line and its notes under the data. The first entry is open and the rest are
/// a line each. The twin of <c>ui/src/Data.tsx</c>: the same marks, the same words, the same order. What it shows comes from <see cref="StoreData.Shown"/>.
/// </summary>
internal static class DataView
{
    /// <summary>
    /// The section for a store with data; null for any other kind of shape and for a store that shows nothing. <paramref name="opened"/> is what the
    /// reader has opened or closed, by box and entry, so a panel drawn again (a changed file, a new theme) keeps it; an entry not in it is open if it is the first.
    /// </summary>
    public static Control? Build(string id, FlowyObject o, Func<string, IBrush> resource, Dictionary<(string Id, string Entry), bool> opened)
    {
        if (o.Type != "store") return null;
        var entries = StoreData.Shown(o);
        if (entries.Count == 0) return null;
        var section = new StackPanel { Spacing = 12 };
        section.Children.Add(Chrome.Section(Icons.Table, "Data", entries.Count));
        foreach (var (entry, first) in entries.Select((entry, i) => (entry, i == 0)))
        {
            var key = (id, entry.Name);
            section.Children.Add(Entry(entry, opened.TryGetValue(key, out var was) ? was : first, resource, on => opened[key] = on));
        }
        AutomationProperties.SetName(section, "Data");
        return section;
    }

    private static TextBlock Small(string text, IBrush brush, double size = 12) =>
        new() { Text = text, FontSize = size, Foreground = brush, TextWrapping = TextWrapping.Wrap };

    private static Control Dot() => new Ellipse { Width = 7, Height = 7, VerticalAlignment = VerticalAlignment.Center, Classes = { "datadot" } };

    /// <summary>One entry. Open, it shows its name, limits, note, the data and the notes; closed, one line with how much there is. A toggle, so a screen reader hears whether it is open.</summary>
    private static Control Entry(DataShown entry, bool open, Func<string, IBrush> resource, Action<bool> remember)
    {
        var muted = resource("MutedBrush");
        var chevron = Icons.Make(Icons.ChevronRight, "rowicon", 12);
        chevron.VerticalAlignment = VerticalAlignment.Center;
        var count = Small(entry.Summary, muted);
        // The name, its kind and the count wrap among themselves in the middle column, so a long name never runs under the limits at the right.
        var title = new WrapPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        title.Children.Add(new TextBlock { Text = entry.Name, FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 8, 0) });
        if (entry.Kind is { } kind)
        {
            var small = Small(kind, muted);
            small.Margin = new Thickness(0, 0, 8, 0);
            title.Children.Add(small);
        }
        title.Children.Add(count);
        var header = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 8 };
        Grid.SetColumn(title, 1);
        header.Children.Add(chevron);
        header.Children.Add(title);
        if (entry.Limits is { } limits)
        {
            var clock = Icons.Make(Icons.Clock, "rowicon", 12);
            clock.VerticalAlignment = VerticalAlignment.Top;
            clock.Margin = new Thickness(0, 3, 0, 0);
            var text = Small(limits, muted);
            text.MaxWidth = 190;
            text.TextAlignment = TextAlignment.Right;
            var right = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center, Children = { clock, text } };
            Grid.SetColumn(right, 2);
            header.Children.Add(right);
        }
        var head = new ToggleButton { Content = header, IsChecked = open };
        head.Classes.Add("datahead");
        AutomationProperties.SetName(head, entry.Name);

        var body = new StackPanel { Spacing = 8, Margin = new Thickness(0, 8, 0, 0) };
        if (entry.Note is { } note) body.Children.Add(Small(note, muted, 13));
        body.Children.Add(entry.Lines.Count > 0 ? Document(entry, resource) : Table(entry, resource));
        if (entry.Notes.Count > 0) body.Children.Add(Notes(entry, resource));

        void Sync()
        {
            var on = head.IsChecked == true;
            body.IsVisible = on;
            count.IsVisible = !on;
            chevron.RenderTransform = new RotateTransform(on ? 90 : 0);
        }
        head.IsCheckedChanged += (_, _) =>
        {
            Sync();
            remember(head.IsChecked == true);
        };
        Sync();
        return new StackPanel { Children = { head, body } };
    }

    /// <summary>A mark after a column's name: PK, FK and the table it points to, or NULL, with the full name as its tip.</summary>
    private static Control Mark(string text, string tip, Func<string, IBrush> resource)
    {
        var mark = new Border
        {
            Child = new TextBlock { Text = text, FontSize = 9.5, FontWeight = FontWeight.SemiBold, Foreground = resource("MutedBrush") },
            BorderBrush = resource("LineBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(3),
            Padding = new Thickness(4, 0),
            VerticalAlignment = VerticalAlignment.Center,
        };
        ToolTip.SetTip(mark, tip);
        AutomationProperties.SetName(mark, tip);
        return mark;
    }

    /// <summary>A column's heading: its name and marks on a line, its type under them in small type.</summary>
    private static Control Heading(DataColumn column, Func<string, IBrush> resource)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 5 };
        row.Children.Add(new TextBlock { Text = column.Name, FontSize = 12, FontWeight = FontWeight.SemiBold, VerticalAlignment = VerticalAlignment.Center });
        if (column.Key == "primary") row.Children.Add(Mark("PK", "Primary key", resource));
        if (column.To is { } to) row.Children.Add(Mark($"FK {to}", $"Foreign key to {to}", resource));
        if (column.Nullable) row.Children.Add(Mark("NULL", "Can be empty", resource));
        if (column.Note is not null) row.Children.Add(Dot());
        if (column.Type is not { } type) return row;
        var heading = new StackPanel { Children = { row } };
        heading.Children.Add(new TextBlock { Text = type, FontFamily = Fonts.Mono, FontSize = 10.5, Foreground = resource("MutedBrush"), TextWrapping = TextWrapping.NoWrap });
        return heading;
    }

    /// <summary>A table, key set or topic: headings on a faint fill over the sample rows. Cells do not wrap; a long one is cut and its whole text is its tip. A grid wider than the panel scrolls inside its frame.</summary>
    private static Control Table(DataShown entry, Func<string, IBrush> resource)
    {
        // The checks say a table has at most 8 rows and 12 columns, but a file can hold more, and every cell is a control. Far past the limits the rest is left out, and a line says so.
        var cutRows = entry.Rows.Count - Math.Min(entry.Rows.Count, DrawRows);
        var rows = entry.Rows.Count > DrawRows ? entry.Rows.Take(DrawRows).ToList() : entry.Rows;
        var columns = entry.Columns.Count > DrawColumns ? entry.Columns.Take(DrawColumns).ToList() : entry.Columns;
        entry = entry with { Rows = rows, Columns = columns };
        var grid = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch };
        foreach (var _ in entry.Columns) grid.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Auto));
        grid.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Star)); // takes what is left, so the fill and the rules reach the frame's edge
        for (var r = 0; r <= entry.Rows.Count; r++) grid.RowDefinitions.Add(new RowDefinition(GridLength.Auto));
        var span = entry.Columns.Count + 1;

        var fill = new Border { Classes = { "datafill" }, IsHitTestVisible = false };
        Grid.SetColumnSpan(fill, span);
        grid.Children.Add(fill);
        for (var r = 1; r < entry.Rows.Count; r++)
        {
            var rule = new Border { Classes = { "datarule" }, IsHitTestVisible = false };
            Grid.SetRow(rule, r + 1);
            Grid.SetColumnSpan(rule, span);
            grid.Children.Add(rule);
        }
        for (var c = 0; c < entry.Columns.Count; c++)
        {
            var cell = new Border { Padding = new Thickness(8, 4), Child = Heading(entry.Columns[c], resource) };
            Grid.SetColumn(cell, c);
            grid.Children.Add(cell);
        }
        for (var r = 0; r < entry.Rows.Count; r++)
            for (var c = 0; c < entry.Columns.Count; c++)
            {
                var text = entry.Rows[r][c];
                var cell = new TextBlock
                {
                    Text = text,
                    FontFamily = Fonts.Mono,
                    FontSize = 11.5,
                    MaxWidth = 190,
                    TextTrimming = TextTrimming.CharacterEllipsis,
                    TextWrapping = TextWrapping.NoWrap,
                    Margin = new Thickness(8, 3),
                };
                if (text != "") ToolTip.SetTip(cell, text);
                Grid.SetRow(cell, r + 1);
                Grid.SetColumn(cell, c);
                grid.Children.Add(cell);
            }
        var framed = Framed(grid, $"{entry.Name} rows", resource, new Thickness(0, 0, 0, 7)); // room under the rows for the scrollbar, which lies over the content
        return cutRows > 0 ? WithMore(framed, $"{cutRows} more rows", resource) : framed;
    }

    /// <summary>How much of a table or document is drawn: far more than the checks allow, so only a file that breaks them by a long way is cut.</summary>
    internal const int DrawRows = 60, DrawColumns = 36, DrawLines = 120;

    private static Control WithMore(Control content, string words, Func<string, IBrush> resource)
    {
        var more = new TextBlock { Text = words, FontSize = 12, Foreground = resource("MutedBrush"), Margin = new Thickness(2, 4, 0, 0) };
        return new StackPanel { Children = { content, more } };
    }

    /// <summary>A document: one sample, a field to a line, nesting shown by indent, a dot after a field with a note.</summary>
    private static Control Document(DataShown entry, Func<string, IBrush> resource)
    {
        var doc = new StackPanel();
        var cutLines = Math.Max(0, entry.Lines.Count - DrawLines);
        foreach (var line in entry.Lines.Take(DrawLines))
        {
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness((line.Depth - 1) * 14, 0, 0, 0) };
            row.Children.Add(new TextBlock { Text = line.Key, FontFamily = Fonts.Mono, FontSize = 12, Foreground = resource("MutedBrush") });
            if (line.Value != "") row.Children.Add(new TextBlock { Text = line.Value, FontFamily = Fonts.Mono, FontSize = 12 });
            if (line.Noted) row.Children.Add(Dot());
            doc.Children.Add(row);
        }
        var framedDoc = Framed(doc, $"{entry.Name} sample", resource, new Thickness(10, 8, 10, 12)); // room under the lines for the scrollbar, which lies over the content
        return cutLines > 0 ? WithMore(framedDoc, $"{cutLines} more fields", resource) : framedDoc;
    }

    private static Control Framed(Control content, string name, Func<string, IBrush> resource, Thickness padding)
    {
        var scroll = new ScrollViewer
        {
            Content = new Border { Child = content, Padding = padding },
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
        };
        var frame = new Border { Child = scroll, BorderBrush = resource("LineBrush"), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(8), ClipToBounds = true };
        AutomationProperties.SetName(frame, name);
        return frame;
    }

    /// <summary>The notes under the data, each in a strip with the column or field it is about.</summary>
    private static Control Notes(DataShown entry, Func<string, IBrush> resource)
    {
        var list = new StackPanel { Spacing = 4 };
        foreach (var n in entry.Notes)
        {
            var name = new Border { Child = new TextBlock { Text = n.Name, FontFamily = Fonts.Mono, FontSize = 11.5 }, VerticalAlignment = VerticalAlignment.Top, Classes = { "datacode" } };
            var text = new TextBlock { Text = n.Text, FontSize = 12.5, Foreground = resource("KnowFgBrush"), TextWrapping = TextWrapping.Wrap };
            var row = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)], ColumnSpacing = 6, Children = { name, text } };
            Grid.SetColumn(text, 1);
            list.Children.Add(new Border { Child = row, Classes = { "datanote" } });
        }
        return list;
    }
}
