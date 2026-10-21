namespace Flowy.Core;

/// <summary>
/// One thing wrong with the model. <c>Connection</c> and <c>Step</c> say where in the file to point (a place in
/// model.yaml's connections, a place in the flow's steps); they aren't part of what the problem is.
/// </summary>
public sealed record Problem(string File, string? Id, string Message, int? Connection = null, int? Step = null)
{
    /// <summary>What a problem that belongs to step <paramref name="step"/> (counted from 0) starts with: "step N: " (N counts from 1). Twin of <c>stepPrefix</c> in src/core/problem.ts.</summary>
    public static string StepPrefix(int step) => $"step {step + 1}: ";

    /// <summary>The problem's text without its step prefix, the same wherever the step moves to. Twin of <c>withoutStep</c> in src/core/problem.ts.</summary>
    public static string WithoutStep(Problem p) =>
        p.Step is { } step && p.Message.StartsWith(StepPrefix(step), StringComparison.Ordinal) ? p.Message[StepPrefix(step).Length..] : p.Message;
}
