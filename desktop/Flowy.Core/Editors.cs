namespace Flowy.Core;

/// <summary>How an editor's command line takes a project, a file and a line, which decides what Open in does with it.</summary>
public enum EditorFamily
{
    /// <summary>VS Code and its forks: <c>code &lt;project&gt; -g &lt;file&gt;:&lt;line&gt;</c>. A window that already has the project open takes the file.</summary>
    VsCode,
    /// <summary>IntelliJ IDEA, Rider and the rest: <c>idea64 &lt;project&gt; --line &lt;n&gt; &lt;file&gt;</c>, to the window that has the project open.</summary>
    JetBrains,
    /// <summary>Zed: <c>zed &lt;project&gt; &lt;file&gt;:&lt;line&gt;</c>.</summary>
    Zed,
    /// <summary>Sublime Text: <c>subl &lt;project&gt; &lt;file&gt;:&lt;line&gt;</c>.</summary>
    Sublime,
    /// <summary>Visual Studio: <c>devenv /Edit &lt;file&gt;</c>, in the instance that is open. It takes no line.</summary>
    VisualStudio,
    /// <summary>Notepad++: <c>notepad++ -n&lt;line&gt; &lt;file&gt;</c>. It has no project.</summary>
    NotepadPlusPlus,
}

/// <summary>An editor on this computer: an id the app remembers, the name a menu and a button say, the program to start and how it takes a file.</summary>
public sealed record EditorApp(string Id, string Name, string Program, EditorFamily Family);

/// <summary>Where the file system is asked from, so a test can stand in for the computer.</summary>
public sealed record EditorProbe(Func<string, bool> FileExists, Func<string, IEnumerable<string>> SubFolders, Func<string, string?> Env, string Os);

/// <summary>
/// The editors installed on this computer, found where their installers put them, and the command line that opens a file of the repo in each: the
/// project with the file focused where the editor can do that, else the file alone. Nothing here starts a process; Flowy.App does, with no shell.
/// </summary>
public static class Editors
{
    /// <summary>The JetBrains IDEs, by the name of their program (idea64.exe, idea.sh, idea in an app bundle) and the name a person knows them by.</summary>
    private static readonly (string Program, string Name)[] JetBrainsIdes =
    [
        ("idea", "IntelliJ IDEA"), ("rider", "Rider"), ("webstorm", "WebStorm"), ("pycharm", "PyCharm"), ("goland", "GoLand"), ("clion", "CLion"),
        ("phpstorm", "PhpStorm"), ("rubymine", "RubyMine"), ("rustrover", "RustRover"), ("studio", "Android Studio"),
    ];

