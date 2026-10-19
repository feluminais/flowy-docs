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

/// <summary>What the navigator remembers for one project: the panel tab that was open ("flows" or "explorer", else none) and which shapes were open in the tree.</summary>
public sealed record NavigatorState(string? Tab, IReadOnlyList<string> Expanded)
{
    /// <summary>The most shapes remembered open for one project, and the most projects remembered, so a runaway entry never grows the file without bound.</summary>
    public const int MaxExpanded = 2000;

    public const int MaxProjects = 50;
}

/// <summary>What the app remembers between runs. <c>OpenFilesWith</c> is the app the person chose to open a box's linked files with; null means the system's default. <c>Navigators</c> is what each project's navigator remembers, by <see cref="ModelFolders.Key"/>.</summary>
public sealed record UserState(IReadOnlyList<string> Recent, string? Lines, bool CheckForUpdates, WindowSize? Window = null, string? OpenFilesWith = null, IReadOnlyDictionary<string, NavigatorState>? Navigators = null)
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
            // The app a person chose for linked files. One that is not text, or is gone, is forgotten.
            var openWith = root.TryGetProperty("openFilesWith", out var o) && o.ValueKind == JsonValueKind.String && o.GetString() is { Length: > 0 } app && System.IO.File.Exists(app) ? app : null;
            // What each project's navigator remembered. Anything that is not text is dropped, and so is whatever is past the limits.
            Dictionary<string, NavigatorState>? navigators = null;
            if (root.TryGetProperty("navigators", out var n) && n.ValueKind == JsonValueKind.Object)
            {
                navigators = [];
                foreach (var entry in n.EnumerateObject().Take(NavigatorState.MaxProjects))
                {
                    if (entry.Value.ValueKind != JsonValueKind.Object) continue;
                    var tab = entry.Value.TryGetProperty("tab", out var t) && t.ValueKind == JsonValueKind.String && t.GetString() is "flows" or "explorer" ? t.GetString() : null;
                    var open = entry.Value.TryGetProperty("expanded", out var x) && x.ValueKind == JsonValueKind.Array
                        ? x.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.String).Select(e => e.GetString()!).Take(NavigatorState.MaxExpanded).ToList()
                        : [];
                    navigators[entry.Name] = new NavigatorState(tab, open);
                }
            }
            return new UserState(recent, lines, updates, window, openWith, navigators);
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
            System.IO.File.WriteAllText(temp, JsonSerializer.Serialize(new { recent = state.Recent, lines = state.Lines, checkForUpdates = state.CheckForUpdates, openFilesWith = state.OpenFilesWith, window = state.Window is { } w ? new { width = w.Width, height = w.Height, maximized = w.Maximized } : null, navigators = state.Navigators?.ToDictionary(k => k.Key, k => new { tab = k.Value.Tab, expanded = k.Value.Expanded }) }, Json));
            System.IO.File.Move(temp, file, true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // A read-only profile: the app still works, it just forgets.
        }
    }
}
