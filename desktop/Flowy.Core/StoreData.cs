using static Flowy.Core.YamlTree;

namespace Flowy.Core;

/// <summary>
/// A column of a grid. <c>Key</c> is only ever "primary"; <c>To</c> names the table a foreign key points to. <c>Type</c> is the data type as the author
/// writes it ("int", "text"); a trailing "?" in the file ("int?") says the column can be empty, and is <c>Nullable</c> here, not part of the type.
/// </summary>
public sealed record DataColumn(string Name, string? Type, bool Nullable, string? Key, string? To, string? Note);

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
    public const int MaxColumns = 12, MaxRows = 8, MaxDepth = 3, MaxFields = 20, MaxType = 40;

    private static bool JsBlank(string s) => s.All(JsCompat.IsSpace);

    private static string? Text(object? v) => v is string s && !JsBlank(s) ? s : null;

    private static bool Present(object? v) => v is not (null or "");

    private static string Plural(int n, string word) => $"{n} {word}{(n == 1 ? "" : "s")}";

    /// <summary>A written type split into the type and whether it can be empty: "int?" is "int" and nullable, "?" is nullable with no type.</summary>
    private static (string? Type, bool Nullable) TypeOf(object? raw)
    {
        if (Text(raw) is not { } text) return (null, false);
        var written = JsCompat.JsTrim(text);
        var nullable = written.EndsWith('?');
        var type = JsCompat.JsTrim(nullable ? written[..^1] : written);
        return (type == "" ? null : type, nullable);
    }

    private static DataColumn? ColumnOf(object? raw)
    {
        if (raw is string s) return JsBlank(s) ? null : new DataColumn(s, null, false, null, null, null);
        if (raw is not OrderedDictionary<string, object?> map || Text(Get(map, "name")) is not { } name) return null;
        var (type, nullable) = TypeOf(Get(map, "type"));
        return new DataColumn(name, type, nullable, Get(map, "key") is "primary" ? "primary" : null, Text(Get(map, "to")), Text(Get(map, "note")));
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
            foreach (var key in JsCompat.OrderKeys(map.Keys))
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

    // ---- editing --------------------------------------------------------------------------------------------------

    private static bool Blank(object? v) => v is string s && JsBlank(s);

    private static OrderedDictionary<string, object?> Rest(OrderedDictionary<string, object?> map, params string[] taken)
    {
        var rest = new OrderedDictionary<string, object?>();
        foreach (var (key, value) in map)
            if (!taken.Contains(key)) rest[key] = value;
        return rest;
    }

    private static object? TidyColumn(object? c)
    {
        if (c is not OrderedDictionary<string, object?> map) return c;
        var tidy = new OrderedDictionary<string, object?>();
        if (map.TryGetValue("name", out var name)) tidy["name"] = name;
        foreach (var field in new[] { "type", "key", "to", "note" })
            if (map.TryGetValue(field, out var value) && !Blank(value)) tidy[field] = value;
        foreach (var (key, value) in Rest(map, "name", "type", "key", "to", "note")) tidy[key] = value;
        return tidy.Count == 1 && name is string ? name : tidy;
    }

    private static object? TidyEntry(object? e)
    {
        if (e is not OrderedDictionary<string, object?> entry) return e;
        var tidy = new OrderedDictionary<string, object?>();
        if (entry.TryGetValue("name", out var name)) tidy["name"] = name;
        foreach (var field in new[] { "kind", "limits", "note" })
            if (entry.TryGetValue(field, out var value) && !Blank(value)) tidy[field] = value;
        if (entry.TryGetValue("columns", out var columns)) tidy["columns"] = columns is List<object?> list ? list.Select(TidyColumn).ToList() : columns;
        if (entry.TryGetValue("rows", out var rows)) tidy["rows"] = rows;
        if (entry.TryGetValue("sample", out var sample)) tidy["sample"] = sample;
        if (entry.TryGetValue("notes", out var notes) && notes is not OrderedDictionary<string, object?> { Count: 0 }) tidy["notes"] = notes;
        foreach (var (key, value) in Rest(entry, "name", "kind", "limits", "note", "columns", "rows", "sample", "notes")) tidy[key] = value;
        return tidy;
    }

    /// <summary>
    /// The entries of a data as they go to disk: keys in the order name, kind, limits, note, columns, rows, sample, notes (others after); a blank kind,
    /// limits, note, type, key or <c>to</c> left out (a column's keys go name, type, key, to, note); a column with only a name written as the bare name. A value of the wrong shape, a data that is not a
    /// list included, is carried through unchanged for the checks to report. The twin of <c>tidyData</c> (numbers are already text in a tree).
    /// </summary>
    public static object? Tidy(object? input) => input is List<object?> entries ? entries.Select(TidyEntry).ToList() : input;

    // ---- writing --------------------------------------------------------------------------------------------------

    /// <summary>
    /// What a store's data writes on one line, so a table of eight rows stays eight lines and a diff stays readable: each row, each column that is a
    /// mapping, a <c>columns</c> list of only bare names, and a list of text inside a sample. Everything else stays block style. The twin of
    /// <c>compactData</c> in src/core/model.ts: only nodes of the expected kind are marked, so a hand-written data of the wrong shape is written as it is.
    /// Returns a copy with <see cref="FlowSeq"/> and <see cref="FlowMap"/> marks; the tree it is given is not changed.
    /// </summary>
    public static object? Compact(object? objects)
    {
        if (objects is not OrderedDictionary<string, object?> map) return objects;
        var copy = new OrderedDictionary<string, object?>();
        foreach (var (id, o) in map)
        {
            if (o is OrderedDictionary<string, object?> obj && obj.TryGetValue("data", out var data) && data is List<object?> entries)
            {
                var changed = new OrderedDictionary<string, object?>(obj) { ["data"] = entries.Select(CompactEntry).ToList() };
                copy[id] = changed;
            }
            else copy[id] = o;
        }
        return copy;
    }

    private static object? CompactEntry(object? e)
    {
        if (e is not OrderedDictionary<string, object?> entry) return e;
        var copy = new OrderedDictionary<string, object?>(entry);
        if (entry.TryGetValue("columns", out var c) && c is List<object?> columns)
            copy["columns"] = columns.All(item => item is string)
                ? new FlowSeq(columns)
                : columns.Select(column => column is OrderedDictionary<string, object?> map ? new FlowMap(map) : column).ToList();
        if (entry.TryGetValue("rows", out var r) && r is List<object?> rows)
            copy["rows"] = rows.Select(row => row is List<object?> cells ? new FlowSeq(cells) : row).ToList();
        if (entry.TryGetValue("sample", out var sample)) copy["sample"] = FlowTextLists(sample);
        return copy;
    }

    /// <summary>In a sample document, a list of only text is written on one line.</summary>
    private static object? FlowTextLists(object? node)
    {
        if (node is List<object?> list) return list.All(item => item is string) ? new FlowSeq(list) : list.Select(FlowTextLists).ToList();
        if (node is not OrderedDictionary<string, object?> map) return node;
        var copy = new OrderedDictionary<string, object?>();
        foreach (var (key, value) in map) copy[key] = FlowTextLists(value);
        return copy;
    }

    /// <summary>A store's data as the text of the edit box: the same one-line forms the file uses, with no wrapper. Empty text for none. The twin of <c>serializeData</c>.</summary>
    public static string Serialize(object? data) =>
        data is null or "" or List<object?> { Count: 0 } ? "" : YamlWriter.Write(data is List<object?> entries ? entries.Select(CompactEntry).ToList() : data);

    /// <summary>The edit box's text as data, read as the files are. Blank text is an empty list. Throws a <see cref="ParseError"/> (file "data") for text that is not YAML. Text with nothing in it but comments reads as `~`, which is not a list, so it is refused like any other data that is not one (the TypeScript side reads it as null and is refused the same way). The twin of <c>parseData</c>.</summary>
    public static object? ParseText(string text) => JsBlank(text) ? new List<object?>() : YamlText.Parse("data", text) ?? "~";

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
            foreach (var field in new[] { "type", "to", "note" })
                if (map.TryGetValue(field, out var value) && value is not string) output.Add($"{label}: column \"{name}\": \"{field}\" must be plain text");
            if (Get(map, "type") is string type && JsCompat.JsTrim(type).Length > MaxType) output.Add($"{label}: column \"{name}\": type is longer than {MaxType} characters");
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

    /// <summary>Whether any text in a value, the keys of a mapping included, holds a line break (or one of the separators that read as one).</summary>
    private static bool HasLineBreak(object? node) => node switch
    {
        string s => s.IndexOfAny(['\r', '\n', (char)0x85, (char)0x2028, (char)0x2029]) >= 0, // the separators too: YAML 1.1 readers take them for line breaks
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
        foreach (var key in JsCompat.OrderKeys(notes.Keys))
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
