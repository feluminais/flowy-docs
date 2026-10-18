using System.Text.RegularExpressions;
using YamlDotNet.Core;
using YamlDotNet.Core.Events;

namespace Flowy.Core;

/// <summary>
/// Reads YAML the way Flowy's other readers do: every value stays the text that was typed, so an id like
/// <c>007</c> or a version like <c>3.10</c> is never turned into a number. A mapping comes back as an
/// <see cref="OrderedDictionary{TKey,TValue}"/> in file order, a list as a <see cref="List{T}"/> of objects,
/// and anything else as a string. An empty file gives null.
/// </summary>
public static class YamlText
{
    private const int MaxDepth = 200;

    // Line starts are found by \n only, as in the TypeScript reader, so a Unicode line separator inside a value can't pass for one.
    private static readonly Regex Conflict = new(
        @"(?<![^\n])(?:(?:<{7}|>{7})(?= |\r?\n|\r?\z)|={7}(?=\r?\n|\r?\z))",
        RegexOptions.CultureInvariant);

    public static object? Parse(string file, string text)
    {
        var conflict = Conflict.Match(text);
        if (conflict.Success)
            throw new ParseError(file, "unresolved merge conflict", text.AsSpan(0, conflict.Index).Count('\n') + 1);

        if (text.Length > 0 && text[0] == '﻿') text = text[1..]; // YamlDotNet keeps a byte-order mark as part of the first key
        try
        {
            var parser = new Parser(new StringReader(text));
            parser.Consume<StreamStart>();
            if (parser.TryConsume<StreamEnd>(out _)) return null;
            parser.Consume<DocumentStart>();
            var value = Read(parser, file, 0);
            parser.Consume<DocumentEnd>();
            if (!parser.Accept<StreamEnd>(out _)) throw new ParseError(file, "source contains multiple documents");
            return value;
        }
        catch (Exception e) when (e is not ParseError)
        {
            // YamlDotNet's parser throws more than YamlException on some half-typed input (InvalidOperationException, ArgumentException).
            throw new ParseError(file, e.Message.Split('\n')[0], e is YamlException y ? (int)y.Start.Line : null);
        }
    }

    // Known gap: anchors and aliases are refused. The TypeScript reader takes small ones; here a few nested aliases
    // could expand into billions of values, so the app says so instead.
    private static ParseError Aliases(string file, Mark at) => new(file, "anchors and aliases are not supported", (int)at.Line);

    private static object Read(IParser parser, string file, int depth)
    {
        if (depth > MaxDepth) throw new ParseError(file, "nested too deeply");
        if (parser.Accept<AnchorAlias>(out var alias)) throw Aliases(file, alias.Start);

        if (parser.TryConsume<Scalar>(out var scalar))
        {
            if (!scalar.Anchor.IsEmpty) throw Aliases(file, scalar.Start);
            return scalar.Value;
        }
        if (parser.TryConsume<SequenceStart>(out var sequence))
        {
            if (!sequence.Anchor.IsEmpty) throw Aliases(file, sequence.Start);
            var list = new List<object?>();
            while (!parser.TryConsume<SequenceEnd>(out _)) list.Add(Read(parser, file, depth + 1));
            return list;
        }
        if (parser.TryConsume<MappingStart>(out var mapping))
        {
            if (!mapping.Anchor.IsEmpty) throw Aliases(file, mapping.Start);
            var map = new OrderedDictionary<string, object?>();
            while (!parser.TryConsume<MappingEnd>(out _))
            {
                if (!parser.Accept<Scalar>(out var keyEvent)) throw new ParseError(file, "mapping keys must be plain text", (int)mapping.Start.Line);
                var key = (string)Read(parser, file, depth + 1);
                var value = Read(parser, file, depth + 1);
                if (!map.TryAdd(key, value)) throw new ParseError(file, "Map keys must be unique", (int)keyEvent.Start.Line);
            }
            return map;
        }
        throw new ParseError(file, "unexpected content");
    }
}
