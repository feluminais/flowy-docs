using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// What a flow at one of its stops puts on a canvas and on a player card: where its steps stand on a view, the card's words and bar, the marks on its lines and the
/// steps to play. The reader's one canvas and each pane of a comparison draw a flow through this, so the two cannot drift apart.
/// </summary>
internal static class FlowStage
{
    /// <summary>
    /// Where the steps of the stop at <paramref name="index"/> stand on <paramref name="view"/>, with the shapes that take a request off a line lit with them. <paramref name="lineStyle"/> is how lines are
    /// drawn here: where a pair has more lines than fit across its shapes they are folded into trunks, which depends on it (see <see cref="Trunks.Draw"/>).
    /// </summary>
    public static Playing PlayingAt(Model model, string view, Flow flow, IReadOnlyList<Stop> stops, int index, string lineStyle = "straight")
    {
        // A shape that takes a request off the line (`by`) is lit with the step, so it does not sit at the faint level while it flashes.
        var also = stops[index].Steps.SelectMany(i => Animations.Read(flow.Steps[i])?.By is { Shape: { } taker } && Views.PlaceStep(model, view, taker, null) is { } at ? new[] { at.From } : []).ToList();
        var ends = flow.Steps.Select(s => Views.PlaceStep(model, view, s.From, s.To)).ToList();
        return new Playing(ends, null, stops[index].Steps, Structure.OtherLaneSteps(stops, index), also.Count > 0 ? also : null, StrandsOf(model, view, flow, ends, lineStyle));
    }

    /// <summary>
    /// Where a project draws a line for each connection, the line each step of the flow rides (the id of its strand, see <see cref="Strands.StrandOf"/>; null for a step that rides none).
    /// Null where a pair is one line. A step that rides a line folded into a trunk rides the trunk (see <see cref="Trunks.DrawnStrandOf"/>).
    /// </summary>
    public static List<string?>? StrandsOf(Model model, string view, Flow flow, IReadOnlyList<(string From, string To)?> ends, string lineStyle = "straight")
    {
        if (model.Pairs != "separate") return null;
        var drawn = Trunks.Draw(model, view, lineStyle);
        return [.. ends.Select((placed, i) => placed is { } at ? Trunks.DrawnStrandOf(model, drawn, flow.Steps[i], at) : null)];
    }

    /// <summary>No pair is parted: what a stop asks of the lines when none of its steps rides a pair of several.</summary>
    public static readonly IReadOnlyDictionary<string, PartPlan> NoPlans = new Dictionary<string, PartPlan>();

    /// <summary>
    /// What the stop at <paramref name="index"/> asks of the lines of each pair it rides, where a project draws a line for each connection: which of the pair's lines are lit, and when the earliest
    /// <c>part</c> beat of the steps on it starts (see <see cref="Parts.PlanOf"/>). <paramref name="shown"/> says which line each step rides. Empty for a pair of one line, and where a pair is one line.
    /// </summary>
    public static IReadOnlyDictionary<string, PartPlan> PartsAt(Model model, string view, Flow flow, IReadOnlyList<Stop> stops, int index, Playing? shown, string lineStyle = "straight")
    {
        // The lines as drawn: a pair with more lines than fit has them as trunks, and a trunk is one lane of its pair.
        if (shown?.Strands is not { } ridden || Trunks.Draw(model, view, lineStyle).View.Strands is not { } strands) return NoPlans;
        var stop = stops[index];
        var lanes = strands.ToDictionary(s => s.Id, s => s.Lanes);
        var steps = new List<(string? Strand, IReadOnlyList<Beat>? Beats)>();
        foreach (var i in stop.Steps)
        {
            var id = i < ridden.Count ? ridden[i] : null;
            if (id is not null && Payloads.MotionOf(model, flow.Steps[i]) is { } animation && shown.Ends[i] is { } placed && lanes.TryGetValue(id, out var n))
                steps.Add((id, Animations.BeatsFor(animation, 0, stop.Before.Any(j => Animations.Follows(shown.Ends[j], placed)), n).Beats));
            else steps.Add((id, null));
        }
        var plans = Parts.PlanOf(strands, steps);
        return plans.Count == 0 ? NoPlans : plans;
    }

