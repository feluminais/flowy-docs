using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The bar over the canvas: the repo's other models, the breadcrumb of the level you are in, the edit tools, and on the right the problems, the line style, Search, the shortcut list and the edit switch.
/// It draws what it is told and says what was pressed; what a press does is the reader's.
/// </summary>
internal sealed class TopBar : Border
{
    private readonly StackPanel _draftMark = new() { Orientation = Orientation.Horizontal, Spacing = 4, VerticalAlignment = VerticalAlignment.Center }; // inside a draft: the model it belongs to, and Draft; in the bar only there
    private StackPanel? _left;
    private readonly Button _ownerButton = new() { Classes = { "crumb" } };
    private readonly StackPanel _crumbs = new() { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
    private readonly ComboBox _linePicker = new();
    private readonly ComboBox _modelPicker = new() { IsVisible = false }; // the repo's other models; only there when it has several
    private readonly Button _searchButton = new();
    private readonly Button _helpButton = new();
    private readonly Button _problemsButton = new();
    private readonly Button _editButton = new();
    private readonly Button _addButton = new();
    private readonly Button _newFlowButton = new();
    private readonly Button _undoButton = new();
    private readonly Button _redoButton = new();
    private readonly Button _tidyButton = new();
    private readonly StackPanel _editTools = new() { Orientation = Orientation.Horizontal, Spacing = 2, IsVisible = false, VerticalAlignment = VerticalAlignment.Center };
    private IReadOnlyList<ModelEntry> _models = [];
    private string? _dir;
    private bool _syncing;

    public TopBar()
    {
        AreaStyles.Add(this, "TopBar");
        Classes.Add("bar");
        Child = Build();
    }

    /// <summary>Another model of the repo was picked, by its folder.</summary>
    public event Action<string>? ModelPicked;

    /// <summary>The name of the model a draft belongs to was pressed: back to the model.</summary>
    public event Action? OwnerClicked;

    /// <summary>A line style was picked: "straight", "curved" or "angled".</summary>
    public event Action<string>? LinesChosen;

    public event Action? SearchClicked;

    public event Action? HelpClicked;

    public event Action? EditClicked;

    public event Action? AddClicked;

    public event Action? NewFlowClicked;

    public event Action? UndoClicked;

    public event Action? RedoClicked;

    public event Action? TidyClicked;

    /// <summary>A level of the breadcrumb was pressed.</summary>
    public event Action<string>? CrumbClicked;

    /// <summary>A problem in the list was pressed.</summary>
    public event Action<Problem>? ProblemClicked;

    internal ComboBox ModelPicker => _modelPicker;

    /// <summary>The model's name in the draft mark, or null when this is no draft. For a test.</summary>
    internal string? DraftOf => _draftMark.Parent is not null ? AutomationProperties.GetName(_ownerButton) : null;

    internal Button OwnerButton => _ownerButton;

    internal ComboBox LinePicker => _linePicker;

    internal Button ProblemsButton => _problemsButton;

    internal bool EditToolsVisible => _editTools.IsVisible;

    private Control Build()
    {
        // Undo and redo are only their arrows; the rest say what they do.
        void Make(Button button, string icon, string? text, string name, string tip, Action click)
        {
            button.Classes.Add("tool");
            Chrome.Fill(button, icon, text, name);
            ToolTip.SetTip(button, tip);
            button.Click += (_, _) => click();
        }
        Make(_editButton, Icons.Pencil, "Edit", "Edit", "Edit mode (E)", () => EditClicked?.Invoke());
        Make(_addButton, Icons.Plus, "Add", "Add", "Add a shape here (N)", () => AddClicked?.Invoke());
        Make(_newFlowButton, Icons.Route, "New flow", "New flow", "Record a flow", () => NewFlowClicked?.Invoke());
        Make(_undoButton, Icons.Undo, null, "Undo", "Undo the last change (Ctrl+Z)", () => UndoClicked?.Invoke());
        Make(_redoButton, Icons.Redo, null, "Redo", "Redo what you undid (Ctrl+Y or Ctrl+Shift+Z)", () => RedoClicked?.Invoke());
        Make(_tidyButton, Icons.Grid, "Tidy", "Tidy", "Lay this view out again", () => TidyClicked?.Invoke());
        foreach (var b in new[] { _newFlowButton, _addButton, _undoButton, _redoButton, _tidyButton }) _editTools.Children.Add(b);
        _linePicker.Items.Add("Lines: straight");
        _linePicker.Items.Add("Lines: curved");
        _linePicker.Items.Add("Lines: right-angled");
        _linePicker.SelectedIndex = 0;
        _linePicker.SelectionChanged += (_, _) =>
        {
            if (_syncing) return;
            LinesChosen?.Invoke(_linePicker.SelectedIndex switch { 1 => "curved", 2 => "angled", _ => "straight" });
        };
        _searchButton.Classes.Add("tool");
        Chrome.Fill(_searchButton, Icons.Search, "Search");
        ToolTip.SetTip(_searchButton, "Find a shape (Ctrl+K or /)");
        _searchButton.Click += (_, _) => SearchClicked?.Invoke();
        _helpButton.Classes.Add("tool");
        Chrome.Fill(_helpButton, Icons.Keyboard, null, "Keyboard shortcuts");
        ToolTip.SetTip(_helpButton, "Keyboard shortcuts (?)");
        _helpButton.Click += (_, _) => HelpClicked?.Invoke();
        _problemsButton.Classes.Add("problems");
        _problemsButton.IsVisible = false;

        Chrome.FlatPicker(_linePicker);
        Chrome.FlatPicker(_modelPicker);
        Avalonia.Automation.AutomationProperties.SetName(_modelPicker, "Model");
        ToolTip.SetTip(_modelPicker, "Switch to another model in this repo");
        _modelPicker.SelectionChanged += (_, _) =>
        {
            if (_syncing || _modelPicker.SelectedIndex < 0 || _modelPicker.SelectedIndex >= _models.Count) return;
            var picked = _models[_modelPicker.SelectedIndex];
            if (_dir is not null && ModelFolders.Key(picked.Dir) != ModelFolders.Key(_dir)) ModelPicked?.Invoke(picked.Dir);
            ShowModels(_models, _dir); // this window stays on its own model; the picked one opens in its own window
        };
        _ownerButton.Click += (_, _) => OwnerClicked?.Invoke();
        ToolTip.SetTip(_ownerButton, "Back to the model");
        _draftMark.Children.Add(_ownerButton);
        _draftMark.Children.Add(DraftChip());
        var left = _left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, VerticalAlignment = VerticalAlignment.Center, Children = { _modelPicker, _crumbs, _editTools } };
        var right = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, HorizontalAlignment = HorizontalAlignment.Right, Children = { _problemsButton, _linePicker, _searchButton, _helpButton, _editButton } };
        var dock = new DockPanel { LastChildFill = false };
        DockPanel.SetDock(right, Dock.Right);
        dock.Children.Add(right);
        dock.Children.Add(left);
        return dock;
    }

    /// <summary>The chip that says this is a draft: its icon and the word Draft, in the accent, inside a dashed outline.</summary>
    private static Control DraftChip()
    {
        var icon = Icons.Make(Icons.Draft, "draftmark", 14);
        icon.VerticalAlignment = VerticalAlignment.Center;
        var word = new TextBlock { Text = "Draft", VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 0, 1), Classes = { "draftmark" } };
        var outline = new Avalonia.Controls.Shapes.Rectangle { RadiusX = 11, RadiusY = 11 };
        outline.Classes.Add("draftmark");
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, Margin = new Thickness(9, 3), Children = { icon, word } };
        var chip = new Grid { VerticalAlignment = VerticalAlignment.Center, Children = { outline, row } };
        AutomationProperties.SetName(chip, "Draft");
        return chip;
    }

    /// <summary>Inside a draft: the name of the model it belongs to, which leads back, and the Draft chip. Null outside one.</summary>
    internal void ShowDraft(string? modelName)
    {
        _left!.Children.Remove(_draftMark);
        if (modelName is null) return;
        _left.Children.Insert(_left.Children.IndexOf(_crumbs), _draftMark);
        _ownerButton.Content = new TextBlock { Text = modelName, VerticalAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(_ownerButton, modelName);
    }

    /// <summary>The picker's items and the one selected: this window's model. A name another model shares shows its folder too.</summary>
    internal void ShowModels(IReadOnlyList<ModelEntry> models, string? dir)
    {
        _models = models;
        _dir = dir;
        _syncing = true;
        _modelPicker.ItemsSource = _models.Select(m => _models.Count(o => o.Name == m.Name) > 1 ? $"{m.Name} ({m.Where})" : m.Name).ToList();
        _modelPicker.SelectedIndex = _dir is null ? -1 : _models.ToList().FindIndex(m => ModelFolders.Key(m.Dir) == ModelFolders.Key(_dir));
        _modelPicker.IsVisible = _models.Count > 1 && _modelPicker.SelectedIndex >= 0;
        _syncing = false;
    }

    /// <summary>The breadcrumb: the levels from the overview to <paramref name="view"/>.</summary>
    internal void ShowCrumbs(Model model, string view)
    {
        _crumbs.Children.Clear();
        foreach (var id in Views.Chain(model, view).AsEnumerable().Reverse())
        {
            var first = _crumbs.Children.Count == 0;
            if (!first)
            {
                var chevron = Icons.Make(Icons.ChevronRight, "crumbsep", 14);
                chevron.Margin = new Thickness(2, 2, 2, 0);
                chevron.VerticalAlignment = VerticalAlignment.Center;
                _crumbs.Children.Add(chevron);
            }
            // The overview, where it all starts, is a house; the boxes zoomed into after it are only their names.
            var label = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 7 };
            if (first) label.Children.Add(Pushed(Icons.Make(Icons.Home, "crumbicon", 16)));
            label.Children.Add(new TextBlock { Text = Views.NameOf(model, id), VerticalAlignment = VerticalAlignment.Center });
            var crumb = new Button { Content = label, IsEnabled = id != view };
            Avalonia.Automation.AutomationProperties.SetName(crumb, Views.NameOf(model, id));
            crumb.Classes.Add("crumb");
            var target = id;
            crumb.Click += (_, _) => CrumbClicked?.Invoke(target);
            _crumbs.Children.Add(crumb);
        }
    }

    /// <summary>The line picker. Its list never changes: a pick redraws from inside its own SelectionChanged, and clearing its items there throws.</summary>
    internal void ShowLines(string style, string tip)
    {
        _syncing = true;
        _linePicker.SelectedIndex = style switch { "curved" => 1, "angled" => 2, _ => 0 };
        ToolTip.SetTip(_linePicker, tip);
        _syncing = false;
    }

    internal void ShowProblems(IReadOnlyList<Problem> problems)
    {
        _problemsButton.IsVisible = problems.Count > 0;
        Chrome.Fill(_problemsButton, Icons.Alert, $"{problems.Count} problem{(problems.Count == 1 ? "" : "s")}");
        // The list is made when it is opened, not on every step: a model can have thousands of problems, and the flyout is shut nearly always.
        var flyout = new Flyout { Placement = PlacementMode.BottomEdgeAlignedLeft };
        flyout.Opening += (_, _) =>
        {
            var list = new StackPanel { Spacing = 0, MaxWidth = 380 };
            Paging.Fill(list, problems, p =>
            {
                var row = new Button { Content = new TextBlock { Text = $"{p.File}  {p.Message}", TextWrapping = TextWrapping.Wrap } };
                row.Classes.Add("result");
                row.Click += (_, _) =>
                {
                    flyout.Hide();
                    ProblemClicked?.Invoke(p);
                };
                return row;
            });
            flyout.Content = new ScrollViewer { Content = list, MaxHeight = 420 };
        };
        _problemsButton.Flyout = flyout;
    }

    /// <summary>What the bar shows for edit mode: the tools while editing, the switch pressed, and Undo and Redo when there is something to take back or do again.</summary>
    internal void ShowEdit(bool editing, bool canSwitch, bool canUndo, bool canRedo)
    {
        _editTools.IsVisible = editing;
        _editButton.IsEnabled = canSwitch;
        if (editing) _editButton.Classes.Add("pressed");
        else _editButton.Classes.Remove("pressed");
        _undoButton.IsEnabled = canUndo;
        _redoButton.IsEnabled = canRedo;
    }

    /// <summary>An icon beside words, a little lower than the middle of its line, where the words' own middle is.</summary>
    private static Control Pushed(Control icon)
    {
        icon.Margin = new Thickness(0, 2, 0, 0);
        return icon;
    }
}
