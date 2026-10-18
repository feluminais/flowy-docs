using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>Where a box's <c>code</c> paths link to on GitHub or GitLab. A port of src/node/git.ts.</summary>
public static partial class CodeLinks
{
    /// <summary>A path made safe for a URL one part at a time, so a # or ? in a name stays part of the name (JavaScript's encodeURIComponent).</summary>
    public static string EncodePath(string path) => string.Join('/', path.Split('/').Select(EncodePart));

    private static string EncodePart(string part) =>
        Uri.EscapeDataString(part).Replace("%21", "!").Replace("%2A", "*").Replace("%27", "'").Replace("%28", "(").Replace("%29", ")");

    // \z, not $, so a trailing newline can't hide in the repository name.
    [GeneratedRegex(@"^(?:https://(?:[^@/]+@)?|git@|ssh://git@)(github\.com|gitlab\.com)[:/](.+?)(?:\.git)?/?\z", RegexOptions.CultureInvariant)]
    private static partial Regex Remote();

    /// <summary>
    /// The web address <c>code</c> paths link to, from the origin's URL, the branch (or commit) and the folder's
    /// place in the repo (<c>git rev-parse --show-prefix</c>, "" at the top). Only github.com and gitlab.com.
    /// </summary>
    public static string? BaseFrom(string remote, string branch, string prefix)
    {
        var found = Remote().Match(remote.Trim());
        if (!found.Success) return null;
        var host = found.Groups[1].Value;
        return $"https://{host}/{found.Groups[2].Value}/{(host == "gitlab.com" ? "-/" : "")}tree/{EncodePath(branch)}/{EncodePath(prefix)}";
    }

    // Known limit: worked out once per folder per process, so a branch switch or a new origin shows after a restart.
    private static readonly ConcurrentDictionary<string, Task<string?>> Bases = new();

    /// <summary>Where <c>code</c> paths under <paramref name="root"/> link to, or null when git or the remote can't say.</summary>
    public static Task<string?> BaseFor(string root) => Bases.GetOrAdd(root, Work);

    private static async Task<string?> Work(string root)
    {
        async Task<string> Git(params string[] args)
        {
            var start = new ProcessStartInfo("git") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true };
            start.ArgumentList.Add("-C");
            start.ArgumentList.Add(root);
            foreach (var a in args) start.ArgumentList.Add(a);
            using var process = Process.Start(start) ?? throw new InvalidOperationException("git did not start");
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            try
            {
                var output = process.StandardOutput.ReadToEndAsync(timeout.Token);
                await process.WaitForExitAsync(timeout.Token);
                if (process.ExitCode != 0) throw new InvalidOperationException("git failed");
                return (await output).Trim();
            }
            catch
            {
                if (!process.HasExited) process.Kill(true);
                throw;
            }
        }
        try
        {
            var branch = await Git("rev-parse", "--abbrev-ref", "HEAD");
            return BaseFrom(await Git("remote", "get-url", "origin"), branch == "HEAD" ? await Git("rev-parse", "HEAD") : branch, await Git("rev-parse", "--show-prefix"));
        }
        catch
        {
            return null; // not a repo, no origin, or no git
        }
    }
}
