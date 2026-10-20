namespace Flowy.Core;

/// <summary>A column of a grid. <c>Key</c> is only ever "primary"; <c>To</c> names the table a foreign key points to.</summary>
public sealed record DataColumn(string Name, string? Key, string? To, string? Note);

/// <summary>One note under the data: the column's name, or the field's dotted path in a document, and what it says.</summary>
public sealed record NoteLine(string Name, string Text);

/// <summary>One line of a sample document. <c>Path</c> is null under a list item, which a note cannot address.</summary>
public sealed record SampleLine(int Depth, string Key, string Value, string? Path, bool Noted);

/// <summary>One entry of a store's <c>data</c>, ready to draw. A grid has columns and rows; a document has lines.</summary>
public sealed record DataShown(
    string Name, string? Kind, string? Limits, string? Note, string Summary,
    IReadOnlyList<DataColumn> Columns, IReadOnlyList<IReadOnlyList<string>> Rows, IReadOnlyList<SampleLine> Lines, IReadOnlyList<NoteLine> Notes);

/// <summary>A store's <c>data</c>: what it shows and what is wrong with it. A port of src/core/data.ts with the same rules and the same words.</summary>
public static class StoreData
{
    /// <summary>How much the section shows, so it stays a picture of the few tables that matter and never a dump.</summary>
    public const int MaxColumns = 12, MaxRows = 8, MaxDepth = 3, MaxFields = 20;

    private static string? Text(object? v) => v is string s && !string.IsNullOrWhiteSpace(s) ? s : null;

    private static bool Present(object? v) => v is not (null or "");

    private static object? Get(OrderedDictionary<string, object?> map, string key) => map.TryGetValue(key, out var v) ? v : null;

    private static string Plural(int n, string word) => $"{n} {word}{(n == 1 ? "" : "s")}";

    private static DataColumn? ColumnOf(object? raw)
    {
        if (raw is string s) return string.IsNullOrWhiteSpace(s) ? null : new DataColumn(s, null, null, null);
        if (raw is not OrderedDictionary<string, object?> map || Text(Get(map, "name")) is not { } name) return null;
        return new DataColumn(name, Get(map, "key") is "primary" ? "primary" : null, Text(Get(map, "to")), Text(Get(map, "note")));
    }

    private static List<IReadOnlyList<string>> RowsOf(object? raw, int width) =>
        raw is List<object?> rows
            ? rows.OfType<List<object?>>().Select(row => (IReadOnlyList<string>)Enumerable.Range(0, width).Select(i => i < row.Count && row[i] is string s ? s : "").ToList()).ToList()
            : [];

    private static string Inline(IEnumerable<object?> items) => $"[{string.Join(", ", items.OfType<string>())}]";

    /// <summary>
    /// A sample document as lines. A text field is one line; a mapping is a line followed by its fields one level deeper; a list of text is one
    /// line, <c>[a, b]</c>; any other list is a line followed by a <c>-</c> line for each item (and an item's fields two levels deeper). A line's
    /// path is its keys joined with dots, and is null under a list item. <c>Noted</c> says <paramref name="notes"/> has text for that path.
    /// </summary>
    private static List<SampleLine> LinesOf(OrderedDictionary<string, object?> sample, OrderedDictionary<string, object?> notes)
    {
        var lines = new List<SampleLine>();
        bool Noted(string? path) => path is not null && notes.TryGetValue(path, out var note) && Text(note) is not null;
        void Add(int depth, string key, string value, string? path = null) => lines.Add(new SampleLine(depth, key, value, path, Noted(path)));
        // prefix is the path of the mapping being walked, "" at the top, and null under a list item.
        void Walk(OrderedDictionary<string, object?> map, int depth, string? prefix)
        {
            foreach (var key in JsKeys.Order(map.Keys))
            {
                var value = map[key];
                var path = prefix is null ? null : prefix == "" ? key : $"{prefix}.{key}";
                if (value is OrderedDictionary<string, object?> child)
                {
                    Add(depth, key, "", path);
                    Walk(child, depth + 1, path);
                }
                else if (value is List<object?> list)
                {
                    if (list.All(item => item is string)) Add(depth, key, Inline(list), path);
                    else
                    {
                        Add(depth, key, "", path);
                        foreach (var item in list)
                        {
                            if (item is string text) Add(depth + 1, "-", text);
                            else if (item is OrderedDictionary<string, object?> fields)
                            {
                                Add(depth + 1, "-", "");
                                Walk(fields, depth + 2, null);
                            }
                            else if (item is List<object?> inner) Add(depth + 1, "-", Inline(inner));
                        }
                    }
                }
                else Add(depth, key, value as string ?? "", path);
            }
        }
        Walk(sample, 1, "");
        return lines;
    }

