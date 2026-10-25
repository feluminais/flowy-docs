using System.Diagnostics;
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
            engine.Execute(Engine.PrepareScript(reader.ReadToEnd()));
            budget.Limit = snippet;
            return _engine = engine;
        }
        catch (Exception e) when (e is not OutOfMemoryException)
        {
            _broken = true;
            return null;
        }
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
