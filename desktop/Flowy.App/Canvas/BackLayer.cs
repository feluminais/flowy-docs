using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Flowy.Core;
using CorePt = Flowy.Core.Pt;
using CoreRect = Flowy.Core.Rect;

namespace Flowy.App.Canvas;

/// <summary>
/// What sits behind the boxes: the frame around the view's own boxes, and the lines with their arrowheads and labels. Drawn in one
/// pass with the same camera as the boxes, so a line stays on its boxes while the view moves and zooms.
/// </summary>
internal sealed class BackLayer : Control
{
    /// <summary>
    /// A line as drawn. `Made` is what its path was made from: the two boxes and their outlines, so a line whose boxes stayed where they were keeps its path, its geometry and its label.
    /// `Label` is the label's box at the middle of the line, as measured; where it is drawn is in `_labelAt`.
    /// </summary>
    private sealed record Drawn(SceneEdge Edge, LinePath Path, Geometry Geometry, (CoreRect From, CoreRect To, double[]? OutlineFrom, double[]? OutlineTo, string Style) Made, CoreRect? Label, Avalonia.Rect Bounds, IReadOnlyList<CorePt>? Points = null, LanePose? Pose = null, CorePt? Step = null)
    {
        /// <summary>The <c>s</c> of the pose it is drawn in: how far its pair is spread.</summary>
        public double S => Pose?.S ?? 0;
    }

    private string _style = "";

    private List<Drawn> _lines = [];
    private List<CoreRect> _labels = [];
    private Dictionary<string, CoreRect> _labelAt = []; // where each label is drawn, by line id, kept clear of the boxes and of each other (LineLabels)
    private Dictionary<string, int> _labelSide = []; // the side of its line a label beside the line runs to (-1 left, 1 right), by line id; left out for a label on its line (LineLabels)
    private HashSet<string> _labelHidden = []; // the lines of a pair side by side whose labels found no clear place: drawn only while the line is pointed at
    private IReadOnlyDictionary<string, double>? _widths; // how thick each line is drawn while a load shows (by line id), where it differs from the usual
    private FailureOverlay? _failures; // the Failures tab's badges and the line a picked mode fails, while the tab is open
    private IReadOnlyDictionary<string, Change>? _changes; // a comparison's change marks on the lines, by line id, while Show changes is on
    private Scene? _scene;
    private Viewport _viewport = new(0, 0, 1);

    private readonly LaneStore _lanes;

    private PartStore? _parts; // how far the lines of each pair are parted around the lit one while a flow plays

    /// <summary>How far each pair of lines side by side is on its way to spread (0 is rest, 1 is spread; linear), by pair id, and where it is going. The pose the lanes are drawn in is its eased value.</summary>
    private readonly Dictionary<string, (double Progress, double Goal)> _spread = [];

    private IDisposable? _easing; // the frames that move the pairs that are on their way
    private IReadOnlySet<string> _raised = new HashSet<string>(); // the lines pointed at among the lines of their pair: drawn above them
    private IReadOnlySet<string> _mates = new HashSet<string>(); // the other lines of a pair when one of them is pointed at: drawn a little faded

    public BackLayer(LaneStore lanes)
    {
        _lanes = lanes;
        IsHitTestVisible = false;
        ActualThemeVariantChanged += (_, _) => InvalidateVisual();
    }

    /// <summary>
    /// The store that says how far the lines of a pair are parted around the lit one (see <see cref="PartStore"/>). A line of a pair of several reads it when it is made; <see cref="PartsChanged"/> makes the
    /// lines again when the store moves.
    /// </summary>
    internal PartStore? Parts
    {
        set => _parts = value;
    }

    /// <summary>The lanes of some pair have moved (a step is parting them, or they are closing): the lines of pairs of several are made again, and only those whose pose changed are.</summary>
    internal void PartsChanged()
    {
        if (_scene is { } scene) Build(scene, _style);
    }

    /// <summary>The camera, for the places a pointer is turned into the diagram's own. The layer is drawn in the diagram's units: the canvas moves it with the boxes, so a move of the camera draws nothing again.</summary>
    public Viewport Viewport
    {
        get => _viewport;
        set => _viewport = value;
    }

    /// <summary>Draws the scene's lines in <paramref name="style"/>: "straight", "curved" or "angled".</summary>
    public void SetScene(Scene scene, string style)
    {
        _scene = scene;
        AimSpread(scene);
        Build(scene, style);
        if (_spread.Values.Any(p => p.Progress != p.Goal)) _easing ??= Anim.Frames(this, EaseSpread);
    }

