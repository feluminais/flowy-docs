using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>Reading a folder again and again, with a reader the test holds back: what lands, what is said when a file can't be read, and that an older read never lands after a newer one.</summary>
public class FolderSessionTests
{
    static FolderSessionTests()
    {
        // Two reads wait on each other here, and the other tests in the run keep pool threads busy: a pool that starts with few threads grows too slowly for them.
        ThreadPool.GetMinThreads(out var workers, out var io);
        ThreadPool.SetMinThreads(Math.Max(workers, 32), io);
    }

    private static Folder Empty() => new(new Model(), []);

    [Fact]
    public async Task A_read_reports_the_folder()
    {
        var session = new FolderSession("anywhere", _ => Empty());
        var landed = new List<Folder>();
        session.Loaded += landed.Add;
        await session.LoadAsync();
        Assert.Single(landed);
    }

    [Fact]
    public async Task A_file_that_cannot_be_parsed_says_why_and_lands_nothing()
    {
        var error = new ParseError("model.yaml", "bad", null);
        var session = new FolderSession("anywhere", _ => throw error);
        var said = new List<string>();
        var landed = 0;
        session.Loaded += _ => landed++;
        session.Failed += said.Add;
        await session.LoadAsync();
        Assert.Equal([error.Message], said);
        Assert.Equal(0, landed);
    }

    [Fact]
    public async Task A_folder_that_cannot_be_read_says_so()
    {
        var session = new FolderSession("anywhere", _ => throw new IOException("in use"));
        var said = new List<string>();
        session.Failed += said.Add;
        await session.LoadAsync();
        Assert.Equal(["Can't read the folder: in use"], said);
    }

    [Fact]
    public void Reading_now_gives_an_empty_folder_and_the_reason_when_a_file_is_bad()
    {
        var session = new FolderSession("anywhere", _ => throw new UnauthorizedAccessException("denied"));
        var folder = session.Read(out var problem);
        Assert.Equal("Can't read the folder: denied", problem);
        Assert.Empty(folder.Model.Objects);

        var good = new FolderSession("anywhere", _ => Empty());
        good.Read(out problem);
        Assert.Null(problem);
    }

    [Fact]
    public async Task An_older_read_that_finishes_last_says_nothing()
    {
        var gate = new ManualResetEventSlim();
        var calls = 0;
        var first = Empty();
        var second = Empty();
        var session = new FolderSession("anywhere", _ =>
        {
            if (Interlocked.Increment(ref calls) != 1) return second;
            gate.Wait(TimeSpan.FromSeconds(60)); // the first read is slow
            return first;
        });
        var landed = new List<Folder>();
        session.Loaded += landed.Add;

        var older = session.LoadAsync();
        while (Volatile.Read(ref calls) == 0) await Task.Delay(5, TestContext.Current.CancellationToken);
        await session.LoadAsync();
        gate.Set();
        await older;

        Assert.Same(second, Assert.Single(landed));
    }

    [Fact]
    public async Task A_read_still_on_its_way_when_the_session_ends_says_nothing()
    {
        var gate = new ManualResetEventSlim();
        var session = new FolderSession("anywhere", _ =>
        {
            gate.Wait(TimeSpan.FromSeconds(60));
            return Empty();
        });
        var landed = 0;
        session.Loaded += _ => landed++;
        var read = session.LoadAsync();
        session.Dispose();
        gate.Set();
        await read;
        Assert.Equal(0, landed);
        await session.LoadAsync(); // and it reads no more
        Assert.Equal(0, landed);
    }

    [Fact]
    public async Task A_folder_that_has_gone_is_said_so_and_reads_nothing_more()
    {
        var gone = Path.Combine(Path.GetTempPath(), "flowy-gone-" + Guid.NewGuid().ToString("N"));
        var reads = 0;
        var session = new FolderSession(gone, _ =>
        {
            reads++;
            return Empty();
        });
        var said = new List<string>();
        session.Failed += said.Add;
        await session.RefreshAsync();
        Assert.Equal(["The folder is gone. Open it again when it is back."], said);
        Assert.True(session.WatchFailed);
        await session.RefreshAsync();
        Assert.Single(said);
        Assert.Equal(0, reads);
    }
}
