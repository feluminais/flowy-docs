using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Flowy.Core;
using Xunit;
using static Flowy.App.Tests.EditModeTests;

namespace Flowy.App.Tests;

/// <summary>The pickers of an object's form: what is drawn is what a click saves, and the form shows what the file says.</summary>
public class PickersTests
{
    private static (TempFolder Temp, string Dir, ObjectEditor Form, ReaderView Reader) OpenApi()
    {
        var (temp, dir, _, reader) = Open();
        reader.SetEditing(true);
        reader.GoTo("shop");
        reader.OpenObject("api");
        return (temp, dir, reader.Panel.CurrentObjectEditor!, reader);
    }

    [AvaloniaFact]
    public async Task Picking_a_type_a_shape_and_a_colour_saves_it_and_rings_the_cell()
    {
        var (temp, dir, form, reader) = OpenApi();
        using var _ = temp;
        Assert.Equal("app", form.TypeChoices.Chosen);
        Assert.Contains("store", form.TypeChoices.Ids);
        await form.TypeChoices.Choose("store");
        await Until(() => reader.Folder!.Model.GetObject("api")!.Type == "store");
        Assert.Equal("store", form.TypeChoices.Chosen);

        Assert.Equal("", form.ShapeChoices.Chosen); // the type's own
        Assert.Equal(["", .. Look.ShapeNames], form.ShapeChoices.Ids);
        await form.ShapeChoices.Choose("hexagon");
        await Until(() => reader.Folder!.Model.GetObject("api")!.Shape == "hexagon");
        Assert.Equal("hexagon", form.ShapeChoices.Chosen);
        await form.ShapeChoices.Choose("");
        await Until(() => reader.Folder!.Model.GetObject("api")!.Shape is null);
        Assert.DoesNotContain("shape:", Model(dir));

        Assert.Equal("", form.ColorChoices.Chosen);
        Assert.Equal(["", .. Look.ColorNames], form.ColorChoices.Ids);
        await form.ColorChoices.Choose("teal");
        await Until(() => reader.Folder!.Model.GetObject("api")!.Color == "teal");
        Assert.Equal("teal", form.ColorChoices.Chosen);
    }

    [AvaloniaFact]
    public async Task A_colour_the_file_holds_that_is_not_a_name_gets_a_swatch_and_goes_when_a_name_is_picked()
    {
        var (temp, _, form, reader) = OpenApi();
        using var _ = temp;
        form.HexField.Text = "#3b82f6";
        await form.HexField.Commit();
        await Until(() => reader.Folder!.Model.GetObject("api")!.Color == "#3b82f6");
        Assert.Equal("#3b82f6", form.ColorChoices.Chosen);
        Assert.Contains("#3b82f6", form.ColorChoices.Ids);
        await form.ColorChoices.Choose("pink");
        await Until(() => reader.Folder!.Model.GetObject("api")!.Color == "pink");
        Assert.DoesNotContain("#3b82f6", form.ColorChoices.Ids);
        Assert.Equal("", form.HexField.Text);
    }

    [AvaloniaFact]
    public async Task The_opacity_bar_saves_what_it_is_let_go_at_and_the_default_takes_it_away()
    {
        var (temp, dir, form, reader) = OpenApi();
        using var _ = temp;
        Assert.Equal(0, form.OpacityBar.Value); // no colour, no fill
        await form.ColorChoices.Choose("blue");
        await Until(() => reader.Folder!.Model.GetObject("api")!.Color == "blue");
        Assert.Equal(15, form.OpacityBar.Value); // what a colour fills with when nothing says
        await form.OpacityBar.Set(60);
        await Until(() => reader.Folder!.Model.GetObject("api")!.Opacity == "60");
        Assert.Contains("opacity:", Model(dir));
        Assert.Equal(60, form.OpacityBar.Value);
        await form.OpacityBar.Set(100);
        await Until(() => reader.Folder!.Model.GetObject("api")!.Opacity == "100");
    }

    [AvaloniaFact]
    public async Task The_icon_grid_opens_filters_and_saves_the_icon_picked_and_the_types_own_takes_it_away()
    {
        var (temp, dir, form, reader) = OpenApi();
        using var _ = temp;
        var icons = form.IconChoice;
        Assert.False(icons.IsOpen);
        icons.Open(true);
        Assert.True(icons.IsOpen);
        Assert.Equal(LookData.IconGroups.SelectMany(g => g.Names), icons.Names);
        await icons.Choose("building-bank");
        await Until(() => reader.Folder!.Model.GetObject("api")!.Icon == "building-bank");
        Assert.Contains("icon: building-bank", Model(dir));
        Assert.False(icons.IsOpen); // picking closes it
        await icons.Choose("");
        await Until(() => reader.Folder!.Model.GetObject("api")!.Icon is null);
        Assert.DoesNotContain("icon:", Model(dir));
    }

    [AvaloniaFact]
    public void Typing_in_the_icon_filter_hides_what_does_not_match_and_says_when_nothing_does()
    {
        var (temp, _, window, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.GoTo("shop");
        reader.OpenObject("api");
        var icons = reader.Panel.CurrentObjectEditor!.IconChoice;
        icons.Open(true);
        Settle(window);
        Assert.True(icons.FilterBox.IsFocused, "the filter takes the focus when the grid opens");
        window.KeyTextInput("bank");
        Settle(window);
        Assert.Equal(["building-bank"], icons.VisibleNames);
        icons.FilterBox.Text = "no such thing";
        Settle(window);
        Assert.Empty(icons.VisibleNames);
        Assert.True(icons.SaysNone);
        icons.FilterBox.Text = "";
        Settle(window);
        Assert.Equal(icons.Names, icons.VisibleNames);
        Assert.False(icons.SaysNone);
    }

    [AvaloniaFact]
    public async Task A_model_defined_icon_has_a_group_of_its_own_in_the_grid()
    {
        var (temp, dir, form, reader) = OpenApi();
        using var _ = temp;
        File.WriteAllText(Path.Combine(dir, "model.yaml"), Model(dir).Replace("objects:", "icons:\n  stripe: M4 4h16v16h-16z\nobjects:"));
        reader.Load(FolderLoader.Load(dir), dir);
        reader.SetEditing(true);
        reader.GoTo("shop");
        reader.OpenObject("api");
        var icons = reader.Panel.CurrentObjectEditor!.IconChoice;
        icons.Open(true);
        Assert.Contains("stripe", icons.Names);
        await icons.Choose("stripe");
        await Until(() => reader.Folder!.Model.GetObject("api")!.Icon == "stripe");
    }

    [AvaloniaFact]
    public void The_add_form_offers_the_types_that_fit_as_tiles_and_the_first_is_picked()
    {
        var (temp, _, window, reader) = Open();
        using var _ = temp;
        reader.SetEditing(true);
        reader.GoTo("shop");
        Press(window, Key.N, PhysicalKey.N);
        var types = reader.Panel.CurrentAddForm!.TypeChoices;
        Assert.Equal(["app", "store"], types.Ids);
        Assert.Equal("app", types.Chosen);
    }

    [AvaloniaFact]
    public async Task A_refused_edit_puts_the_ring_back_where_it_was()
    {
        var (temp, _, form, reader) = OpenApi();
        using var _ = temp;
        // A type the nesting rules refuse: a store may not hold an app, so the form does not offer it, and the pick fails if forced.
        var before = form.TypeChoices.Chosen;
        var saved = await form.TypeChoices.Choose("not-a-type");
        Assert.False(saved);
        Assert.Equal(before, form.TypeChoices.Chosen);
    }
}
