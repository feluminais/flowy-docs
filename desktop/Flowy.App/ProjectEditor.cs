using Avalonia.Controls;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>The Overview in edit mode: the system's name and what it is (the <c>name:</c> and <c>about:</c> of model.yaml) and whether a pair of shapes is drawn as one line or a line for each connection (<c>pairs:</c>), under the same heading and counts as the reading view.</summary>
internal sealed class ProjectEditor : StackPanel
{
    private readonly TextBlock _title;
    private readonly TextBlock _summary;
    private readonly FieldBox _name;
    private readonly FieldBox _about;
    private readonly Chooser _pairs;

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
        _pairs = Pick.PairTiles("merged", id => run(d => EditOps.SetPairs(d, id)));
        Children.Add(new StackPanel { Spacing = 12, Children = { _name, _about, _pairs } });
    }

    internal FieldBox NameField => _name;

    internal FieldBox AboutField => _about;

    /// <summary>The two tiles of the lines between two shapes, for tests.</summary>
    internal Chooser PairsChoice => _pairs;

    internal string Title => _title.Text ?? "";

    public void Update(Model model, OutlineTotals totals)
    {
        _title.Text = model.ProjectName == "" ? "Overview" : model.ProjectName;
        _summary.Text = SidePanel.Summary(totals);
        _name.Sync(model.ProjectName);
        _about.Sync(model.ProjectAbout);
        _pairs.Show(model.Pairs);
    }
}
