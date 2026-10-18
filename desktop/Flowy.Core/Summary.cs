namespace Flowy.Core;

/// <summary>A few lines of text about a loaded folder: what the window shows until the canvas exists.</summary>
public static class Summary
{
    private static string Count(int n, string one, string many) => $"{n} {(n == 1 ? one : many)}";

    public static string Describe(Folder folder)
    {
        var m = folder.Model;
        var lines = new List<string>
        {
            $"{Count(m.Objects.Count, "box", "boxes")}, {Count(m.Connections.Count, "connection", "connections")}, {Count(m.Flows.Count, "flow", "flows")}, {Count(folder.Problems.Count, "problem", "problems")}",
        };
        lines.AddRange(folder.Problems.Select(p => $"  {p.File}: {p.Message}"));
        return string.Join('\n', lines);
    }
}