    /// <summary>The editors <paramref name="probe"/> finds, VS Code and its forks first, each once.</summary>
    public static List<EditorApp> Find(EditorProbe probe)
    {
        var found = new List<EditorApp>();
        void Add(string id, string name, EditorFamily family, params string?[] places)
        {
            if (found.Any(e => e.Id == id)) return;
            if (places.FirstOrDefault(p => p is not null && probe.FileExists(p)) is { } program) found.Add(new EditorApp(id, name, program, family));
        }
        var windows = probe.Os == "windows";
        var mac = probe.Os == "macos";
        string? Under(string? root, params string[] parts) => root is null ? null : Path.Combine([root, .. parts]);
        var local = probe.Env("LOCALAPPDATA");
        var programs = probe.Env("ProgramFiles");
        var programs86 = probe.Env("ProgramFiles(x86)");
        var home = probe.Env("HOME");
        string? OnPath(string name) => (probe.Env("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries).Select(d => Path.Combine(d, name)).FirstOrDefault(probe.FileExists);

        if (windows)
        {
            Add("vscode", "VS Code", EditorFamily.VsCode, Under(local, "Programs", "Microsoft VS Code", "Code.exe"), Under(programs, "Microsoft VS Code", "Code.exe"));
            Add("vscode-insiders", "VS Code Insiders", EditorFamily.VsCode, Under(local, "Programs", "Microsoft VS Code Insiders", "Code - Insiders.exe"), Under(programs, "Microsoft VS Code Insiders", "Code - Insiders.exe"));
            Add("cursor", "Cursor", EditorFamily.VsCode, Under(local, "Programs", "cursor", "Cursor.exe"));
            Add("windsurf", "Windsurf", EditorFamily.VsCode, Under(local, "Programs", "Windsurf", "Windsurf.exe"));
            Add("vscodium", "VSCodium", EditorFamily.VsCode, Under(local, "Programs", "VSCodium", "VSCodium.exe"), Under(programs, "VSCodium", "VSCodium.exe"));
            Add("zed", "Zed", EditorFamily.Zed, Under(local, "Programs", "Zed", "Zed.exe"));
            foreach (var folder in new[] { Under(programs, "JetBrains"), Under(local, "Programs"), Under(programs, "Android") }.OfType<string>().SelectMany(probe.SubFolders))
                foreach (var (program, name) in JetBrainsIdes)
                    Add(program, name, EditorFamily.JetBrains, Path.Combine(folder, "bin", $"{program}64.exe"));
            foreach (var year in new[] { Under(programs, "Microsoft Visual Studio"), Under(programs86, "Microsoft Visual Studio") }.OfType<string>().SelectMany(probe.SubFolders).OrderDescending(StringComparer.Ordinal))
                foreach (var edition in probe.SubFolders(year))
                    Add("visual-studio", "Visual Studio", EditorFamily.VisualStudio, Path.Combine(edition, "Common7", "IDE", "devenv.exe"));
            Add("sublime", "Sublime Text", EditorFamily.Sublime, Under(programs, "Sublime Text", "subl.exe"), Under(programs, "Sublime Text 3", "subl.exe"));
            Add("notepad-plus-plus", "Notepad++", EditorFamily.NotepadPlusPlus, Under(programs, "Notepad++", "notepad++.exe"), Under(programs86, "Notepad++", "notepad++.exe"));
        }
        else if (mac)
        {
            string App(string bundle, params string[] inside) => Path.Combine(["/Applications", bundle, "Contents", .. inside]);
            Add("vscode", "VS Code", EditorFamily.VsCode, App("Visual Studio Code.app", "Resources", "app", "bin", "code"));
            Add("vscode-insiders", "VS Code Insiders", EditorFamily.VsCode, App("Visual Studio Code - Insiders.app", "Resources", "app", "bin", "code-insiders"));
            Add("cursor", "Cursor", EditorFamily.VsCode, App("Cursor.app", "Resources", "app", "bin", "cursor"));
            Add("windsurf", "Windsurf", EditorFamily.VsCode, App("Windsurf.app", "Resources", "app", "bin", "windsurf"));
            Add("vscodium", "VSCodium", EditorFamily.VsCode, App("VSCodium.app", "Resources", "app", "bin", "codium"));
            Add("zed", "Zed", EditorFamily.Zed, App("Zed.app", "MacOS", "cli"));
            foreach (var bundle in probe.SubFolders("/Applications").Select(Path.GetFileName).OfType<string>().Where(b => b.EndsWith(".app", StringComparison.Ordinal)))
                foreach (var (program, name) in JetBrainsIdes)
                    Add(program, name, EditorFamily.JetBrains, App(bundle, "MacOS", program));
            Add("sublime", "Sublime Text", EditorFamily.Sublime, App("Sublime Text.app", "SharedSupport", "bin", "subl"));
        }
        else
        {
            Add("vscode", "VS Code", EditorFamily.VsCode, OnPath("code"));
            Add("cursor", "Cursor", EditorFamily.VsCode, OnPath("cursor"));
            Add("windsurf", "Windsurf", EditorFamily.VsCode, OnPath("windsurf"));
            Add("vscodium", "VSCodium", EditorFamily.VsCode, OnPath("codium"));
            Add("zed", "Zed", EditorFamily.Zed, OnPath("zed"), OnPath("zeditor"));
            foreach (var (program, name) in JetBrainsIdes)
                Add(program, name, EditorFamily.JetBrains, OnPath(program), OnPath($"{program}.sh"), Under(home, ".local", "share", "JetBrains", "Toolbox", "scripts", program));
            Add("sublime", "Sublime Text", EditorFamily.Sublime, OnPath("subl"));
        }
        return found;
    }

    /// <summary>
    /// The arguments that open <paramref name="file"/> (a path on disk inside <paramref name="project"/>, the folder that holds flowy/) in
    /// <paramref name="editor"/>, at <paramref name="line"/> when there is one: with the project, so the file opens in the window that has it, where the
    /// editor's command line can say both.
    /// </summary>
    public static List<string> Arguments(EditorApp editor, string project, string file, int? line) => editor.Family switch
    {
        EditorFamily.VsCode => [project, "-g", line is { } n ? $"{file}:{n}" : file],
        EditorFamily.JetBrains => line is { } n ? [project, "--line", n.ToString(System.Globalization.CultureInfo.InvariantCulture), file] : [project, file],
        EditorFamily.Zed or EditorFamily.Sublime => [project, line is { } n ? $"{file}:{n}" : file],
        EditorFamily.VisualStudio => ["/Edit", file],
        _ => line is { } n ? [$"-n{n}", file] : [file],
    };
}
