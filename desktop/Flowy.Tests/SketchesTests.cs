using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class SketchesTests
{
    private const string Plain = "objects: {}\nconnections: []\n";

    /// <summary>A repo with a model in flowy/ and a sketch called "group-orders" in it. Returns the model folder.</summary>
    private static string Setup(TempDir temp)
    {
        temp.Write("flowy/model.yaml", "name: Plum\nobjects: {}\nconnections: []\n");
        temp.Write("flowy/sketches/group-orders/model.yaml", "name: Group orders\nobjects: {}\nconnections: []\n");
        return Path.Combine(temp.Dir, "flowy");
    }

    [Fact]
    public void The_sketches_of_a_model_are_listed_by_id_with_the_name_each_gives_itself()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        temp.Write("flowy/sketches/b-sketch/model.yaml", "name: Zebra\n");
        temp.Write("flowy/sketches/a-sketch/model.yaml", Plain);
        Assert.Equal([new SketchInfo("a-sketch", "a-sketch"), new SketchInfo("b-sketch", "Zebra"), new SketchInfo("group-orders", "Group orders")], Sketches.List(model));
    }

    [Fact]
    public void Only_folders_with_a_model_yaml_and_an_id_for_a_name_are_sketches()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        temp.Write("flowy/sketches/Not_An_Id/model.yaml", Plain);
        temp.Write("flowy/sketches/no-model/flows/x.yaml", "name: X\n");
        temp.Write("flowy/sketches/notes.md", "x");
        Assert.Equal(["group-orders"], Sketches.List(model).Select(s => s.Id));
    }

    [Fact]
    public void A_model_with_no_sketches_folder_has_no_sketches()
    {
        using var temp = new TempDir();
        temp.Write("flowy/model.yaml", Plain);
        Assert.Empty(Sketches.List(Path.Combine(temp.Dir, "flowy")));
    }

    [Fact]
    public void A_sketch_whose_model_yaml_cannot_be_read_is_named_by_its_id()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        temp.Write("flowy/sketches/broken/model.yaml", "name: [unclosed\n");
        Assert.Contains(new SketchInfo("broken", "broken"), Sketches.List(model));
    }

    [Fact]
    public void The_model_of_a_sketch_is_the_folder_two_levels_up_when_it_holds_a_model_yaml()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        var sketch = Path.Combine(model, "sketches", "group-orders");
        Assert.Equal(Path.GetFullPath(model), Sketches.ModelOf(sketch));
        Assert.Equal(Path.GetFullPath(model), Sketches.ModelOf(sketch + Path.DirectorySeparatorChar));
        Assert.Null(Sketches.ModelOf(model));
    }

    [Fact]
    public void A_folder_in_sketches_is_no_sketch_without_an_id_for_a_name_or_a_model_beside_it()
    {
        using var temp = new TempDir();
        temp.Write("elsewhere/sketches/ok/model.yaml", Plain); // no model.yaml in elsewhere/
        temp.Write("flowy/model.yaml", Plain);
        temp.Write("flowy/sketches/Bad_Id/model.yaml", Plain);
        Assert.Null(Sketches.ModelOf(Path.Combine(temp.Dir, "elsewhere", "sketches", "ok")));
        Assert.Null(Sketches.ModelOf(Path.Combine(temp.Dir, "flowy", "sketches", "Bad_Id")));
    }

    [Fact]
    public void The_repo_of_a_sketch_is_the_folder_that_holds_its_model_folder()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        var sketch = Path.Combine(model, "sketches", "group-orders");
        Assert.Equal(Path.GetFullPath(temp.Dir), Sketches.RepoOf(sketch));
        Assert.Equal(Path.GetFullPath(temp.Dir), Sketches.RepoOf(model));
        Assert.Equal(Path.GetFullPath(temp.Dir), FolderLoader.RepoRoot(sketch));
    }

    [Fact]
    public void A_sketchs_code_paths_start_from_the_repo_like_the_models()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        temp.Write("src/orders.ts", "export {}\n");
        var objects = "objects:\n  orders:\n    type: system\n    name: Orders\n    code:\n      - src/orders.ts\n      - src/gone.ts\nconnections: []\n";
        temp.Write("flowy/model.yaml", objects);
        temp.Write("flowy/sketches/group-orders/model.yaml", objects);
        var sketch = Path.Combine(model, "sketches", "group-orders");
        Assert.Equal(["src/gone.ts"], FolderLoader.MissingPaths(sketch, FolderLoader.Load(sketch).Model));
        Assert.Equal(["src/gone.ts"], FolderLoader.MissingPaths(model, FolderLoader.Load(model).Model));
    }

    [Fact]
    public void The_model_never_reads_its_sketches()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        temp.Write("flowy/sketches/group-orders/flows/split.yaml", "name: Split\nsteps: []\n");
        var folder = FolderLoader.Load(model);
        Assert.Empty(folder.Model.Flows);
        Assert.Empty(folder.Model.Objects);
    }

    [Fact]
    public void A_sketch_is_not_a_model_of_the_repo_for_the_picker()
    {
        using var temp = new TempDir();
        Setup(temp);
        Assert.Equal(["flowy"], RepoModels.Find(temp.Dir).Select(m => m.Id));
    }

    [Fact]
    public void A_sketch_can_be_opened_by_its_folder()
    {
        using var temp = new TempDir();
        var sketch = Path.Combine(Setup(temp), "sketches", "group-orders");
        Assert.Equal(sketch, ModelFolders.Resolve(sketch));
    }

    [Fact]
    public void A_sketchs_window_is_called_by_its_folder_and_its_model()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        var title = ModelFolders.Title(Path.Combine(model, "sketches", "group-orders"));
        Assert.Equal($"group-orders (sketch of {Path.GetFileName(temp.Dir)})", title);
    }

    [Theory]
    [InlineData("sketches", false)]
    [InlineData("sketches/group-orders", true)]
    [InlineData("sketches/group-orders/model.yaml", true)]
    [InlineData("sketches\\group-orders\\model.yaml", true)]
    [InlineData("sketches/group-orders/layout.yaml", false)]
    [InlineData("sketches/group-orders/flows/a.yaml", false)]
    [InlineData("sketches/group-orders/flows", false)]
    [InlineData("drafts", false)] // the old name of the folder counts the same
    [InlineData("drafts/group-orders", true)]
    [InlineData("drafts/group-orders/model.yaml", true)]
    [InlineData("drafts/group-orders/flows/a.yaml", false)]
    public void A_change_in_sketches_counts_only_when_it_adds_or_takes_away_a_sketch(string rel, bool expected) =>
        Assert.Equal(expected, FolderLayout.IsPartOfModel(rel));

    [Fact]
    public void A_new_sketch_is_a_model_yaml_with_its_name_separate_lines_and_nothing_in_it()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        var dir = Sketches.Create(model, "Split the bill");
        Assert.Equal(Sketches.DirOf(model, "split-the-bill"), dir);
        Assert.Equal("name: Split the bill\npairs: separate\nobjects: {}\nconnections: []\n", File.ReadAllText(Path.Combine(dir, "model.yaml")).Replace("\r\n", "\n"));
        var folder = FolderLoader.Load(dir);
        Assert.Equal("Split the bill", folder.Model.ProjectName);
        Assert.Empty(folder.Model.Objects);
    }

    /// <summary>The file the browser and MCP write for a new empty sketch (newSketch in src/core/sketches.ts) is the one the desktop writes, so a sketch starts the same wherever it is made.</summary>
    [Fact]
    public void A_new_sketch_starts_as_the_same_file_the_typescript_core_makes()
    {
        var expected = JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "sketches.json")))!.AsArray();
        Assert.NotEmpty(expected);
        foreach (var entry in expected)
        {
            using var temp = new TempDir();
            var model = Setup(temp);
            var dir = Sketches.Create(model, entry!["name"]!.GetValue<string>());
            Assert.Equal(entry["file"]!.GetValue<string>(), File.ReadAllText(Path.Combine(dir, "model.yaml")).Replace("\r\n", "\n"));
        }
    }

    [Fact]
    public void A_name_that_needs_quoting_is_written_so_it_reads_back()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        var dir = Sketches.Create(model, "Plan B: #2 'maybe'");
        Assert.Equal("Plan B: #2 'maybe'", FolderLoader.Load(dir).Model.ProjectName);
    }

    [Theory]
    [InlineData("LAN transfer", "lan-transfer")]
    [InlineData("Ünïcode Café", "unicode-cafe")]
    [InlineData("!!!", "sketch")]
    [InlineData("  --Spaced  out--  ", "spaced-out")]
    public void The_id_comes_from_the_name_as_the_browser_makes_it(string name, string id)
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        Assert.Equal(Sketches.DirOf(model, id), Sketches.Create(model, name));
    }

    [Fact]
    public void A_name_that_is_taken_gets_a_number()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        Assert.Equal(Sketches.DirOf(model, "group-orders-2"), Sketches.Create(model, "Group orders"));
        Assert.Equal(Sketches.DirOf(model, "group-orders-3"), Sketches.Create(model, "GROUP ORDERS"));
        Assert.Equal(["group-orders", "group-orders-2", "group-orders-3"], Sketches.List(model).Select(s => s.Id));
    }

    [Fact]
    public void A_name_of_only_spaces_is_refused_and_leaves_nothing_behind()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        var error = Assert.Throws<OpError>(() => Sketches.Create(model, "   "));
        Assert.Equal("Give the sketch a name.", error.Message);
        Assert.Equal(["group-orders"], Directory.EnumerateDirectories(Path.Combine(model, "sketches")).Select(Path.GetFileName));
    }

    [Fact]
    public void A_model_without_a_sketches_folder_gets_one_with_the_first_sketch()
    {
        using var temp = new TempDir();
        temp.Write("flowy/model.yaml", Plain);
        var model = Path.Combine(temp.Dir, "flowy");
        Assert.Equal(Sketches.DirOf(model, "sketch"), Sketches.Create(model, "!!!"));
        Assert.Equal(["sketch"], Sketches.List(model).Select(s => s.Id));
    }

    [Fact]
    public void The_plum_demo_has_its_sketch()
    {
        var plum = Path.Combine(Repo.Root, "docs", "demo", "flowy");
        Assert.Contains(new SketchInfo("group-orders", "Group orders"), Sketches.List(plum));
    }

    /// <summary>A repo with a model in flowy/ and a sketch made before the rename, in drafts/. Returns the model folder.</summary>
    private static string SetupLegacy(TempDir temp)
    {
        temp.Write("flowy/model.yaml", "name: Plum\nobjects: {}\nconnections: []\n");
        temp.Write("flowy/drafts/old-idea/model.yaml", "name: Old idea\nobjects: {}\nconnections: []\n");
        return Path.Combine(temp.Dir, "flowy");
    }

    [Fact]
    public void A_sketch_kept_in_the_old_drafts_folder_is_listed_found_and_opened_like_any_other()
    {
        using var temp = new TempDir();
        var model = SetupLegacy(temp);
        var old = Path.Combine(model, "drafts", "old-idea");
        Assert.Equal([new SketchInfo("old-idea", "Old idea")], Sketches.List(model));
        Assert.True(Sketches.Has(model, "old-idea"));
        Assert.Equal(old, Sketches.DirOf(model, "old-idea"));
        Assert.Equal(Path.GetFullPath(model), Sketches.ModelOf(old));
        Assert.Equal(Path.GetFullPath(temp.Dir), Sketches.RepoOf(old));
        Assert.Equal($"old-idea (sketch of {Path.GetFileName(temp.Dir)})", ModelFolders.Title(old));
        Assert.Equal("Old idea", FolderLoader.Load(old).Model.ProjectName);
    }

    [Fact]
    public void Sketches_of_both_folders_are_listed_together_and_one_in_sketches_wins_over_the_same_id_in_drafts()
    {
        using var temp = new TempDir();
        var model = SetupLegacy(temp);
        temp.Write("flowy/sketches/new-idea/model.yaml", "name: New idea\n");
        temp.Write("flowy/sketches/old-idea/model.yaml", "name: Old idea, moved\n");
        Assert.Equal([new SketchInfo("new-idea", "New idea"), new SketchInfo("old-idea", "Old idea, moved")], Sketches.List(model));
        Assert.Equal(Path.Combine(model, "sketches", "old-idea"), Sketches.DirOf(model, "old-idea"));
    }

    [Fact]
    public void A_new_sketch_goes_to_sketches_and_never_takes_an_id_that_a_sketch_in_drafts_has()
    {
        using var temp = new TempDir();
        var model = SetupLegacy(temp);
        var made = Sketches.Create(model, "Old idea");
        Assert.Equal(Path.Combine(model, "sketches", "old-idea-2"), made);
        Assert.False(Directory.Exists(Path.Combine(model, "drafts", "old-idea-2")));
        Assert.Equal(["old-idea", "old-idea-2"], Sketches.List(model).Select(s => s.Id));
    }

    [Fact]
    public void A_legacy_sketch_is_not_a_model_of_the_repo_for_the_picker()
    {
        using var temp = new TempDir();
        SetupLegacy(temp);
        Assert.Equal(["flowy"], RepoModels.Find(temp.Dir).Select(m => m.Id));
    }
}
