using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class DraftsTests
{
    private const string Plain = "objects: {}\nconnections: []\n";

    /// <summary>A repo with a model in flowy/ and a draft called "group-orders" in it. Returns the model folder.</summary>
    private static string Setup(TempDir temp)
    {
        temp.Write("flowy/model.yaml", "name: Plum\nobjects: {}\nconnections: []\n");
        temp.Write("flowy/drafts/group-orders/model.yaml", "name: Group orders\nobjects: {}\nconnections: []\n");
        return Path.Combine(temp.Dir, "flowy");
    }

    [Fact]
    public void The_drafts_of_a_model_are_listed_by_id_with_the_name_each_gives_itself()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        temp.Write("flowy/drafts/b-draft/model.yaml", "name: Zebra\n");
        temp.Write("flowy/drafts/a-draft/model.yaml", Plain);
        Assert.Equal([new DraftInfo("a-draft", "a-draft"), new DraftInfo("b-draft", "Zebra"), new DraftInfo("group-orders", "Group orders")], Drafts.List(model));
    }

    [Fact]
    public void Only_folders_with_a_model_yaml_and_an_id_for_a_name_are_drafts()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        temp.Write("flowy/drafts/Not_An_Id/model.yaml", Plain);
        temp.Write("flowy/drafts/no-model/flows/x.yaml", "name: X\n");
        temp.Write("flowy/drafts/notes.md", "x");
        Assert.Equal(["group-orders"], Drafts.List(model).Select(d => d.Id));
    }

    [Fact]
    public void A_model_with_no_drafts_folder_has_no_drafts()
    {
        using var temp = new TempDir();
        temp.Write("flowy/model.yaml", Plain);
        Assert.Empty(Drafts.List(Path.Combine(temp.Dir, "flowy")));
    }

    [Fact]
    public void A_draft_whose_model_yaml_cannot_be_read_is_named_by_its_id()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        temp.Write("flowy/drafts/broken/model.yaml", "name: [unclosed\n");
        Assert.Contains(new DraftInfo("broken", "broken"), Drafts.List(model));
    }

    [Fact]
    public void The_model_of_a_draft_is_the_folder_two_levels_up_when_it_holds_a_model_yaml()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        var draft = Path.Combine(model, "drafts", "group-orders");
        Assert.Equal(Path.GetFullPath(model), Drafts.ModelOf(draft));
        Assert.Equal(Path.GetFullPath(model), Drafts.ModelOf(draft + Path.DirectorySeparatorChar));
        Assert.Null(Drafts.ModelOf(model));
    }

    [Fact]
    public void A_folder_in_drafts_is_no_draft_without_an_id_for_a_name_or_a_model_beside_it()
    {
        using var temp = new TempDir();
        temp.Write("elsewhere/drafts/ok/model.yaml", Plain); // no model.yaml in elsewhere/
        temp.Write("flowy/model.yaml", Plain);
        temp.Write("flowy/drafts/Bad_Id/model.yaml", Plain);
        Assert.Null(Drafts.ModelOf(Path.Combine(temp.Dir, "elsewhere", "drafts", "ok")));
        Assert.Null(Drafts.ModelOf(Path.Combine(temp.Dir, "flowy", "drafts", "Bad_Id")));
    }

    [Fact]
    public void The_repo_of_a_draft_is_the_folder_that_holds_its_model_folder()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        var draft = Path.Combine(model, "drafts", "group-orders");
        Assert.Equal(Path.GetFullPath(temp.Dir), Drafts.RepoOf(draft));
        Assert.Equal(Path.GetFullPath(temp.Dir), Drafts.RepoOf(model));
        Assert.Equal(Path.GetFullPath(temp.Dir), FolderLoader.RepoRoot(draft));
    }

    [Fact]
    public void A_drafts_code_paths_start_from_the_repo_like_the_models()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        temp.Write("src/orders.ts", "export {}\n");
        var objects = "objects:\n  orders:\n    type: system\n    name: Orders\n    code:\n      - src/orders.ts\n      - src/gone.ts\nconnections: []\n";
        temp.Write("flowy/model.yaml", objects);
        temp.Write("flowy/drafts/group-orders/model.yaml", objects);
        var draft = Path.Combine(model, "drafts", "group-orders");
        Assert.Equal(["src/gone.ts"], FolderLoader.MissingPaths(draft, FolderLoader.Load(draft).Model));
        Assert.Equal(["src/gone.ts"], FolderLoader.MissingPaths(model, FolderLoader.Load(model).Model));
    }

    [Fact]
    public void The_model_never_reads_its_drafts()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        temp.Write("flowy/drafts/group-orders/flows/split.yaml", "name: Split\nsteps: []\n");
        var folder = FolderLoader.Load(model);
        Assert.Empty(folder.Model.Flows);
        Assert.Empty(folder.Model.Objects);
    }

    [Fact]
    public void A_draft_is_not_a_model_of_the_repo_for_the_picker()
    {
        using var temp = new TempDir();
        Setup(temp);
        Assert.Equal(["flowy"], RepoModels.Find(temp.Dir).Select(m => m.Id));
    }

    [Fact]
    public void A_draft_can_be_opened_by_its_folder()
    {
        using var temp = new TempDir();
        var draft = Path.Combine(Setup(temp), "drafts", "group-orders");
        Assert.Equal(draft, ModelFolders.Resolve(draft));
    }

    [Fact]
    public void A_drafts_window_is_called_by_its_folder_and_its_model()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        var title = ModelFolders.Title(Path.Combine(model, "drafts", "group-orders"));
        Assert.Equal($"group-orders (draft of {Path.GetFileName(temp.Dir)})", title);
    }

    [Theory]
    [InlineData("drafts", false)]
    [InlineData("drafts/group-orders", true)]
    [InlineData("drafts/group-orders/model.yaml", true)]
    [InlineData("drafts\\group-orders\\model.yaml", true)]
    [InlineData("drafts/group-orders/layout.yaml", false)]
    [InlineData("drafts/group-orders/flows/a.yaml", false)]
    [InlineData("drafts/group-orders/flows", false)]
    public void A_change_in_drafts_counts_only_when_it_adds_or_takes_away_a_draft(string rel, bool expected) =>
        Assert.Equal(expected, FolderLayout.IsPartOfModel(rel));

    [Fact]
    public void A_new_draft_is_a_model_yaml_with_its_name_and_nothing_in_it()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        var dir = Drafts.Create(model, "Split the bill");
        Assert.Equal(Drafts.DirOf(model, "split-the-bill"), dir);
        Assert.Equal("name: Split the bill\nobjects: {}\nconnections: []\n", File.ReadAllText(Path.Combine(dir, "model.yaml")).Replace("\r\n", "\n"));
        var folder = FolderLoader.Load(dir);
        Assert.Equal("Split the bill", folder.Model.ProjectName);
        Assert.Empty(folder.Model.Objects);
    }

    [Fact]
    public void A_name_that_needs_quoting_is_written_so_it_reads_back()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        var dir = Drafts.Create(model, "Plan B: #2 'maybe'");
        Assert.Equal("Plan B: #2 'maybe'", FolderLoader.Load(dir).Model.ProjectName);
    }

    [Theory]
    [InlineData("LAN transfer", "lan-transfer")]
    [InlineData("Ünïcode Café", "unicode-cafe")]
    [InlineData("!!!", "draft")]
    [InlineData("  --Spaced  out--  ", "spaced-out")]
    public void The_id_comes_from_the_name_as_the_browser_makes_it(string name, string id)
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        Assert.Equal(Drafts.DirOf(model, id), Drafts.Create(model, name));
    }

    [Fact]
    public void A_name_that_is_taken_gets_a_number()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        Assert.Equal(Drafts.DirOf(model, "group-orders-2"), Drafts.Create(model, "Group orders"));
        Assert.Equal(Drafts.DirOf(model, "group-orders-3"), Drafts.Create(model, "GROUP ORDERS"));
        Assert.Equal(["group-orders", "group-orders-2", "group-orders-3"], Drafts.List(model).Select(d => d.Id));
    }

    [Fact]
    public void A_name_of_only_spaces_is_refused_and_leaves_nothing_behind()
    {
        using var temp = new TempDir();
        var model = Setup(temp);
        var error = Assert.Throws<OpError>(() => Drafts.Create(model, "   "));
        Assert.Equal("Give the draft a name.", error.Message);
        Assert.Equal(["group-orders"], Directory.EnumerateDirectories(Path.Combine(model, "drafts")).Select(Path.GetFileName));
    }

    [Fact]
    public void A_model_without_a_drafts_folder_gets_one_with_the_first_draft()
    {
        using var temp = new TempDir();
        temp.Write("flowy/model.yaml", Plain);
        var model = Path.Combine(temp.Dir, "flowy");
        Assert.Equal(Drafts.DirOf(model, "draft"), Drafts.Create(model, "!!!"));
        Assert.Equal(["draft"], Drafts.List(model).Select(d => d.Id));
    }

    [Fact]
    public void The_plum_demo_has_its_draft()
    {
        var plum = Path.Combine(Repo.Root, "docs", "demo", "flowy");
        Assert.Contains(new DraftInfo("group-orders", "Group orders"), Drafts.List(plum));
    }
}
