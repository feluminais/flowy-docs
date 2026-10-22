using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class RepoModelsTests
{
    private static string Repo(TempDir temp)
    {
        foreach (var rel in new[] { "flowy", "services/billing/flowy", "services/dispatch/flowy", "node_modules/dep/flowy", ".hidden/flowy" })
            temp.Write(Path.Combine(rel, "model.yaml"), "objects: {}\n");
        Directory.CreateDirectory(Path.Combine(temp.Dir, "services", "empty", "flowy")); // no model.yaml
        return temp.Dir;
    }

    [Fact]
    public void Every_flowy_folder_with_a_model_yaml_is_found_nearest_the_top_first()
    {
        using var temp = new TempDir();
        var found = RepoModels.Find(Repo(temp));
        Assert.Equal(["flowy", "services/billing/flowy", "services/dispatch/flowy"], found.Select(m => m.Id));
        Assert.Equal([Path.GetFileName(temp.Dir), "billing", "dispatch"], found.Select(m => m.Name));
    }

    [Fact]
    public void A_repo_without_models_has_none()
    {
        using var temp = new TempDir();
        Assert.Empty(RepoModels.Find(temp.Dir));
    }

    [Fact]
    public void The_repo_of_a_model_is_the_nearest_folder_above_it_with_a_git_folder()
    {
        using var temp = new TempDir();
        Repo(temp);
        Directory.CreateDirectory(Path.Combine(temp.Dir, ".git"));
        var billing = Path.Combine(temp.Dir, "services", "billing", "flowy");
        Assert.Equal(temp.Dir, RepoModels.RootOf(billing));
        Assert.Equal(3, RepoModels.InRepoOf(billing).Count);
    }

    [Fact]
    public void Without_a_git_folder_the_repo_is_the_folder_the_model_sits_in()
    {
        using var temp = new TempDir();
        Repo(temp);
        Assert.Equal(temp.Dir, RepoModels.RootOf(Path.Combine(temp.Dir, "flowy")));
    }
}
