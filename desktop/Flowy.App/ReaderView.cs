using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// A model folder on screen: the top bar, the canvas, and what sits over it (the side panel, the flow player, search, the shortcut list).
/// It holds what the reader has chosen: the view they are in, the box or line open in the panel, the flow playing and its step, the line
/// the pointer is on.
/// </summary>
internal sealed partial class ReaderView : Grid
{
    private const int DoubleClickMilliseconds = 250;

    // Opening a box: the old level flies off, the new one settles in. The browser version takes 220 and 320 ms, but there the browser's
    // compositor runs it; here every frame is the UI thread's work, and a shorter move hides any hitch in it.
    private const double LeaveMilliseconds = 140;
    private const double ArriveMilliseconds = 230;

    private enum SideKind { Object, Objects, Line, Add, Flow }

    /// <summary><c>Objects</c> is several boxes picked in edit mode, to move or delete together: their ids are in <c>Ids</c>.</summary>
    private sealed record Side(SideKind Kind, string? Id = null, string? From = null, string? To = null, string? FlowName = null, IReadOnlyList<string>? Ids = null);

    private readonly CanvasView _canvas = new();
    private readonly Border _motionHost;
    private readonly StackPanel _empty;
    private readonly TextBlock _emptyTitle = new() { Text = "Nothing to show yet", FontSize = 18, FontWeight = FontWeight.SemiBold, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly TextBlock _emptyBody = new() { TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, Classes = { "muted" } };
    private readonly SidePanel _panel = new();
    private readonly PerfPanel _perfPanel = new();
    private readonly PlayerCard _player = new();
    private readonly PickedBar _pickedBar = new();
    private readonly Grid _overlay = new();
    private readonly Border _banner = new();
    private readonly TextBlock _bannerText = new() { TextWrapping = TextWrapping.Wrap };
    private readonly StackPanel _crumbs = new() { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
    private readonly NavigatorPanel _nav = new();
    private readonly NavRail _rail = new(true); // the navigator's, on the left
    private readonly NavRail _detailsRail = new(false); // Details', on the right
    private readonly Sash _navSash = new(true, "Resize the navigator");
    private readonly Sash _detailsSash = new(false, "Resize the details panel");
    private Control? _zoomButtons;
    private readonly ComboBox _linePicker = new();
    private readonly Button _searchButton = new();
    private readonly Button _helpButton = new();
    private readonly Button _problemsButton = new();

    private Folder? _folder;
    private string? _codeBase;
    private string? _repoRoot;
    private string _view = Names.Root;
    private Side? _side; // what is picked: it shows in Details
    private PanelTab? _tab; // the navigator's tab (Flows or Explorer), chosen on its rail or its strip; null: the navigator is closed
    private bool _navUsed; // the navigator is where the reader last clicked or opened something: Escape closes it then, and leaves it alone once they work in the diagram
    private bool _details; // Details was opened from its rail, to show the level you are in; a pick opens it too
    private double _navWidth = Camera.Nav; // dragged by the sashes on the panels' edges
    private double _detailsWidth = Camera.Panel;
    private readonly HashSet<string> _expanded = [Names.Root]; // the shapes whose children show in the Explorer; the project's own row starts open
    private (Model Model, bool Editing, OutlineTotals Totals)? _totals;

    /// <summary>The flow playing, the stop it is at (see <see cref="Structure.Stops"/>), and the places it was opened from.</summary>
    private sealed record Playhead(string Flow, int Step, IReadOnlyList<FlowPlace> Trail);

    private Playhead? _playing;
    private readonly System.Runtime.CompilerServices.ConditionalWeakTable<Flow, IReadOnlyList<Stop>> _stops = new(); // a flow's stops, made once for as long as that flow is the one in the model
    private string? _hover;
    private string? _ownLines; // this reader's own pick of line style
    private string _fitKey = "";
    private bool _syncing;
    private SearchBox? _search;
    private ShortcutsCard? _shortcuts;
    private Notice? _notice;
    private DispatcherTimer? _opening; // a click on a box that opens, waiting out the double-click window
    private string? _openingBox; // that box: a Ctrl+click in the meantime still counts it as picked
    private IDisposable? _motion;
    private bool _moving;

    public event Action<string?>? LinesPicked;

    /// <summary>The app the person chose to open linked files with, or null for the system's default. Read at every click.</summary>
    internal Func<string?> CustomApp { get; set; } = () => null;

    /// <summary>What carries out a link's action; null means <see cref="LinkLauncher"/>. A test sets it to see what would be opened. Returns what went wrong, or null.</summary>
    internal Func<LinkAction, Task<string?>>? LinkRunner { get; set; }

    public ReaderView()
    {
        RowDefinitions = [new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Auto), new RowDefinition(GridLength.Star)];

        _banner.Classes.Add("banner");
        _banner.Child = _bannerText;
        _banner.IsVisible = false;
        SetRow(_banner, 0);
        Children.Add(_banner);

        var bar = new Border { Child = BuildBar() };
        bar.Classes.Add("bar");
        SetRow(bar, 1);
        Children.Add(bar);

        _motionHost = new Border { ClipToBounds = true, Child = _canvas };
        _empty = new StackPanel
        {
            Spacing = 6, IsVisible = false, IsHitTestVisible = false, MaxWidth = 440,
            HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
            Children = { _emptyTitle, _emptyBody },
        };
        _zoomButtons = ZoomButtons();
        var stage = new Grid { Children = { _motionHost, _empty, _zoomButtons, _panel, _nav, _navSash, _detailsSash, _player, _pickedBar, _overlay } };
        var beside = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star), new ColumnDefinition(GridLength.Auto)], Children = { _rail, stage, _detailsRail } };
        SetColumn(stage, 1);
        SetColumn(_detailsRail, 2);
        SetRow(beside, 2);
        Children.Add(beside);

        _canvas.BoxClicked += BoxClicked;
        _canvas.BoxToggled += ToggleBox;
        _canvas.BoxesPicked += PickBoxes;
        _pickedBar.DeleteRequested += () => _ = DeleteSelectedAsync();
        _pickedBar.ClearRequested += ClearPicked;
        _canvas.BoxesMoved += moved => _ = MoveBoxesAsync(moved);
        _canvas.ConnectRequested += (from, to) => _ = ConnectAsync(from, to);
        _canvas.BoxDoubleClicked += id =>
        {
            if (CanOpen(id)) ZoomInto(id);
        };
        _canvas.EdgeClicked += id =>
        {
            if (_folder is null) return;
            _undoMove = false;
            _opening?.Stop();
            var edge = Scene()?.Edges.FirstOrDefault(e => e.Id == id);
            if (edge is null) return;
            if (_side is { Kind: SideKind.Line } line && line.From == edge.From && line.To == edge.To)
            {
                CloseDetails(); // its panel is already open: a second click closes it
                return;
            }
            _side = new Side(SideKind.Line, From: edge.From, To: edge.To);
            Refresh();
        };
        _canvas.EdgeHovered += id => SetHover(id);
        _canvas.PaneClicked += PaneClicked;
        _canvas.FrameClicked += () =>
        {
            // While a flow is recorded, or a load shows, the outline is just empty canvas: the panel has its own work.
            if (Recording is not null || PerfOpen) PaneClicked();
            else ShowLevel();
        };
        _panel.Closed += () =>
        {
            if (PerfOpen) ClosePerf();
            else CloseDetails();
        };
        WirePerformance();
        _nav.Tabs.Picked += SetTab;
        _nav.Closed += CloseNav;
        _rail.Picked += ToggleTab;
        _detailsRail.Picked += ToggleTab;
        _navSash.Current = () => _navWidth;
        _navSash.Resized += w => ResizeNav(w);
        _navSash.Reset += () => ResizeNav(Camera.Nav);
        _navSash.Settled += Remember;
        _detailsSash.Current = () => _detailsWidth;
        _detailsSash.Resized += w => ResizeDetails(w);
        _detailsSash.Reset += () => ResizeDetails(Camera.Panel);
        _detailsSash.Settled += Remember;
        _nav.Flows.Opened += flow => OpenFlow(flow.Id);
        _nav.Explorer.Picked += PickRow;
        _nav.Explorer.Opened += OpenRow;
        _nav.Explorer.Toggled += ToggleOpen;
        _player.Back += () => StepTo(StopIndex() - 1);
        _player.Next += () => StepTo(StopIndex() + 1);
        _player.Stop += Stop;
        _player.Auto += ToggleAuto;
        _player.Replay += Replay;
        _player.OpenFlow += OpenLinked;
        _player.BackToFlow += GoBack;

        Focusable = true;
        // Every press, handled or not (the canvas handles its own): it says which half the reader is working in.
        AddHandler(PointerPressedEvent, OnPointerDown, RoutingStrategies.Tunnel, handledEventsToo: true);
        // On the whole window, so keys work wherever the focus happens to be: a click on a button must not switch the shortcuts off.
        AttachedToVisualTree += (_, _) => TopLevel.GetTopLevel(this)?.AddHandler(KeyDownEvent, OnKeyDown, RoutingStrategies.Bubble);
        DetachedFromVisualTree += (_, e) => (e.RootVisual as Interactive)?.RemoveHandler(KeyDownEvent, OnKeyDown);
        ActualThemeVariantChanged += (_, _) => Refresh();
    }

    public Folder? Folder => _folder;

    // What a test can look at.
    internal string? SelectedBoxId => SelectedBox;
    internal bool HasPanel => ShownTab is not null || RightOpen;
    internal bool IsMoving => _moving;
    internal bool ShowsEmptyNote => _empty.IsVisible;
    internal string? BannerText => _banner.IsVisible ? _bannerText.Text : null;
    internal string? PlayingFlowId => PlayingFlow()?.Id;
    internal int PlayingStep => StopIndex();
    internal PlayerCard Card => _player;
    internal bool ShortcutsOpen => _shortcuts is not null;
    internal bool SearchOpen => _search is not null;

    /// <summary>Sets this reader's own line style: "straight", "curved" or "angled" (anything else goes back to the project's).</summary>
    public void PickLines(string? style)
    {
        _ownLines = style is "straight" or "curved" or "angled" ? style : null;
        Refresh();
    }

    public string View => _view;

    public CanvasView Canvas => _canvas;

    public string LineStyle => Editing ? _folder?.Model.LineStyle ?? "straight" : _ownLines ?? _folder?.Model.LineStyle ?? "straight";

    private Control BuildBar()
    {
        BuildEditBar();
        _linePicker.Items.Add("Lines: straight");
        _linePicker.Items.Add("Lines: curved");
        _linePicker.Items.Add("Lines: right-angled");
        _linePicker.SelectedIndex = 0;
        _linePicker.SelectionChanged += (_, _) =>
        {
            if (_syncing) return;
            var style = _linePicker.SelectedIndex switch { 1 => "curved", 2 => "angled", _ => "straight" };
            if (Editing)
            {
                // In edit mode the picker sets the project's style, which everyone sees (lines: in model.yaml).
                _ = RunAsync(d => EditOps.SetLines(d, style));
                return;
            }
            _ownLines = style == (_folder?.Model.LineStyle ?? "straight") ? null : style; // the project's own style isn't kept as a pick: the screen follows the project again
            LinesPicked?.Invoke(_ownLines);
            Refresh();
        };
        _searchButton.Classes.Add("tool");
        Chrome.Fill(_searchButton, Icons.Search, "Search");
        ToolTip.SetTip(_searchButton, "Search shapes and flows (Ctrl+K)");
        _searchButton.Click += (_, _) => ToggleSearch();
        _helpButton.Classes.Add("tool");
        Chrome.Fill(_helpButton, Icons.Keyboard, null, "Keyboard shortcuts");
        ToolTip.SetTip(_helpButton, "Keyboard shortcuts (?)");
        _helpButton.Click += (_, _) => ToggleShortcuts();
        _problemsButton.Classes.Add("problems");
        _problemsButton.IsVisible = false;

        _linePicker.Classes.Add("flat");
        var left = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, VerticalAlignment = VerticalAlignment.Center, Children = { _crumbs, _editTools } };
        var right = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2, HorizontalAlignment = HorizontalAlignment.Right, Children = { _linePicker, _searchButton, _helpButton, _problemsButton, _editButton } };
        var dock = new DockPanel { LastChildFill = false };
        DockPanel.SetDock(right, Dock.Right);
        dock.Children.Add(right);
        dock.Children.Add(left);
        return dock;
    }

    private Control ZoomButtons()
    {
        Button Make(string icon, string name, Action click)
        {
            var b = new Button { Content = Icons.Make(icon, "zoomicon", 16) };
            b.Classes.Add("zoom");
            b.Click += (_, _) => click();
            Avalonia.Automation.AutomationProperties.SetName(b, name);
            ToolTip.SetTip(b, name);
            return b;
        }
        var group = new Border
        {
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(16),
            Child = new StackPanel
            {
                Children =
                {
                    Make(Icons.Plus, "Zoom in", () => _canvas.ZoomBy(1.25)),
                    Make(Icons.Minus, "Zoom out", () => _canvas.ZoomBy(0.8)),
                    Make(Icons.Fit, "Fit the view", FitNow),
                },
            },
        };
        group.Classes.Add("zoomgroup");
        return group;
    }

    // ---- what is loaded ----------------------------------------------------------------------------------------

    public void Load(Folder folder, string dir)
    {
        _folder = folder;
        WarmCode(folder);
        _session = new EditSession(dir);
        _editMode = false;
        _navUsed = false;
        _view = Names.Root;
        _side = null;
        _details = false;
        _perf = false;
        _ramping = false;
        _playing = null;
        _hover = null;
        _codeBase = null;
        _repoRoot = FolderLoader.RepoRoot(dir);
        SetBanner(null);
        Refresh();
        _ = LoadCodeBase(dir);
        Dispatcher.UIThread.Post(() => Focus());
    }

    /// <summary>Carries out a link's action, and says in a notice if it couldn't. An app that was chosen and has since gone is said so, since the link then opens the default way.</summary>
    private async Task RunLink(LinkAction action)
    {
        if (CustomApp() is { } app && !File.Exists(app))
            ShowNotice("The app chosen for opening links is gone, so links open the default way. Choose another under File > Open Files With.", 6);
        var run = LinkRunner ?? (a => TopLevel.GetTopLevel(this) is { } top ? LinkLauncher.RunAsync(top, a) : Task.FromResult<string?>(null));
        if (await run(action) is { } problem) ShowNotice(problem);
    }

    private async Task LoadCodeBase(string dir)
    {
        var codeBase = await CodeLinks.BaseFor(FolderLoader.RepoRoot(dir));
        if (_folder is null) return;
        _codeBase = codeBase;
        Refresh();
    }

    /// <summary>A model that holds code gets the colouring engine started in the background, so the first panel that shows code does not wait for it.</summary>
    private static void WarmCode(Folder folder)
    {
        if (folder.Model.Objects.Any(o => o.Value.Snippets is List<object?> { Count: > 0 })) Hljs.WarmUp();
    }

    /// <summary>A changed folder arrives: show it, keeping where the reader is as far as it still exists.</summary>
    public void Reload(Folder folder)
    {
        _folder = folder;
        WarmCode(folder);
        if (_side is { Kind: SideKind.Object, Id: { } id } && folder.Model.GetObject(id) is null) _side = null;
        if (_side is { Kind: SideKind.Objects, Ids: { } picked }) _side = SideOf(picked.Where(p => folder.Model.GetObject(p) is not null).ToList()); // boxes that went are no longer picked
        if (!PerfOpen || LoadTest is null) _ramping = false; // a ramp whose run is gone has nothing to run on, and its loop has already ended
        SetBanner(null);
        Refresh();
    }

    public void SetBanner(string? text)
    {
        _banner.IsVisible = text is not null;
        _bannerText.Text = text;
        UpdateEmpty();
    }

    /// <summary>Says what is happening in a card over the canvas. With <paramref name="seconds"/> it goes by itself.</summary>
    public void ShowNotice(string text, double seconds = 0)
    {
        DismissNotice();
        var notice = new Notice(text, DismissNotice) { Margin = NoticeMargin };
        _notice = notice;
        _overlay.Children.Add(notice);
        if (seconds > 0)
            DispatcherTimer.RunOnce(() =>
            {
                if (_notice == notice) DismissNotice();
            }, TimeSpan.FromSeconds(seconds));
    }

    /// <summary>A model with nothing in it shows a few words about what to do, not a blank canvas. A file that can't be read has its banner already.</summary>
    private void UpdateEmpty()
    {
        _empty.IsVisible = _folder is not null && !_banner.IsVisible && (_view == Names.Root || Editing) && _canvas.Scene is { Boxes.Count: 0 };
        _emptyTitle.Text = Editing ? "Nothing here yet" : "Nothing to show yet";
        _emptyBody.Text = Editing
            ? "Press Add to put the first shape here."
            : "Add shapes to model.yaml, or ask Claude to map the repo. They appear here as soon as the file is saved. Press E to draw them yourself.";
    }

    /// <summary>The view on screen, or the flow playing, as Mermaid text in a code fence: what the browser's Mermaid button copies.</summary>
    public string? MermaidText() =>
        _folder is not { } folder ? null : "```mermaid\n" + (PlayingFlow() is { } f ? Mermaid.Flow(folder.Model, f.Id) : Mermaid.View(folder.Model, CurrentView())) + "```\n";

    /// <summary>The diagram as it is on screen, without the bar and the panel, as a PNG at <paramref name="scale"/> times the screen's size.</summary>
    public void SavePicture(string path, double scale = 2)
    {
        var size = _motionHost.Bounds.Size;
        if (size.Width < 1 || size.Height < 1) return;
        var was = _motionHost.Background;
        _motionHost.Background = this.TryFindResource("BgBrush", ActualThemeVariant, out var bg) && bg is IBrush brush ? brush : Brushes.White;
        try
        {
            using var bitmap = new RenderTargetBitmap(new PixelSize((int)Math.Ceiling(size.Width * scale), (int)Math.Ceiling(size.Height * scale)), new Vector(96 * scale, 96 * scale));
            bitmap.Render(_motionHost);
            bitmap.Save(path, PngBitmapEncoderOptions.Default);
        }
        finally
        {
            _motionHost.Background = was;
        }
    }

    /// <summary>The name a picture of what's on screen suggests: the model, then the level.</summary>
    public string PictureName(string model)
    {
        var level = _folder is null ? "" : Views.NameOf(_folder.Model, CurrentView());
        var name = level == "Overview" ? model : $"{model} - {level}";
        return string.Concat(name.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '-' : c));
    }

    private void DismissNotice()
    {
        if (_notice is null) return;
        _overlay.Children.Remove(_notice);
        _notice = null;
    }

    // ---- derived state -----------------------------------------------------------------------------------------

    /// <summary>A box with children opens.</summary>
    private bool CanOpen(string id) => _folder is { } f && (Views.HasChildren(f.Model, id) || (Editing && Checks.TypesIn(f.Model, id).Count > 0));

    /// <summary>The view shown: after a reload the view's object may be gone or empty, and the nearest one that still exists stands in.</summary>
    private string CurrentView() => _folder is null ? Names.Root : Views.Chain(_folder.Model, _view).FirstOrDefault(v => v == Names.Root || CanOpen(v)) ?? Names.Root;

    private string? SelectedBox => _side is { Kind: SideKind.Object } s ? s.Id : null;

    /// <summary>The boxes drawn as selected: the open box, or the two picked for the step being recorded.</summary>
    private IEnumerable<string> SelectedBoxes => Recording is { } r ? new[] { r.From, r.To }.OfType<string>() : _side is { Kind: SideKind.Objects, Ids: { } many } ? many : SelectedBox is { } b ? [b] : [];

    private Scene? Scene() => _canvas.Scene;

    private List<(string Id, Flow Flow)> FlowsHere()
    {
        if (_folder is null) return [];
        var view = CurrentView();
        return _folder.Model.Flows.Where(kv => kv.Value.View == view && (kv.Value.Steps.Count > 0 || Editing)).Select(kv => (kv.Key, kv.Value)).ToList();
    }

    private (string Id, Flow Flow)? PlayingFlow() => Editing || PerfOpen ? null : _playing is { } p && FlowsHere().FirstOrDefault(f => f.Id == p.Flow) is { Flow: not null } found ? found : null;

    /// <summary>What the player steps through: the stops of a flow. A flow with no groups has one for each step.</summary>
    private IReadOnlyList<Stop> StopsOf(Flow flow) => _stops.GetValue(flow, f => Structure.Stops(f));

    private int StopIndex() => PlayingFlow() is { } f && _playing is { } p ? Math.Max(0, Math.Min(p.Step, StopsOf(f.Flow).Count - 1)) : 0;

    // ---- drawing -----------------------------------------------------------------------------------------------

    private void Refresh()
    {
        if (_folder is not { } folder) return;
        var model = folder.Model;
        var view = CurrentView();
        var flow = PlayingFlow();
        var index = StopIndex();
        FollowCanvas(model, view);

        var shown = DrawScene(folder, view, flow, index);
        UpdateEmpty();

        // Fit when the view changes or a flow starts or stops, not on every step.
        var key = $"{view} {flow?.Id}";
        if (key != _fitKey)
        {
            _fitKey = key;
            _canvas.Fit(0, flow is not null);
        }

        RefreshBar(model, view, flow);
        RefreshEdit();
        RefreshPanel(model, view);
        ApplyLoad();
        RefreshPlayer(model, view, flow, index, shown);
        UpdateMotion(model, view, flow, index, shown);
        RefreshNavigator(model, view, flow);
    }

    /// <summary>The canvas alone: what pointing at a line changes. The panel keeps its scroll, its open rows and its selection.</summary>
    private Playing? DrawScene(Folder folder, string view, (string Id, Flow Flow)? flow, int index)
    {
        var model = folder.Model;
        Playing? shown = null;
        if (flow is { } f)
        {
            var stops = StopsOf(f.Flow);
            // A shape that takes a request off the line (`by`) is lit with the step, so it does not sit at the faint level while it flashes.
            var also = stops[index].Steps.SelectMany(i => Animations.Read(f.Flow.Steps[i])?.By is { Shape: { } taker } && Views.PlaceStep(model, view, taker, null) is { } at ? new[] { at.From } : []).ToList();
            shown = new Playing(f.Flow.Steps.Select(s => Views.PlaceStep(model, view, s.From, s.To)).ToList(), null, stops[index].Steps, Structure.OtherLaneSteps(stops, index), also.Count > 0 ? also : null);
        }
        else if (Recording is { } rec) shown = RecordingShown(model, view, rec);
        var line = _side is { Kind: SideKind.Line } l ? SceneBuilder.LineId(l.From!, l.To!) : null;
        var scene = SceneBuilder.Build(model, view, shown, folder.Problems, new Focus(SelectedBox, line, _hover));
        _canvas.SetScene(scene, LineStyle, SelectedBoxes);
        // Where shapes stand at this stop, folded from the flow's start and the steps up to it: nothing is stored, so stepping back needs no undo.
        // While the Performance panel is open a run over time sets the states instead (a flow waits behind the panel).
        _canvas.ShowStates(flow is { } playing ? States.Marks(model, States.At(playing.Flow, StopsOf(playing.Flow), index)) : RunMarks(model));
        return shown;
    }

    private void RefreshBar(Model model, string view, (string Id, Flow Flow)? flow)
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
            crumb.Click += (_, _) => ZoomOut(target);
            _crumbs.Children.Add(crumb);
        }

        _syncing = true;
        SyncLinePicker(model);
        _syncing = false;

        var problems = _folder!.Problems;
        _problemsButton.IsVisible = problems.Count > 0;
        Chrome.Fill(_problemsButton, Icons.Alert, $"{problems.Count} problem{(problems.Count == 1 ? "" : "s")}");
        var list = new StackPanel { Spacing = 0, MaxWidth = 380 };
        foreach (var p in problems)
        {
            var row = new Button { Content = new TextBlock { Text = $"{p.File}  {p.Message}", TextWrapping = TextWrapping.Wrap } };
            row.Classes.Add("result");
            var picked = p;
            row.Click += (_, _) =>
            {
                (_problemsButton.Flyout as Flyout)?.Hide();
                Jump(picked);
            };
            list.Children.Add(row);
        }
        _problemsButton.Flyout = new Flyout { Content = new ScrollViewer { Content = list, MaxHeight = 420 }, Placement = PlacementMode.BottomEdgeAlignedRight };
    }

    /// <summary>An icon beside words, a little lower than the middle of its line, where the words' own middle is.</summary>
    private static Control Pushed(Control icon)
    {
        icon.Margin = new Thickness(0, 2, 0, 0);
        return icon;
    }

    private void RefreshPanel(Model model, string view)
    {
        if (PerfOpen)
        {
            ShowPerfPanel(model, view);
            return;
        }
        switch (_side)
        {
            case { Kind: SideKind.Object, Id: { } id } when Editing:
                _panel.ShowObjectEditor(model, id, _folder!.Problems, RunAsync, OpenObject, SetHover, CloseSide);
                break;
            case { Kind: SideKind.Object, Id: { } id }:
                _panel.ShowObject(model, id, _folder!.Problems, _codeBase, new LinkContext(_repoRoot!, () => CustomApp(), RunLink), OpenObject, SetHover, StateHere(id));
                break;
            case { Kind: SideKind.Line, From: { } from, To: { } to } when Editing:
                _panel.ShowLineEditor(model, view, from, to, _folder!.Problems, RunAsync, CloseSide);
                break;
            case { Kind: SideKind.Line, From: { } from, To: { } to }:
                _panel.ShowLine(model, view, from, to, _folder!.Problems);
                break;
            case { Kind: SideKind.Add } when Editing:
                _panel.ShowAdd(model, view, RunAsync, OpenObject);
                break;
            case { Kind: SideKind.Flow } side when Editing:
                _panel.ShowRecorder(model, view, new Recording(side.Id ?? "", side.FlowName ?? "", side.From, side.To), RunAsync,
                    r => SetRecording(r), name => Navigation.NewId(name, model.Flows.Keys, "flow"), CloseSide);
                break;
            default:
                ShowViewDetails(model, view);
                break;
        }
    }

    /// <summary>The state a shape is in at the stop on show, for Details: null when it is Running or no flow plays.</summary>
    private StateMark? StateHere(string id) => _canvas.StatesShown.GetValueOrDefault(id);

    /// <summary>Details with nothing picked, while its rail button is pressed: the level you are inside, or the project's Overview at the top.</summary>
    private void ShowViewDetails(Model model, string view)
    {
        if (!_details) _panel.Clear();
        else if (view == Names.Root) _panel.ShowOverview(Totals());
        else if (Editing) _panel.ShowObjectEditor(model, view, _folder!.Problems, RunAsync, OpenObject, SetHover, CloseSide);
        else _panel.ShowObject(model, view, _folder!.Problems, _codeBase, new LinkContext(_repoRoot!, () => CustomApp(), RunLink), OpenObject, SetHover);
    }

    private void RefreshPlayer(Model model, string view, (string Id, Flow Flow)? flow, int index, Playing? shown)
    {
        if (flow is not { } f)
        {
            _player.Clear();
            _canvas.SetMarks([]);
            return;
        }
        var stops = StopsOf(f.Flow);
        var stop = stops[index];
        var caption = Captions.Of(f.Flow, stop);
        var steps = stop.Steps.Select((i, n) =>
        {
            var step = f.Flow.Steps[i];
            var ends = step.From is null ? "" : Views.StepEnds(model, step.From, step.To, shown?.Ends[i]);
            var animation = Animations.Read(step);
            var outcome = animation is null ? null : Animations.OutcomeLine(animation, id => Views.NameOf(model, id));
            return new PlayerStep(ends, step.Text ?? "", step.Description, n < caption.Lanes.Count ? caption.Lanes[n] : "", LinkOf(model, step), outcome);
        }).ToList();
        var moves = stop.Steps.Any(i => Animations.Read(f.Flow.Steps[i]) is not null && shown?.Ends[i] is not null);
        (string Name, int Step)? trail = _playing is { Trail.Count: > 0 } here ? TrailBar(model, here.Trail[^1]) : null;
        _player.Show(new PlayerView(string.IsNullOrEmpty(f.Flow.Name) ? f.Id : f.Flow.Name, index, stops.Count, stop.Kind, caption, Captions.ProgressOf(f.Flow, stops), _auto, moves, trail, steps, _canvas.StatesShown.Values.ToList()));
        _canvas.SetMarks(stop.Steps
            .Select((i, n) => (Placed: shown?.Ends[i], Text: n < caption.Marks.Count ? caption.Marks[n] : ""))
            .Where(x => x.Placed is not null && x.Text != "" && stop.Kind is not null)
            .Select(x => new CanvasView.Mark(x.Placed!.Value.From, x.Placed.Value.To, x.Text, stop.Kind!))
            .ToList());
    }

    /// <summary>A step's link to another flow, for the card: null when it has none or the flow isn't there.</summary>
    private static LinkedFlow? LinkOf(Model model, Step step)
    {
        if (Structure.Blank(step.FlowId)) return null;
        var id = Structure.JsTrim(step.FlowId!);
        return model.Flows.TryGetValue(id, out var target) ? new LinkedFlow(id, string.IsNullOrEmpty(target.Name) ? id : target.Name, target.Steps.Count > 0 && Views.IsView(model, target.View)) : null;
    }

    /// <summary>The Back bar's words: the flow the reader came from and the stop they left, one that still exists after a reload.</summary>
    private (string Name, int Step) TrailBar(Model model, FlowPlace left)
    {
        var known = model.Flows.TryGetValue(left.Flow, out var parent);
        var last = known ? StopsOf(parent!).Count - 1 : left.Step;
        return (known && !string.IsNullOrEmpty(parent!.Name) ? parent.Name : left.Flow, Math.Min(left.Step, last) + 1);
    }

    /// <summary>Lights a line as if the pointer were on it.</summary>
    public void SetHover(string? id)
    {
        if (_hover == id) return;
        _hover = id;
        if (_folder is { } folder) DrawScene(folder, CurrentView(), PlayingFlow(), StopIndex());
    }

    // ---- moving about ------------------------------------------------------------------------------------------

    /// <summary>Shows a view straight away: no zoom.</summary>
    public void GoTo(string view)
    {
        if (_folder is null) return;
        _undoMove = false;
        _opening?.Stop();
        _motion?.Dispose();
        _moving = false;
        _canvas.RenderTransform = null;
        _canvas.Opacity = 1;
        _view = view;
        _playing = null;
        StopAuto();
        _hover = null;
        if (_side is { Kind: not SideKind.Object }) _side = null; // lines belong to one view
        Refresh();
    }

    /// <summary>Opens a box the way a double-click does.</summary>
    public void OpenBox(string id)
    {
        if (CanOpen(id)) ZoomInto(id);
    }

    /// <summary>Opens a box from where it sits on screen: zoom in when it's inside this view, slide across when it sits beside it.</summary>
    private void ZoomInto(string id)
    {
        _opening?.Stop();
        _undoMove = false;
        _side = null;
        var rect = _canvas.RectOf(id);
        var origin = rect is { } r ? _canvas.Viewport.ToScreen(r.Center) : new Pt(_canvas.Bounds.Width / 2, _canvas.Bounds.Height / 2);
        ZoomTo(id, Navigation.MoveBetween(_folder!.Model, CurrentView(), id), origin);
    }

    /// <summary>Zooms out to a view, about the middle of the canvas: the box's place in the outer view isn't known until it's drawn.</summary>
    private void ZoomOut(string id) => ZoomTo(id, Navigation.MoveBetween(_folder!.Model, CurrentView(), id), new Pt(_canvas.Bounds.Width / 2, _canvas.Bounds.Height / 2));

    /// <summary>The old view flies off, then the new one settles in. A second move on the way, or reduced motion, goes straight there.</summary>
    private void ZoomTo(string view, Move direction, Pt origin)
    {
        if (_moving || MotionSettings.Reduced)
        {
            GoTo(view);
            return;
        }
        _moving = true;
        // Laying out a big view takes a moment: do it now, behind the old view flying off, so the new one doesn't wait for it.
        if (_folder is { } folder) _ = Task.Run(() => SceneBuilder.Build(folder.Model, view, null, folder.Problems));
        var size = _canvas.Bounds.Size;
        var (ux, uy) = (origin.X - size.Width / 2, origin.Y - size.Height / 2);
        var length = Math.Sqrt(ux * ux + uy * uy);
        var slide = length == 0 ? new Vector(0, 0) : new Vector(ux / length * 0.25 * size.Width, uy / length * 0.25 * size.Height);
        _canvas.RenderTransformOrigin = new RelativePoint(origin.X, origin.Y, RelativeUnit.Absolute);
        _motion = Anim.Run(this, LeaveMilliseconds, Anim.EaseIn, t => Apply(direction, true, t, slide), () =>
        {
            var wasMoving = _moving;
            GoTo(view);
            if (!wasMoving) return;
            _moving = true;
            _canvas.RenderTransformOrigin = new RelativePoint(origin.X, origin.Y, RelativeUnit.Absolute);
            _motion = Anim.Run(this, ArriveMilliseconds, Anim.EaseOut, t => Apply(direction, false, t, slide), () =>
            {
                _moving = false;
                _canvas.RenderTransform = null;
                _canvas.Opacity = 1;
            });
        });
    }

    private void Apply(Move direction, bool leaving, double t, Vector slide)
    {
        static double Lerp(double a, double b, double t) => a + (b - a) * t;
        _canvas.Opacity = leaving ? 1 - t : t;
        if (direction == Move.Across)
        {
            var k = leaving ? -t : 1 - t;
            _canvas.RenderTransform = new TranslateTransform(slide.X * k, slide.Y * k);
            return;
        }
        var scale = direction == Move.In ? (leaving ? Lerp(1, 4, t) : Lerp(0.25, 1, t)) : (leaving ? Lerp(1, 0.25, t) : Lerp(2.5, 1, t));
        _canvas.RenderTransform = new ScaleTransform(scale, scale);
    }

    public void FitNow() => _canvas.Fit(RightOpen ? _detailsWidth : 0, PlayingFlow() is not null, ShownTab is not null ? _navWidth : 0, 220);

    // ---- selecting ---------------------------------------------------------------------------------------------

    private void PaneClicked()
    {
        _opening?.Stop();
        _undoMove = false;
        if (Recording is { } rec)
        {
            _side = _side! with { From = null, To = null };
            Refresh();
            return;
        }
        _side = null;
        Refresh();
        Focus();
    }

    /// <summary>Opens Details on the level you are inside, as its button on the rail does: what a click on the outline round that level does.</summary>
    private void ShowLevel()
    {
        _opening?.Stop();
        _undoMove = false;
        if (_details && _side is null)
        {
            CloseDetails(); // its Details are already showing: a second click closes them
            return;
        }
        _side = null;
        _details = true;
        Refresh();
        Focus();
    }

    private void BoxClicked(string id)
    {
        _opening?.Stop();
        _undoMove = false;
        if (Recording is { } rec)
        {
            PickBox(rec, id);
            return;
        }
        if (_side is { Kind: SideKind.Object, Id: { } open } && open == id)
        {
            CloseDetails(); // its panel is already open: a second click closes it
            return;
        }
        // Zooming into a box is a double-click, and its first click must not open the panel. With a panel already open there's
        // nothing to open, only its box to change, so that goes at once: no wait between one box and the next.
        if (!CanOpen(id) || _side is not null)
        {
            OpenObject(id);
            return;
        }
        _openingBox = id;
        _opening = new DispatcherTimer(TimeSpan.FromMilliseconds(DoubleClickMilliseconds), DispatcherPriority.Normal, (_, _) =>
        {
            _opening?.Stop();
            _openingBox = null;
            OpenObject(id);
        });
        _opening.Start();
    }

    /// <summary>Shows a box's panel, and moves the view just far enough that the box isn't under it.</summary>
    public void OpenObject(string id)
    {
        if (_folder?.Model.GetObject(id) is null) return;
        _undoMove = false;
        _side = new Side(SideKind.Object, Id: id);
        Refresh();
        _canvas.Reveal(id, _detailsWidth, ShownTab is not null ? _navWidth : 0);
    }

    public void Select(string id) => OpenObject(id);

    /// <summary>Shows the panel of a line of the current view.</summary>
    public void OpenLine(string from, string to)
    {
        _undoMove = false;
        _side = new Side(SideKind.Line, From: from, To: to);
        Refresh();
    }

    // ---- flows -------------------------------------------------------------------------------------------------

    public void Play(string flow, int step = 0)
    {
        if (Editing) return;
        StopAuto();
        // A step number is the file's; the player stops where that step is.
        var at = _folder?.Model.Flows.TryGetValue(flow, out var found) == true ? Structure.StopIndexOf(StopsOf(found), step) : step;
        _playing = new Playhead(flow, at, []);
        Refresh();
    }

    private void StepTo(int index)
    {
        if (PlayingFlow() is not { } f || _playing is not { } p) return;
        StopAuto();
        _playing = p with { Step = Math.Max(0, Math.Min(index, StopsOf(f.Flow).Count - 1)) };
        Refresh();
    }

    private void Stop()
    {
        _playing = null;
        StopAuto();
        Refresh();
    }

    /// <summary>A step's story continues in another flow: opens it (on its own view), leaving the place to come back to.</summary>
    private void OpenLinked(string id)
    {
        if (_folder is not { } folder || PlayingFlow() is not { } here || _playing is not { } p) return;
        if (!folder.Model.Flows.TryGetValue(id, out var target) || target.Steps.Count == 0 || !Views.IsView(folder.Model, target.View)) return; // a flow whose view can't open can't play
        StopAuto();
        var trail = Trails.Open(p.Trail, new FlowPlace(here.Id, StopIndex()));
        if (target.View != CurrentView()) GoTo(target.View!); // GoTo clears what plays
        _playing = new Playhead(id, 0, trail);
        Refresh();
    }

    /// <summary>Back to the flow this one was opened from, at the stop the reader left.</summary>
    private void GoBack()
    {
        if (_folder is not { } folder || _playing is not { } p || Trails.Close(p.Trail) is not { } closed) return;
        if (!folder.Model.Flows.TryGetValue(closed.Back.Flow, out var parent) || !Views.IsView(folder.Model, parent.View))
        {
            Stop(); // the flow it came from is gone, or can't play any more
            return;
        }
        StopAuto();
        if (parent.View != CurrentView()) GoTo(parent.View!);
        _playing = new Playhead(closed.Back.Flow, closed.Back.Step, closed.Trail);
        Refresh();
    }

    // ---- search, shortcuts, problems ---------------------------------------------------------------------------

    public void OpenSearch(string query = "")
    {
        if (_folder is null) return;
        CloseSearch(false);
        _search = new SearchBox(_folder.Model, id =>
        {
            CloseSearch(true);
            GoTo(Views.ParentOf(_folder.Model, id)); // the view the box sits in
            OpenObject(id);
        }, () => CloseSearch(true), query);
        _overlay.Children.Add(_search);
    }

    private void CloseSearch(bool refocus)
    {
        if (_search is null) return;
        var search = _search;
        _search = null;
        _overlay.Children.Remove(search);
        if (refocus) Focus();
    }

    private void ToggleSearch()
    {
        if (_search is null) OpenSearch();
        else CloseSearch(true);
    }

    public void ShowShortcuts(bool show = true)
    {
        if (show == (_shortcuts is not null)) return;
        if (!show)
        {
            _overlay.Children.Remove(_shortcuts!);
            _shortcuts = null;
            return;
        }
        _shortcuts = new ShortcutsCard(() => ShowShortcuts(false), CanPerf);
        _overlay.Children.Add(_shortcuts);
    }

    private void ToggleShortcuts() => ShowShortcuts(_shortcuts is null);

    private void Jump(Problem problem)
    {
        if (_folder is not { } folder) return;
        var spot = Navigation.Locate(folder.Model, problem);
        GoTo(spot.View);
        if (spot.Object is { } obj) OpenObject(obj);
        else if (spot.Line is { } line)
        {
            _side = new Side(SideKind.Line, From: line.From, To: line.To);
            Refresh();
        }
        else if (spot.Flow is { } flow)
        {
            // The player only lists flows with steps in a view that opens; Locate falls back to the top for a bad view.
            if (folder.Model.Flows[flow] is { Steps.Count: > 0 } f && f.View == spot.View) Play(flow, spot.Step ?? 0);
            else ShowNotice($"This flow can't play yet. Fix {problem.File} first.");
        }
    }

    // ---- keys --------------------------------------------------------------------------------------------------

    private bool InNavigator(object? source) => _nav.IsVisible && source is Visual v && (ReferenceEquals(v, _nav) || v.GetVisualAncestors().Contains(_nav));

    /// <summary>A click in the navigator makes Escape close it. A click anywhere else (the diagram, Details) makes Escape leave it alone, and takes the keyboard out of it.</summary>
    private void OnPointerDown(object? sender, PointerPressedEventArgs e)
    {
        var inside = InNavigator(e.Source);
        _navUsed = inside;
        if (!inside && InNavigator(TopLevel.GetTopLevel(this)?.FocusManager?.GetFocusedElement())) Focus();
    }

    private void OnKeyDown(object? sender, KeyEventArgs e)
    {
        if (_folder is not { } folder) return;
        var inNavigator = InNavigator(e.Source);
        if (e.Source is TextBox field)
        {
            // A field keeps its keys. The navigator's filters give up Escape once they are empty, so it closes with a click in one.
            if (e.Key != Key.Escape || !inNavigator) return;
            if (!string.IsNullOrEmpty(field.Text))
            {
                field.Text = "";
                e.Handled = true;
                return;
            }
        }
        if (_nav.Explorer.Holds(e.Source) && e.Key != Key.Escape) return; // the tree has its own keys, and a letter typed in it goes to its filter
        var view = CurrentView();
        var plain = e.KeyModifiers == KeyModifiers.None;
        var flow = PlayingFlow();
        void Up() => ZoomOut(Views.ParentOf(folder.Model, view));

        if (e.Key == Key.Escape && _search is not null)
        {
            // The search field closes itself on Escape; this is for when the focus has slipped out of it.
            CloseSearch(true);
        }
        else if (e.Key == Key.Escape && _canvas.CancelGesture()) { }
        else if (UndoMoveKey(e)) { }
        else if (e.Key == Key.Escape && ResetPick()) { }
        else if (e.Key == Key.Escape && _shortcuts is null && _side is { Kind: SideKind.Objects }) ClearPicked();
        else if (e.Key == Key.Escape)
        {
            var navigator = ShownTab is not null && (_navUsed || inNavigator);
            switch (Navigation.Escape(_shortcuts is not null, navigator, flow is not null, RightOpen, view != Names.Root))
            {
                case EscapeStep.Shortcuts: ShowShortcuts(false); break;
                case EscapeStep.Navigator: CloseNav(); break;
                case EscapeStep.Flow: Stop(); break;
                case EscapeStep.Panel:
                    if (PerfOpen) ClosePerf();
                    else CloseDetails();
                    break;
                case EscapeStep.Up: Up(); break;
                default: return;
            }
        }
        else if (EditKey(e)) { }
        else if (PerfOpen && e.Key == Key.Right) StepLevel(PerfView.StepFrom(ActivePos, 1));
        else if (PerfOpen && e.Key == Key.Left) StepLevel(PerfView.StepFrom(ActivePos, -1));
        else if (PerfOpen && e.Key == Key.Home) StepLevel(0);
        else if (PerfOpen && LoadTest is { } top && e.Key == Key.End) StepLevel(ActiveTop(top));
        else if (PerfOpen && e.PhysicalKey == PhysicalKey.P && plain) ToggleRamp();
        else if (flow is not null && e.Key == Key.Right) StepTo(StopIndex() + 1);
        else if (flow is not null && e.Key == Key.Left) StepTo(StopIndex() - 1);
        else if (flow is not null && e.Key == Key.Home) StepTo(0);
        else if (flow is not null && e.Key == Key.End) StepTo(StopsOf(flow.Value.Flow).Count - 1);
        else if (flow is not null && e.PhysicalKey == PhysicalKey.P && plain) ToggleAuto();
        else if (flow is not null && e.PhysicalKey == PhysicalKey.R && plain) Replay();
        else if (e.Key == Key.Enter && Recording is null)
        {
            // The box with keyboard focus (Tab moves it), else the one whose panel is open: in if it opens, else its panel.
            var id = (TopLevel.GetTopLevel(this)?.FocusManager?.GetFocusedElement() as BoxControl)?.Id ?? SelectedBox;
            if (id is null) return;
            if (CanOpen(id)) ZoomInto(id);
            else OpenObject(id);
        }
        else if (e.KeySymbol == "?") ToggleShortcuts();
        else if ((e.PhysicalKey == PhysicalKey.K && e.KeyModifiers == KeyModifiers.Control) || e.KeySymbol == "/" || (e.PhysicalKey == PhysicalKey.Slash && e.KeyModifiers == KeyModifiers.None)) OpenSearch();
        else if (e.PhysicalKey == PhysicalKey.F && plain) FitNow();
        else if (e.PhysicalKey == PhysicalKey.L && plain && ShowFlows) ToggleTab(PanelTab.Flows);
        else if (e.PhysicalKey == PhysicalKey.O && plain) ToggleTab(PanelTab.Explorer);
        else if (e.PhysicalKey == PhysicalKey.T && plain && CanPerf) TogglePerf();
        // Z zooms out, always: in edit mode Esc and Backspace may be busy taking a drag back, and going up should stay one key away.
        else if ((e.Key == Key.Back || e.PhysicalKey == PhysicalKey.Z) && plain && view != Names.Root && Recording is null) Up();
        else return;
        e.Handled = true;
    }
}
