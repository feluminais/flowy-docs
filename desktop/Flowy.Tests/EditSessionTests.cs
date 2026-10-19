using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class EditSessionTests
{
    /// <summary>A copy of the crafted case (hand-written extras, flows, a layout) in a folder of its own, to edit.</summary>
    private static (TempDir Temp, string Dir) Copy()
    {
        var temp = new TempDir();
        var source = Path.Combine(Repo.Root, "desktop", "fixtures", "cases", "edit", "flowy");
        foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
            temp.Write(Path.Combine("flowy", Path.GetRelativePath(source, file)), File.ReadAllText(file));
        return (temp, Path.Combine(temp.Dir, "flowy"));
    }

    private static string Read(string dir, string rel) => File.ReadAllText(Path.Combine(dir, rel));

    private static int TempFiles(string dir) => Directory.GetFiles(dir, "*.tmp", SearchOption.AllDirectories).Length;

    private static ObjectInput Fresh => new("fresh", "actor", "Fresh");

    [Fact]
    public void A_version_is_the_first_sixteen_hex_digits_of_the_sha256_as_the_typescript_makes_it()
    {
        Assert.Equal("ba7816bf8f01cfea", FileStore.Hash("abc"));
    }

    [Fact]
    public void The_first_edit_of_an_empty_folder_creates_model_yaml_and_nothing_else()
    {
        using var temp = new TempDir();
        var dir = Path.Combine(temp.Dir, "flowy");
        Directory.CreateDirectory(dir);
        var session = new EditSession(dir);
        Assert.Null(session.Apply(d => EditOps.PutObject(d, new ObjectInput("shop", "system", "Shop"))));
        Assert.Equal("objects:\n  shop:\n    type: system\n    name: Shop\nconnections: []\n", Read(dir, "model.yaml"));
        Assert.Equal(["model.yaml"], Directory.GetFiles(dir, "*", SearchOption.AllDirectories).Select(f => Path.GetRelativePath(dir, f)).ToArray());
        Assert.Equal(0, TempFiles(dir));
    }

    [Fact]
    public void Only_the_files_an_edit_changes_are_written_and_the_rest_keep_their_bytes_and_their_hand_written_style()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        var flowBefore = Read(dir, "flows/order.yaml");
        var layoutBefore = Read(dir, "layout.yaml");
        var session = new EditSession(dir);
        Assert.Null(session.Apply(d => EditOps.PutObject(d, new ObjectInput("api", Tech: "Fastify"))));
        Assert.Equal(flowBefore, Read(dir, "flows/order.yaml")); // its own style, comments and all
        Assert.Equal(layoutBefore, Read(dir, "layout.yaml"));
        var model = Read(dir, "model.yaml");
        Assert.Contains("tech: Fastify", model);
        Assert.Contains("owner: sales", model); // extra keys survive
        Assert.Contains("note: hand-written", model);
        Assert.DoesNotContain("# A model", model); // comments don't, as in the browser
        Assert.Equal(0, TempFiles(dir));
    }

    [Fact]
    public void An_edit_that_would_add_a_problem_is_refused_and_writes_nothing()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        var before = Read(dir, "model.yaml");
        var session = new EditSession(dir);
        var message = session.Apply(d => EditOps.PutObject(d, new ObjectInput("loose", "app", "Loose")));
        Assert.StartsWith("Refused, nothing saved. This would add:", message);
        Assert.Contains("app must be inside system", message);
        Assert.Equal(before, Read(dir, "model.yaml"));
        Assert.False(session.CanUndo);
    }

    [Fact]
    public void A_file_that_changed_since_it_was_read_is_never_overwritten()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        var session = new EditSession(dir);
        var message = session.Apply(d =>
        {
            File.AppendAllText(Path.Combine(dir, "model.yaml"), "\n# someone else was here\n"); // between the read and the write
            return EditOps.PutObject(d, Fresh);
        });
        Assert.Equal(EditSession.ChangedOutside, message);
        Assert.Contains("someone else was here", Read(dir, "model.yaml"));
        Assert.DoesNotContain("fresh", Read(dir, "model.yaml"));
        Assert.False(session.CanUndo);
    }

    [Fact]
    public void A_file_that_cannot_be_read_blocks_editing_and_says_where()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        File.WriteAllText(Path.Combine(dir, "flows", "browse.yaml"), "name: Broken\nview: root\nsteps: [\n");
        var broken = Read(dir, "model.yaml");
        var session = new EditSession(dir);
        var message = session.Apply(d => EditOps.PutObject(d, Fresh));
        Assert.StartsWith("Can't read flows/browse.yaml", message);
        Assert.EndsWith("Fix the file and the view updates.", message);
        Assert.Equal(broken, Read(dir, "model.yaml"));
    }

    [Fact]
    public void Undo_puts_back_what_the_edit_wrote_and_redo_does_it_again()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        var session = new EditSession(dir);
        Assert.Null(session.Apply(d => EditOps.PutObject(d, new ObjectInput("api", Tech: "Fastify"))));
        var edited = Read(dir, "model.yaml");
        Assert.Null(session.Apply(d => EditOps.PlaceBoxes(d, "root", [("customer", 5, 6)])));
        Assert.True(session.CanUndo);
        Assert.False(session.CanRedo);

        Assert.Null(session.Undo());
        Assert.DoesNotContain("customer: [5, 6]", Read(dir, "layout.yaml"));
        Assert.Equal(edited, Read(dir, "model.yaml"));
        Assert.True(session.CanRedo);
        Assert.Null(session.Undo());
        Assert.DoesNotContain("tech: Fastify", Read(dir, "model.yaml"));
        Assert.Equal("Nothing to undo.", session.Undo());

        Assert.Null(session.Redo());
        Assert.Equal(edited, Read(dir, "model.yaml"));
        Assert.Null(session.Redo());
        Assert.Contains("customer: [5, 6]", Read(dir, "layout.yaml"));
        Assert.Equal("Nothing to redo.", session.Redo());
        Assert.Equal(0, TempFiles(dir));
    }

    [Fact]
    public void A_new_edit_clears_what_could_have_been_redone()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        var session = new EditSession(dir);
        Assert.Null(session.Apply(d => EditOps.PutObject(d, Fresh)));
        Assert.Null(session.Undo());
        Assert.True(session.CanRedo);
        Assert.Null(session.Apply(d => EditOps.PutObject(d, new ObjectInput("other", "actor", "Other"))));
        Assert.False(session.CanRedo);
    }

    [Fact]
    public void Undo_does_nothing_where_the_file_changed_since()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        var session = new EditSession(dir);
        Assert.Null(session.Apply(d => EditOps.PutObject(d, Fresh)));
        File.AppendAllText(Path.Combine(dir, "model.yaml"), "# edited elsewhere\n");
        var changed = Read(dir, "model.yaml");
        Assert.StartsWith("Can't undo: this changed since", session.Undo());
        Assert.Equal(changed, Read(dir, "model.yaml"));
        Assert.True(session.CanUndo); // still there to try again
    }

    [Fact]
    public void Undoing_a_flow_that_was_created_deletes_its_file_and_redoing_brings_it_back()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        var session = new EditSession(dir);
        Assert.Null(session.Apply(d => EditOps.PutFlow(d, "pay", "Customer pays", "root", [EditOps.NewStep("customer", "pay", "Pays")])));
        var created = Read(dir, "flows/pay.yaml");
        Assert.Null(session.Undo());
        Assert.False(File.Exists(Path.Combine(dir, "flows", "pay.yaml")));
        Assert.Null(session.Redo());
        Assert.Equal(created, Read(dir, "flows/pay.yaml"));
    }

    [Fact]
    public void Undoing_the_delete_of_a_flow_writes_it_back()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        var session = new EditSession(dir);
        Assert.Null(session.Apply(d => EditOps.DeleteFlow(d, "browse")));
        Assert.False(File.Exists(Path.Combine(dir, "flows", "browse.yaml")));
        Assert.Null(session.Undo());
        Assert.Contains("name: Customer browses", Read(dir, "flows/browse.yaml"));
    }

    [Fact]
    public void An_edit_that_changes_nothing_writes_nothing_and_is_not_an_undo_step()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        var before = Read(dir, "model.yaml");
        var session = new EditSession(dir);
        Assert.Null(session.Apply(d => EditOps.PutObject(d, new ObjectInput("api", Name: "API")))); // same name
        Assert.Equal(before, Read(dir, "model.yaml")); // not even rewritten in the canonical style
        Assert.False(session.CanUndo);
    }

    [Fact]
    public void The_watcher_hears_saves_but_not_the_temporary_file_they_go_through()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        var session = new EditSession(dir);
        var saves = 0;
        session.Saved += () => saves++;
        using var watcher = new FolderWatcher(dir, TimeSpan.FromMilliseconds(30));
        var heard = 0;
        watcher.Changed += () => Interlocked.Increment(ref heard);
        Assert.Null(session.Apply(d => EditOps.PutObject(d, Fresh)));
        Thread.Sleep(600);
        Assert.Equal(1, saves);
        Assert.Equal(1, heard);
    }
}
