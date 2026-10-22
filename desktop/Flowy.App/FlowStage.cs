using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// What a flow at one of its stops puts on a canvas and on a player card: where its steps stand on a view, the card's words and bar, the marks on its lines and the
/// steps to play. The reader's one canvas and each pane of a comparison draw a flow through this, so the two cannot drift apart.
/// </summary>
internal static class FlowStage
{
    /// <summary>Where the steps of the stop at <paramref name="index"/> stand on <paramref name="view"/>, with the shapes that take a request off a line lit with them.</summary>
    public static Playing PlayingAt(Model model, string view, Flow flow, IReadOnlyList<Stop> stops, int index)
    {
        // A shape that takes a request off the line (`by`) is lit with the step, so it does not sit at the faint level while it flashes.
        var also = stops[index].Steps.SelectMany(i => Animations.Read(flow.Steps[i])?.By is { Shape: { } taker } && Views.PlaceStep(model, view, taker, null) is { } at ? new[] { at.From } : []).ToList();
        return new Playing(flow.Steps.Select(s => Views.PlaceStep(model, view, s.From, s.To)).ToList(), null, stops[index].Steps, Structure.OtherLaneSteps(stops, index), also.Count > 0 ? also : null);
    }

    /// <summary>The card for the stop at <paramref name="index"/>, and the marks its groups put on the lines.</summary>
    public static (PlayerView Card, List<CanvasView.Mark> Marks) CardAt(
        Model model, Flow flow, string id, IReadOnlyList<Stop> stops, int index, Playing? shown, bool auto, (string Name, int Step)? trail, IReadOnlyList<StateMark> states)
    {
        var stop = stops[index];
        var caption = Captions.Of(flow, stop);
        var steps = stop.Steps.Select((i, n) =>
        {
            var step = flow.Steps[i];
            var ends = step.From is null ? "" : Views.StepEnds(model, step.From, step.To, shown?.Ends[i]);
            var animation = Animations.Read(step);
            var outcome = animation is null ? null : Animations.OutcomeLine(animation, shape => Views.NameOf(model, shape));
            return new PlayerStep(ends, step.Text ?? "", step.Description, n < caption.Lanes.Count ? caption.Lanes[n] : "", LinkOf(model, step), outcome);
        }).ToList();
        var moves = stop.Steps.Any(i => Animations.Read(flow.Steps[i]) is not null && shown?.Ends[i] is not null);
        var card = new PlayerView(string.IsNullOrEmpty(flow.Name) ? id : flow.Name, index, stops.Count, stop.Kind, caption, Captions.ProgressOf(flow, stops), auto, moves, trail, steps, states);
        var marks = stop.Steps
            .Select((i, n) => (Placed: shown?.Ends[i], Text: n < caption.Marks.Count ? caption.Marks[n] : ""))
            .Where(x => x.Placed is not null && x.Text != "" && stop.Kind is not null)
            .Select(x => new CanvasView.Mark(x.Placed!.Value.From, x.Placed.Value.To, x.Text, stop.Kind!))
            .ToList();
        return (card, marks);
    }

    /// <summary>The steps of the stop at <paramref name="index"/> that move, ready for <see cref="CanvasView.PlaySteps"/>; empty when none does.</summary>
    public static List<CanvasView.StepRun> RunsOf(Model model, string view, Flow flow, IReadOnlyList<Stop> stops, int index, Playing shown)
    {
        // Every step of the stop that moves plays at once; the stop has settled when the longest has finished.
        var stop = stops[index];
        var runs = new List<CanvasView.StepRun>();
        foreach (var i in stop.Steps)
        {
            if (Animations.Read(flow.Steps[i]) is not { } animation || shown.Ends[i] is not { } placed) continue;
            runs.Add(new CanvasView.StepRun(animation, placed.From, placed.To, stop.Before.Any(j => Animations.Follows(shown.Ends[j], placed)), TakenBy(model, view, animation, placed)));
        }
        return runs;
    }

    /// <summary>A step's link to another flow, for the card: null when it has none or the flow isn't there.</summary>
    public static LinkedFlow? LinkOf(Model model, Step step)
    {
        if (JsCompat.Blank(step.FlowId)) return null;
        var id = JsCompat.JsTrim(step.FlowId!);
        return model.Flows.TryGetValue(id, out var target) ? new LinkedFlow(id, string.IsNullOrEmpty(target.Name) ? id : target.Name, target.Steps.Count > 0 && Views.IsView(model, target.View)) : null;
    }

    /// <summary>
    /// Who takes an intercepted request, as the view can draw it: the box that stands for the shape in this view, unless that is an end of the step (the view folds
    /// the shape into one of them) or the view can't show it; then its name stands in, drawn as a marker. Null for a step that is not intercepted.
    /// </summary>
    private static CanvasView.TakenBy? TakenBy(Model model, string view, StepAnimation animation, (string From, string To) placed)
    {
        if (animation.By is not { } by) return null;
        if (by.Name is { } name) return new CanvasView.TakenBy(Name: name);
        var box = Views.PlaceStep(model, view, by.Shape, null)?.From;
        return box is not null && box != placed.From && box != placed.To ? new CanvasView.TakenBy(Node: box) : new CanvasView.TakenBy(Name: Views.NameOf(model, by.Shape!));
    }
}
