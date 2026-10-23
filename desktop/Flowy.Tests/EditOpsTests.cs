using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>Every edit, as a script (desktop/fixtures/ops.ts): the C# ops must write the files the TypeScript ops write, and refuse with the same words.</summary>
public class EditOpsTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "ops.json")))!;

    private static EditDoc Start(string name = "edit")
    {
        var dir = Path.Combine(Repo.Root, "desktop", "fixtures", "cases", name, "flowy");
        KeyValuePair<string, string>[] Read(string sub) => Directory.Exists(Path.Combine(dir, sub))
            ? Directory.GetFiles(Path.Combine(dir, sub), "*.yaml").OrderBy(f => f, StringComparer.Ordinal).Select(f => KeyValuePair.Create(Path.GetFileNameWithoutExtension(f), File.ReadAllText(f))).ToArray()
            : [];
        return EditDoc.Parse(File.ReadAllText(Path.Combine(dir, "model.yaml")), File.ReadAllText(Path.Combine(dir, "layout.yaml")), Read("flows"), Read("failures"));
    }

    private static List<Target> Targets(JsonNode? list) => list!.AsArray().Select(t => t!["line"] is { } l
        ? new Target(Line: new LineTarget(l["from"]!.GetValue<string>(), l["to"]!.GetValue<string>(), l["label"]?.GetValue<string>(), l["all"]?.GetValue<bool>() ?? false))
        : new Target(Object: t["object"]!.GetValue<string>())).ToList();

    private static List<Resolution> Resolutions(JsonNode? list) => list!.AsArray().Select(r => new Resolution(r!["key"]!.GetValue<string>(), r["action"]!.GetValue<string>(), r["to"]?.GetValue<string>())).ToList();

    private static string? Str(JsonNode s, string key) => s[key]?.GetValue<string>();

    /// <summary>A list of mappings from the script, as the YAML trees the ops take: a flow's steps, an object's links.</summary>
    private static List<OrderedDictionary<string, object?>> Entries(JsonNode? list) =>
        list!.AsArray().Select(e => (OrderedDictionary<string, object?>)YamlWriterTests.Tree(e)!).ToList();

    private static List<OrderedDictionary<string, object?>> Steps(JsonNode? steps) => Entries(steps);

    /// <summary>The groups of a flow in a script: group id → options, as a tree. None if the script has none; {} is an empty set.</summary>
    private static OrderedDictionary<string, object?>? Groups(JsonNode? groups) => groups is null ? null : (OrderedDictionary<string, object?>)YamlWriterTests.Tree(groups)!;

    private static EditDoc Apply(EditDoc doc, JsonNode s)
    {
        switch (Str(s, "op"))
        {
            case "putObject":
                return EditOps.PutObject(doc, new ObjectInput(Str(s, "id")!, Str(s, "type"), Str(s, "name"), Str(s, "in"), s["external"]?.GetValue<bool>(), Str(s, "tech"), Str(s, "description"),
                    s["code"]?.AsArray().Select(c => c!.GetValue<string>()).ToList(),
                    s["links"] is null ? null : Entries(s["links"]),
                    Str(s, "shape"), Str(s, "color"), s["opacity"]?.ToString(), Str(s, "icon"),
                    s["data"] is null ? null : YamlWriterTests.Tree(s["data"]),
                    s["snippets"] is null ? null : Entries(s["snippets"])));
            case "deleteObject": return EditOps.DeleteObject(doc, Str(s, "id")!);
            case "deleteObjects": return EditOps.DeleteObjects(doc, s["ids"]!.AsArray().Select(i => i!.GetValue<string>()).ToList());
            case "deleteWith": return EditOps.DeleteWith(doc, Targets(s["targets"]), Resolutions(s["resolutions"]));
            case "connect": return EditOps.Connect(doc, new ConnectionInput(Str(s, "from")!, Str(s, "to")!, Str(s, "label")));
            case "removeConnection": return EditOps.RemoveConnection(doc, new ConnectionInput(Str(s, "from")!, Str(s, "to")!, Str(s, "which")));
            case "relabel": return EditOps.Relabel(doc, new ConnectionInput(Str(s, "from")!, Str(s, "to")!, Str(s, "which")), Str(s, "label")!);
            case "putFlow": return EditOps.PutFlow(doc, Str(s, "id")!, Str(s, "name")!, Str(s, "view")!, Steps(s["steps"]), Groups(s["groups"]), Groups(s["states"]));
            case "updateFlow": return EditOps.UpdateFlow(doc, Str(s, "id")!, Str(s, "name"), s["steps"] is null ? null : Steps(s["steps"]), Groups(s["groups"]));
            case "setCompare": return EditOps.SetCompare(doc, Str(s, "id")!, Str(s, "with") is { } partner ? new CompareTag(partner, Str(s, "note")) : null);
            case "removeStep": return EditOps.RemoveStep(doc, Str(s, "id")!, s["index"]!.GetValue<int>());
            case "putGroup": return EditOps.PutGroup(doc, Str(s, "id")!, Str(s, "group")!, (OrderedDictionary<string, object?>)YamlWriterTests.Tree(s["options"])!);
            case "removeGroup": return EditOps.RemoveGroup(doc, Str(s, "id")!, Str(s, "group")!);
            case "setStepGroup": return EditOps.SetStepGroup(doc, Str(s, "id")!, s["index"]!.GetValue<int>(), Str(s, "group")!);
            case "setStepAnimation": return EditOps.SetStepAnimation(doc, Str(s, "id")!, s["index"]!.GetValue<int>(), s["animation"] is null ? null : YamlWriterTests.Tree(s["animation"]));
            case "setStepStates": return EditOps.SetStepStates(doc, Str(s, "id")!, s["index"]!.GetValue<int>(), s["states"]!.AsObject().ToDictionary(kv => kv.Key, kv => kv.Value!.GetValue<string>()));
            case "setGroupKind": return EditOps.SetGroupKind(doc, Str(s, "id")!, Str(s, "group")!, Str(s, "kind")!);
            case "groupSteps": return EditOps.GroupSteps(doc, Str(s, "id")!, Str(s, "group")!, Str(s, "kind")!, s["first"]!.GetValue<int>(), s["last"]!.GetValue<int>());
            case "deleteFlow": return EditOps.DeleteFlow(doc, Str(s, "id")!);
            case "putAnalysis": return EditOps.PutAnalysis(doc, Str(s, "id")!, Str(s, "name")!);
            case "deleteAnalysis": return EditOps.DeleteAnalysis(doc, Str(s, "id")!);
            case "putMode": return EditOps.PutMode(doc, Str(s, "analysis")!, Str(s, "id")!, Str(s, "mode")!, Str(s, "on"), Str(s, "from"), Str(s, "to"));
            case "deleteMode": return EditOps.DeleteMode(doc, Str(s, "analysis")!, Str(s, "id")!);
            case "updateMode": return EditOps.UpdateMode(doc, Str(s, "analysis")!, Str(s, "id")!, ModeChanges.Of((OrderedDictionary<string, object?>)YamlWriterTests.Tree(s["changes"])!));
            case "updateAnalysis": return EditOps.UpdateAnalysis(doc, Str(s, "id")!, Str(s["changes"]!, "name"), Str(s["changes"]!, "about"), Str(s["changes"]!, "scope"));
            case "placeBoxes":
                return EditOps.PlaceBoxes(doc, Str(s, "view")!, s["boxes"]!.AsObject().Select(b => (b.Key, b.Value![0]!.GetValue<double>(), b.Value![1]!.GetValue<double>())));
            case "setLines": return EditOps.SetLines(doc, Str(s, "style"));
            case "setProject": return EditOps.SetProject(doc, Str(s, "name"), Str(s, "about"));
            case "forgetLayout": return EditOps.ForgetLayout(doc, Str(s, "view")!);
            default: throw new InvalidOperationException($"unknown op {Str(s, "op")}");
        }
    }

    private static Dictionary<string, string> Files(JsonNode node) => node.AsObject().ToDictionary(f => f.Key, f => f.Value!.GetValue<string>());

    private static string Differences(Dictionary<string, string> expected, Dictionary<string, string> actual)
    {
        var lines = new List<string>();
        foreach (var key in expected.Keys.Union(actual.Keys).OrderBy(k => k, StringComparer.Ordinal))
        {
            expected.TryGetValue(key, out var e);
            actual.TryGetValue(key, out var a);
            if (e != a) lines.Add($"  {key}\n--- expected\n{e}\n--- wrote\n{a}");
        }
        return string.Join("\n", lines);
    }

    [Fact]
    public void A_hand_written_folder_is_rewritten_as_the_browser_rewrites_it_and_keeps_every_extra_key()
    {
        var files = Start().ToFiles();
        var expected = Files(Expected()["initial"]!);
        Assert.True(Differences(expected, files) == "", Differences(expected, files));
        Assert.Contains("owner: sales", files["model.yaml"]);
        Assert.Contains("note: hand-written", files["model.yaml"]);
        Assert.Contains("owner: platform-team", files["model.yaml"]);
        Assert.StartsWith("lines: curved\nowner: platform-team\nobjects:\n", files["model.yaml"]);
    }

    private static void RunScript(EditDoc doc, JsonArray results, int atLeast)
    {
        Assert.True(results.Count > atLeast);
        for (var i = 0; i < results.Count; i++)
        {
            var spec = results[i]!["spec"]!;
            var step = $"step {i + 1} ({Str(spec, "op")} {spec.ToJsonString()})";
            string? error = null;
            EditDoc? next = null;
            try
            {
                next = Apply(doc, spec);
                EditOps.RefuseNewProblems(doc.ToModel(), next.ToModel());
            }
            catch (OpError e)
            {
                error = e.Message;
            }
            if (results[i]!["error"] is { } expectedError)
            {
                Assert.True(error is not null, $"{step} should have been refused: {expectedError.GetValue<string>()}");
                Assert.Equal(expectedError.GetValue<string>(), error);
                continue;
            }
            Assert.True(error is null, $"{step} was refused: {error}");
            doc = next!;
            var expected = Files(results[i]!["files"]!);
            var actual = doc.ToFiles();
            Assert.True(Differences(expected, actual) == "", $"{step}\n{Differences(expected, actual)}");
        }
    }

    [Fact]
    public void Every_edit_writes_what_the_typescript_ops_write_and_a_refused_one_says_the_same_words()
    {
        RunScript(Start(), Expected()["results"]!.AsArray(), 40);
    }

    [Fact]
    public void Deleting_what_others_depend_on_settles_each_row_as_the_typescript_does_and_a_refusal_says_the_same_words()
    {
        var remove = Expected()["remove"]!;
        var files = Start("delete").ToFiles();
        var initial = Files(remove["initial"]!);
        Assert.True(Differences(initial, files) == "", Differences(initial, files));
        Assert.Contains("failures/ordering.yaml", files.Keys);
        RunScript(Start("delete"), remove["results"]!.AsArray(), 20);
    }

    [Fact]
    public void The_failure_forms_write_what_the_typescript_ops_write_and_a_refusal_says_the_same_words()
    {
        RunScript(Start("delete"), Expected()["failuresEdit"]!["results"]!.AsArray(), 30);
    }

    [Fact]
    public void An_id_made_from_a_name_is_the_one_the_browser_makes()
    {
        var ids = Expected()["ids"]!.AsArray();
        Assert.True(ids.Count > 20);
        foreach (var r in ids)
        {
            var taken = r!["taken"]!.AsArray().Select(t => t!.GetValue<string>()).ToList();
            Assert.Equal(r["id"]!.GetValue<string>(), Navigation.NewId(r["name"]!.GetValue<string>(), taken, "component"));
        }
    }

    [Fact]
    public void The_types_a_view_may_hold_are_the_ones_the_nesting_allows()
    {
        var model = FolderLoader.Load(Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "edit", "flowy")).Model;
        foreach (var r in Expected()["types"]!.AsArray())
            Assert.Equal(r!["types"]!.AsArray().Select(t => t!.GetValue<string>()), Checks.TypesIn(model, r["view"]!.GetValue<string>()));
    }

    [Fact]
    public void An_edit_never_changes_the_document_it_started_from()
    {
        var doc = Start();
        var before = doc.ToFiles();
        EditOps.PutObject(doc, new ObjectInput("fresh", "actor", "Fresh"));
        EditOps.DeleteObject(doc, "db");
        EditOps.PlaceBoxes(doc, "root", [("customer", 1, 2)]);
        EditOps.SetLines(doc, "angled");
        Assert.Equal(before, doc.ToFiles());
    }

    [Fact]
    public void A_blank_groups_section_is_no_section_so_an_edit_writes_what_the_browser_writes()
    {
        foreach (var blank in new[] { "groups:\n", "groups: ~\n", "groups: null\n" })
        {
            var doc = EditDoc.Parse("objects: {}\n", null, [KeyValuePair.Create("f", $"name: F\nview: root\n{blank}steps:\n  - {{ from: a, text: x }}\n")]);
            var files = EditOps.UpdateFlow(doc, "f", name: "G").ToFiles();
            Assert.Equal("name: G\nview: root\nsteps:\n  - from: a\n    text: x\n", files["flows/f.yaml"]);
        }
    }
}
