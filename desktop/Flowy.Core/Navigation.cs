using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>How moving from one view to another should feel: into a box inside, out to one around, or across to one beside.</summary>
public enum Move { In, Out, Across }

/// <summary>A line touching a box, as the canvas draws it where the box sits: the box at its other end, and the connections it stands for.</summary>
public sealed record BoxLine(string From, string To, string Other, IReadOnlyList<Connection> Connections);

/// <summary>Where the canvas shows a problem: the view to open, and the box, line or flow step in it.</summary>
public sealed record Spot(string View, string? Object = null, (string From, string To)? Line = null, string? Flow = null, int? Step = null, (string Analysis, string? Mode)? Failure = null);

/// <summary>What one press of Escape closes, innermost first.</summary>
public enum EscapeStep { Shortcuts, Navigator, Flow, Panel, Compare, Up }

/// <summary>The reading half of ui/src/edit.ts, ui/src/search.ts and ui/src/keys.ts, and the teaser of ui/src/Box.tsx.</summary>
public static class Navigation
{
    /// <summary>Which way <paramref name="to"/> lies from <paramref name="from"/> in the nesting. Opening a box that sits beside the one you're in is across, so going there and back never dives in twice.</summary>
    public static Move MoveBetween(Model model, string from, string to)
    {
        if (Views.Chain(model, to).Contains(from)) return Move.In;
        if (Views.Chain(model, from).Contains(to)) return Move.Out;
        return Move.Across;
    }

    /// <summary>The connections one line of a view stands for, with their place in model.connections.</summary>
    public static List<(int Index, Connection Connection)> ConnectionsOf(Model model, string view, string from, string to) =>
        model.Connections.Select((connection, index) => (index, connection))
            .Where(x => Views.PlaceEnds(model, view, x.connection.From, x.connection.To) is { } ends && ends.From == from && ends.To == to)
            .ToList();

    /// <summary>The lines touching box <paramref name="id"/> in the view it sits in, going out and coming in.</summary>
    public static (List<BoxLine> Out, List<BoxLine> In) LinesOf(Model model, string id)
    {
        var view = Views.ParentOf(model, id);
        // One pass, grouped by where each connection lands: asking ConnectionsOf per line rescans every connection each time.
        var byEnds = new Dictionary<(string From, string To), List<Connection>>();
        var order = new List<(string From, string To)>();
        foreach (var c in model.Connections)
        {
            if (Views.PlaceEnds(model, view, c.From, c.To) is not { } ends || (ends.From != id && ends.To != id)) continue;
            if (!byEnds.TryGetValue(ends, out var list))
            {
                byEnds[ends] = list = [];
                order.Add(ends);
            }
            list.Add(c);
        }
        var lines = order.Select(e => new BoxLine(e.From, e.To, e.From == id ? e.To : e.From, byEnds[e])).ToList();
        return (lines.Where(l => l.From == id).ToList(), lines.Where(l => l.To == id).ToList());
    }

    public static Spot Locate(Model model, Problem problem)
    {
        if (problem.Id is not null && model.GetObject(problem.Id) is not null) return new Spot(Views.ParentOf(model, problem.Id), problem.Id);
        var c = problem.Connection is { } i && i < model.Connections.Count ? model.Connections[i] : null;
        if (c is not null)
        {
            var end = new[] { c.From, c.To }.FirstOrDefault(e => model.GetObject(e) is not null);
            if (end is null) return new Spot(Names.Root);
            // The lowest view, from one end up, that shows the line (a line to a box's own child shows inside that box), else that end's box.
            foreach (var view in Views.Chain(model, end))
                if (Views.PlaceEnds(model, view, c.From, c.To) is { } line) return new Spot(view, Line: line);
            return new Spot(Views.ParentOf(model, end), end);
        }
        if (FolderLayout.FailureIdOf(problem.File) is { } aid && model.Failures.Contains(aid))
        {
            // A mode's problems start with its id and ": " (the id is no shape id: it never names an object). The longest id that fits is the mode.
            var modes = model.Failures[aid].Modes;
            var mode = modes.Keys.Where(id => problem.Message.StartsWith($"{id}: ", StringComparison.Ordinal)).OrderByDescending(id => id.Length).FirstOrDefault();
            return mode is null ? new Spot(Names.Root, Failure: (aid, null)) : new Spot(Failures.HomeView(model, modes[mode]), Failure: (aid, mode));
        }
        if (FolderLayout.FlowIdOf(problem.File) is { } id && model.Flows.Contains(id))
        {
            var view = model.Flows[id].View;
            return new Spot(Views.IsView(model, view) ? view! : Names.Root, Flow: id, Step: problem.Step);
        }
        return new Spot(Names.Root);
    }