    /// <summary>
    /// What a store's data shows, entry by entry. An entry that is not a mapping or has no name is left out, and so is one with neither
    /// <c>columns</c> (a grid) nor <c>sample</c> (a document); the checks report those. Never throws.
    /// </summary>
    public static IReadOnlyList<DataShown> Shown(FlowyObject o)
    {
        if (o.Data is not List<object?> data) return [];
        var shown = new List<DataShown>();
        foreach (var raw in data)
        {
            if (raw is not OrderedDictionary<string, object?> entry || Text(Get(entry, "name")) is not { } name) continue;
            string? kind = Text(Get(entry, "kind")), limits = Text(Get(entry, "limits")), note = Text(Get(entry, "note"));
            if (Get(entry, "columns") is List<object?> rawColumns)
            {
                var columns = rawColumns.Select(ColumnOf).OfType<DataColumn>().ToList();
                var notes = columns.Where(c => c.Note is not null).Select(c => new NoteLine(c.Name, c.Note!)).ToList();
                shown.Add(new DataShown(name, kind, limits, note, Plural(columns.Count, "column"), columns, RowsOf(Get(entry, "rows"), columns.Count), [], notes));
            }
            else if (Get(entry, "sample") is OrderedDictionary<string, object?> sample)
            {
                var notesMap = Get(entry, "notes") as OrderedDictionary<string, object?>;
                var lines = LinesOf(sample, notesMap ?? new OrderedDictionary<string, object?>());
                var notes = notesMap is null ? [] : lines.Where(l => l.Noted).Select(l => new NoteLine(l.Path!, (string)notesMap[l.Path!]!)).ToList();
                shown.Add(new DataShown(name, kind, limits, note, Plural(sample.Count, "field"), [], [], lines, notes));
            }
        }
        return shown;
    }

    // ---- the checks ----------------------------------------------------------------------------------------------

    private static void GridProblems(string label, OrderedDictionary<string, object?> entry, List<string> output)
    {
        if (Get(entry, "columns") is not List<object?> columns)
        {
            output.Add($"{label}: columns must be a list");
            return;
        }
        if (columns.Count == 0) output.Add($"{label}: columns is empty");
        var seen = new HashSet<string>();
        for (var i = 0; i < columns.Count; i++)
        {
            var column = columns[i];
            if (column is not (string or OrderedDictionary<string, object?>))
            {
                output.Add($"{label}: column {i + 1} must be a name or a mapping");
                continue;
            }
            var map = column as OrderedDictionary<string, object?>;
            if ((column is string s ? Text(s) : Text(Get(map!, "name"))) is not { } name)
            {
                output.Add($"{label}: column {i + 1} has no name");
                continue;
            }
            if (!seen.Add(name)) output.Add($"{label}: column \"{name}\" appears twice");
            if (map is null) continue;
            if (Present(Get(map, "key")) && Get(map, "key") is not "primary") output.Add($"{label}: column \"{name}\": key must be primary");
            foreach (var field in new[] { "to", "note" })
                if (map.TryGetValue(field, out var value) && value is not string) output.Add($"{label}: column \"{name}\": \"{field}\" must be plain text");
        }
        if (columns.Count > MaxColumns) output.Add($"{label}: {columns.Count} columns, at most {MaxColumns}");
        var rawRows = Get(entry, "rows");
        if (!Present(rawRows)) return;
        if (rawRows is not List<object?> rows)
        {
            output.Add($"{label}: rows must be a list of rows");
            return;
        }
        for (var i = 0; i < rows.Count; i++)
        {
            if (rows[i] is not List<object?> row || row.Any(cell => cell is not string)) output.Add($"{label}: row {i + 1} must be a list of cells");
            else if (row.Count != columns.Count)
                output.Add($"{label}: row {i + 1} has {Plural(row.Count, "cell")} but there {(columns.Count == 1 ? "is" : "are")} {Plural(columns.Count, "column")}");
        }
        if (rows.Count > MaxRows) output.Add($"{label}: {rows.Count} rows, at most {MaxRows}");
    }

