namespace Flowy.Core;

/// <summary>Which addresses a link in a description may open. Descriptions come from files nobody here wrote.</summary>
public static class WebAddress
{
    /// <summary>True for an absolute http or https address and nothing else: not file:, javascript:, mailto:, a relative path, or text.</summary>
    public static bool IsSafe(string? address) =>
        Uri.TryCreate(address, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" && uri.Host != "";
}
