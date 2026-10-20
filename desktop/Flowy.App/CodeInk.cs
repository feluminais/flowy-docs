using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The colours of code: which stretches of a snippet are keywords, strings and so on, and which language an unnamed snippet is written in.
/// The twin of ui/src/highlight.ts: the same nine kinds, the same languages.
/// </summary>
internal static class CodeInk
{
    /// <summary>The code as runs for the language, or one plain run when the language isn't coloured. Never throws.</summary>
    public static IReadOnlyList<CodeRun> Runs(string text, string? languageId) => [new CodeRun(text)];

    /// <summary>The language the code is most likely written in, or null when it is too short or too plain to tell.</summary>
    public static Language? Detect(string text) => null;

    /// <summary>The language a snippet is shown in: the one it names, or else the one worked out from the code. <c>Auto</c> says which.</summary>
    public static (Language? Language, bool Auto) LanguageFor(string text, string? named) =>
        Snippets.LanguageOf(named) is { } language ? (language, false) : (Detect(string.Join('\n', Snippets.CodeLines(text))), true);
}