    /// <summary>Whether any text in a value, the keys of a mapping included, holds a line break.</summary>
    private static bool HasLineBreak(object? node) => node switch
    {
        string s => s.IndexOfAny(['\r', '\n']) >= 0,
        List<object?> list => list.Any(HasLineBreak),
        OrderedDictionary<string, object?> map => map.Any(kv => HasLineBreak(kv.Key) || HasLineBreak(kv.Value)),
        _ => false,
    };

    /// <summary>Whether a list sits directly inside a list anywhere in the sample, which the picture cannot draw.</summary>
    private static bool HasNestedList(object? node) => node switch
    {
        List<object?> list => list.Any(item => item is List<object?> || HasNestedList(item)),
        OrderedDictionary<string, object?> map => map.Values.Any(HasNestedList),
        _ => false,
    };

    private static void SampleProblems(string label, OrderedDictionary<string, object?> entry, List<string> output)
    {
        if (Get(entry, "sample") is not OrderedDictionary<string, object?> sample)
        {
            output.Add($"{label}: sample must be a mapping of fields");
            return;
        }
        if (sample.Count == 0)
        {
            output.Add($"{label}: sample is empty");
            return;
        }
        if (HasNestedList(sample)) output.Add($"{label}: sample has a list inside a list, which isn't shown");
        var lines = LinesOf(sample, new OrderedDictionary<string, object?>());
        var depth = lines.Max(l => l.Depth);
        if (depth > MaxDepth) output.Add($"{label}: sample is nested {depth} levels deep, at most {MaxDepth}");
        if (lines.Count > MaxFields) output.Add($"{label}: sample shows {lines.Count} fields, at most {MaxFields}");
        var rawNotes = Get(entry, "notes");
        if (!Present(rawNotes)) return;
        if (rawNotes is not OrderedDictionary<string, object?> notes || notes.Values.Any(v => v is not string))
        {
            output.Add($"{label}: notes must map a field to its note");
            return;
        }
        var paths = lines.Select(l => l.Path).OfType<string>().ToHashSet();
        foreach (var key in JsKeys.Order(notes.Keys))
            if (!paths.Contains(key)) output.Add($"{label}: the note on \"{key}\" names no field of the sample");
    }

    /// <summary>
    /// What is wrong with a store's data, as messages without the object's id (the checks add it). A blank <c>data</c>, <c>kind</c>,
    /// <c>limits</c>, <c>note</c>, <c>columns</c>, <c>rows</c>, <c>sample</c> or <c>notes</c> counts as left out. Never throws.
    /// </summary>
    public static List<string> Problems(FlowyObject o)
    {
        if (!Present(o.Data)) return [];
        if (o.Type != "store") return ["only a store can have data"];
        if (o.Data is not List<object?> data) return ["data must be a list of entries"];
        var output = new List<string>();
        var names = new HashSet<string>();
        for (var i = 0; i < data.Count; i++)
        {
            if (data[i] is not OrderedDictionary<string, object?> entry)
            {
                output.Add($"data entry {i + 1} must be a mapping");
                continue;
            }
            var name = Text(Get(entry, "name"));
            if (name is null) output.Add($"data entry {i + 1} has no name");
            else if (names.Contains(name)) output.Add($"data \"{name}\" appears twice");
            if (name is not null) names.Add(name);
            var label = name is null ? $"data entry {i + 1}" : $"data \"{name}\"";
            if (HasLineBreak(entry)) output.Add($"{label}: text can't hold a line break");
            foreach (var field in new[] { "kind", "limits", "note" })
                if (entry.TryGetValue(field, out var value) && value is not string) output.Add($"{label}: \"{field}\" must be plain text");
            var (grid, document) = (Present(Get(entry, "columns")), Present(Get(entry, "sample")));
            if (!grid && !document) output.Add($"{label} needs columns or a sample");
            else if (grid && document) output.Add($"{label} has both columns and a sample");
            if (!grid && Present(Get(entry, "rows"))) output.Add($"{label}: rows need columns");
            if (!document && Present(Get(entry, "notes"))) output.Add($"{label}: notes need a sample");
            if (grid) GridProblems(label, entry, output);
            if (document) SampleProblems(label, entry, output);
        }
        return output;
    }
}
