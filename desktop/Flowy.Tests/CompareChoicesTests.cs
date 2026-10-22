using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>
/// The C# side of dumpCompareChoices in desktop/fixtures/compare.ts: what each flow and run of desktop/fixtures/cases/compare can be compared with, and the order each pair reads in,
/// must be what choicesFor and orderPair in ui/src/compare.ts say.
/// </summary>
public class CompareChoicesTests
{
    private static readonly JsonNode Expected = JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "compare-choices.json")))!;
    private static readonly Folder Case = FolderLoader.Load(Path.Combine(Repo.Root, Expected["folder"]!.GetValue<string>()));
    private static readonly IReadOnlyDictionary<string, LoadRun> Runs = Case.Runs?.ToDictionary(kv => kv.Key, kv => kv.Value) ?? new Dictionary<string, LoadRun>();

    private static JsonObject Node(Choice c) => new() { ["id"] = c.Id, ["name"] = c.Name, ["side"] = c.Side, ["missing"] = c.Missing };

    private static void Matches(JsonArray expected, string kind)
    {
        Assert.NotEmpty(expected);
        foreach (var entry in expected)
        {
            var id = entry!["id"]!.GetValue<string>();
            var (linked, others) = CompareChoices.For(Case.Model, Runs, kind, id);
            var actual = new JsonObject { ["id"] = id, ["linked"] = new JsonArray(linked.Select(c => (JsonNode)Node(c)).ToArray()), ["others"] = new JsonArray(others.Select(c => (JsonNode)Node(c)).ToArray()) };
            Assert.Equal(JsonDump.Pretty(entry), JsonDump.Pretty(actual));
        }
    }

    [Fact]
    public void Every_flow_lists_what_the_TypeScript_choicesFor_lists()
    {
        Matches(Expected["flows"]!.AsArray(), "flow");
    }

    [Fact]
    public void Every_run_lists_what_the_TypeScript_choicesFor_lists()
    {
        Matches(Expected["runs"]!.AsArray(), "run");
    }

    [Fact]
    public void Every_pair_of_flows_and_runs_reads_in_the_order_the_TypeScript_orderPair_gives()
    {
        foreach (var (kind, key) in new[] { ("flow", "flowOrders"), ("run", "runOrders") })
        {
            var tags = CompareChoices.TagsOf(Case.Model, Runs, kind);
            var pairs = Expected[key]!.AsArray();
            Assert.NotEmpty(pairs);
            foreach (var pair in pairs)
            {
                var (a, b) = (pair!["a"]!.GetValue<string>(), pair["b"]!.GetValue<string>());
                var (older, newer) = CompareChoices.Order(kind, tags, a, b);
                Assert.Equal(new[] { pair["order"]![0]!.GetValue<string>(), pair["order"]![1]!.GetValue<string>() }, new[] { older, newer });
            }
        }
    }

    [Fact]
    public void A_tag_to_something_missing_is_kept_and_greyed_and_the_id_itself_is_never_listed()
    {
        var (linked, others) = CompareChoices.For(Case.Model, Runs, "flow", "ghost");
        Assert.Equal(new Choice("nowhere", "nowhere", "before", true), Assert.Single(linked));
        Assert.DoesNotContain(others, c => c.Id == "ghost");
        var (selfLinked, selfOthers) = CompareChoices.For(Case.Model, Runs, "flow", "selfish");
        Assert.Empty(selfLinked);
        Assert.DoesNotContain(selfOthers, c => c.Id == "selfish");
    }

    [Fact]
    public void Linked_flows_come_first_in_the_order_partners_lists_them_and_a_mutual_pair_lists_once()
    {
        var (linked, others) = CompareChoices.For(Case.Model, Runs, "flow", "checkout-v2");
        Assert.Equal(["checkout", "checkout-v3"], linked.Select(c => c.Id).ToArray());
        Assert.Equal(new[] { "before", "after" }, linked.Select(c => c.Side!).ToArray());
        Assert.DoesNotContain(others, c => linked.Any(l => l.Id == c.Id));
        Assert.Single(CompareChoices.For(Case.Model, Runs, "flow", "mutual-a").Linked);
    }

    [Fact]
    public void The_flow_that_holds_the_tag_reads_second()
    {
        var tags = CompareChoices.TagsOf(Case.Model, Runs, "flow");
        Assert.Equal(("checkout", "checkout-v2"), CompareChoices.Order("flow", tags, "checkout-v2", "checkout"));
        Assert.Equal(("checkout", "checkout-v2"), CompareChoices.Order("flow", tags, "checkout", "checkout-v2"));
        Assert.Equal(("checkout", "bare"), CompareChoices.Order("flow", tags, "checkout", "bare"));
    }
}
