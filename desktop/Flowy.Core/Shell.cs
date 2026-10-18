using System.Text.Json;

namespace Flowy.Core;

/// <summary>Which folder a pick, a drop or a path on the command line means, and what the window is called.</summary>
public static class ModelFolders
{
    /// <summary>The disk, passed in so the rules can be tested without one.</summary>
    public sealed record Disk(Func<string, bool> IsDir, Func<string, bool> HasFile)
    {
        public static Disk Real { get; } = new(Directory.Exists, File.Exists);
    }

    /// <summary>
    /// The model folder for what was picked: the folder itself if it is called <c>flowy</c>, else the <c>flowy</c> folder inside it, else
    /// the folder itself if it holds <c>model.yaml</c>. Null when there is none. A repo's own <c>flowy</c> folder wins over a
    /// <c>model.yaml</c> at its root, which other tools write too. The app never creates a folder: a viewer must not write into a repo it
    /// was only asked to read.
    /// </summary>
    public static string? Resolve(string picked, Disk? disk = null)
    {
        disk ??= Disk.Real;
        var folder = Path.TrimEndingDirectorySeparator(picked);
        if (folder == "") return null;
        if (disk.IsDir(folder) is false) return null;
        if (Path.GetFileName(folder) == "flowy") return folder;
        var inside = Path.Combine(folder, "flowy");
        if (disk.IsDir(inside)) return inside;
        return disk.HasFile(Path.Combine(folder, "model.yaml")) ? folder : null;
    }

    /// <summary>The name a window shows: the repo for <c>&lt;repo&gt;/flowy</c>, else the model folder's own name.</summary>
    public static string Title(string dir)
    {
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(dir));
        var name = Path.GetFileName(full);
        return name == "flowy" ? Path.GetFileName(Path.GetDirectoryName(full)) is { Length: > 0 } parent ? parent : name : name;
    }

    /// <summary>One key per folder, so the same folder reached two ways is one window. Windows and macOS file names ignore case.</summary>
    public static string Key(string dir)
    {
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(dir));
        return OperatingSystem.IsWindows() || OperatingSystem.IsMacOS() ? full.ToUpperInvariant() : full;
    }

    /// <summary>The first argument that names a folder. Flags and values that aren't folders are skipped; relative paths are against <paramref name="cwd"/>.</summary>
    public static string? FromArguments(IEnumerable<string> args, string cwd, Func<string, bool>? isDir = null)
    {
        isDir ??= Directory.Exists;
        foreach (var raw in args)
        {
            if (raw.StartsWith('-')) continue;
            // Explorer's "%V" on a drive's own background is D:\, and that backslash escapes the closing quote: the app is given D:" .
            var arg = raw.Length == 3 && raw[1] == ':' && raw[2] == '"' ? raw[..2] + @"\" : raw;
            var path = Path.GetFullPath(arg, cwd);
            if (isDir(path)) return path;
        }
        return null;
    }
}

/// <summary>The folders opened lately, newest first.</summary>
public static class Recents
{
    public const int Max = 10;

    /// <summary>The folder goes first; an earlier copy of the same folder is dropped. Ten are kept.</summary>
    public static List<string> Push(IEnumerable<string> recent, string dir) =>
        Trim([dir, .. recent.Where(r => ModelFolders.Key(r) != ModelFolders.Key(dir))]);

    public static List<string> Trim(IEnumerable<string> recent) => recent.Take(Max).ToList();

    /// <summary>Those that are still there.</summary>
    public static List<string> Existing(IEnumerable<string> recent, Func<string, bool>? exists = null) =>
        recent.Where(exists ?? Directory.Exists).ToList();
}

/// <summary>How big the window was, so the next one opens the same: its size when not maximized, and whether it was.</summary>
public readonly record struct WindowSize(double Width, double Height, bool Maximized);

/// <summary>What the app remembers between runs.</summary>
public sealed record UserState(IReadOnlyList<string> Recent, string? Lines, bool CheckForUpdates, WindowSize? Window = null)
{
    public static UserState Default { get; } = new([], null, true);
}

/// <summary>Reads and writes <see cref="UserState"/> as a small JSON file. A file that is missing or broken gives the defaults: losing the recent list isn't worth failing at start-up.</summary>
public sealed class UserStateStore(string file)
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    /// <summary>Where the state lives: the user's application data folder, or the folder FLOWY_STATE_DIR names.</summary>
    public static string DefaultFile()
    {
        var folder = Environment.GetEnvironmentVariable("FLOWY_STATE_DIR");
        if (string.IsNullOrEmpty(folder)) folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Flowy Docs");
        return Path.Combine(folder, "state.json");
    }

    public string File => file;

    public UserState Load()
    {
        try
        {
            using var doc = JsonDocument.Parse(System.IO.File.ReadAllText(file));
            var root = doc.RootElement;
            var recent = root.TryGetProperty("recent", out var r) && r.ValueKind == JsonValueKind.Array
                ? Recents.Trim(r.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.String).Select(e => e.GetString()!))
                : [];
            var lines = root.TryGetProperty("lines", out var l) && l.ValueKind == JsonValueKind.String && l.GetString() is "straight" or "curved" or "angled" ? l.GetString() : null;
            var updates = !(root.TryGetProperty("checkForUpdates", out var u) && u.ValueKind == JsonValueKind.False);
            // A size that isn't sane (a hand-edited file, a monitor that is gone) is forgotten: the window then opens at its usual size.
            WindowSize? window = null;
            if (root.TryGetProperty("window", out var w) && w.ValueKind == JsonValueKind.Object
                && w.TryGetProperty("width", out var ww) && ww.TryGetDouble(out var width)
                && w.TryGetProperty("height", out var wh) && wh.TryGetDouble(out var height)
                && width is >= 480 and <= 10000 && height is >= 320 and <= 10000)
                window = new WindowSize(width, height, w.TryGetProperty("maximized", out var m) && m.ValueKind == JsonValueKind.True);
            return new UserState(recent, lines, updates, window);
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException or InvalidOperationException)
        {
            return UserState.Default;
        }
    }

    /// <summary>Best effort, through a temporary file so a crash can't leave half a file.</summary>
    public void Save(UserState state)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            var temp = file + ".tmp";
            System.IO.File.WriteAllText(temp, JsonSerializer.Serialize(new { recent = state.Recent, lines = state.Lines, checkForUpdates = state.CheckForUpdates, window = state.Window is { } w ? new { width = w.Width, height = w.Height, maximized = w.Maximized } : null }, Json));
            System.IO.File.Move(temp, file, true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // A read-only profile: the app still works, it just forgets.
        }
    }
}
