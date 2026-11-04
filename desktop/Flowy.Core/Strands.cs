namespace Flowy.Core;

/// <summary>
/// Which line of a pair a flow step rides, where a project draws a line for each connection (<c>pairs: separate</c>, see <see cref="View.Strands"/>). The step says it with <c>via</c>, the label
/// of the connection; when it does not, the payload, the direction or the order of the file decide. A port of src/core/strands.ts.
/// </summary>
public static class Strands
{
    /// <summary>How a <c>via</c> is compared with a label: with the space at its ends cut off, and whatever the case.</summary>
    public static string ViaKey(string? text) => text is null ? "" : JsCompat.JsLower(JsCompat.JsTrim(text));

    /// <summary>
    /// The strands a step between <paramref name="placed"/> can ride, in the order they are tried: the strands of the pair that run the step's way, in lane order, then the strands of a request
    /// or a stream that run against it, since the answer to a request comes back along the line the request went. Empty when the view draws one line for each pair.
    /// </summary>
    public static List<Strand> Candidates(View view, (string From, string To) placed)
    {
        if (view.Strands is null) return [];
        var pair = Views.LineKey(placed.From, placed.To);
        var ofPair = view.Strands.Where(s => s.Pair == pair).ToList();
        var same = ofPair.Where(s => s.From == placed.From && s.To == placed.To);
        var replies = ofPair.Where(s => s.From == placed.To && s.To == placed.From && s.Kind is "request" or "stream");
        return [.. same, .. replies];
    }

    /// <summary>
    /// The strand a step rides, or null when it rides none. Of the candidates (see <see cref="Candidates"/>), the first of these decides: the one whose label is the step's <c>via</c>; the one whose
    /// connection lists the step's payload; the one whose own connection runs between the step's own shapes; the first, in lane order. A <c>via</c> that matches nothing is not an error here.
    /// </summary>
    public static Strand? StrandOf(Model model, View view, Step step, (string From, string To) placed)
    {
        var candidates = Candidates(view, placed);
        if (candidates.Count == 0) return null;
        var via = ViaKey(step.Via);
        if (via != "" && candidates.FirstOrDefault(s => ViaKey(s.Label) == via) is { } named) return named;
        if (step.Payload is string payload
            && candidates.FirstOrDefault(s => s.Connections.Any(i => model.Connections[i].Payloads is List<object?> listed && listed.Any(p => p is string id && id == payload))) is { } carrying) return carrying;
        if (step.To is not null
            && candidates.FirstOrDefault(s => s.Connections.Any(i => model.Connections[i].From == step.From && model.Connections[i].To == step.To)) is { } own) return own;
        return candidates[0];
    }

    /// <summary>For each pair of shapes a view draws, the labels (as <see cref="ViaKey"/> has them) of the connections that land on it.</summary>
    public static Dictionary<string, HashSet<string>> PairLabels(Model model, string view)
    {
        var labels = new Dictionary<string, HashSet<string>>();
        foreach (var c in model.Connections)
        {
            if (Views.PlaceEnds(model, view, c.From, c.To) is not { } ends) continue;
            var key = Views.LineKey(ends.From, ends.To);
            if (!labels.TryGetValue(key, out var set)) labels[key] = set = [];
            set.Add(ViaKey(c.Label));
        }
        return labels;
    }

    private static bool Matches(Dictionary<string, HashSet<string>> labels, Step step, (string From, string To) placed) =>
        ViaKey(step.Via) == "" || (labels.TryGetValue(Views.LineKey(placed.From, placed.To), out var set) && set.Contains(ViaKey(step.Via)));

    /// <summary>
    /// What is wrong with a step's <c>via</c>, worded to follow "step N:": it names no connection between the shapes the step lands on, or null when it names one, there is no <c>via</c>, or
    /// the step is not between two shapes of its view. <paramref name="labels"/> are those of the view the step's flow plays on (see <see cref="PairLabels"/>).
    /// </summary>
    public static string? ViaProblem(Dictionary<string, HashSet<string>> labels, Step step, (string From, string To)? placed)
    {
        if (step.Via is null || ViaKey(step.Via) == "" || step.To is null || placed is not { } at || at.From == at.To) return null;
        return Matches(labels, step, at) ? null : $"\"via\" {JsCompat.Json(step.Via)} matches no connection from {at.From} to {at.To}";
    }

    /// <summary>The steps whose <c>via</c> named a connection in <paramref name="before"/> and names none in <paramref name="after"/>, as a flow id and the step's place from 0.</summary>
    public static List<(string Flow, int Step)> ViaBroken(Model before, Model after)
    {
        var broken = new List<(string, int)>();
        var labels = new Dictionary<string, (Dictionary<string, HashSet<string>> Before, Dictionary<string, HashSet<string>> After)>();
        foreach (var (flow, f) in before.Flows)
        {
            for (var i = 0; i < f.Steps.Count; i++)
            {
                var step = f.Steps[i];
                if (ViaKey(step.Via) == "" || step.To is null) continue;
                if (Views.PlaceStep(before, f.View, step.From, step.To) is not { } placed || placed.From == placed.To) continue;
                if (!labels.TryGetValue(f.View!, out var seen)) labels[f.View!] = seen = (PairLabels(before, f.View!), PairLabels(after, f.View!));
                if (Matches(seen.Before, step, placed) && !Matches(seen.After, step, placed)) broken.Add((flow, i));
            }
        }
        return broken;
    }
}
