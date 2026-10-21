using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The colours of code: which stretches of a snippet are keywords, strings and so on, and which language an unnamed snippet is written in.
/// The twin of ui/src/highlight.ts, and it says the same because it runs the same highlight.js (<see cref="Hljs"/>) and works the language out
/// from the same cues (<see cref="Detect"/>).
/// </summary>
internal static class CodeInk
{
    /// <summary>The code as runs for the language, or one plain run when the language isn't coloured (plain text, or one with no grammar). Never throws.</summary>
    public static IReadOnlyList<CodeRun> Runs(string text, string? languageId) =>
        languageId is null or "text" || text.Length > Snippets.MaxChars || Hljs.Highlight(text, languageId) is not { } html ? [new CodeRun(text)] : CodeRuns.FromHtml(html);

    /// <summary>The language the code is most likely written in, or null when it is too short or too plain to tell, which is drawn as plain text.</summary>
    public static Language? Identify(string text) => Snippets.LanguageOf(Detect.Guess(text));

    /// <summary>The language a snippet is shown in: the one it names, or else the one worked out from the code. <c>Auto</c> says which.</summary>
    public static (Language? Language, bool Auto) LanguageFor(string text, string? named) =>
        Snippets.LanguageOf(named) is { } language ? (language, false) : (Identify(string.Join('\n', Snippets.CodeLines(text))), true);
}
