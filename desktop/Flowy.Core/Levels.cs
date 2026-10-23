namespace Flowy.Core;

/// <summary>The levels the reader has left, oldest first, for Esc to go back through. The twin of ui/src/levels.ts.</summary>
public static class Levels
{
    /// <summary>The most levels Esc can step back through.</summary>
    public const int Max = 50;

    /// <summary>The reader moved from <paramref name="from"/> to <paramref name="to"/> on their own: <paramref name="from"/> is where Esc takes them back to. Staying put leaves the list as it is.</summary>
    public static void Remember(List<string> levels, string from, string to)
    {
        if (from == to || (levels.Count > 0 && levels[^1] == from)) return;
        levels.Add(from);
        if (levels.Count > Max) levels.RemoveRange(0, levels.Count - Max);
    }

    /// <summary>
    /// Esc: the level the reader was in before <paramref name="here"/>, taken off the list together with every level after it. A level that is gone (<paramref name="exists"/> says no),
    /// or is the one they are in, is passed over. Null when there is none, and the caller goes up a level instead.
    /// </summary>
    public static string? CameBack(List<string> levels, string here, Func<string, bool> exists)
    {
        for (var i = levels.Count - 1; i >= 0; i--)
        {
            if (levels[i] == here || !exists(levels[i])) continue;
            var to = levels[i];
            levels.RemoveRange(i, levels.Count - i);
            return to;
        }
        return null;
    }
}
