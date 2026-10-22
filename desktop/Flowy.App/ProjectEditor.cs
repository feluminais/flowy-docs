using Avalonia.Controls;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>The Overview in edit mode: the system's name and what it is (the <c>name:</c> and <c>about:</c> of model.yaml), under the same heading and counts as the reading view.</summary>
internal sealed class ProjectEditor : StackPanel
{
    private readonly TextBlock _title;
    private readonly TextBlock _summary;
    private readonly FieldBox _name;
    private readonly FieldBox _about;

    public ProjectEditor(SidePanel owner, EditRun run)
    {
        Spacing = 14;
        _title = (TextBlock)owner.Heading("Overview");
        _summary = (TextBlock)owner.Muted("");
        _name = new FieldBox("Name", "", false, v => run(d => EditOps.SetProject(d, name: v)));
        _about = new FieldBox("About (Markdown)", "", true, v => run(d => EditOps.SetProject(d, about: v)));
        Children.Add(_title);
        Children.Add(_summary);
        Children.Add(Chrome.Section(Icons.Pencil, "Details"));
        Children.Add(new StackPanel { Spacing = 12, Children = { _name, _about } });
    }

    internal FieldBox NameField => _name;

    internal FieldBox AboutField => _about;

    internal string Title => _title.Text ?? "";

    public void Update(Model model, OutlineTotals totals)
    {
        _title.Text = model.ProjectName == "" ? "Overview" : model.ProjectName;
        _summary.Text = SidePanel.Summary(totals);
        _name.Sync(model.ProjectName);
        _about.Sync(model.ProjectAbout);
    }
}
