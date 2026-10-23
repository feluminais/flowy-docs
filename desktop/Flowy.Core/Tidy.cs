namespace Flowy.Core;

/// <summary>An outsider drawn on another side than the view above puts it on.</summary>
public sealed record SideProblem(string View, string Box, Region Drawn, Region Wanted);

/// <summary>
/// Where the neighbours of a view sit when the reader asks for it (Tidy), so that zooming from one box to the next never leads the same way
/// twice. A port of the model-aware half of src/core/layout.ts.
/// </summary>
public static class Tidy
{
    /// <summary>Which side of the box at <paramref name="from"/> the box at <paramref name="to"/> sits on: the side a line between their centres leaves through.</summary>
    public static Region SideOf(Pt from, Pt to)
    {
        var (dx, dy) = (to.X - from.X, to.Y - from.Y);
        if (Math.Abs(dx) * BoxGeometry.BoxHeight > Math.Abs(dy) * BoxGeometry.BoxWidth) return dx > 0 ? Region.Right : Region.Left;
        return dy > 0 ? Region.Below : Region.Above;
    }

    /// <summary>
    /// Where each outsider of a view waits to match the view above: the side it sits on, seen from the box standing for this view, in the view
    /// they share. An outsider with no such view (the box you are inside) is left out.
    /// </summary>
    public static OrderedDictionary<string, Region> NeighbourSides(Model model, string view, IEnumerable<string> outsiders)
    {
        var sides = new OrderedDictionary<string, Region>();
        var shared = new Dictionary<string, OrderedDictionary<string, Pt>>();
        foreach (var id in outsiders)
        {
            if (Views.Meeting(model, view, id) is not { } m || m.There != id) continue;
            if (!shared.TryGetValue(m.View, out var spots)) shared[m.View] = spots = SceneBuilder.ViewSpots(model, m.View);
            if (spots.TryGetValue(m.Here, out var here) && spots.TryGetValue(m.There, out var there)) sides[id] = SideOf(here, there);
        }
        return sides;
    }

    /// <summary>Where an outsider is drawn around the members: above or below their rows, else in the column left or right of them.</summary>
    private static Region DrawnSide(IReadOnlyList<Pt> members, Pt at)
    {
        var top = members.Min(p => p.Y);
        var bottom = members.Max(p => p.Y) + BoxGeometry.BoxHeight;
        if (at.Y + BoxGeometry.BoxHeight <= top) return Region.Above;
        if (at.Y >= bottom) return Region.Below;
        var middle = (members.Min(p => p.X) + members.Max(p => p.X) + BoxGeometry.BoxWidth) / 2;
        return at.X + BoxGeometry.BoxWidth / 2 < middle ? Region.Left : Region.Right;
    }

    /// <summary>The outsiders of a view that are drawn on another side than <see cref="NeighbourSides"/> gives.</summary>
    public static List<SideProblem> SideProblems(Model model, string view)
    {
        var v = Views.Compute(model, view);
        if (v.Members.Count == 0) return [];
        var at = SceneBuilder.SpotsOf(model, view, v, [.. v.Members, .. v.Outsiders]);
        var members = v.Members.Select(id => at[id]).ToList();
        var problems = new List<SideProblem>();
        foreach (var (box, wanted) in NeighbourSides(model, view, v.Outsiders))
        {
            var drawn = DrawnSide(members, at[box]);
            if (drawn != wanted) problems.Add(new SideProblem(view, box, drawn, wanted));
        }
        return problems;
    }

    /// <summary>Where Tidy puts every box of a view: each outsider on the side <see cref="NeighbourSides"/> gives, wherever boxes were dragged before.</summary>
    public static OrderedDictionary<string, Pt> TidySpots(Model model, string view)
    {
        var v = Views.Compute(model, view);
        return SceneBuilder.PlaceCached(v.Members.ToList(), v.Outsiders.ToList(), v.Edges, NeighbourSides(model, view, v.Outsiders));
    }
}