    /// <summary>
    /// Points each pair of lines side by side towards where the scene wants it: spread while it is selected or focused (see <see cref="SceneEdge.Spread"/>), else at rest. A pair seen for the first
    /// time starts there, so opening a view moves nothing; one that is already on screen eases over <see cref="Lanes.SpreadMs"/>, and with reduced motion it snaps.
    /// </summary>
    private void AimSpread(Scene scene)
    {
        var goals = scene.Edges.Where(e => e.Pair is not null && e.Lanes > 1).GroupBy(e => e.Pair!).ToDictionary(g => g.Key, g => g.Any(e => e.Spread) ? 1.0 : 0.0);
        foreach (var gone in _spread.Keys.Where(k => !goals.ContainsKey(k)).ToList()) _spread.Remove(gone);
        foreach (var (pair, goal) in goals)
            _spread[pair] = _spread.TryGetValue(pair, out var was) && !MotionSettings.Reduced ? (was.Progress, goal) : (goal, goal);
    }

    /// <summary>One frame of the ease: the pairs on their way go on by <paramref name="ms"/>, and the lines they hold are made again. False once every pair is where it is going.</summary>
    private bool EaseSpread(double ms)
    {
        foreach (var (pair, (progress, goal)) in _spread.ToList())
            if (progress != goal) _spread[pair] = (Lanes.SpreadProgress(progress, goal, ms), goal);
        if (_scene is { } scene) Build(scene, _style);
        var moving = _spread.Values.Any(p => p.Progress != p.Goal);
        if (!moving) _easing = null;
        return moving;
    }

    /// <summary>Lets time go by in the ease of the pairs, without frames: for the tests, which move the clock by hand.</summary>
    internal void Ease(double ms) => EaseSpread(ms);

