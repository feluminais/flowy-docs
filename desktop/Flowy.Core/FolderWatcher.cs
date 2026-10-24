namespace Flowy.Core;

/// <summary>
/// Tells when a model changes: model.yaml, layout.yaml or a flow file saved, added or removed. An editor saving three files wakes it once,
/// because it waits 100 ms after the last change. The temporary files the canvas saves through, and anything else in the folder, are not changes.
/// </summary>
public sealed class FolderWatcher : IDisposable
{
    private readonly FileSystemWatcher _watcher;
    private readonly Timer _timer;
    private readonly TimeSpan _wait;

    /// <summary>Raised on a thread-pool thread.</summary>
    public event Action? Changed;

    /// <summary>Raised when the folder can no longer be watched (it was deleted, or the system ran out of watches).</summary>
    public event Action<Exception>? Failed;

    public FolderWatcher(string dir, TimeSpan? wait = null)
    {
        _wait = wait ?? TimeSpan.FromMilliseconds(100);
        _timer = new Timer(_ => Changed?.Invoke());
        // 64 KB (the most the system allows on a network share is less, and then the system's own limit holds): a folder of hundreds of flows touched at once, as a branch switch does, overflows the 8 KB it starts with.
        _watcher = new FileSystemWatcher(dir) { InternalBufferSize = 64 * 1024, IncludeSubdirectories = true, NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size };
        FileSystemEventHandler changed = (_, e) => Touch(e.Name);
        _watcher.Changed += changed;
        _watcher.Created += changed;
        _watcher.Deleted += changed;
        _watcher.Renamed += (_, e) =>
        {
            Touch(e.OldName);
            Touch(e.Name);
        };
        _watcher.Error += (_, e) => Fault(e.GetException());
        _watcher.EnableRaisingEvents = true;
    }

    /// <summary>
    /// A watcher that ran out of room lost some changes, but still watches: the folder is read again, and nothing else is lost. Any other error means it can't watch any more.
    /// </summary>
    internal void Fault(Exception e)
    {
        if (e is InternalBufferOverflowException) _timer.Change(_wait, Timeout.InfiniteTimeSpan);
        else Failed?.Invoke(e);
    }

    private void Touch(string? name)
    {
        if (name is not null && (name.EndsWith(".tmp", StringComparison.Ordinal) || !FolderLayout.IsPartOfModel(name))) return;
        _timer.Change(_wait, Timeout.InfiniteTimeSpan);
    }

    public void Dispose()
    {
        _watcher.Dispose();
        _timer.Dispose();
    }
}
