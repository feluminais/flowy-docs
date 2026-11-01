using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.App.Canvas;
using Flowy.Core;

namespace Flowy.App;

/// <summary>
/// A payload as the panels and the player card show it: a row with the way it goes and its name that folds out to what it is about, its shape and its example, each
/// code block at a capped height with its own scroll so a long schema never takes the panel over. The twin of ui/src/Payloads.tsx.
/// </summary>
internal static class PayloadView
{
    /// <summary>How tall a payload's code block grows before it scrolls, in the panels and on the player card.</summary>
    public const double CodeHeight = 240;

    /// <summary>One payload as a row: <paramref name="back"/> draws it coming back; <paramref name="title"/> says where it comes from when only flow steps send it.</summary>
    public static Control Row(Payloads.Shown shown, bool back, bool open, Func<string, IBrush> resource, string? title = null)
    {
        var body = new StackPanel { Spacing = 8, Margin = new Thickness(20, 6, 0, 4), IsVisible = false };
        var header = new Button { Content = Label(shown.Name, false), HorizontalAlignment = HorizontalAlignment.Left };
        header.Classes.Add("disclosure");
        header.Classes.Add("payload");
        AutomationProperties.SetName(header, shown.Name);
        if (back) AutomationProperties.SetHelpText(header, "Comes back"); // the arrow says so to the eye
        void Toggle()
        {
            // Built on the first open: a line can carry a dozen payloads, each with a long schema.
            if (body.Children.Count == 0) Fill(body, shown, resource);
            body.IsVisible = !body.IsVisible;
            header.Content = Label(shown.Name, body.IsVisible);
        }
        header.Click += (_, _) => Toggle();
        if (open) Toggle();
        var arrow = Icons.Make(back ? Icons.ArrowLeft : Icons.ArrowRight, "payloadicon", 14);
        arrow.VerticalAlignment = VerticalAlignment.Center;
        var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Children = { arrow, header } };
        var row = new StackPanel { Children = { head, body } };
        row.Classes.Add("payloadrow");
        if (title is not null) ToolTip.SetTip(row, title);
        return row;
    }

    /// <summary>The name and the mark that says it folds out, as More's does.</summary>
    private static string Label(string name, bool open) => $"{name} {(open ? "▾" : "▸")}";

    /// <summary>What a payload is, under its name: what it is about, then its shape and its example. The rows show it open, and so does the card on a paused dot.</summary>
    public static Control Body(Payloads.Shown shown, Func<string, IBrush> resource)
    {
        var body = new StackPanel { Spacing = 8 };
        Fill(body, shown, resource);
        return body;
    }

    private static void Fill(StackPanel body, Payloads.Shown shown, Func<string, IBrush> resource)
    {
        if (shown.About is { } about) body.Children.Add(new MarkdownView(about, 13));
        if (shown.Shape is { } shape) body.Children.Add(CodeView.Titled("Shape", shape.Text, shape.Language, resource, CodeHeight));
        if (shown.Example is { } example) body.Children.Add(CodeView.Titled("Example", example.Text, example.Language, resource, CodeHeight));
    }

    /// <summary>Where a payload only flow steps send comes from: "Checkout, step 2 reply; ...". Null for one a connection lists.</summary>
    public static string? FromSteps(Model model, Payloads.Carried carried) =>
        carried.Own || carried.Steps.Count == 0
            ? null
            : string.Join("; ", carried.Steps.Select(s => $"{(model.Flows.Contains(s.Flow) && !string.IsNullOrEmpty(model.Flows[s.Flow].Name) ? model.Flows[s.Flow].Name : s.Flow)}, step {s.Step + 1}{(s.Reply ? " reply" : "")}"));

    /// <summary>What a line carries, a row each, the first open when <paramref name="firstOpen"/>; null when it carries nothing.</summary>
    public static Control? Rows(Model model, IReadOnlyList<Payloads.Carried> carried, bool firstOpen, Func<string, IBrush> resource)
    {
        if (carried.Count == 0) return null;
        var list = new StackPanel { Spacing = 2 };
        for (var i = 0; i < carried.Count; i++) list.Children.Add(Row(carried[i].Payload, carried[i].Back, firstOpen && i == 0, resource, FromSteps(model, carried[i])));
        return list;
    }
}
