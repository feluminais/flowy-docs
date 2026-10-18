namespace Flowy.Core;

/// <summary>A file that can't be read as a Flowy file. Nothing is shown from it.</summary>
public sealed class ParseError : Exception
{
    public string File { get; }

    public int? Line { get; }

    /// <summary>What's wrong, without the "file:line:" prefix that <see cref="Exception.Message"/> starts with.</summary>
    public string Reason { get; }

    public ParseError(string file, string reason, int? line = null)
        : base($"{file}{(line is null ? "" : $":{line}")}: {reason}")
    {
        File = file;
        Line = line;
        Reason = reason;
    }
}
