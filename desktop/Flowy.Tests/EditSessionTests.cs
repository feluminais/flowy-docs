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
        Assert.Equal(EditResult.Ok, session.Apply(d => EditOps.PutObject(d, new ObjectInput("shop", "system", "Shop"))));
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
        Assert.Equal(EditResult.Ok, session.Apply(d => EditOps.PutObject(d, new ObjectInput("api", Tech: "Fastify"))));
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
        var message = session.Apply(d => EditOps.PutObject(d, new ObjectInput("loose", "app", "Loose"))).Message;
        Assert.StartsWith("Refused, nothing saved. This would add:", message);
        Assert.Contains("app must be inside system", message);
        Assert.Equal(before, Read(dir, "model.yaml"));
        Assert.False(session.CanUndo);
    }

    /// <summary>A run that measured the actor "10" and the line from api to db, in a folder of its own: only the checker reads what is in it. A run needs two levels.</summary>
    private static void WriteRun(string dir)
    {
        const string level = "    overall: { rate: 1, p50: 1, p95: 1, errors: 0 }\n    objects:\n      \"10\": { util: 0.1 }\n    connections:\n      - { from: api, to: db, rate: 1, p50: 1, p95: 1, errors: 0 }\n";
        File.WriteAllText(Path.Combine(dir, "perf", "tenth-load.yaml"), "name: Tenth\nlevels:\n  - load: 1\n" + level + "  - load: 2\n" + level);
    }

    [Fact]
    public void An_edit_that_leaves_a_run_naming_a_shape_or_a_line_that_is_gone_is_refused_and_names_the_run()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        Directory.CreateDirectory(Path.Combine(dir, "perf"));
        WriteRun(dir);
        var before = Read(dir, "model.yaml");
        var session = new EditSession(dir);
        var shape = session.Apply(d => EditOps.DeleteObject(d, "10")).Message;
        Assert.StartsWith("Refused, nothing saved. This would add:", shape);
        Assert.Contains("perf/tenth-load.yaml: unknown object \"10\"", shape);
        Assert.EndsWith("Change or delete those runs first.", shape);
        var line = session.Apply(d => EditOps.RemoveConnection(d, new ConnectionInput("api", "db"))).Message;
        Assert.Contains("perf/tenth-load.yaml: api → db is not a connection in the model", line);
        Assert.Equal(before, Read(dir, "model.yaml"));
        Assert.False(session.CanUndo);
        // Without the run the same edit goes through.
        File.Delete(Path.Combine(dir, "perf", "tenth-load.yaml"));
        Assert.Equal(EditResult.Ok, session.Apply(d => EditOps.DeleteObject(d, "10")));
    }

    [Fact]
    public void A_run_that_already_names_something_gone_does_not_stop_an_edit_that_has_nothing_to_do_with_it()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        Directory.CreateDirectory(Path.Combine(dir, "perf"));
        WriteRun(dir);
        var session = new EditSession(dir);
        File.WriteAllText(Path.Combine(dir, "model.yaml"), Read(dir, "model.yaml").Replace("  \"10\": { type: actor, name: Tenth }\n", ""));
        Assert.Equal(EditResult.Ok, session.Apply(d => EditOps.PutObject(d, new ObjectInput("api", Tech: "Fastify"))));
    }

    [Fact]
    public void A_file_that_changed_since_it_was_read_is_never_overwritten()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        var session = new EditSession(dir);
        var result = session.Apply(d =>
        {
            File.AppendAllText(Path.Combine(dir, "model.yaml"), "\n# someone else was here\n"); // between the read and the write
            return EditOps.PutObject(d, Fresh);
        });
        Assert.Equal(EditResult.FileChanged, result);
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
        var message = session.Apply(d => EditOps.PutObject(d, Fresh)).Message;
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
        Assert.Equal(EditResult.Ok, session.Apply(d => EditOps.PutObject(d, new ObjectInput("api", Tech: "Fastify"))));
        var edited = Read(dir, "model.yaml");
        Assert.Equal(EditResult.Ok, session.Apply(d => EditOps.PlaceBoxes(d, "root", [("customer", 5, 6)])));
        Assert.True(session.CanUndo);
        Assert.False(session.CanRedo);

        Assert.Equal(EditResult.Ok, session.Undo());
        Assert.DoesNotContain("customer: [5, 6]", Read(dir, "layout.yaml"));
        Assert.Equal(edited, Read(dir, "model.yaml"));
        Assert.True(session.CanRedo);
        Assert.Equal(EditResult.Ok, session.Undo());
        Assert.DoesNotContain("tech: Fastify", Read(dir, "model.yaml"));
        Assert.Equal("Nothing to undo.", session.Undo().Message);

        Assert.Equal(EditResult.Ok, session.Redo());
        Assert.Equal(edited, Read(dir, "model.yaml"));
        Assert.Equal(EditResult.Ok, session.Redo());
        Assert.Contains("customer: [5, 6]", Read(dir, "layout.yaml"));
        Assert.Equal("Nothing to redo.", session.Redo().Message);
        Assert.Equal(0, TempFiles(dir));
    }

    [Fact]
    public void A_new_edit_clears_what_could_have_been_redone()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        var session = new EditSession(dir);
        Assert.Equal(EditResult.Ok, session.Apply(d => EditOps.PutObject(d, Fresh)));
        Assert.Equal(EditResult.Ok, session.Undo());
        Assert.True(session.CanRedo);
        Assert.Equal(EditResult.Ok, session.Apply(d => EditOps.PutObject(d, new ObjectInput("other", "actor", "Other"))));
        Assert.False(session.CanRedo);
    }

    [Fact]
    public void Undo_does_nothing_where_the_file_changed_since()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        var session = new EditSession(dir);
        Assert.Equal(EditResult.Ok, session.Apply(d => EditOps.PutObject(d, Fresh)));
        File.AppendAllText(Path.Combine(dir, "model.yaml"), "# edited elsewhere\n");
        var changed = Read(dir, "model.yaml");
        Assert.StartsWith("Can't undo: this changed since", session.Undo().Message);
        Assert.Equal(changed, Read(dir, "model.yaml"));
        Assert.True(session.CanUndo); // still there to try again
    }

    [Fact]
    public void Undoing_a_flow_that_was_created_deletes_its_file_and_redoing_brings_it_back()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        var session = new EditSession(dir);
        Assert.Equal(EditResult.Ok, session.Apply(d => EditOps.PutFlow(d, "pay", "Customer pays", "root", [EditOps.NewStep("customer", "pay", "Pays")])));
        var created = Read(dir, "flows/pay.yaml");
        Assert.Equal(EditResult.Ok, session.Undo());
        Assert.False(File.Exists(Path.Combine(dir, "flows", "pay.yaml")));
        Assert.Equal(EditResult.Ok, session.Redo());
        Assert.Equal(created, Read(dir, "flows/pay.yaml"));
    }

    [Fact]
    public void Undoing_the_delete_of_a_flow_writes_it_back()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        var session = new EditSession(dir);
        Assert.Equal(EditResult.Ok, session.Apply(d => EditOps.DeleteFlow(d, "browse")));
        Assert.False(File.Exists(Path.Combine(dir, "flows", "browse.yaml")));
        Assert.Equal(EditResult.Ok, session.Undo());
        Assert.Contains("name: Customer browses", Read(dir, "flows/browse.yaml"));
    }

    [Fact]
    public void An_edit_that_changes_nothing_writes_nothing_and_is_not_an_undo_step()
    {
        var (temp, dir) = Copy();
        using var _ = temp;
        var before = Read(dir, "model.yaml");
        var session = new EditSession(dir);
        Assert.Equal(EditResult.Ok, session.Apply(d => EditOps.PutObject(d, new ObjectInput("api", Name: "API")))); // same name
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
        Assert.Equal(EditResult.Ok, session.Apply(d => EditOps.PutObject(d, Fresh)));
        // A busy runner can be slow to deliver the event, so wait for it, then give a second one time to show up.
        SpinWait.SpinUntil(() => Volatile.Read(ref heard) > 0, TimeSpan.FromSeconds(10));
        Thread.Sleep(300);
        Assert.Equal(1, saves);
        Assert.Equal(1, Volatile.Read(ref heard));
    }

    private static (TempDir Temp, string Dir) CopyCase(string name)
    {
        var temp = new TempDir();
        var source = Path.Combine(Repo.Root, "desktop", "fixtures", "cases", name, "flowy");
        foreach (var file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
            temp.Write(Path.Combine("flowy", Path.GetRelativePath(source, file)), File.ReadAllText(file));
        return (temp, Path.Combine(temp.Dir, "flowy"));
    }

    private static Dictionary<string, string> Snapshot(string dir) =>
        Directory.GetFiles(dir, "*", SearchOption.AllDirectories).ToDictionary(f => Path.GetRelativePath(dir, f).Replace('\\', '/'), File.ReadAllText);

    [Fact]
    public void A_delete_that_settles_flows_and_analyses_writes_each_file_it_changes_and_one_undo_puts_them_all_back()
    {
        var (temp, dir) = CopyCase("delete");
        using var _ = temp;
        var before = Snapshot(dir);
        var session = new EditSession(dir);
        Assert.Contains("is used by failure analysis ordering", session.Apply(d => EditOps.DeleteObject(d, "cache")).Message);
        Assert.Equal(before, Snapshot(dir));
        var targets = new[] { new Target(Object: "db") };
        var settled = new[] { new Resolution("step:checkout:3", "removeStep"), new Resolution("mode:ordering:db-down:on", "removeMode") };
        Assert.Equal(EditResult.Ok, session.Apply(d => EditOps.DeleteWith(d, targets, settled)));
        var after = Snapshot(dir);
        Assert.NotEqual(before["model.yaml"], after["model.yaml"]);
        Assert.NotEqual(before["flows/checkout.yaml"], after["flows/checkout.yaml"]);
        Assert.NotEqual(before["failures/ordering.yaml"], after["failures/ordering.yaml"]);
        Assert.Equal(before["flows/pay.yaml"], after["flows/pay.yaml"]);
        Assert.DoesNotContain("db-down", after["failures/ordering.yaml"]);
        Assert.Contains("step: 3", after["failures/ordering.yaml"]); // the receipt mode moved up from step 4
        Assert.Equal(0, TempFiles(dir));
        Assert.Equal(EditResult.Ok, session.Undo());
        Assert.Equal(before, Snapshot(dir)); // byte for byte, hand-written style included
        Assert.Equal("Nothing to undo.", session.Undo().Message);
    }

    private static readonly Target[] DropDb = [new Target(Object: "db")];
    private static readonly Resolution[] SettleDb = [new("step:checkout:3", "removeStep"), new("mode:ordering:db-down:on", "removeMode")];

    /// <summary>A hook that throws a disk error on the writes whose numbers (counting from 1, put-backs included) are listed.</summary>
    private static Action<string> FailOn(params int[] numbers)
    {
        var n = 0;
        return _ => { if (numbers.Contains(++n)) throw new IOException("disk full"); };
    }

    [Fact]
    public void A_write_that_fails_halfway_puts_back_what_was_written_and_records_nothing()
    {
        var (temp, dir) = CopyCase("delete");
        using var _ = temp;
        var before = Snapshot(dir);
        var session = new EditSession(dir) { BeforeWrite = FailOn(2) };
        var saves = 0;
        session.Saved += () => saves++;
        Assert.Equal("Couldn't save: disk full", session.Apply(d => EditOps.DeleteWith(d, DropDb, SettleDb)).Message);
        Assert.Equal(before, Snapshot(dir));
        Assert.Equal(0, TempFiles(dir));
        Assert.Equal(0, saves);
        Assert.False(session.CanUndo);
    }

    [Fact]
    public void A_file_that_changed_between_reading_and_writing_stops_the_edit_before_any_file_is_touched()
    {
        var (temp, dir) = CopyCase("delete");
        using var _ = temp;
        var session = new EditSession(dir);
        var result = session.Apply(d =>
        {
            File.WriteAllText(Path.Combine(dir, "failures", "ordering.yaml"), "name: Someone else\nmodes: {}\n"); // someone else saves while the editor works
            return EditOps.DeleteWith(d, DropDb, SettleDb);
        });
        Assert.Equal(EditResult.FileChanged, result);
        var now = Snapshot(dir);
        Assert.Equal("name: Someone else\nmodes: {}\n", now["failures/ordering.yaml"]);
        Assert.Contains("db:", now["model.yaml"]);
        Assert.Contains("Saves the order", now["flows/checkout.yaml"]);
        Assert.False(session.CanUndo);
    }

    [Fact]
    public void When_a_file_cannot_be_put_back_either_it_is_named_and_the_edit_can_still_be_undone()
    {
        var (temp, dir) = CopyCase("delete");
        using var _ = temp;
        var before = Snapshot(dir);
        var session = new EditSession(dir) { BeforeWrite = FailOn(2, 3) }; // the second file, then putting the first back
        var saves = 0;
        session.Saved += () => saves++;
        var message = session.Apply(d => EditOps.DeleteWith(d, DropDb, SettleDb)).Message;
        Assert.Equal("Couldn't save: disk full. model.yaml was saved first and could not be put back.", message);
        Assert.NotEqual(before["model.yaml"], Snapshot(dir)["model.yaml"]);
        Assert.Equal(1, saves);
        session.BeforeWrite = null;
        Assert.Equal(EditResult.Ok, session.Undo());
        Assert.Equal(before, Snapshot(dir)); // byte for byte, hand-written style included
        Assert.False(session.CanUndo);
    }

    [Fact]
    public void An_undo_that_fails_halfway_leaves_every_file_as_the_edit_left_it_and_can_be_tried_again()
    {
        var (temp, dir) = CopyCase("delete");
        using var _ = temp;
        var before = Snapshot(dir);
        var session = new EditSession(dir);
        Assert.Equal(EditResult.Ok, session.Apply(d => EditOps.DeleteWith(d, DropDb, SettleDb)));
        var after = Snapshot(dir);
        session.BeforeWrite = FailOn(2);
        Assert.Equal("Couldn't undo: disk full", session.Undo().Message);
        Assert.Equal(after, Snapshot(dir));
        Assert.True(session.CanUndo);
        session.BeforeWrite = null;
        Assert.Equal(EditResult.Ok, session.Undo());
        Assert.Equal(before, Snapshot(dir));
    }

    [Fact]
    public void An_analysis_that_cannot_be_read_is_left_alone_by_an_edit()
    {
        var (temp, dir) = CopyCase("delete");
        using var _ = temp;
        File.WriteAllText(Path.Combine(dir, "failures", "broken.yaml"), "name: Broken\nmodes: [not, a, map]\n");
        var session = new EditSession(dir);
        Assert.Equal(EditResult.Ok, session.Apply(d => EditOps.PutObject(d, new ObjectInput("api", Tech: "Fastify"))));
        Assert.Equal("name: Broken\nmodes: [not, a, map]\n", File.ReadAllText(Path.Combine(dir, "failures", "broken.yaml")));
    }
}
