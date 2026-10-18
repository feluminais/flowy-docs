using System.IO.Pipes;
using System.Text.Json;

namespace Flowy.App;

/// <summary>
/// One Flowy Docs per user. A second launch (<c>Flowy Docs.exe some\folder</c>, or a click on a folder's "Open with" entry) hands its
/// arguments to the one already running and ends, and the running one opens the folder. A named mutex says which is running; a named
/// pipe, open to this user only, carries the arguments.
/// </summary>
internal static class SingleInstance
{
    private sealed record Message(string Cwd, string[] Args);

    // The mutex is per logon session, so the pipe is too: the same user in a second session (remote desktop) must not meet this one's pipe.
    private static string PipeName(string key) => $"FlowyDocs.{Environment.UserName}.{System.Diagnostics.Process.GetCurrentProcess().SessionId}.{key}";

    private static string MutexName(string key) => $@"Local\FlowyDocs.{key}";

    /// <summary>Hands the arguments to the running instance, if there is one. True means it took them and this process should end.</summary>
    public static bool TryHandOver(string[] args, string cwd, string key = "main", int timeoutMilliseconds = 1500)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", PipeName(key), PipeDirection.Out, PipeOptions.CurrentUserOnly);
            client.Connect(timeoutMilliseconds);
            using var writer = new StreamWriter(client) { AutoFlush = true };
            writer.WriteLine(JsonSerializer.Serialize(new Message(cwd, args)));
            return true;
        }
        catch (Exception e) when (e is TimeoutException or IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    /// <summary>Becomes the running instance and listens for arguments from later ones, or returns null when another already is. Dispose to stop.</summary>
    public static IDisposable? Own(string key, Action<string[], string> received)
    {
        var mutex = new Mutex(true, MutexName(key), out var owned);
        if (!owned)
        {
            mutex.Dispose();
            return null;
        }
        var stop = new CancellationTokenSource();
        _ = Task.Run(() => Listen(key, received, stop.Token));
        return new Owner(mutex, stop);
    }

    private static async Task Listen(string key, Action<string[], string> received, CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                await using var server = new NamedPipeServerStream(PipeName(key), PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await server.WaitForConnectionAsync(token);
                using var reader = new StreamReader(server);
                var line = await reader.ReadLineAsync(token);
                if (line is not null && JsonSerializer.Deserialize<Message>(line) is { Args: not null, Cwd: not null } message) received(message.Args, message.Cwd);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception)
            {
                // A client that left half way, sent nonsense, or a pipe that can't be made: wait for the next, without spinning on it.
                await Task.Delay(500, token).ContinueWith(_ => { });
            }
        }
    }

    private sealed class Owner(Mutex mutex, CancellationTokenSource stop) : IDisposable
    {
        public void Dispose()
        {
            stop.Cancel();
            try
            {
                mutex.ReleaseMutex();
            }
            catch (ApplicationException)
            {
                // released from another thread than took it: the process is ending anyway
            }
            mutex.Dispose();
        }
    }
}
