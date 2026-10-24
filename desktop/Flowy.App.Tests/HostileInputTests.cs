using System.Diagnostics;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

/// <summary>Text from a model nobody here wrote must never take the window down. Each case is one an outside review found to crash or stall the app.</summary>
[Trait("Weight", "Heavy")]
public class HostileInputTests
{
    [AvaloniaTheory]
    [InlineData("```\n```")]
    [InlineData("```")]
    [InlineData("Intro.\n\n```\n```")]
    public void An_empty_code_block_is_drawn(string text) => Assert.NotEmpty(new MarkdownView(text).Children);

    [AvaloniaFact]
    public void Text_nested_deeper_than_the_parser_allows_is_shown_as_it_was_typed()
    {
        var view = new MarkdownView(new string('>', 300) + " x");
        Assert.IsType<SelectableTextBlock>(Assert.Single(view.Children));
    }

    [AvaloniaFact]
    public void Entities_are_decoded()
    {
        var text = Assert.IsType<SelectableTextBlock>(Assert.Single(new MarkdownView("R&amp;D &copy; 2026 and &lt;tag&gt;").Children));
        Assert.Equal("R&D © 2026 and <tag>", string.Concat(text.Inlines!.OfType<Run>().Select(r => r.Text)));
    }

    [AvaloniaFact]
    public void A_huge_description_is_cut_and_still_draws_quickly()
    {
        var clock = Stopwatch.StartNew();
        var view = new MarkdownView(string.Concat(Enumerable.Repeat("[a](", 40_000)));
        Assert.NotEmpty(view.Children);
        // About 3 s on a desktop and twice that on a CI machine: the bound is for a parse that slows down sharply as the input grows.
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(15), $"took {clock.Elapsed}");
    }

    [AvaloniaFact]
    public void A_model_whose_first_paragraph_is_hostile_still_opens_and_selects()
    {
        using var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "model.yaml"), "objects:\n  a:\n    type: system\n    name: A\n    description: |\n      ```\n      ```\n");
        var reader = new ReaderView();
        var window = new Window { Width = 900, Height = 600, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        reader.Select("a");
        Assert.Equal("a", reader.SelectedBoxId);
    }

    [AvaloniaFact]
    public void A_folder_deleted_while_open_says_so_and_opening_it_again_carries_on()
    {
        using var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "model.yaml"), "objects:\n  a: { type: actor, name: A }\n");
        var shell = new Shell(null);
        var window = shell.Show(dir);
        Assert.Equal(1, window.Reader.Folder!.Model.Objects.Count);

        Directory.Delete(dir, true);
        for (var i = 0; i < 100 && window.Reader.BannerText is null; i++)
        {
            Thread.Sleep(50);
            Dispatcher.UIThread.RunJobs();
        }
        Assert.NotNull(window.Reader.BannerText);
        Assert.Equal(1, window.Reader.Folder!.Model.Objects.Count); // the last good model stays

        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "model.yaml"), "objects:\n  a: { type: actor, name: A }\n  b: { type: actor, name: B }\n");
        Assert.Same(window, shell.Show(dir));
        Assert.Null(window.Reader.BannerText);
        Assert.Equal(2, window.Reader.Folder!.Model.Objects.Count);
        window.Close();
    }

    [AvaloniaFact]
    public void Opening_a_box_flies_off_and_settles_in_on_the_new_level_and_ends_still()
    {
        var dir = Path.Combine(Repo.Root, "docs", "demo", "flowy");
        var reader = new ReaderView();
        var window = new Window { Width = 1100, Height = 700, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "0"); // the other tests turn motion off
        try
        {
            reader.OpenBox("ordering");
            Assert.True(reader.IsMoving);
            var clock = Stopwatch.StartNew();
            while (clock.Elapsed < TimeSpan.FromSeconds(5) && reader.IsMoving)
            {
                AvaloniaHeadlessPlatform.ForceRenderTimerTick(); // a headless window draws no frames of its own
                Dispatcher.UIThread.RunJobs();
                Thread.Sleep(5);
            }
        }
        finally
        {
            Environment.SetEnvironmentVariable("FLOWY_REDUCE_MOTION", "1");
        }
        Assert.False(reader.IsMoving);
        Assert.Equal("ordering", reader.View);
        Assert.Null(reader.Canvas.RenderTransform);
        Assert.Equal(1, reader.Canvas.Opacity);
    }

    [AvaloniaFact]
    public void The_demo_that_ships_with_the_app_opens_without_a_problem()
    {
        var dir = Assert.IsType<string>(Shell.DemoDir);
        var folder = FolderLoader.Load(dir);
        Assert.Empty(folder.Problems); // its code paths need the folders beside flowy/, which ship too
        var window = new Shell(null).Show(dir);
        Assert.Equal(dir, window.Dir);
        window.Close();
    }

    [AvaloniaFact]
    public void A_model_with_nothing_in_it_says_so_and_a_broken_one_shows_its_banner_instead()
    {
        using var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "model.yaml"), "objects:\n");
        var reader = new ReaderView();
        var window = new Window { Width = 900, Height = 600, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        Assert.True(reader.ShowsEmptyNote);
        reader.SetBanner("model.yaml:1: broken");
        Assert.False(reader.ShowsEmptyNote);
        reader.SetBanner(null);
        Assert.True(reader.ShowsEmptyNote);
        reader.Load(FolderLoader.Load(Path.Combine(Repo.Root, "docs", "demo", "flowy")), Path.Combine(Repo.Root, "docs", "demo", "flowy"));
        Assert.False(reader.ShowsEmptyNote);
    }

    [AvaloniaFact]
    public void The_view_copies_as_a_fenced_mermaid_diagram_and_a_flow_playing_copies_as_a_sequence()
    {
        var dir = Path.Combine(Repo.Root, "docs", "demo", "flowy");
        var reader = new ReaderView();
        var window = new Window { Width = 1100, Height = 700, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        Assert.StartsWith("```mermaid\nflowchart TB\n", reader.MermaidText());
        Assert.EndsWith("\n```\n", reader.MermaidText());
        reader.GoTo("ordering");
        reader.Play("place-order");
        Assert.StartsWith("```mermaid\nsequenceDiagram\n", reader.MermaidText());
    }

    [AvaloniaFact]
    public void A_picture_is_named_after_the_model_and_the_level_and_leaves_the_canvas_as_it_was()
    {
        using var temp = new TempFolder();
        var dir = Path.Combine(Repo.Root, "docs", "demo", "flowy");
        var reader = new ReaderView();
        var window = new Window { Width = 1100, Height = 700, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        window.UpdateLayout();
        Assert.Equal("Plum", reader.PictureName("Plum"));
        Assert.Equal("Plum - Ordering", PictureNameIn(reader, "ordering", "Plum"));
        Assert.Equal("a-b", reader.PictureName("a/b").Replace("a-b - Ordering", "a-b"));
        reader.SavePicture(Path.Combine(temp.Path, "plum.png")); // headless drawing makes no pixels: this only has to run, and not break the window
        Assert.Equal("ordering", reader.View);
    }

    [AvaloniaFact]
    public void A_picture_of_nothing_writes_no_file_and_does_not_say_it_saved()
    {
        using var temp = new TempFolder();
        var path = Path.Combine(temp.Path, "none.png");
        var reader = new ReaderView(); // never shown, so there is no size to draw
        Assert.False(reader.SavePicture(path));
        Assert.False(File.Exists(path));
        Assert.Equal("Couldn't save the picture: nothing on screen to draw", ReaderView.PictureNotice(path, false));
        Assert.Equal("Saved none.png.", ReaderView.PictureNotice(path, true));
        Assert.Equal("Couldn't save the picture: pick a folder on this computer", ReaderView.PictureNotice(null, false));
    }

    private static string PictureNameIn(ReaderView reader, string view, string model)
    {
        reader.GoTo(view);
        return reader.PictureName(model);
    }

    [AvaloniaFact]
    public void Pointing_at_a_line_leaves_the_panel_as_it_is()
    {
        var dir = Path.Combine(Repo.Root, "docs", "demo", "flowy");
        var reader = new ReaderView();
        var window = new Window { Width = 1100, Height = 700, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        reader.GoTo("ordering");
        reader.OpenObject("order-api");
        window.UpdateLayout(); // the panel's controls are put in the tree by a layout pass
        var before = reader.GetVisualDescendants().OfType<MarkdownView>().First();
        reader.SetHover("order-api→payments");
        Assert.Same(before, reader.GetVisualDescendants().OfType<MarkdownView>().First());
        reader.SetHover(null);
        Assert.Same(before, reader.GetVisualDescendants().OfType<MarkdownView>().First());
    }
}
