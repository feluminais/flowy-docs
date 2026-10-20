namespace Flowy.Core;

/// <summary>What a stretch of code is, for colouring. The same nine kinds as <c>TOKEN_KINDS</c> in ui/src/highlight.ts, which the stylesheet and Styles.axaml colour.</summary>
public enum TokenKind { Comment, Keyword, String, Number, Type, Function, Property, Tag, Meta }

/// <summary>A stretch of code and what it is, if it is any of the kinds. A stretch of none is drawn plain.</summary>
public readonly record struct CodeRun(string Text, TokenKind? Kind = null);
