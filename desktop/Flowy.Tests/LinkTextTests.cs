using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class LinkTextTests
{
    private static FlowyObject Box(string linksYaml) =>
        ModelFiles.ParseModel("objects:\n  a:\n    type: actor\n    name: A\n    links:\n" + linksYaml).Objects["a"];

    private static string Flat(OrderedDictionary<string, object?> entry) => string.Join(",", entry.Select(kv => $"{kv.Key}={kv.Value}"));

    [Fact]
    public void A_box_s_links_are_a_line_each_with_the_title_first()
    {
        var box = Box("      - { title: Runbook, url: docs/runbook.md }\n      - { url: \"https://status.example.com\" }\n      - { title: Text, url: u, note: x }\n");
        Assert.Equal("Runbook | docs/runbook.md\nhttps://status.example.com\nText | u", LinkText.Format(box));
        Assert.Equal("", LinkText.Format(new FlowyObject("actor", "A", null, null, null, null, null)));
    }

    [Fact]
    public void The_last_bar_with_spaces_splits_title_from_address_and_blank_lines_are_skipped()
    {
        var parsed = LinkText.Parse("Runbook | docs/runbook.md\n\n  https://x.dev/a|b  \nPostmortems | wiki | https://wiki.example.com/pm\n", null);
        Assert.Equal(["title=Runbook,url=docs/runbook.md", "url=https://x.dev/a|b", "title=Postmortems | wiki,url=https://wiki.example.com/pm"], parsed.Select(Flat));
        Assert.Empty(LinkText.Parse("", null));
        Assert.Empty(LinkText.Parse(" \n\n ", null));
    }

    [Fact]
    public void A_link_keeps_the_extra_keys_it_had_found_by_its_address()
    {
        var existing = Box("      - { title: Old, url: docs/a.md, note: keep }\n").Links;
        var parsed = LinkText.Parse("New title | docs/a.md\ndocs/b.md", existing);
        Assert.Equal(["title=New title,url=docs/a.md,note=keep", "url=docs/b.md"], parsed.Select(Flat));
        Assert.Equal(["url=docs/a.md,note=keep"], LinkText.Parse("docs/a.md", existing).Select(Flat));
    }
}
