using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class FolderLoaderTests
{
    [Fact]
    public void A_missing_folder_is_an_empty_model()
    {
        using var temp = new TempDir();
        var folder = FolderLoader.Load(Path.Combine(temp.Dir, "flowy"));
        Assert.Equal(0, folder.Model.Objects.Count);
        Assert.Empty(folder.Problems);
    }

    [Fact]
    public void A_file_an_editor_has_open_for_writing_can_still_be_read()
    {
        using var temp = new TempDir();
        var path = temp.Write("flowy/model.yaml", "objects:\n  a: { type: actor, name: A }\n");
        using var editor = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.Read);
        Assert.Equal(["a"], FolderLoader.Load(Path.Combine(temp.Dir, "flowy")).Model.Objects.Keys);
    }

    [Fact]
    public void A_model_yaml_that_is_a_folder_is_a_parse_error_not_a_crash()
    {
        using var temp = new TempDir();
        Directory.CreateDirectory(Path.Combine(temp.Dir, "flowy", "model.yaml"));
        var e = Assert.Throws<ParseError>(() => FolderLoader.Load(Path.Combine(temp.Dir, "flowy")));
        Assert.Equal("model.yaml", e.File);
    }

    [Fact]
    public void The_model_the_layout_and_every_flow_are_read()
    {
        using var temp = new TempDir();
        temp.Write("flowy/model.yaml", "objects:\n  a: { type: actor, name: A }\n  s: { type: system, name: S }\nconnections:\n  - { from: a, to: s, label: uses }\n");
        temp.Write("flowy/layout.yaml", "root:\n  a: [5, 6]\n");
        temp.Write("flowy/flows/b.yaml", "name: B\nview: root\nsteps:\n  - { from: a, to: s, text: Uses it }\n");
        temp.Write("flowy/flows/a.yaml", "name: A\nview: root\nsteps:\n  - { from: a, text: Waits }\n");
        var folder = FolderLoader.Load(Path.Combine(temp.Dir, "flowy"));
        Assert.Equal(["a", "s"], folder.Model.Objects.Keys);
        Assert.Equal(new LayoutPoint(5, 6), folder.Model.Layout["root"]["a"]);
        Assert.Equal(["a", "b"], folder.Model.Flows.Keys); // by file name
        Assert.Empty(folder.Problems);
    }

    [Fact]
    public void A_yml_flow_file_is_ignored_and_reported()
    {
        using var temp = new TempDir();
        temp.Write("flowy/model.yaml", "objects:\n  a: { type: actor, name: A }\n");
        temp.Write("flowy/flows/old.yml", "name: Old\n");
        var folder = FolderLoader.Load(Path.Combine(temp.Dir, "flowy"));
        Assert.Equal(0, folder.Model.Flows.Count);
        var problem = Assert.Single(folder.Problems);
        Assert.Equal(new Problem("flows/old.yml", null, "Flowy reads flow files that end in .yaml, so this one is ignored. Rename it to flows/old.yaml."), problem);
    }

    [Fact]
    public void Code_paths_are_looked_for_beside_the_folder()
    {
        using var temp = new TempDir();
        temp.Write("src/real.ts", "");
        temp.Write("docs/readme.md", "");
        temp.Write("flowy/model.yaml", "objects:\n  a: { type: system, name: A, code: [src/real.ts, src/gone.ts, docs/, nope/] }\n");
        var folder = FolderLoader.Load(Path.Combine(temp.Dir, "flowy") + Path.DirectorySeparatorChar);
        Assert.Equal(["a: code path \"src/gone.ts\" doesn't exist", "a: code path \"nope/\" doesn't exist"], folder.Problems.Select(p => p.Message));
    }

    [Fact]
    public void A_file_that_cannot_be_parsed_stops_the_load()
    {
        using var temp = new TempDir();
        temp.Write("flowy/model.yaml", "objects:\n  a: { type: actor, name: A }\n");
        temp.Write("flowy/flows/f.yaml", "steps: nope\n");
        var e = Assert.Throws<ParseError>(() => FolderLoader.Load(Path.Combine(temp.Dir, "flowy")));
        Assert.Equal("flows/f.yaml", e.File);
    }

    [Fact]
    public void A_file_that_is_not_UTF8_stops_the_load()
    {
        using var temp = new TempDir();
        var path = temp.Write("flowy/model.yaml", "");
        File.WriteAllBytes(path, [0x6F, 0x62, 0xFF, 0xFE]);
        var e = Assert.Throws<ParseError>(() => FolderLoader.Load(Path.Combine(temp.Dir, "flowy")));
        Assert.Equal("model.yaml", e.File);
        Assert.Equal("is not UTF-8 text. Save it as UTF-8 and try again.", e.Reason);
    }

    [Fact]
    public void A_file_over_the_size_limit_stops_the_load_in_the_words_core_uses()
    {
        using var temp = new TempDir();
        temp.Write("flowy/model.yaml", "about: " + new string('x', 5 * 1024 * 1024) + "\n");
        var e = Assert.Throws<ParseError>(() => FolderLoader.Load(Path.Combine(temp.Dir, "flowy")));
        Assert.Equal("model.yaml", e.File);
        Assert.Equal("is 5.1 MB, more than the 5 MB Flowy reads", e.Reason);
    }

    [Fact]
    public void A_file_with_a_byte_order_mark_loads()
    {
        using var temp = new TempDir();
        var path = temp.Write("flowy/model.yaml", "");
        File.WriteAllBytes(path, [0xEF, 0xBB, 0xBF, .. "objects:\n  a: { type: actor, name: A }\n"u8.ToArray()]);
        Assert.Equal(["a"], FolderLoader.Load(Path.Combine(temp.Dir, "flowy")).Model.Objects.Keys);
    }

    [Fact]
    public void RepoRoot_is_the_folder_that_holds_the_model_folder()
    {
        var dir = Path.Combine(Path.GetTempPath(), "shop", "flowy");
        Assert.Equal(Path.Combine(Path.GetTempPath(), "shop").TrimEnd(Path.DirectorySeparatorChar), FolderLoader.RepoRoot(dir));
        Assert.Equal(FolderLoader.RepoRoot(dir), FolderLoader.RepoRoot(dir + Path.DirectorySeparatorChar));
    }

    [Fact]
    public void A_summary_counts_what_is_there_and_lists_the_problems()
    {
        using var temp = new TempDir();
        temp.Write("flowy/model.yaml", "objects:\n  a: { type: actor, name: A }\n  b: { type: app, name: B }\n");
        var text = Summary.Describe(FolderLoader.Load(Path.Combine(temp.Dir, "flowy")));
        Assert.Equal("2 shapes, 0 connections, 0 flows, 1 problem\n  model.yaml: b: app must be inside system", text);
    }

    [Fact]
    public void A_missing_link_path_is_a_problem_and_a_web_address_is_not_looked_up()
    {
        using var temp = new TempDir();
        temp.Write("docs/runbook.md", "");
        temp.Write("flowy/model.yaml", "objects:\n  api:\n    type: system\n    name: API\n    links:\n      - { title: Runbook, url: docs/runbook.md }\n      - { title: Gone, url: docs/gone.md }\n      - { title: Status, url: \"https://status.example.com\" }\n");
        var folder = FolderLoader.Load(Path.Combine(temp.Dir, "flowy"));
        Assert.Equal(["api: link path \"docs/gone.md\" doesn't exist"], folder.Problems.Select(p => p.Message));
    }

    private const string Flow = "name: F\nview: root\nsteps:\n  - { from: a, text: Waits }\n";

    [Fact]
    public void A_flow_in_a_folder_is_read_by_its_file_name_alone_and_the_folder_is_kept_apart()
    {
        using var temp = new TempDir();
        temp.Write("flowy/model.yaml", "objects:\n  a: { type: actor, name: A }\n");
        temp.Write("flowy/flows/billing/refunds/refund.yaml", Flow);
        temp.Write("flowy/flows/billing/pay.yaml", "name: Pay\nview: root\ntags: [happy path, Error path]\nsteps:\n  - { from: a, text: Waits }\n");
        temp.Write("flowy/flows/top.yaml", Flow);
        var folder = FolderLoader.Load(Path.Combine(temp.Dir, "flowy"));
        Assert.Equal(["pay", "refund", "top"], folder.Model.Flows.Keys); // by file name, wherever the files are
        Assert.Equal("billing/refunds", folder.Model.FolderOf("refund"));
        Assert.Equal("", folder.Model.FolderOf("top"));
        Assert.Equal(["billing", "billing/refunds"], folder.Model.FolderPaths());
        Assert.Equal(["happy path", "Error path"], folder.Model.Flows["pay"].Tags);
        Assert.Empty(folder.Problems);
    }

    [Fact]
    public void Of_two_files_with_one_name_the_first_folder_in_path_order_is_read_and_the_other_is_a_problem()
    {
        using var temp = new TempDir();
        temp.Write("flowy/model.yaml", "objects:\n  a: { type: actor, name: A }\n");
        temp.Write("flowy/flows/zeta/pay.yaml", Flow);
        temp.Write("flowy/flows/alpha/pay.yaml", Flow);
        var folder = FolderLoader.Load(Path.Combine(temp.Dir, "flowy"));
        Assert.Equal("alpha", folder.Model.FolderOf("pay"));
        var problem = Assert.Single(folder.Problems);
        Assert.Equal(new Problem("flows/zeta/pay.yaml", null, "Flowy reads one flow for each name, and flows/alpha/pay.yaml already has \"pay\", so this one is ignored. Rename it."), problem);
    }

    [Fact]
    public void A_folder_that_starts_with_a_dot_is_left_alone_and_one_with_a_name_that_cannot_be_used_is_skipped_and_reported()
    {
        using var temp = new TempDir();
        temp.Write("flowy/model.yaml", "objects:\n  a: { type: actor, name: A }\n");
        temp.Write("flowy/flows/.drafts/hidden.yaml", Flow);
        temp.Write("flowy/flows/a#b/zed.yaml", Flow);
        temp.Write("flowy/flows/ok/fine.yaml", Flow);
        var folder = FolderLoader.Load(Path.Combine(temp.Dir, "flowy"));
        Assert.Equal(["fine"], folder.Model.Flows.Keys);
        var problem = Assert.Single(folder.Problems);
        Assert.Equal(new Problem("flows/a#b", null, $"Flowy skips this folder, since its name can't be used: {Names.FolderRule}."), problem);
    }

    [Fact]
    public void Tags_that_are_not_a_list_of_words_are_a_parse_error_at_the_flows_real_path()
    {
        using var temp = new TempDir();
        temp.Write("flowy/model.yaml", "objects:\n  a: { type: actor, name: A }\n");
        temp.Write("flowy/flows/billing/oops.yaml", "name: F\nview: root\ntags: happy\nsteps: []\n");
        var e = Assert.Throws<ParseError>(() => FolderLoader.Load(Path.Combine(temp.Dir, "flowy")));
        Assert.Equal("flows/billing/oops.yaml", e.File);
        Assert.Equal("\"tags\" must be a list of words", e.Reason);
    }
}
