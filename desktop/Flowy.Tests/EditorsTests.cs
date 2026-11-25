using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>Which editors Open Code In finds on a computer, and the command line that opens a file of the repo in each.</summary>
public class EditorsTests
{
    private static EditorProbe Windows(params string[] files)
    {
        var set = new HashSet<string>(files, StringComparer.OrdinalIgnoreCase);
        var env = new Dictionary<string, string> { ["LOCALAPPDATA"] = @"C:\Users\me\AppData\Local", ["ProgramFiles"] = @"C:\Program Files", ["ProgramFiles(x86)"] = @"C:\Program Files (x86)" };
        IEnumerable<string> Sub(string dir) => set.Select(f => f[..Math.Max(0, f.LastIndexOf('\\'))]).SelectMany(Parents).Where(p => string.Equals(Path.GetDirectoryName(p), dir, StringComparison.OrdinalIgnoreCase)).Distinct(StringComparer.OrdinalIgnoreCase);
        static IEnumerable<string> Parents(string p) { for (var d = p; !string.IsNullOrEmpty(d); d = Path.GetDirectoryName(d)) yield return d; }
        return new EditorProbe(set.Contains, Sub, name => env.GetValueOrDefault(name), "windows");
    }

    [Fact]
    public void Editors_are_found_where_their_installers_put_them_VS_Code_and_its_forks_first()
    {
        if (!OperatingSystem.IsWindows()) return; // the paths are Windows paths, read with Windows' separators
        var found = Editors.Find(Windows(
            @"C:\Program Files\JetBrains\JetBrains Rider 2025.3\bin\rider64.exe",
            @"C:\Users\me\AppData\Local\Programs\cursor\Cursor.exe",
            @"C:\Users\me\AppData\Local\Programs\Microsoft VS Code\Code.exe",
            @"C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\devenv.exe",
            @"C:\Program Files (x86)\Notepad++\notepad++.exe"));
        Assert.Equal(["VS Code", "Cursor", "Rider", "Visual Studio", "Notepad++"], found.Select(e => e.Name));
        Assert.Equal(@"C:\Users\me\AppData\Local\Programs\Microsoft VS Code\Code.exe", found[0].Program);
    }

    [Fact]
    public void A_computer_with_no_editor_has_none()
    {
        Assert.Empty(Editors.Find(new EditorProbe(_ => false, _ => [], _ => null, "windows")));
        Assert.Empty(Editors.Find(new EditorProbe(_ => false, _ => [], _ => null, "macos")));
        Assert.Empty(Editors.Find(new EditorProbe(_ => false, _ => [], _ => "/usr/bin", "other")));
    }

    [Fact]
    public void Each_editor_opens_the_project_with_the_file_at_its_line_where_its_command_line_can()
    {
        const string project = "/r", file = "/r/src/a.ts";
        EditorApp Of(EditorFamily family) => new("x", "X", "x", family);
        Assert.Equal(["/r", "-g", "/r/src/a.ts:42"], Editors.Arguments(Of(EditorFamily.VsCode), project, file, 42));
        Assert.Equal(["/r", "-g", "/r/src/a.ts"], Editors.Arguments(Of(EditorFamily.VsCode), project, file, null));
        Assert.Equal(["/r", "--line", "42", "/r/src/a.ts"], Editors.Arguments(Of(EditorFamily.JetBrains), project, file, 42));
        Assert.Equal(["/r", "/r/src/a.ts"], Editors.Arguments(Of(EditorFamily.JetBrains), project, file, null));
        Assert.Equal(["/r", "/r/src/a.ts:42"], Editors.Arguments(Of(EditorFamily.Zed), project, file, 42));
        Assert.Equal(["/r", "/r/src/a.ts:42"], Editors.Arguments(Of(EditorFamily.Sublime), project, file, 42));
        Assert.Equal(["/Edit", "/r/src/a.ts"], Editors.Arguments(Of(EditorFamily.VisualStudio), project, file, 42));
        Assert.Equal(["-n42", "/r/src/a.ts"], Editors.Arguments(Of(EditorFamily.NotepadPlusPlus), project, file, 42));
    }
}