    /// <summary>The <c>s</c> of the pose a line is drawn in: 0 for a line alone between its shapes and for a pair at rest, 1 for one that is spread, between while it eases (for tests).</summary>
    internal double SpreadOf(string edgeId) => _lines.FirstOrDefault(l => l.Edge.Id == edgeId)?.S ?? 0;

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);
        _easing?.Dispose();
        _easing = null;
        foreach (var (pair, (_, goal)) in _spread.ToList()) _spread[pair] = (goal, goal); // a layer that is back later shows the pairs where they were going
    }

    /// <summary>
    /// The pose's <c>s</c> of a line now: the eased progress of its pair, cut to 32 steps (what the lane store keeps a path for, so an ease is a handful of paths and not one for each frame).
    /// </summary>
    private double SpreadNow(SceneEdge e) =>
        e.Pair is { } pair && e.Lanes > 1 && _spread.TryGetValue(pair, out var p) ? Math.Round(Lanes.EasedSpread(p.Progress) * 32) / 32 : 0;

    private static LanePose PoseAt(double s) => s == 0 ? LanePose.Rest : s == 1 ? LanePose.Spread : new LanePose(s, []);

    /// <summary>
    /// The pose a line is drawn in: its pair's spread, and while a step plays on the pair, how lit each of its lanes is (the others part around the lit one, see <see cref="PartStore"/>; a step playing
    /// on a pair wins over its being spread, so the scene does not spread it then).
    /// </summary>
    private LanePose PoseOf(SceneEdge e) =>
        e.Pair is not null && e.Lanes > 1 && _parts?.Lam(e.Pair) is { } lit ? new LanePose(SpreadNow(e), lit) : PoseAt(SpreadNow(e));

    private static bool SamePose(LanePose? a, LanePose? b) => (a ?? LanePose.Rest).S == (b ?? LanePose.Rest).S && (a ?? LanePose.Rest).Lam.SequenceEqual((b ?? LanePose.Rest).Lam);

    private void Build(Scene scene, string style)
    {
        var rects = scene.Boxes.ToDictionary(b => b.Id, b => b.Rect);
        var outlines = scene.Boxes.ToDictionary(b => b.Id, b => Look.DefOf(b.Object).Edge); // where a line meets each shape
        // Dragging a box moves it and the lines at it; every other line is as it was, and is not worked out again (a path parsed, a label measured).
        var before = style == _style ? _lines.ToDictionary(l => l.Edge.Id) : [];
        _style = style;
        _lines = scene.Edges
            .Where(e => rects.ContainsKey(e.From) && rects.ContainsKey(e.To))
            .Select(e =>
            {
                var made = (rects[e.From], rects[e.To], outlines[e.From], outlines[e.To], style);
                if (before.TryGetValue(e.Id, out var was) && was.Made.From == made.Item1 && was.Made.To == made.Item2 && ReferenceEquals(was.Made.OutlineFrom, made.Item3) && ReferenceEquals(was.Made.OutlineTo, made.Item4)
                    && was.Edge.Label == e.Label && was.Edge.Slot == e.Slot && was.Edge.Spread == e.Spread && SamePose(was.Pose, PoseOf(e)) && (e.Label is null || (e.Flags & EdgeFlags.Active) == (was.Edge.Flags & EdgeFlags.Active)))
                    return was with { Edge = e };
                var pose = PoseOf(e);
                var lane = _lanes.PathFor(e.Id, style, new LaneEnd(e.From, made.Item1, made.Item3), new LaneEnd(e.To, made.Item2, made.Item4), pose, e.Slot);
                var label = e.Label is { Length: > 0 } ? LabelBox(lane.Path, Format(e, LineLabels.Clip(e.Label), Brushes.Black)) : (CoreRect?)null;
                // The hairlines of a trunk lie behind it on its outer side, a fixed step along the normal of the pair (see Lanes.StackStep).
                CorePt? step = e.Trunk is not null && e.Slot is { } slot ? Lanes.StackStep(new LaneBox(e.From, made.Item1, made.Item3), new LaneBox(e.To, made.Item2, made.Item4), slot) : null;
                return new Drawn(e, lane.Path, lane.Geometry, made, label, lane.Geometry.Bounds, lane.Points, pose, step);
            }).ToList();
        PointedAt(scene);
        PlaceLabels();
        InvalidateVisual();
    }

    /// <summary>
    /// Of the lines of a pair side by side, the ones pointed at when the pointer is on some of them and not on the whole pair: those are drawn above the rest of their pair, and the rest of
    /// the pair fades a little (<see cref="Lanes.SiblingOpacity"/>). The browser does the same (<c>raised</c> and <c>lane-mate</c> in ui/src/Line.tsx).
    /// </summary>
    private void PointedAt(Scene scene)
    {
        var raised = new HashSet<string>();
        var mates = new HashSet<string>();
        foreach (var pair in scene.Edges.Where(e => e.Pair is not null && e.Lanes > 1).GroupBy(e => e.Pair!))
        {
            var hot = pair.Where(e => e.Flags.HasFlag(EdgeFlags.Hover)).ToList();
            if (hot.Count == 0 || hot.Count == pair.Count()) continue;
            raised.UnionWith(hot.Select(e => e.Id));
            mates.UnionWith(pair.Where(e => !e.Flags.HasFlag(EdgeFlags.Hover)).Select(e => e.Id));
        }
        (_raised, _mates) = (raised, mates);
    }

    /// <summary>How strong a line is drawn: as <see cref="Fade"/>, and a little less where it is a line of a pair when another line of the pair is pointed at.</summary>
    private double OpacityOf(SceneEdge e) => Fade(e) * (_mates.Contains(e.Id) ? Lanes.SiblingOpacity : 1);

    /// <summary>How strong the line with this id is drawn, or null if it is not on the canvas (for tests).</summary>
    internal double? OpacityOf(string edgeId) => _lines.FirstOrDefault(l => l.Edge.Id == edgeId) is { } line ? OpacityOf(line.Edge) : null;

    /// <summary>
    /// The lines in the order they are drawn, the last on top: a lit line draws over the others, and a line pointed at among the lines of its pair draws over everything, so a strip of one
    /// line is never under its neighbour's.
    /// </summary>
    private IEnumerable<Drawn> InDrawOrder() =>
        _lines.OrderBy(l => _raised.Contains(l.Edge.Id) ? 2 : l.Edge.Flags.HasFlag(EdgeFlags.Active) || l.Edge.Flags.HasFlag(EdgeFlags.Step) ? 1 : 0);

    /// <summary>The ids of the lines in the order they are drawn, the last on top (for tests).</summary>
    internal IReadOnlyList<string> DrawOrder() => InDrawOrder().Select(l => l.Edge.Id).ToList();

    /// <summary>
    /// Where the labels on show go, as the browser places them: each slides along its line to the first place clear of the boxes and of the labels placed
    /// before it. A lit line's label and a lifted one stay at the middle of the line, and the others are placed round them.
    /// </summary>
    private void PlaceLabels()
    {
        var items = _lines.Where(l => l.Label is not null).Select(l =>
        {
            var box = l.Label!.Value;
            var pinned = l.Edge.Flags.HasFlag(EdgeFlags.Active) || IsLifted(l.Edge);
            // The label of a line that has others beside it starts with a sample of the line, and keeps clear of their lines.
            var across = l.Edge.Lanes > 1 && l.Edge.Pair is not null
                ? _lines.Where(o => o.Edge.Id != l.Edge.Id && o.Edge.Pair == l.Edge.Pair && o.Points is not null).Select(o => o.Points!).ToList()
                : null;
            return new LabelItem(l.Edge.Id, l.Path.Data, new CorePt(box.X + box.Width / 2, box.Y + box.Height / 2), box.Width, box.Height, pinned, across, across is null ? 0 : LineLabels.Sample, IsLifted(l.Edge) ? LineLabels.PipeClear : LineLabels.NextTo);
        }).ToList();
        var spots = LineLabels.PlaceSpots(items, _scene?.Boxes.Select(b => b.Rect).ToList() ?? []);
        _labelAt = items.ToDictionary(i => i.Id, i => LineLabels.Around(spots[i.Id].At, i));
        _labelSide = spots.Where(e => e.Value.Side != 0).ToDictionary(e => e.Key, e => e.Value.Side);
        _labelHidden = spots.Where(e => e.Value.Hidden).Select(e => e.Key).ToHashSet();
        _labels = [.. _labelAt.Where(e => !_labelHidden.Contains(e.Key)).Select(e => e.Value)];
    }

    private IReadOnlySet<(string From, string To)> _lifted = new HashSet<(string, string)>();

    /// <summary>Whether a line's label is lifted: for a line alone between its shapes, when a step with marks plays along it; of the lines of a pair side by side, only the one the step rides.</summary>
    private bool IsLifted(SceneEdge e) => e.Pair is null
        ? _lifted.Contains((e.From, e.To))
        : e.Flags.HasFlag(EdgeFlags.Active) && _lifted.Any(l => SceneBuilder.LineId(l.From, l.To) == e.Pair);

    /// <summary>
    /// The lit lines whose labels move aside, to the upper side of the line as the browser does for a step that plays: a step that leaves marks beside its
    /// line (a cross, a bar, a clock) keeps its label clear of them. None leaves every label where it is.
    /// </summary>
    public void LiftLabels(IEnumerable<(string From, string To)> lines)
    {
        var set = lines.ToHashSet();
        if (set.SetEquals(_lifted)) return;
        _lifted = set;
        PlaceLabels();
        InvalidateVisual();
    }

    /// <summary>Where the labels showing now are, with their padding: what traffic runs under, as it runs under a shape.</summary>
    internal IReadOnlyList<CoreRect> LabelRects => _labels;

    /// <summary>The path data of a line as it is drawn now, for tests.</summary>
    internal string? PathOf(string edgeId) => _lines.FirstOrDefault(l => l.Edge.Id == edgeId)?.Path.Data;

    /// <summary>The geometry of a line, for tests: a line whose boxes did not move keeps the one it had.</summary>
    internal Geometry? GeometryOf(string edgeId) => _lines.FirstOrDefault(l => l.Edge.Id == edgeId)?.Geometry;

    /// <summary>Draws the lines at these thicknesses (a load's traffic makes busy lines thicker), or as usual for null.</summary>
    public void SetWidths(IReadOnlyDictionary<string, double>? widths)
    {
        _widths = widths;
        InvalidateVisual();
    }

    /// <summary>Draws the Failures tab's marks on the lines: a badge with the count at the label, and for a picked mode its line in red and every other faded. Null takes them away.</summary>
    public void SetFailures(FailureOverlay? overlay)
    {
        _failures = overlay;
        InvalidateVisual();
    }

    /// <summary>Draws a halo behind the lines a comparison marks (by line id), in the colour and dash of their kind. Null, or no lines, takes them away.</summary>
    public void SetChanges(IReadOnlyDictionary<string, Change>? lines)
    {
        var next = lines is { Count: > 0 } ? lines : null;
        if (ReferenceEquals(next, _changes) || (next is null && _changes is null)) return;
        _changes = next;
        InvalidateVisual();
    }

    /// <summary>The kind a line is marked as, or null (for tests).</summary>
    internal Change? ChangeOf(string from, string to) => _changes is not null && _changes.TryGetValue(SceneBuilder.LineId(from, to), out var kind) ? kind : null;

    private Change? ChangeOf(SceneEdge e) => _changes is not null && _changes.TryGetValue(e.PairId, out var kind) ? kind : null;

    /// <summary>The badge a line wears now, or null (for tests).</summary>
    internal FailureMark? FailureOn(string from, string to) =>
        _failures is not null && _failures.Lines.TryGetValue(Failures.LineKey(from, to), out var mark) ? mark : null;

    /// <summary>How a line is lit for the picked failure mode (for tests).</summary>
    internal FailLight FailLightOf(string from, string to) => _failures?.LightOfLine(from, to) ?? FailLight.None;

    /// <summary>How thick a line is drawn while a load shows, or null when it is drawn as usual (for tests).</summary>
    internal double? WidthOf(string edgeId) => _widths is not null && _widths.TryGetValue(edgeId, out var w) ? w : null;

    /// <summary>How thick a line is drawn: what a load's traffic gives it, which outranks being picked, hovered or lit as the browser's inline width does; else lit 3, picked or hovered 2, any other 1.5.</summary>
    internal static double ThicknessOf(bool lit, bool picked, double? traffic) => traffic ?? (lit ? 2.5 : picked ? 2 : 1.5);

    /// <summary>
    /// The line under a point of this control, if any (within a few pixels of it), for pointing at and clicking lines. Where a pair has several lines side by side their strips overlap and the
    /// lines move when the pair is spread, so the line is the one of the pair nearest the pointer as the core says (<see cref="Lanes.NearestStrand"/>, which measures in screen pixels, so the same click picks the same line at any zoom, as in the browser), not the one
    /// whose stroke was found first.
    /// </summary>
    public string? EdgeAt(Point screen)
    {
        var world = _viewport.ToWorld(new CorePt(screen.X, screen.Y));
        var at = new Point(world.X, world.Y);
        var reach = 7 / _viewport.Zoom; // half the pen below: only a line whose box holds the point within that can be under it
        Pen? pen = null;
        for (var i = _lines.Count - 1; i >= 0; i--)
        {
            var line = _lines[i];
            if (!line.Bounds.Inflate(reach).Contains(at) || SceneBuilder.IsStepLine(line.Edge.Id)) continue;
            pen ??= new Pen(Brushes.Black, 14 / _viewport.Zoom);
            // A lane is a polyline the core made, so how near the pointer is to it is plain arithmetic; any other line is asked of its geometry.
            if (line.Points is { } points ? Lanes.DistanceTo(points, new CorePt(world.X, world.Y)) > reach : !line.Geometry.StrokeContains(pen, at)) continue;
            if (line.Edge.Pair is not { } pair || line.Edge.Lanes < 2) return line.Edge.Id;
            var near = _lines.Where(o => o.Edge.Pair == pair && o.Edge.Slot is not null && o.Points is not null)
                .Select(o => new HitLane(o.Edge.Id, pair, o.Edge.Slot!.Value.Lane, o.Points!)).ToList();
            return Lanes.NearestStrand(near, new CorePt(world.X, world.Y), _viewport.Zoom) ?? line.Edge.Id;
        }
        return null;
    }

    private (string Name, double Width, double Height)? _titleSize;

    /// <summary>How big the frame's title is: measured once for a name, not on every pointer move.</summary>
    private (double Width, double Height) TitleSize(string name)
    {
        if (_titleSize is not { } known || known.Name != name)
        {
            var title = FrameTitle(name, Brushes.Black);
            _titleSize = known = (name, title.Width, title.Height);
        }
        return (known.Width, known.Height);
    }

    private static FormattedText FrameTitle(string name, IBrush brush) =>
        new(name, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight, new Typeface(FontFamily.Default, FontStyle.Normal, FontWeight.SemiBold), 12, brush);

    /// <summary>Whether a point of this control is on the frame's outline or its title (a few pixels either side of the line, so it is easy to hit): a click there is a click on the system the frame stands for.</summary>
    public bool OnFrame(Point screen)
    {
        if (_scene is not { Frame: { } frame } || _scene.FrameName == "") return false;
        var world = _viewport.ToWorld(new CorePt(screen.X, screen.Y));
        var at = new Point(world.X, world.Y);
        var reach = 6 / _viewport.Zoom;
        var outer = new Avalonia.Rect(frame.X - reach, frame.Y - reach, frame.Width + 2 * reach, frame.Height + 2 * reach);
        var inner = new Avalonia.Rect(frame.X + reach, frame.Y + reach, Math.Max(0, frame.Width - 2 * reach), Math.Max(0, frame.Height - 2 * reach));
        if (outer.Contains(at) && !inner.Contains(at)) return true;
        var (width, height) = TitleSize(_scene.FrameName);
        return new Avalonia.Rect(frame.X + 14, frame.Y - height / 2, width + 12, height).Contains(at);
    }

    private IBrush Brush(string key) => AppTheme.Brush(this, key);

    private double _litFade = 1;
    private double _litFadeSeveral = 1;

    /// <summary>How strong the lines a step has lit are drawn: 1, or less while a step that timed out has dimmed them (see MotionMath.LitOpacity).</summary>
    public double LitFade
    {
        get => _litFade;
        set
        {
            if (_litFade == value) return;
            _litFade = value;
            InvalidateVisual();
        }
    }

    /// <summary>How strong a lit line that has others beside it is drawn: as <see cref="LitFade"/>, but a step that timed out dims it to <see cref="Lanes.LitFloorLanes"/>, not a quarter, so it is never fainter than its kin.</summary>
    public double LitFadeSeveral
    {
        get => _litFadeSeveral;
        set
        {
            if (_litFadeSeveral == value) return;
            _litFadeSeveral = value;
            InvalidateVisual();
        }
    }

    private double Fade(SceneEdge e) =>
        _failures?.LightOfLine(e.From, e.To) == FailLight.Dim ? 0.15 :
        e.Flags.HasFlag(EdgeFlags.Dim) ? (ChangeOf(e) is null ? 0.15 : 0.6) : // a mark on a line off the step on show stays readable
 e.Flags.HasFlag(EdgeFlags.Lane) ? 0.55 : e.Flags.HasFlag(EdgeFlags.Kin) ? Lanes.KinOpacity : e.Flags.HasFlag(EdgeFlags.Faint) ? 0.25
        : e.Flags.HasFlag(EdgeFlags.Active) && e.Flags.HasFlag(EdgeFlags.Several) ? _litFadeSeveral
        : e.Flags.HasFlag(EdgeFlags.Active) || e.Flags.HasFlag(EdgeFlags.Step) ? _litFade : 1;

    public override void Render(DrawingContext context)
    {
        base.Render(context);
        if (_scene is null) return;
        var accent = Brush("AccentBrush");

        if (_scene.Frame is { } frame && _scene.FrameName != "")
        {
            var rect = new Avalonia.Rect(frame.X, frame.Y, frame.Width, frame.Height);
            context.DrawRectangle(null, new Pen(accent, 1.5), rect, 12, 12);
            var title = FrameTitle(_scene.FrameName, accent);
            var at = new Point(frame.X + 14 + 6, frame.Y - title.Height / 2);
            context.DrawRectangle(Brush("BgBrush"), null, new Avalonia.Rect(at.X - 6, at.Y, title.Width + 12, title.Height));
            context.DrawText(title, at);
        }

        foreach (var line in InDrawOrder())
            DrawLine(context, line, accent);
        foreach (var line in _lines)
            if (line.Edge.Label is { Length: > 0 } label) DrawLabel(context, line, label);
        if (_failures is { Lines.Count: > 0 })
            foreach (var line in _lines)
                // A failure mode is on a pair, so the badge of a pair of lines side by side is drawn once, on the first, at the middle of the pair.
                if (line.Edge.Slot is not ({ Lane: > 0 } or { Within: > 0 }) && _failures.Lines.TryGetValue(Failures.LineKey(line.Edge.From, line.Edge.To), out var mark)) DrawFailBadge(context, line, mark);
    }

    /// <summary>
    /// The count of failure modes a line carries, in the colour of the worst, as a shape wears it. On the left end of the line's label when it has one,
    /// else centred on the line's label point.
    /// </summary>
    private void DrawFailBadge(DrawingContext context, Drawn line, FailureMark mark)
    {
        using var opacity = context.PushOpacity(Fade(line.Edge));
        var unrated = mark.Band == RiskBand.Unrated;
        var text = new FormattedText(mark.Count.ToString(CultureInfo.InvariantCulture), CultureInfo.CurrentUICulture, FlowDirection.LeftToRight,
            new Typeface(FontFamily.Default, FontStyle.Normal, FontWeight.Bold), 11, Brush(unrated ? "FgBrush" : "BgBrush"));
        var width = Math.Max(20, text.Width + 12);
        var (x, y) = _labelAt.TryGetValue(line.Edge.Id, out var label) ? (label.X - width + 6, label.Y + label.Height / 2) : (line.Path.Label.X - width / 2, line.Path.Label.Y);
        var rect = line.Edge.Lanes > 1 ? PairBadgeRect(PairCentre(line), width) : new Avalonia.Rect(x, y - 10, width, 20);
        var fill = Brush(mark.Band switch { RiskBand.High => "DangerBrush", RiskBand.Medium => "WarnBrush", RiskBand.Low => "MutedBrush", _ => "BgBrush" });
        context.DrawRectangle(fill, unrated ? new Pen(Brush("LineBrush"), 1) : null, rect, 10, 10);
        context.DrawText(text, new Point(rect.X + (width - text.Width) / 2, rect.Y + (20 - text.Height) / 2));
    }

    /// <summary>
    /// Where the badge of a pair of lines side by side goes: its top 30 px above the middle of the pair, as the browser puts it (<c>translate(-50%, -150%)</c> of a badge 20 px high), so it does not cover
    /// the lane that runs through the middle.
    /// </summary>
    internal static Avalonia.Rect PairBadgeRect(CorePt centre, double width) => new(centre.X - width / 2, centre.Y - 30, width, 20);

    /// <summary>The middle of the pair a line is one of: where the line between the two shapes would have its label.</summary>
    private CorePt PairCentre(Drawn line) =>
        _lanes.PathFor(line.Edge.PairId, "straight", new LaneEnd(line.Edge.From, line.Made.From, line.Made.OutlineFrom), new LaneEnd(line.Edge.To, line.Made.To, line.Made.OutlineTo)).Path.Label;

    private void DrawLine(DrawingContext context, Drawn line, IBrush accent)
    {
        var e = line.Edge;
        var lit = e.Flags.HasFlag(EdgeFlags.Active) || e.Flags.HasFlag(EdgeFlags.Step);
        var emphasised = lit || e.Selected || e.Flags.HasFlag(EdgeFlags.Hover);
        var brush = e.Flags.HasFlag(EdgeFlags.Problem) && !lit ? Brush("WarnBrush") : emphasised ? accent : Brush("EdgeBrush");
        var thickness = ThicknessOf(lit, e.Selected || e.Flags.HasFlag(EdgeFlags.Hover), WidthOf(e.PairId));
        if (_failures?.LightOfLine(e.From, e.To) == FailLight.Fails) // the line a picked failure mode fails, in the colour of the mode's band
        {
            brush = Brush(_failures.LitBand switch { RiskBand.High => "DangerBrush", RiskBand.Medium => "WarnBrush", _ => "MutedBrush" });
            thickness = 2.5;
        }
        var dash = KindMarks.Dash(DashesOf(e.Flags, e.Look, _widths is not null), thickness);
        using var opacity = context.PushOpacity(OpacityOf(e));
        if (ChangeOf(e) is { } change)
        {
            // The halo: 8 px wide in the kind's colour at 30%, dashed for Removed (6 and 4 px, in widths of the pen), as the browser's .change-line.
            using var faint = context.PushOpacity(0.3);
            var halo = Brush(change switch { Change.New => "AccentBrush", Change.Removed => "DangerBrush", _ => "WarnBrush" });
            context.DrawGeometry(null, new Pen(halo, 8, change == Change.Removed ? new DashStyle([6.0 / 8, 4.0 / 8], 0) : null, PenLineCap.Flat), line.Geometry);
        }
        // A trunk, several lines stacked as one: two hairlines behind its line, on its outer side, and a chip with the number of connections on its middle (not while its label shows there).
        if (line.Step is { } step) TrunkMarks.Hairlines(context, line.Geometry, brush, step);
        context.DrawGeometry(null, new Pen(brush, thickness, dash, PenLineCap.Flat), line.Geometry);
        if (e.Trunk is { } trunk && !(e.Flags.HasFlag(EdgeFlags.Hover) && e.Label is not null)) TrunkMarks.Chip(context, trunk.Size, line.Path.Label, brush, Brush("BoxBrush"), Brush("FgBrush"));

        // The marks are Flowy's own shapes (Heads, Kinds.Marks), in the line's colour, as big as the browser draws them: scaled by the traffic width alone, which being picked or lit
        // does not change. A plain line has a filled head on its end (and on its start when connections run both ways); a line with a kind has the kind's head and, running one way,
        // its tail on the start.
        var scale = MarkScaleOf(WidthOf(e.PairId), e.Lanes);
        var ground = Brush("BgBrush");
        var marks = KindKey.MarksOf(e.Look, e.Both);
        KindMarks.Draw(context, marks.Head, brush, ground, line.Path.End, line.Path.Direction, scale);
        if (marks.HeadAtStart) KindMarks.Draw(context, marks.Head, brush, ground, line.Path.Start, line.Path.StartDirection, scale);
        if (marks.Tail is { } tail) KindMarks.Draw(context, tail, brush, ground, line.Path.Start, line.Path.StartDirection, scale);
    }

    /// <summary>
    /// The dashes a line is drawn with, in px as SVG counts them, or null for a solid line. A step's line and a lane keep their own. A kind's pattern shows on a line that is
    /// not lit (a lit line is solid, so the dot has a clean base; one of several side by side keeps its kind's pattern, as the kind is what tells it from its neighbours) and not under a load's traffic (<paramref name="loaded"/>), which paints on top of it; the marks stay either way.
    /// </summary>
    internal static IReadOnlyList<double>? DashesOf(EdgeFlags flags, LineLook? look, bool loaded)
    {
        if (flags.HasFlag(EdgeFlags.Step)) return [8, 5];
        if (flags.HasFlag(EdgeFlags.Lane)) return [4, 5];
        if ((flags.HasFlag(EdgeFlags.Active) && !flags.HasFlag(EdgeFlags.Several)) || look is null || loaded) return null;
        var dashes = Kinds.Dashes(look.Pattern);
        return dashes.Count == 0 ? null : dashes;
    }

    /// <summary>How much bigger than usual a head is on a line a load's traffic gave this width (null: the usual 1.5 thick, scale 1), as the browser's Ends in Line.tsx.</summary>
    internal static double HeadScaleOf(double? traffic) => Heads.Scale(traffic ?? 1.5);

    /// <summary>The scale a line's marks are drawn at: the head scale for its traffic width, held to <see cref="KindKey.LaneMarkScale"/> when the line is one of several side by side, as the browser's Ends in Line.tsx.</summary>
    internal static double MarkScaleOf(double? traffic, int lanes) => KindKey.MarkScale(HeadScaleOf(traffic), lanes);

    private static FormattedText Format(SceneEdge e, string text, IBrush brush) =>
        new(text, CultureInfo.CurrentUICulture, FlowDirection.LeftToRight,
            new Typeface(FontFamily.Default, FontStyle.Normal, e.Flags.HasFlag(EdgeFlags.Active) ? FontWeight.SemiBold : FontWeight.Normal), 11, brush);

    /// <summary>The box a label is drawn in: its text centred on the line's label point, with a little room round it.</summary>
    private static CoreRect LabelBox(LinePath path, FormattedText text) =>
        new(path.Label.X - text.Width / 2 - 4, path.Label.Y - text.Height / 2 - 2, text.Width + 8, text.Height + 4);

    private void DrawLabel(DrawingContext context, Drawn line, string text)
    {
        using var opacity = context.PushOpacity(OpacityOf(line.Edge));
        text = LineLabels.Clip(text);
        var formatted = Format(line.Edge, text, Brush("FgBrush"));
        // The label of a line among others starts with a sample of the line (its pattern and marks), so it is tied to its own line with no leader line.
        var sampled = line.Edge.Lanes > 1 && line.Edge.Pair is not null;
        var sample = sampled ? LineLabels.Sample : 0;
        // A label with no clear place is drawn only while its line is pointed at, then at the middle of the line.
        var hidden = _labelHidden.Contains(line.Edge.Id);
        if (hidden && !_raised.Contains(line.Edge.Id)) return;
        var found = !hidden && _labelAt.TryGetValue(line.Edge.Id, out var placed);
        var box = found ? _labelAt[line.Edge.Id] : LabelBox(line.Path, formatted) with { Width = formatted.Width + 8 + sample };
        if (sampled && !found) box = box with { X = line.Path.Label.X - box.Width / 2 };
        // The label of a line among others is placed beside its lit line already (see LineLabels.BesideLit), clear of a pipe too; a lone line's label steps aside here.
        if (!sampled && IsLifted(line.Edge) && _scene is { } s
            && s.Boxes.FirstOrDefault(b => b.Id == line.Edge.From) is { } a && s.Boxes.FirstOrDefault(b => b.Id == line.Edge.To) is { } b)
        {
            var (x, y) = MotionMath.LabelOffset(b.Rect.X + b.Rect.Width / 2 - (a.Rect.X + a.Rect.Width / 2), b.Rect.Y + b.Rect.Height / 2 - (a.Rect.Y + a.Rect.Height / 2), text.Length);
            box = box with { X = box.X + x, Y = box.Y + y };
        }
        context.DrawRectangle(Brush("BgBrush"), null, new Avalonia.Rect(box.X, box.Y, box.Width, box.Height), 2, 2);
        // A label that runs to the left of its line has the sample at its right end, so the sample is by the line.
        var flipped = found && _labelSide.TryGetValue(line.Edge.Id, out var side) && side < 0;
        if (sampled) LookSwatch.Sketch(context, line.Edge.Look ?? Kinds.PlainLook, false, Brush("EdgeBrush"), Brush("BgBrush"), flipped ? box.X + box.Width - sample + 6 : box.X + 4, flipped ? box.X + box.Width - 4 : box.X + sample - 6, box.Y + box.Height / 2);
        context.DrawText(formatted, new Point(flipped ? box.X + 4 : box.X + 4 + sample, box.Y + 2));
    }
}