    /// <summary>The card for the stop at <paramref name="index"/>, and the marks its groups put on the lines.</summary>
    public static (PlayerView Card, List<CanvasView.Mark> Marks) CardAt(
        Model model, Flow flow, string id, IReadOnlyList<Stop> stops, int index, Playing? shown, bool showsPause, (string Name, int Step)? trail, IReadOnlyList<StateMark> states,
        IReadOnlyDictionary<int, Change>? changes = null, IReadOnlyList<string>? channels = null, bool auto = false)
    {
        var stop = stops[index];
        var caption = Captions.Of(flow, stop);
        var steps = stop.Steps.Select((i, n) =>
        {
            var step = flow.Steps[i];
            var ends = step.From is null ? "" : Views.StepEnds(model, step.From, step.To, shown?.Ends[i]);
            var animation = Animations.Read(step);
            var outcome = animation is null ? null : Animations.OutcomeLine(animation, shape => Views.NameOf(model, shape));
            // What a step leaves open or closes is not a failure, so it is told in the card's own colour, not the outcome's.
            var channel = outcome is null && animation is not null ? Animations.ChannelLine(animation) : null;
            return new PlayerStep(ends, step.Text ?? "", step.Description, n < caption.Lanes.Count ? caption.Lanes[n] : "", LinkOf(model, step), outcome ?? channel, channel is not null)
            {
                Sends = Payloads.OfStep(model, step), Reply = Payloads.ReplyOf(model, step),
            };
        }).ToList();
        var moves = stop.Steps.Any(i => Animations.Read(flow.Steps[i]) is not null && shown?.Ends[i] is not null);
        var progress = Captions.ProgressOf(flow, stops);
        // A cell takes the mark of the steps of its stop (by file step number), when a comparison is marking this flow.
        var cells = changes is null ? null : progress.Cells.Select(c => CompareUi.ChangeOfStop(stops[c.Stop].Steps, changes)).ToList();
        var card = new PlayerView(string.IsNullOrEmpty(flow.Name) ? id : flow.Name, index, stops.Count, stop.Kind, caption, progress, showsPause, moves, trail, steps, states, cells, channels, auto);
        var marks = stop.Steps
            .Select((i, n) => (Placed: shown?.Ends[i], Text: n < caption.Marks.Count ? caption.Marks[n] : ""))
            .Where(x => x.Placed is not null && x.Text != "" && stop.Kind is not null)
            .Select(x => new CanvasView.Mark(x.Placed!.Value.From, x.Placed.Value.To, x.Text, stop.Kind!))
            .ToList();
        return (card, marks);
    }

    /// <summary>
    /// The card of every stop of the flow, for <see cref="PlayerCard"/> to keep the size of the tallest: what each stop says, with the states and the kinds of channel the
    /// flow has by then (whether or not this view can show them, so the room is never too small).
    /// </summary>
    public static PlayerCard.Every EveryCard(Model model, string view, Flow flow, string id, IReadOnlyList<Stop> stops, Playing? shown, (string Name, int Step)? trail, IReadOnlyDictionary<int, Change>? changes = null) =>
        new((model, view, flow, stops, trail, changes), () => [.. Enumerable.Range(0, stops.Count).Select(k =>
            CardAt(model, flow, id, stops, k, shown, false, trail, [.. States.Marks(model, States.At(flow, stops, k)).Values], changes, Channels.KindsOf(Channels.At(flow, stops, k))).Card)]);

