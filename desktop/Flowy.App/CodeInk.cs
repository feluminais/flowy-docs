using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// The colours of code: which stretches of a snippet are keywords, strings and so on, and which language an unnamed snippet is written in.
/// The twin of ui/src/highlight.ts, and it says the same because it runs the same highlight.js (<see cref="Hljs"/>) and works the language out
/// from the same cues (<see cref="Detect"/>).
/// </summary>
internal static class CodeInk
{
    // What the colours of a piece of code came to, by the code and its language. A panel is built again for every step, selection and reload, and the same snippets come back each time: colouring
    // is a script run by an interpreter (170 ms for 8,000 characters), and a snippet it gives up on would cost its whole timeout again every time.
    private static readonly BoundedCache<(string Text, string Language), IReadOnlyList<CodeRun>> Coloured = new(400);

    /// <summary>The code as runs for the language, or one plain run when the language isn't coloured (plain text, or one with no grammar). Never throws.</summary>
    public static IReadOnlyList<CodeRun> Runs(string text, string? languageId) =>
        languageId is null or "text" || text.Length > Snippets.MaxChars
            ? [new CodeRun(text)]
            : Coloured.GetOrAdd((text, languageId), key => Hljs.Highlight(key.Text, key.Language) is not { } html ? [new CodeRun(key.Text)] : CodeRuns.FromHtml(html));

    /// <summary>
    /// Colours the snippets of these shapes on another thread, so a panel that shows one finds it done. Starts the engine too, so even the first one does not wait for it. The snippets of a big
    /// model are not all worked through: the first ones, which are the ones a reader is most likely to open.
    /// </summary>
    public static void Prefetch(IEnumerable<FlowyObject> objects) => Task.Run(() =>
    {
        Hljs.Highlight("{}", "json");
        var done = 0;
        foreach (var o in objects)
            foreach (var snippet in Snippets.Of(o))
            {
                if (done++ >= 60) return;
                var (language, _) = LanguageFor(snippet.Text, snippet.Language);
                Runs(string.Join('\n', Snippets.CodeLines(snippet.Text)), language?.Id);
            }
    });

    /// <summary>The language the code is most likely written in, or null when it is too short or too plain to tell, which is drawn as plain text.</summary>
    public static Language? Identify(string text) => Snippets.LanguageOf(Detect.Guess(text));

    /// <summary>The language a snippet is shown in: the one it names, or else the one worked out from the code. <c>Auto</c> says which.</summary>
    public static (Language? Language, bool Auto) LanguageFor(string text, string? named) =>
        Snippets.LanguageOf(named) is { } language ? (language, false) : (Identify(string.Join('\n', Snippets.CodeLines(text))), true);
}
