using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>ui/src/usedby.ts, reproduced: for the shapes and lines of two folders, what is open before any choice, after removing everything, after rerouting everything, and after one or half the rows are settled (desktop/fixtures/usedby.ts).</summary>
public class UsedByTests
{
    private static readonly Dictionary<string, string> Folders = new()
    {
        ["shop"] = "desktop/fixtures/cases/failures/flowy",
        ["delete-case"] = "desktop/fixtures/cases/delete/flowy",
    };

    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "usedby.json")))!;

    private static JsonNode? Strings(IEnumerable<string> items) => new JsonArray(items.Select(s => (JsonNode?)JsonValue.Create(s)).ToArray());

    private static JsonNode Summary(UsedByPlan plan) => JsonDump.Obj(
        ("targets", Strings(plan.Targets.Select(t => t.Object ?? $"{t.Line!.From}>{t.Line.To}"))),
        ("asks", Strings(plan.Asks.Select(r => r.Key))), ("open", Strings(plan.Open.Select(r => r.Key))), ("along", Strings(plan.Along.Select(r => r.Key))),
        ("flows", Strings(plan.Flows.OrderBy(f => f, StringComparer.Ordinal))));

    private static JsonNode After(Model model, IReadOnlyList<Target> targets, IReadOnlyDictionary<string, Choice> choices)
    {
        var plan = UsedBy.PlanOf(model, targets, choices);
        JsonNode Pair(string key, string action, string? to) => JsonDump.Obj(("key", key), ("action", action), ("to", to));
        return JsonDump.Obj(
            ("choices", new JsonArray(choices.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => (JsonNode?)Pair(kv.Key, kv.Value.Action, kv.Value.To)).ToArray())),
            ("plan", Summary(plan)),
            ("resolutions", new JsonArray(UsedBy.ResolutionsOf(plan, choices).OrderBy(r => r.Key, StringComparer.Ordinal).Select(r => (JsonNode?)Pair(r.Key, r.Action, r.To)).ToArray())),
            ("done", UsedBy.DoneText(model, plan, choices, targets)), ("along", UsedBy.AlongText(plan.Along)));
    }

    private static List<Target> TargetsOf(JsonNode? list) => list!.AsArray().Select(t => t!["line"] is { } l
        ? new Target(Line: new LineTarget(l["from"]!.GetValue<string>(), l["to"]!.GetValue<string>(), l["label"]?.GetValue<string>()))
        : new Target(Object: t["object"]!.GetValue<string>())).ToList();

    [Theory]
    [InlineData("shop")]
    [InlineData("delete-case")]
    public void What_is_open_and_what_each_choice_comes_to_is_what_the_TypeScript_says(string name)
    {
        var model = FolderLoader.Load(Path.Combine(Repo.Root, Folders[name])).Model;
        var none = new Dictionary<string, Choice>();
        var count = 0;
        foreach (var entry in Expected()[name]!.AsArray())
        {
            var targets = TargetsOf(entry!["targets"]);
            var plan = UsedBy.PlanOf(model, targets, none);
            var left = UsedBy.ShapesLeft(model, plan);
            string Said(string what) => $"{name}: {entry["targets"]!.ToJsonString()} {what}";
            Assert.True(JsonDump.Pretty(entry["none"]) == JsonDump.Pretty(After(model, targets, none)), Said("with no choice"));
            Assert.Equal(JsonDump.Pretty(entry["left"]), JsonDump.Pretty(Strings(left)));
            var rows = plan.Rows.Where(r => r.NeedsDecision).Select(r => (JsonNode?)JsonDump.Obj(
                ("key", r.Key),
                ("text", JsonDump.Obj(("title", UsedBy.TextOf(model, r).Title), ("where", UsedBy.TextOf(model, r).Where), ("shapes", Strings(UsedBy.TextOf(model, r).Shapes)))),
                ("choice", JsonDump.Obj(("action", UsedBy.DefaultChoice(r).Action))),
                ("labels", Strings(r.Actions.Select(UsedBy.Label))))).ToArray();
            Assert.Equal(JsonDump.Pretty(entry["rows"]), JsonDump.Pretty(new JsonArray(rows)));
            Assert.True(JsonDump.Pretty(entry["removeAll"]) == JsonDump.Pretty(After(model, targets, UsedBy.RemoveAll(model, targets, none))), Said("remove all"));
            if (left.Count > 0) Assert.True(JsonDump.Pretty(entry["reroute"]) == JsonDump.Pretty(After(model, targets, UsedBy.RerouteAll(model, targets, none, left[0]))), Said("reroute all"));
            else Assert.Null(entry["reroute"]);
            if (plan.Asks.Count > 0)
            {
                var first = plan.Asks[0];
                var one = new Dictionary<string, Choice> { [first.Key] = UsedBy.DefaultChoice(first) };
                Assert.True(JsonDump.Pretty(entry["first"]) == JsonDump.Pretty(After(model, targets, one)), Said("first row"));
                var seed = new Dictionary<string, Choice> { [first.Key] = first.Actions.Contains("reroute") && left.Count > 0 ? new Choice("reroute", left[0]) : UsedBy.DefaultChoice(first) };
                Assert.True(JsonDump.Pretty(entry["half"]) == JsonDump.Pretty(After(model, targets, UsedBy.RemoveAll(model, targets, seed))), Said("half"));
            }
            else
            {
                Assert.Null(entry["first"]);
                Assert.Null(entry["half"]);
            }
            count++;
        }
        Assert.True(count > 5);
    }
}
