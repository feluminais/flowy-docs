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
        _watcher = new FileSystemWatcher(dir) { IncludeSubdirectories = true, NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size };
        FileSystemEventHandler changed = (_, e) => Touch(e.Name);
        _watcher.Changed += changed;
        _watcher.Created += changed;
        _watcher.Deleted += changed;
        _watcher.Renamed += (_, e) => Touch(e.Name);
        _watcher.Error += (_, e) => Failed?.Invoke(e.GetException());
        _watcher.EnableRaisingEvents = true;
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
