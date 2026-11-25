using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// What a reader opens code paths with: the folder that holds flowy/ on disk, the repository's page for it (GitHub or GitLab), the editor picked
/// under File › Open Code In, and how a link is started. <see cref="Changed"/> tells the paths on show to draw their buttons again.
/// </summary>
internal sealed class SourceOpener(Func<string?> root, Func<string?> codeBase, Func<EditorApp?> editor, Func<LinkAction, Task> run)
{
    public string? Root => root();

    public string? CodeBase => codeBase();

    public EditorApp? Editor => editor();

    public event Action? Changed;

    public void Refresh() => Changed?.Invoke();

    public Task Run(LinkAction action) => run(action);

    /// <summary>The repository's page for a path, at its line (#L42 on both hosts), or null when the repo is on neither or the address isn't safe to open.</summary>
    public string? PageOf(CodeRef at) =>
        CodeBase is { } baseUrl && baseUrl + CodeLinks.EncodePath(at.Path) + (at.Line is { } n ? $"#L{n}" : "") is var page && WebAddress.IsSafe(page) ? page : null;

    /// <summary>The host's name, as its button says it: GitLab for gitlab.com, else GitHub.</summary>
    public string? RemoteName => CodeBase is null ? null : CodeBase.StartsWith("https://gitlab.com/", StringComparison.Ordinal) ? "GitLab" : "GitHub";

    /// <summary>
    /// What the editor button does with a path: open the file in the editor, the project with it, at its line; show a folder in the file explorer; or,
    /// with no editor on this computer, show the file in its folder. Null for a path that is not inside the repo on disk (the checks report one that is missing).
    /// </summary>
    public LinkAction? EditAction(CodeRef at)
    {
        if (Root is not { } repo || LinkOpening.Locate(repo, at.Path) is not { } real) return null;
        if (Directory.Exists(real)) return new LinkAction(LinkKind.Folder, real);
        if (Editor is not { } app) return new LinkAction(LinkKind.ShowInFolder, real);
        return new LinkAction(LinkKind.Editor, real, app.Program) { Arguments = Editors.Arguments(app, Path.GetFullPath(repo), real, at.Line) };
    }
}

/// <summary>
/// The paths a <c>code</c> list holds, each as text with a button for each place it opens: the editor picked under File › Open Code In (the project with
/// the file focused, at its line), and GitHub or GitLab. A folder, or a file on a computer with no editor, has Show in folder instead. The reader it sits
/// in hands it its <see cref="SourceOpener"/> through <see cref="OpenerProperty"/>, so a panel builds one without knowing where it will be shown.
/// The browser draws the same (ui/src/Source.tsx).
/// </summary>
internal sealed class SourceList : StackPanel
{
    /// <summary>The words on the list, its buttons and its edit field, as the browser has them.</summary>
    internal static class Words
    {
        public const string Title = "Source";
        public const string ShowInFolder = "Show in folder";
        public const string Field = "Files and folders (one per line)";
        public const string Example = "src/api/orders.ts:42";
    }

    public static readonly AttachedProperty<SourceOpener?> OpenerProperty = AvaloniaProperty.RegisterAttached<SourceList, Control, SourceOpener?>("Opener", inherits: true);

    public static void SetOpener(Control control, SourceOpener? opener) => control.SetValue(OpenerProperty, opener);

    /// <summary>A <c>code</c> list as its edit field shows it: one entry a line, the text ones only (the checks report the rest).</summary>
    public static string FieldText(object? code) => code is List<object?> list ? string.Join('\n', list.OfType<string>()) : "";

    /// <summary>The edit field of a <c>code</c> list: one path a line, <c>path:line</c> for a line of a file. A blank line is no path, and an empty field takes the list off.</summary>
    public static FieldBox Field(object? code, Func<IReadOnlyList<string>, Task<bool>> save) =>
        new(Words.Field, FieldText(code), true, v => save([.. v.Split('\n').Select(l => l.Trim()).Where(l => l != "")]), Words.Example);

    private readonly List<CodeRef> _paths;
    private readonly StackPanel _rows = new() { Spacing = 0 };
    private SourceOpener? _opener;

    private SourceList(List<CodeRef> paths, string title, bool bare)
    {
        _paths = paths;
        Spacing = 6;
        if (!bare) Children.Add(Chrome.Section(Icons.Folder, title, paths.Count));
        Children.Add(_rows);
        AutomationProperties.SetName(this, title);
        Build();
    }

    /// <summary>The list for a <c>code</c> list as the file held it, or null when it holds no path. <paramref name="bare"/> leaves the heading out (under a step, which already says what it is).</summary>
    public static Control? Of(object? code, string title = Words.Title, bool bare = false) => CodeRefs.Of(code) is { Count: > 0 } paths ? new SourceList(paths, title, bare) : null;

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        _opener = GetValue(OpenerProperty);
        if (_opener is not null) _opener.Changed += Build;
        Build();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        if (_opener is not null) _opener.Changed -= Build;
        _opener = null;
        base.OnDetachedFromVisualTree(e);
    }

    private void Build()
    {
        _rows.Children.Clear();
        foreach (var at in _paths) _rows.Children.Add(Row(at, _opener));
    }

    /// <summary>One path: an icon, the path as text to read and select, then its buttons.</summary>
    internal static Control Row(CodeRef at, SourceOpener? opener)
    {
        var icon = Icons.Make(at.Path.EndsWith('/') ? Icons.Folder : Icons.File, "rowicon", 16);
        icon.VerticalAlignment = VerticalAlignment.Center;
        var text = new SelectableTextBlock { Text = at.ToString(), FontFamily = Fonts.Mono, FontSize = 13, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center };
        var buttons = Buttons(at, opener);
        var grid = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], ColumnSpacing = 10, Children = { icon, text, buttons } };
        Grid.SetColumn(text, 1);
        Grid.SetColumn(buttons, 2);
        var row = new Border { Child = grid };
        row.Classes.Add("row");
        return row;
    }

    /// <summary>The buttons that open one path: the editor (or Show in folder), then GitHub or GitLab. None until the reader's opener is known.</summary>
    internal static StackPanel Buttons(CodeRef at, SourceOpener? opener)
    {
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        if (opener is null) return buttons;
        if (opener.EditAction(at) is { } edit)
        {
            var name = edit.Kind == LinkKind.Editor ? opener.Editor!.Name : Words.ShowInFolder;
            buttons.Children.Add(Button(edit.Kind == LinkKind.Editor ? Icons.FileCode : Icons.Folder, name, edit.Kind == LinkKind.Editor ? $"Open in {name}" : null, () => opener.Run(edit)));
        }
        if (RemoteButton(at, opener) is { } remote) buttons.Children.Add(remote);
        return buttons;
    }

    /// <summary>The GitHub or GitLab button for a path, or null when the repo is on neither.</summary>
    internal static Button? RemoteButton(CodeRef at, SourceOpener? opener) =>
        opener?.PageOf(at) is { } page && opener.RemoteName is { } host
            ? Button(host == "GitLab" ? Icons.GitLab : Icons.GitHub, host, null, () => opener.Run(new LinkAction(LinkKind.Web, page)))
            : null;

    private static Button Button(string icon, string text, string? tip, Func<Task> click)
    {
        var button = new Button();
        button.Classes.Add("tool");
        button.Classes.Add("open");
        Chrome.Fill(button, icon, text);
        if (tip is not null) ToolTip.SetTip(button, tip);
        button.Click += async (_, _) => await click();
        return button;
    }
}
