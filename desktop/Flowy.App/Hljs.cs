using System.Diagnostics;
using System.Reflection;
using Jint;
using Jint.Constraints;

namespace Flowy.App;

/// <summary>
/// highlight.js, run in-process: the same script the canvas colours code with (Assets/hljs.js, built from ui/src/hljs.ts), so a snippet gets the
/// same colours and the same language in the app and in the browser. Jint is a JavaScript interpreter written in C#; nothing here is a web view
/// and nothing from the model runs as script, the code is only ever passed in as a string. Slow code is stopped, and a failure gives no answer.
/// </summary>
/// <param name="load">How long loading the script may take.</param>
/// <param name="snippet">How long one snippet may take.</param>
/// <param name="pattern">How long one pattern may take over one snippet.</param>
internal sealed class Hljs(TimeSpan load, TimeSpan snippet, TimeSpan pattern)
{
    /// <summary>
    /// The one the app colours with. Loading the script gets far longer than a snippet does: a load that runs out of time on a busy machine would
    /// leave the engine broken, and every snippet plain, until the app is started again.
    /// </summary>
    private static readonly Hljs App = new(TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(2), TimeSpan.FromMilliseconds(500));

    private readonly object _gate = new();
    private Engine? _engine;
    private bool _broken;

    /// <summary>Why the last answer was null when it was not for a missing grammar, so a test that gets null can say why.</summary>
    internal Exception? LastError { get; private set; }

    private Engine? Start()
    {
        if (_engine is not null || _broken) return _engine;
        try
        {
            using var stream = typeof(Hljs).Assembly.GetManifestResourceStream("hljs.js") ?? throw new InvalidOperationException("hljs.js is not in the app");
            using var reader = new StreamReader(stream);
            // A slow pattern is stopped by its own timeout, not by the script's: the engine counts the one only between statements.
            var budget = new Budget { Limit = load };
            var engine = new Engine(o => o.Constraint(budget).RegexTimeoutInterval(pattern).LimitMemory(160L * 1024 * 1024));
            BoundPatterns(engine, pattern);
            var options = new ScriptPreparationOptions { ParsingOptions = ScriptParsingOptions.Default with { RegexTimeout = pattern } }; // the script's own /literals/
            engine.Execute(Engine.PrepareScript(reader.ReadToEnd(), options: options));
            budget.Limit = snippet;
            return _engine = engine;
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            _broken = true;
            LastError = e;
            return null;
        }
    }

    /// <summary>
    /// Gives the patterns the script builds while it runs (every grammar's, through <c>new RegExp</c>) the engine's limit. Jint 4.17 ignores
    /// <c>RegexTimeoutInterval</c> for them and reads the timeout of its private default parser, which is always Acornima's 5 s: a busy machine
    /// could stall one pattern that long and leave the snippet plain, and hostile code could hold one pattern for 5 s. Jint's main branch reads the
    /// engine's limit since sebastienros/jint#3443; once a release has it, this goes. False when Jint has changed under it, so a test can say so.
    /// </summary>
    internal static bool BoundPatterns(Engine engine, TimeSpan limit)
    {
        if (typeof(Engine).GetField("_defaultParser", BindingFlags.Instance | BindingFlags.NonPublic) is not { } field
            || field.GetValue(engine) is not Acornima.Parser parser) return false;
#pragma warning disable CS0618 // ParserOptions.RegexTimeout is obsolete in Acornima, and it is the timeout Jint 4.17 reads
        field.SetValue(engine, new Acornima.Parser(parser.Options with { RegexTimeout = limit }));
#pragma warning restore CS0618
        return true;
    }

    /// <summary>The code as the HTML highlight.js writes, or null for a language it has no grammar for, or when it could not run.</summary>
    public static string? Highlight(string text, string language) => App.Html(text, language);

    /// <summary>The code as the HTML highlight.js writes within this one's limits, or null for a language it has no grammar for, or when it could not run.</summary>
    internal string? Html(string text, string language)
    {
        lock (_gate)
        {
            if (Start() is not { } engine) return null;
            try
            {
                var result = engine.Invoke("flowyHighlight", text, language);
                return result.IsNull() || result.IsUndefined() ? null : result.AsString();
            }
            catch (Exception e) when (e is not OutOfMemoryException)
            {
                LastError = e;
                return null;
            }
        }
    }

    /// <summary>Starts the engine on another thread, so the first panel with code does not wait for it. Harmless to call again.</summary>
    public static void WarmUp() => Task.Run(() => Highlight("{}", "json"));

    /// <summary>How long one run of the script may take, counted from the start of each <c>Execute</c> or <c>Invoke</c>; the limit can change between runs.</summary>
    internal sealed class Budget : Constraint
    {
        private long _started;

        public TimeSpan Limit { get; set; }

        public override void Check()
        {
            if (Stopwatch.GetElapsedTime(_started) > Limit) throw new TimeoutException($"the script ran past {Limit.TotalSeconds:0.#} s");
        }

        public override void Reset() => _started = Stopwatch.GetTimestamp();
    }
}
