namespace Flowy.Core;

/// <summary>
/// How one edit, undo or redo ended. <see cref="Message"/> is what to tell the reader, null once it is saved. <see cref="ChangedOutside"/> is the one
/// refusal the reader answers by loading the folder again: a file changed under the edit.
/// </summary>
public sealed record EditResult(string? Message, bool ChangedOutside = false)
{
    /// <summary>Saved (or, for an edit that changed nothing, nothing to save).</summary>
    public static EditResult Ok { get; } = new((string?)null);

    /// <summary>Refused or failed, with what to tell the reader. Nothing was changed.</summary>
    public static EditResult Refused(string message) => new(message);

    /// <summary>A file changed since it was read, so nothing was written.</summary>
    public static EditResult FileChanged { get; } = new(EditSession.ChangedOutside, true);

    public bool IsOk => Message is null;
}
