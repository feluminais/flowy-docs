using System.Text.Json;

namespace Flowy.Core;

/// <summary>
/// Which language some code is written in, from cues alone. The C# twin of <c>guessLanguage</c> in src/core/detect.ts, with the same cues
/// (<see cref="DetectData"/> is generated from that table), the same weights and the same answer: <c>null</c> when nothing stands out.
/// </summary>
public static class Detect
{
    /// <summary>Whether the code starts like a JSON document (ignoring spaces and line breaks) and is one.</summary>
    private static bool IsJson(string text)
    {
        var i = 0;
        while (i < text.Length && text[i] is ' ' or '\t' or '\r' or '\n') i++;
        if (i == text.Length || text[i] is not ('{' or '[')) return false;
        try
        {
            // JavaScript's JSON.parse has no depth limit worth the name, so neither has this one.
            using var _ = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 10_000 });
            return true;
        }
        catch (Exception e) when (e is JsonException or ArgumentException)
        {
            return false;
        }
    }

    /// <summary>The id of the language the code is most likely written in, or null. Give it the code as <see cref="Snippets.CodeLines"/> joins it.</summary>
    public static string? Guess(string whole)
    {
        // Only the first part is read, as in guessLanguage: a snippet longer than the limit is a problem to fix, and a huge line must not stall the app.
        var text = whole.Length > Snippets.MaxChars ? whole[..Snippets.MaxChars] : whole;
        if (IsJson(text)) return "json";
        string? best = null;
        var bestScore = 0;
        foreach (var (language, cues) in DetectData.Cues)
        {
            var score = 0;
            foreach (var (pattern, weight) in cues)
            {
                var n = pattern.Matches(text).Count;
                if (n > 0) score += weight + Math.Min(n - 1, 2);
            }
            if (language == "yaml" && DetectData.YamlButCode.IsMatch(text)) score -= 3;
            if (score > bestScore)
            {
                best = language;
                bestScore = score;
            }
        }
        if (best == "cpp" && !DetectData.CppOnly.IsMatch(text)) best = "c";
        return bestScore >= DetectData.MinScore ? best : null;
    }
}