    /// <summary>An object's own problems, and those of connections that touch it (a broken connection draws no line to click).</summary>
    public static List<Problem> ProblemsOf(Model model, IEnumerable<Problem> problems, string id) =>
        problems.Where(p =>
        {
            var c = p.Connection is { } i && i < model.Connections.Count ? model.Connections[i] : null;
            return p.Id == id || c?.From == id || c?.To == id;
        }).ToList();

    /// <summary>
    /// Objects whose name and id, together, hold every word of <paramref name="query"/>, ignoring case. Names that start with the first
    /// word come first, then the rest in model order. At most <paramref name="limit"/> of them.
    /// </summary>
    public static List<string> FindObjects(Model model, string query, int limit = 8)
    {
        var words = Regex.Split(query.ToLowerInvariant(), @"\s+").Where(w => w != "").ToList();
        if (words.Count == 0) return [];
        string Name(string id) => (model.Objects[id].Name ?? "").ToLowerInvariant();
        var hits = model.Objects.Keys.Where(id => words.All(w => $"{Name(id)} {id}".Contains(w, StringComparison.Ordinal))).ToList();
        bool Starts(string id) => Name(id).StartsWith(words[0], StringComparison.Ordinal);
        return hits.Where(Starts).Concat(hits.Where(id => !Starts(id))).Take(limit).ToList();
    }

    /// <summary>An id made from a name ("Orders DB" becomes "orders-db"), with -2, -3 and so on when it is taken, in any letter case.</summary>
    public static string NewId(string name, IEnumerable<string> taken, string fallback)
    {
        var plain = name;
        try
        {
            plain = new string(name.Normalize(System.Text.NormalizationForm.FormKD).Where(c => System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c) is not
                (System.Globalization.UnicodeCategory.NonSpacingMark or System.Globalization.UnicodeCategory.SpacingCombiningMark or System.Globalization.UnicodeCategory.EnclosingMark)).ToArray());
        }
        catch (Exception e) when (e is PlatformNotSupportedException or ArgumentException)
        {
            // no normalization data on this system: accents then stay as they are, and become dashes below
        }
        var lower = plain.ToLowerInvariant();
        var dashed = Regex.Replace(lower, "[^a-z0-9]+", "-");
        var baseId = (dashed.Length > 40 ? dashed[..40] : dashed).Trim('-');
        if (baseId == "") baseId = fallback;
        var used = taken.Select(id => id.ToLowerInvariant()).ToHashSet();
        for (var n = 1; ; n++)
        {
            var id = n == 1 ? baseId : $"{baseId}-{n}";
            if (Names.IsValidId(id) && !used.Contains(id)) return id;
        }
    }

    /// <summary>The first paragraph of a description: everything up to the first blank line.</summary>
    public static string? Teaser(string? description) =>
        description is null ? null : Regex.Split(description.Trim(), @"\n\s*\n")[0];

    /// <summary>
    /// Escape peels one layer per press: the shortcut list, the navigator (Flows and Explorer) when it is the last thing you used, a flow playing,
    /// the Details or Performance panel, a comparison of two flows (which takes the place of the flow playing, so the two are never open together), and then the box you're inside, back up
    /// to the level above. At the top, with nothing open, nothing.
    /// <paramref name="navigator"/> is true only when the navigator is open and your last click or key was in it: Escape in the diagram leaves it alone.
    /// </summary>
    public static EscapeStep? Escape(bool shortcuts, bool navigator, bool flow, bool panel, bool compare, bool inside)
    {
        if (shortcuts) return EscapeStep.Shortcuts;
        if (navigator) return EscapeStep.Navigator;
        if (flow) return EscapeStep.Flow;
        if (panel) return EscapeStep.Panel;
        if (compare) return EscapeStep.Compare;
        return inside ? EscapeStep.Up : null;
    }
}
