using Avalonia;
using Avalonia.Controls;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using Avalonia.VisualTree;

namespace Flowy.App;

/// <summary>
/// The command line's own flags, carried out on a window: set up a state in the reader (<c>--view</c>, <c>--select</c>, <c>--tab</c> and the rest), and with
/// <c>--shot</c> save a picture of the window and close it. They exist so a change can be checked without a person looking.
/// </summary>
internal sealed class LaunchScript
{
    private readonly Window _window;
    private readonly ReaderView _reader;

    public LaunchScript(Window window, ReaderView reader)
    {
        _window = window;
        _reader = reader;
    }

    public async Task RunAsync(LaunchOptions options)
    {
        // Let the first layout happen, so the camera knows the canvas's size before it is asked to move.
        await Task.Delay(150);
        Apply(options);
        if (options.Shot is not { } shot) return;
        // On the dispatcher's clock rather than Task.Delay's, so the picture is taken when asked even while an animation is running.
        var wait = TimeSpan.FromMilliseconds(int.TryParse(options.Value("--delay"), out var delay) ? delay : 700);
        DispatcherTimer.RunOnce(() =>
        {
            var scale = double.TryParse(options.Value("--scale"), out var s) && s is >= 1 and <= 4 ? s : 1;
            // --picture is File > Save Picture: the diagram alone, without the bar and the panel.
            if (options.Has("--picture")) _reader.SavePicture(shot, scale);
            else Save(shot, scale);
            _window.Close();
        }, wait, DispatcherPriority.Render);
    }

    private void Apply(LaunchOptions options)
    {
        if (_reader.Folder is null) return;
        if (options.Has("--edit")) _reader.SetEditing(true);
        if (options.Value("--lines") is { } lines) _reader.PickLines(lines);
        if (options.Value("--view") is { } view) _reader.GoTo(view);
        if (options.Value("--flow") is { } flow) _reader.Play(flow, int.TryParse(options.Value("--step"), out var step) ? step : 0);
        // Two flows side by side: --compare a,b (the one that holds a compare tag reads second). A third part, swap, opens them on one canvas that flips between them; it starts on the
        // flow that reads first, and --swapped flips it to the other (with motion on, a short --delay catches the swap half done).
        // Two runs: the value starts with run: (--compare run:a,b[,swap]). The Performance panel is not open for it, and a run that is not there says so in a notice.
        if (options.Value("--compare") is { } compare && compare.Split(',') is [var first, var second, ..])
        {
            var swap = compare.Split(',') is [_, _, var way, ..] && way.Trim() == "swap";
            if (first.Trim().StartsWith("run:", StringComparison.Ordinal)) _reader.OpenRunCompareById(first.Trim()["run:".Length..].Trim(), second.Trim(), swap, options.Has("--swapped"));
            else _reader.OpenCompareById(first.Trim(), second.Trim(), swap, options.Has("--swapped"));
        }
        // --changes turns Show changes on, and --note puts text in the note editor of the pair, as if it had been typed.
        if (options.Has("--changes")) _reader.SetShowChanges(true);
        if (options.Value("--note") is { } note) _reader.PrefillNote(note);
        if (options.Has("--pair")) _reader.AskToPair(); // the confirm of Save as pair
        if (options.Has("--leave")) _reader.TryCloseCompare(); // Close, which asks "Discard the note?" when a note is typed
        if (options.Value("--run") is { } run) _reader.PickRunById(run);
        if (options.Value("--tab") is { } tab) _reader.OpenTab(tab); // before --select: with Failures open, a select picks a failure mode
        if (options.Value("--select") is { } select) _reader.Select(select);
        if (options.Value("--at") is { } at)
        {
            // A load or a time for a run of one source; a load for each dial, separated by commas (--at 200,100), for a run with several.
            var numbers = at.Split(',').Select(n => double.TryParse(n, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var v) ? (double?)v : null).ToList();
            if (numbers.Count > 1 && numbers.All(n => n is not null)) _reader.GoToLoads([.. numbers.Select(n => n!.Value)]);
            else if (numbers is [{ } time]) _reader.GoToTime(time);
        }
        if (options.Has("--add")) _reader.OpenAddPanel();
        if (options.Value("--edit-flow") is { } editFlow) _reader.OpenFlowEditor(editFlow);
        if (options.Has("--remove-link")) _reader.AskToRemoveFlowLink(); // the flow form's Remove, which asks "Remove the link and its note" when the link holds a note
        if (options.Value("--line") is { } line && line.Split(' ') is [var from, var to]) _reader.OpenLine(from, to);
        if (options.Value("--hover") is { } hover) _reader.SetHover(hover);
        if (options.Value("--search") is { } search) _reader.OpenSearch(search);
        if (options.Has("--shortcuts")) _reader.ShowShortcuts();
        if (options.Value("--zoom") is { } zoom) _reader.OpenBox(zoom);
        // --delete asks to delete the shapes named (separated by commas), which opens the Used by panel when something depends on them; --remove-all then settles every row.
        if (options.Value("--delete") is { } delete) _reader.AskDelete([.. delete.Split(',').Select(id => new Flowy.Core.Target(Object: id))]);
        if (options.Has("--remove-all")) _reader.UsedByNow?.PressRemoveAll();
    }

    private void Save(string path, double scale)
    {
        // Rendering a picture does not lay anything out first: do it, so controls added a moment ago are in place.
        _window.UpdateLayout();
        // A card's drop shadow comes out wrong when a bitmap is drawn at more than its own size: the card is blank. Cards are drawn flat for it.
        var shadowed = scale > 1 ? _window.GetVisualDescendants().OfType<Border>().Where(b => b.BoxShadow.Count > 0).Select(b => (Border: b, b.BoxShadow)).ToList() : [];
        foreach (var (border, _) in shadowed) border.BoxShadow = default;
        try
        {
            var bounds = _window.Bounds;
            using var bitmap = new RenderTargetBitmap(new PixelSize((int)(bounds.Width * scale), (int)(bounds.Height * scale)), new Vector(96 * scale, 96 * scale));
            bitmap.Render(_window);
            bitmap.Save(path, PngBitmapEncoderOptions.Default);
        }
        finally
        {
            foreach (var (border, shadow) in shadowed) border.BoxShadow = shadow;
        }
    }
}
