using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Controls.Shapes;
using Avalonia.Layout;
using Avalonia.Media;
using Flowy.Core;

namespace Flowy.App.Canvas;

/// <summary>
/// One object on the canvas: a tile with its type's icon (grey with a cloud when it's external), its name, its tech (or type), and how
/// many boxes it opens onto. Its look comes from the classes it carries (see Styles.axaml): its type, outsider, lit, dim, selected, problem.
/// </summary>
internal sealed class BoxControl : Grid
{
    private static readonly string[] TypeClasses = ["actor", "system", "app", "store", "component"];

    private readonly TextBlock _name = new();
    private readonly TextBlock _meta = new();
    private readonly StackPanel _inside = new();
    private readonly TextBlock _insideText = new();
    private readonly Border _tile = new();
    private string? _teaser;
    private bool _external;
    private string _type = "";

    public string Id { get; }

    public BoxControl(SceneBox box)
    {
        Id = box.Id;
        Classes.Add("box");
        Focusable = true;
        IsTabStop = true;

        var glow = new Border { CornerRadius = new CornerRadius(8), BoxShadow = BoxShadows.Parse("0 0 0 3 #402563eb"), IsHitTestVisible = false };
        glow.Classes.Add("glow");
        var outline = new Rectangle { IsHitTestVisible = true };
        outline.Classes.Add("outline");

        _tile.Classes.Add("tile");
        _name.Classes.Add("name");
        _meta.Classes.Add("meta");
        var text = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Children = { _name, _meta } };
        var content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 10,
            VerticalAlignment = VerticalAlignment.Center,
            IsHitTestVisible = false,
            Children = { _tile, text },
        };
        text.MaxWidth = 130;

        _insideText.Classes.Add("inside");
        _inside.Orientation = Orientation.Horizontal;
        _inside.Spacing = 3;
        _inside.HorizontalAlignment = HorizontalAlignment.Right;
        _inside.VerticalAlignment = VerticalAlignment.Bottom;
        _inside.Margin = new Thickness(0, 0, 9, 5);
        _inside.IsHitTestVisible = false;
        _inside.Children.Add(Icons.Make(Icons.ZoomIn, "zoom", 12));
        _inside.Children.Add(_insideText);

        var badge = new Border
        {
            Width = 18, Height = 18, CornerRadius = new CornerRadius(9),
            HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(0, -9, -9, 0), IsHitTestVisible = false,
            Child = new TextBlock { Text = "!", Foreground = Brushes.White, FontWeight = FontWeight.Bold, FontSize = 12, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center },
        };
        badge.Classes.Add("badge");

        Children.Add(glow);
        Children.Add(outline);
        Children.Add(content);
        Children.Add(_inside);
        Children.Add(badge);
        Update(box);
    }

    public void Update(SceneBox box)
    {
        Avalonia.Controls.Canvas.SetLeft(this, box.Rect.X);
        Avalonia.Controls.Canvas.SetTop(this, box.Rect.Y);
        var o = box.Object;
        var external = Model.IsExternal(o);
        var type = TypeClasses.Contains(o.Type ?? "") ? o.Type! : "system";

        foreach (var t in TypeClasses) Classes.Set(t, t == type);
        Classes.Set("external", external);
        Classes.Set("outsider", box.Outsider);
        Classes.Set("lit", box.Mode == BoxMode.Lit);
        Classes.Set("dim", box.Mode == BoxMode.Dim);
        Classes.Set("problem", box.Problem);
        Classes.Set("actor", type == "actor");
        // The actor's content starts further in, where its round end curves away.
        ((StackPanel)Children[2]).Margin = new Thickness(type == "actor" ? 16 : 12, 0, 14, 0);

        if (external != _external || type != _type || _tile.Child is null)
        {
            _tile.Child = Icons.Make(external ? Icons.Cloud : Icons.ForType(o.Type), "icon", 18);
            _tile.Width = _tile.Height = 34;
            _external = external;
            _type = type;
        }
        _name.Text = string.IsNullOrEmpty(o.Name) ? box.Id : o.Name;
        _meta.Text = string.Join(" · ", new[] { external ? "external" : null, string.IsNullOrEmpty(o.Tech) ? o.Type : o.Tech }.Where(s => !string.IsNullOrEmpty(s)));
        _inside.IsVisible = box.Inside > 0;
        _insideText.Text = $"{box.Inside} inside";
        // Pointing at a box for a moment shows the first paragraph of its description.
        var teaser = Navigation.Teaser(o.Description);
        if (teaser is { Length: > 400 }) teaser = teaser[..400] + "…"; // a tooltip is built for every box, so it stays small
        if (teaser != _teaser)
        {
            _teaser = teaser;
            ToolTip.SetTip(this, string.IsNullOrWhiteSpace(teaser) ? null : new Border { MaxWidth = 260, Child = new MarkdownView(teaser, 13) });
            ToolTip.SetPlacement(this, PlacementMode.Bottom);
            ToolTip.SetShowDelay(this, 400);
        }
        AutomationProperties.SetName(this, $"{_name.Text}, {(external ? "external " : "")}{o.Type}");
    }

    /// <summary>Called by the canvas as the selection changes.</summary>
    public void SetSelected(bool selected) => Classes.Set("selected", selected);
}
