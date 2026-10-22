using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>
/// The C# side of dumpCompareUi in desktop/fixtures/compare.ts: what the comparison's key lists, how a stop of the progress bar is marked, where a note on a pair is read and saved, and when it can't be,
/// must be what keyItems, changeOfStop, noteOf, saveTarget and the rest in ui/src/compare.ts say.
/// </summary>
public class CompareUiTests
{
    private static readonly JsonNode Expected = JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "compare-ui.json")))!;

    private static string Word(Change c) => c switch { Change.New => "new", Change.Removed => "removed", _ => "changed" };

    private static Change Kind(string word) => word switch { "new" => Change.New, "removed" => Change.Removed, _ => Change.Changed };

    private static SideMarks Marks(JsonNode m) => new(
        m["steps"]!.AsObject().ToDictionary(kv => int.Parse(kv.Key), kv => Kind(kv.Value!.GetValue<string>())),
        m["shapes"]!.AsObject().ToDictionary(kv => kv.Key, kv => Kind(kv.Value!.GetValue<string>())),
        m["lines"]!.AsObject().ToDictionary(kv => kv.Key, kv => Kind(kv.Value!.GetValue<string>())));

    /// <summary>A compare value as the folder loader holds it: text, or a mapping.</summary>
    private static object? Raw(JsonNode? node) => node switch
    {
        null => null,
        JsonObject o => o.ToDictionary(kv => kv.Key, kv => Raw(kv.Value)),
        _ => node.GetValue<string>(),
    };

    private static IReadOnlyDictionary<string, object?> TagsOf(JsonNode tags)
    {
        var map = new OrderedDictionary<string, object?>();
        foreach (var (id, value) in tags.AsObject()) map.Add(id, Raw(value));
        return map;
    }

    private static JsonObject TagNode(CompareTag tag)
    {
        var node = new JsonObject { ["with"] = tag.With };
        if (tag.Note is not null) node["note"] = tag.Note;
        return node;
    }

    [Fact]
    public void The_three_kinds_have_one_name_each()
    {
        var names = Expected["names"]!.AsObject();
        foreach (var kind in new[] { Change.New, Change.Removed, Change.Changed }) Assert.Equal(names[Word(kind)]!.GetValue<string>(), CompareUi.Name(kind));
    }

    [Fact]
    public void The_key_lists_the_kinds_on_the_sides_on_screen_as_the_TypeScript_key_does()
    {
        var cases = Expected["keys"]!.AsArray();
        Assert.True(cases.Count >= 20);
        foreach (var c in cases)
        {
            var diff = new FlowDiff(c!["diff"]!["related"]!.GetValue<bool>(), Marks(c["diff"]!["older"]!), Marks(c["diff"]!["newer"]!));
            foreach (var result in c["results"]!.AsArray())
            {
                var sides = result!["sides"]!.AsArray().Select(s => s!.GetValue<string>()).ToList();
                var (items, related) = CompareUi.KeyItems(diff, sides);
                var actual = new JsonObject { ["sides"] = new JsonArray(sides.Select(s => (JsonNode)s).ToArray()), ["items"] = new JsonArray(items.Select(k => (JsonNode)Word(k)).ToArray()), ["related"] = related };
                Assert.Equal(JsonDump.Pretty(result), JsonDump.Pretty(actual));
            }
        }
    }

    [Fact]
    public void A_stop_takes_the_mark_of_its_steps_as_the_TypeScript_one_does()
    {
        var cases = Expected["stops"]!.AsArray();
        Assert.NotEmpty(cases);
        foreach (var c in cases)
        {
            var steps = c!["steps"]!.AsArray().Select(s => s!.GetValue<int>()).ToList();
            var changes = c["changes"]!.AsObject().ToDictionary(kv => int.Parse(kv.Key), kv => Kind(kv.Value!.GetValue<string>()));
            var expected = c["result"]?.GetValue<string>();
            Assert.Equal(expected, CompareUi.ChangeOfStop(steps, changes) is { } kind ? Word(kind) : null);
        }
    }

    [Fact]
    public void Every_pair_reads_its_note_key_and_save_target_as_the_TypeScript_core_does()
    {
        var sets = Expected["tagCases"]!.AsArray();
        Assert.True(sets.Count >= 8);
        foreach (var set in sets)
        {
            var tags = TagsOf(set!["tags"]!);
            foreach (var pair in set["pairs"]!.AsArray())
            {
                var (a, b) = (pair!["a"]!.GetValue<string>(), pair["b"]!.GetValue<string>());
                var where = $"{set["name"]}: {a}, {b}";
                var note = CompareUi.NoteOf(tags, a, b);
                var noteNode = new JsonObject { ["text"] = note.Text };
                if (note.Holder is not null) noteNode["holder"] = note.Holder;
                Assert.True(JsonDump.Pretty(pair["note"]) == JsonDump.Pretty(noteNode), where);
                Assert.Equal(pair["key"]!.GetValue<string>(), CompareUi.PairKey(a, b));
                Assert.Equal(CompareUi.PairKey(a, b), CompareUi.PairKey(b, a));
                foreach (var target in pair["targets"]!.AsArray())
                {
                    var text = target!["text"]!.GetValue<string>();
                    var (id, tag, replaces) = CompareUi.SaveTarget(tags, a, b, text);
                    var actual = new JsonObject { ["text"] = text, ["id"] = id, ["tag"] = TagNode(tag) };
                    if (replaces is not null) actual["replaces"] = replaces;
                    Assert.True(JsonDump.Pretty(target) == JsonDump.Pretty(actual), $"{where}, note {text}");
                }
            }
        }
    }

    [Fact]
    public void A_note_counts_as_unsaved_as_the_TypeScript_one_does()
    {
        foreach (var c in Expected["unsaved"]!.AsArray())
            Assert.Equal(c!["result"]!.GetValue<bool>(), CompareUi.Unsaved(c["draft"]?.GetValue<string>(), c["saved"]!.GetValue<string>()));
    }

    [Fact]
    public void What_blocks_a_note_or_a_pair_is_said_in_the_TypeScript_words()
    {
        foreach (var c in Expected["noteOff"]!.AsArray())
            Assert.Equal(c!["result"]?.GetValue<string>(), CompareUi.NoteOff(c["live"]!.GetValue<bool>(), c["readOnly"]!.GetValue<bool>()));
        foreach (var c in Expected["pairOff"]!.AsArray())
            Assert.Equal(c!["result"]?.GetValue<string>(), CompareUi.PairOff(c["kind"]!.GetValue<string>(), c["a"]!.GetValue<string>(), c["b"]!.GetValue<string>()));
        foreach (var c in Expected["removeNeedsConfirm"]!.AsArray())
        {
            var tag = c!["tag"] is JsonObject t ? new CompareTag(t["with"]!.GetValue<string>(), t["note"]?.GetValue<string>()) : null;
            Assert.Equal(c["result"]!.GetValue<bool>(), CompareUi.RemoveNeedsConfirm(tag));
        }
    }

    private static JsonObject TileNode(FlowTile t) => new() { ["id"] = t.Id, ["name"] = t.Name, ["view"] = t.View };

    private static JsonArray TileNodes(IEnumerable<FlowTile> tiles) => new(tiles.Select(t => (JsonNode?)TileNode(t)).ToArray());

    private static Model CompareCase()
    {
        var dir = Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "compare", "flowy");
        return FolderLoader.Load(dir).Model;
    }

    [Fact]
    public void The_flow_forms_tiles_choices_and_tags_are_the_ones_the_TypeScript_form_offers()
    {
        var model = CompareCase();
        var expected = Expected["partners"]!;
        Assert.Equal(9, expected["tiles"]!.AsArray().Count);
        foreach (var t in expected["tiles"]!.AsArray()) Assert.Equal(JsonDump.Pretty(t), JsonDump.Pretty(TileNode(CompareUi.FlowTile(model, t!["id"]!.GetValue<string>()))));
        foreach (var c in expected["choices"]!.AsArray())
            Assert.Equal(JsonDump.Pretty(c!["result"]), JsonDump.Pretty(TileNodes(CompareUi.PartnerChoices(model, c["flowId"]!.GetValue<string>()))));
        foreach (var c in expected["taggedBy"]!.AsArray())
            Assert.Equal(JsonDump.Pretty(c!["result"]), JsonDump.Pretty(TileNodes(CompareUi.TaggedBy(model, c["flowId"]!.GetValue<string>()))));
        var tags = expected["tagWith"]!.AsArray();
        Assert.True(tags.Count >= 27);
        foreach (var c in tags)
        {
            var tag = CompareUi.TagWith(model, c!["flowId"]!.GetValue<string>(), c["partner"]?.GetValue<string>());
            Assert.Equal(JsonDump.Pretty(c["result"]), JsonDump.Pretty(tag is null ? null : TagNode(tag)));
        }
    }

    [Fact]
    public void A_flow_never_offers_itself_and_a_new_partner_keeps_the_note()
    {
        var model = CompareCase();
        Assert.DoesNotContain(CompareUi.PartnerChoices(model, "checkout-v3"), t => t.Id == "checkout-v3");
        Assert.Equal(new CompareTag("checkout", "Adds a retry, and a receipt"), CompareUi.TagWith(model, "checkout-v3", "checkout"));
        Assert.Equal(new CompareTag("checkout-v3"), CompareUi.TagWith(model, "checkout-v2", "checkout-v3")); // it held no note
        Assert.Null(CompareUi.TagWith(model, "checkout-v3", null));
        Assert.Equal(["checkout-v3"], CompareUi.TaggedBy(model, "checkout-v2").Select(t => t.Id)); // checkout-v3 tags it; checkout-v2 itself tags checkout
    }

    [Fact]
    public void A_pair_asked_for_the_other_way_round_gives_the_same_note()
    {
        IReadOnlyDictionary<string, object?> tags = new Dictionary<string, object?> { ["old"] = null, ["now"] = new Dictionary<string, object?> { ["with"] = "old", ["note"] = "After the fix" } };
        Assert.Equal(("After the fix", "now"), CompareUi.NoteOf(tags, "old", "now"));
        Assert.Equal(("After the fix", "now"), CompareUi.NoteOf(tags, "now", "old"));
        Assert.Equal(("", null), CompareUi.NoteOf(tags, "now", "now"));
    }
}
