namespace Flowy.Core;

/// <summary>One thing wrong in a flow. <c>Step</c> is the 0-based step it belongs to, or null for one that stands alone; a step's message is worded to follow "step N: ".</summary>
public sealed record Finding(int? Step, string Message);