    /// <summary>
    /// What the flow has left open by the stop at <paramref name="index"/>, with where each channel lands in <paramref name="view"/>: a stream and a listener need two boxes (the view may fold
    /// both ends into one, and then there is nothing to draw between), a job only the one it runs on. The step whose motion decides when a mark comes or goes is the one that opens it,
    /// or the one in this stop that closes it.
    /// </summary>
    public static List<CanvasView.OpenChannel> OpenAt(Model model, string view, Flow flow, IReadOnlyList<Stop> stops, int index, string lineStyle = "straight")
    {
        var open = new List<CanvasView.OpenChannel>();
        var laid = model.Pairs == "separate" ? Trunks.Draw(model, view, lineStyle) : null;
        var slots = laid?.View.Strands is { } drawn ? Lanes.SlotsOf(drawn) : null;
        foreach (var channel in Channels.At(flow, stops, index))
        {
            if (Views.PlaceStep(model, view, channel.From, channel.To) is not { } placed) continue;
            if (channel.Kind != "job" && placed.From == placed.To) continue;
            var by = channel.Opening ? channel.Step : stops[index].Steps.Cast<int?>().FirstOrDefault(i => channel.Name is not null && Animations.Read(flow.Steps[i!.Value])?.Closes == channel.Name);
            var motion = by is { } step ? Animations.Read(flow.Steps[step]) : null;
            var motionAt = by is { } s2 ? Views.PlaceStep(model, view, flow.Steps[s2].From, flow.Steps[s2].To) : null;
            // Where each connection is a line of its own, a stream and a listener belong to the line of the step that opened them.
            var strand = laid is null || placed.From == placed.To ? null : Trunks.DrawnStrandOf(model, laid, flow.Steps[channel.Step], placed);
            open.Add(new CanvasView.OpenChannel(channel, placed.From, placed.To, motion, motionAt?.From, motionAt?.To,
                strand, strand is null ? null : slots![strand], strand is null ? null : laid!.View.Strands!.First(s => s.Id == strand).Pair));
        }
        return open;
    }

    /// <summary>The steps of the stop at <paramref name="index"/> that move, ready for <see cref="CanvasView.PlaySteps"/>; empty when none does.</summary>
    public static List<CanvasView.StepRun> RunsOf(Model model, string view, Flow flow, IReadOnlyList<Stop> stops, int index, Playing shown, IReadOnlyDictionary<string, PartPlan>? plans = null, string lineStyle = "straight")
    {
        // Every step of the stop that moves plays at once; the stop has settled when the longest has finished.
        var stop = stops[index];
        var runs = new List<CanvasView.StepRun>();
        // Where a project draws a line for each connection, the pipe of a step runs along the line it rides.
        var strands = shown.Strands is null ? null : Trunks.Draw(model, view, lineStyle).View.Strands ?? [];
        var slots = strands is null ? null : Lanes.SlotsOf(strands);
        plans ??= PartsAt(model, view, flow, stops, index, shown, lineStyle);
        foreach (var i in stop.Steps)
        {
            // The dots say what the step's payloads are called (see Payloads.MotionOf).
            if (Payloads.MotionOf(model, flow.Steps[i]) is not { } animation || shown.Ends[i] is not { } placed) continue;
            // What its dots carry: the reply on the answer's way back, the payload on every other dot (see DotCard).
            var strand = shown.Strands is { } ridden && i < ridden.Count ? ridden[i] : null;
            runs.Add(new CanvasView.StepRun(animation, placed.From, placed.To, stop.Before.Any(j => Animations.Follows(shown.Ends[j], placed)), TakenBy(model, view, animation, placed),
                Payloads.OfDot(model, flow.Steps[i], null)?.Shown, Payloads.OfDot(model, flow.Steps[i], "reply")?.Shown, strand, strand is not null && slots is not null && slots.TryGetValue(strand, out var slot) ? slot : null,
                // Where the lines of its pair part around the lit ones, what runs along it is laid out on the line as it stands once they have.
                strand is not null && strands!.FirstOrDefault(s => s.Id == strand)?.Pair is { } pair && plans.TryGetValue(pair, out var plan) ? plan.Lit : null));
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
