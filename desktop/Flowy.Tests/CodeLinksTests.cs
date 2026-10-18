using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

// Ported from test/git.test.ts.
public class CodeLinksTests
{
    [Theory]
    [InlineData("https://github.com/acme/shop.git")]
    [InlineData("git@github.com:acme/shop.git")]
    [InlineData("ssh://git@github.com/acme/shop")]
    [InlineData("https://token@github.com/acme/shop/")]
    public void A_GitHub_origin_gives_a_link_base_for_the_branch_and_folder(string remote) =>
        Assert.Equal("https://github.com/acme/shop/tree/main/", CodeLinks.BaseFrom(remote, "main", ""));

    [Fact]
    public void GitLab_and_awkward_branch_and_folder_names_are_encoded()
    {
        Assert.Equal("https://gitlab.com/group/sub/shop/-/tree/dev/docs/", CodeLinks.BaseFrom("git@gitlab.com:group/sub/shop.git", "dev", "docs/"));
        Assert.Equal("https://github.com/acme/shop/tree/feat/a%20b/", CodeLinks.BaseFrom("https://github.com/acme/shop", "feat/a b", ""));
        Assert.Equal("https://github.com/acme/shop/tree/fix%2312/C%23/", CodeLinks.BaseFrom("https://github.com/acme/shop", "fix#12", "C#/"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("https://example.com/acme/shop.git")]
    [InlineData("file:///repos/shop")]
    [InlineData("https://github.com.evil.io/acme/shop")]
    public void Other_hosts_give_no_link_base(string remote) => Assert.Null(CodeLinks.BaseFrom(remote, "main", ""));

    [Fact]
    public void Paths_are_encoded_like_encodeURIComponent_part_by_part()
    {
        Assert.Equal("a%20b/c%23d/(e)!*'", CodeLinks.EncodePath("a b/c#d/(e)!*'"));
        Assert.Equal("%C3%A9/%3F", CodeLinks.EncodePath("é/?"));
    }

    [Fact]
    public async Task A_folder_that_is_not_a_repo_gives_no_link_base()
    {
        using var temp = new TempDir();
        Assert.Null(await CodeLinks.BaseFor(temp.Dir));
    }
}
