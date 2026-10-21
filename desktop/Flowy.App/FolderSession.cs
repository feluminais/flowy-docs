using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// Reading a model folder again and again: the folder on disk, and the watch on it. Every read says how it ended, once: <see cref="Loaded"/> with the folder, or
/// <see cref="Failed"/> with the words to show in a banner. A read that was started before a newer one never lands after it. It has no controls; whoever
/// owns it decides where the results go.
/// </summary>
internal sealed class FolderSession : IDisposable
{
    private readonly Func<string, Folder> _load;
    private FolderWatcher? _watcher;
    private int _loads;
    private bool _disposed;

    /// <param name="dir">The model folder.</param>
    /// <param name="load">How the folder is read; <see cref="FolderLoader.Load"/> unless a test says otherwise.</param>
    public FolderSession(string dir, Func<string, Folder>? load = null)
    {
        Dir = dir;
        _load = load ?? FolderLoader.Load;
    }

    public string Dir { get; }

    /// <summary>The folder can no longer be watched (or is gone): it is read again only when it is opened afresh.</summary>
    public bool WatchFailed { get; private set; }

    /// <summary>A read finished with a folder. Raised on the thread that started the read.</summary>
    public event Action<Folder>? Loaded;

    /// <summary>A read could not be done, or the watch is lost: the words for a banner.</summary>
    public event Action<string>? Failed;

    /// <summary>What a failed read says, or null for an exception that is not about reading the folder.</summary>
    private static string? ProblemOf(Exception e) => e switch
    {
        ParseError => e.Message,
        IOException or UnauthorizedAccessException => $"Can't read the folder: {e.Message}",
        _ => null,
    };

    /// <summary>Reads the folder now. A file that can't be read gives an empty folder and the reason in <paramref name="problem"/>.</summary>
    public Folder Read(out string? problem)
    {
        try
        {
            problem = null;
            return _load(Dir);
        }
        catch (Exception e) when (ProblemOf(e) is not null)
        {
            problem = ProblemOf(e);
            return new Folder(new Model(), []);
        }
    }

    /// <summary>Reads the folder again off the calling thread. Only the newest read reports; an older one that finishes later says nothing.</summary>
    public async Task LoadAsync()
    {
        if (_disposed) return;
        var load = ++_loads;
        try
        {
            var folder = await Task.Run(() => _load(Dir));
            if (load == _loads) Loaded?.Invoke(folder);
        }
        catch (Exception e) when (ProblemOf(e) is { } problem)
        {
            if (load == _loads) Failed?.Invoke(problem);
        }
    }

    /// <summary>A file changed: read again. While the watch is lost nothing is read, since it has already said so and a read would clear that. A folder that has gone is said so.</summary>
    public async Task RefreshAsync()
    {
        if (_disposed || WatchFailed) return;
        if (!Directory.Exists(Dir))
        {
            WatchFailed = true;
            Failed?.Invoke("The folder is gone. Open it again when it is back.");
            return;
        }
        await LoadAsync();
    }

    /// <summary>
    /// Starts watching the folder: a change reads it again, and a lost watch says so. <paramref name="post"/> carries what the watcher reports (it comes
    /// on a pool thread) to the thread that owns the screen.
    /// </summary>
    public void Watch(Action<Action> post)
    {
        _watcher?.Dispose();
        _watcher = null;
        WatchFailed = false;
        try
        {
            _watcher = new FolderWatcher(Dir);
            _watcher.Changed += () => post(async () => await RefreshAsync());
            _watcher.Failed += e => post(() =>
            {
                WatchFailed = true;
                Failed?.Invoke($"Can't watch the folder any more ({e.Message}). Open it again to get live updates.");
            });
        }
        catch (Exception e) when (e is ArgumentException or IOException or UnauthorizedAccessException)
        {
            WatchFailed = true;
            Failed?.Invoke($"Can't watch the folder ({e.Message}). Open it again to read it afresh.");
        }
    }

    /// <summary>Stops watching, and drops any read still on its way.</summary>
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _loads++;
        _watcher?.Dispose();
        _watcher = null;
    }
}
