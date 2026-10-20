using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Flowy.Core;
using Xunit;
using static Flowy.App.Tests.EditModeTests;

namespace Flowy.App.Tests;

/// <summary>The Code section of a shape's panel and its edit cards, as a person uses them: what is drawn, what a pick or a typed line saves, and what a hand-written key survives.</summary>
public class CodePanelTests
{
    private const string Source = """
        objects:
          shop:
            type: system
            name: Shop
            snippets:
              - title: Delivery fee
                language: typescript
                note: kept
                text: |-
                  const km = Math.ceil(meters / 500) / 2
                  const fee = base + km * rate
              - language: sql
                text: |-
                  SELECT 1
          bare:
            type: system
            name: Bare
          guess:
            type: system
            name: Guess
            snippets:
              - text: |-
                  SELECT id, total
                  FROM orders
                  WHERE status = 'placed'
              - text: hello
        connections: []
        """;

    private static (TempFolder Temp, string Dir, Window Window, ReaderView Reader) Open(string model)
    {
        var temp = new TempFolder();
        var dir = Path.Combine(temp.Path, "flowy");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "model.yaml"), model);
        var reader = new ReaderView();
        var window = new Window { Width = 1200, Height = 900, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(dir), dir);
        return (temp, dir, window, reader);
    }

    private static IEnumerable<string> Words(ReaderView reader) =>
        reader.Panel.GetVisualDescendants().OfType<TextBlock>().Select(t => t.Text ?? string.Concat(t.Inlines?.OfType<Run>().Select(r => r.Text) ?? [])).Where(t => t != "");

    [AvaloniaFact]
    public void A_shape_with_snippets_shows_a_Code_section_with_each_title_language_and_the_code()
    {
        var (temp, _, window, reader) = Open(Source);
        using var _ = temp;
        reader.OpenObject("shop");
        Settle(window);
        var words = Words(reader).ToList();
        Assert.Contains("CODE", words.Select(w => w.ToUpperInvariant()));
        Assert.Contains("Delivery fee", words);
        Assert.Contains("TypeScript", words);
        Assert.Contains("SQL", words);
        Assert.Contains(words, w => w.Contains("const fee = base + km * rate"));
        Assert.Contains(words, w => w == "SELECT 1");
        Assert.Equal(2, reader.Panel.GetVisualDescendants().OfType<Button>().Count(b => Avalonia.Automation.AutomationProperties.GetName(b) == "Copy"));
    }

    [AvaloniaFact]
    public void A_snippet_with_no_language_is_named_from_its_code_and_a_bare_word_is_left_plain()
    {
        var (temp, _, window, reader) = Open(Source);
        using var _ = temp;
        reader.OpenObject("guess");
        Settle(window);
        var words = Words(reader).ToList();
        Assert.Contains("SQL", words);
        Assert.DoesNotContain("Plain text", words);
        reader.SetEditing(true);
        reader.OpenObject("guess");
        Settle(window);
        var editor = reader.Panel.CurrentObjectEditor!.SnippetsBox;
        Assert.Equal("Auto: SQL", editor.LanguageOf(0).Shown);
        Assert.Equal("Auto: Plain text", editor.LanguageOf(1).Shown);
    }

    [AvaloniaFact]
    public void Code_is_drawn_in_colour_and_the_rest_of_the_text_keeps_the_text_colour()
    {
        var (temp, _, window, reader) = Open(Source);
        using var _ = temp;
        reader.OpenObject("guess");
        Settle(window);
        var runs = reader.Panel.GetVisualDescendants().OfType<SelectableTextBlock>().SelectMany(b => b.Inlines!.OfType<Run>()).ToList();
        // A colour set on the run itself; a plain run sets none and takes the text's (reading Foreground gives the inherited one, so ask whether it is set).
        Assert.Contains(runs, r => r.Text == "SELECT" && r.IsSet(TextElement.ForegroundProperty));
        Assert.Contains(runs, r => r.Text!.Contains("orders") && !r.IsSet(TextElement.ForegroundProperty));
    }

    [AvaloniaFact]
    public void A_shape_without_snippets_has_no_Code_section()
    {
        var (temp, _, window, reader) = Open(Source);
        using var _ = temp;
        reader.OpenObject("bare");
        Settle(window);
        Assert.DoesNotContain("CODE", Words(reader).Select(w => w.ToUpperInvariant()));
    }

    [AvaloniaFact]
    public void The_form_has_a_card_for_each_snippet_and_a_language_picker_that_shows_the_choice()
    {
        var (temp, _, window, reader) = Open(Source);
        using var _ = temp;
        reader.SetEditing(true);
        reader.OpenObject("shop");
        Settle(window);
        var editor = reader.Panel.CurrentObjectEditor!.SnippetsBox;
        Assert.Equal(2, editor.CardCount);
        Assert.Equal("Delivery fee", editor.TitleOf(0).Text);
        Assert.Equal("const km = Math.ceil(meters / 500) / 2\nconst fee = base + km * rate", editor.CodeOf(0).Text);
        Assert.Equal("TypeScript", editor.LanguageOf(0).Shown);
        Assert.Equal("SQL", editor.LanguageOf(1).Shown);
        Assert.Contains("", editor.LanguageOf(0).Ids);
        Assert.Contains("typescript", editor.LanguageOf(0).Ids);
        Assert.Equal(Snippets.Languages.Count + 1, editor.LanguageOf(0).Ids.Count);
        Assert.False(editor.LanguageOf(0).IsOpen);
    }

    [AvaloniaFact]
    public async Task Picking_a_language_saves_it_and_keeps_the_rest_of_the_snippet_including_a_key_Flowy_does_not_know()
    {
        var (temp, dir, window, reader) = Open(Source);
        using var _ = temp;
        reader.SetEditing(true);
        reader.OpenObject("shop");
        Settle(window);
        var editor = reader.Panel.CurrentObjectEditor!.SnippetsBox;
        Assert.True(await editor.LanguageOf(0).Choose("go"));
        await Until(() => Model(dir).Contains("language: go"));
        var file = Model(dir);
        Assert.Contains("note: kept", file);
        Assert.Contains("title: Delivery fee", file);
        Assert.Contains("language: sql", file);
        Assert.Equal("Go", editor.LanguageOf(0).Shown);
    }

    [AvaloniaFact]
    public async Task Choosing_Auto_takes_the_language_out_of_the_file()
    {
        var (temp, dir, window, reader) = Open(Source);
        using var _ = temp;
        reader.SetEditing(true);
        reader.OpenObject("shop");
        Settle(window);
        var editor = reader.Panel.CurrentObjectEditor!.SnippetsBox;
        Assert.True(await editor.LanguageOf(1).Choose(""));
        await Until(() => !Model(dir).Contains("language: sql"));
        Assert.StartsWith("Auto", editor.LanguageOf(1).Shown);
        Assert.Contains("language: typescript", Model(dir));
    }

    [AvaloniaFact]
    public async Task Add_code_makes_a_card_that_saves_nothing_until_it_has_code_then_writes_a_block_of_lines()
    {
        var (temp, dir, window, reader) = Open(Source);
        using var _ = temp;
        reader.SetEditing(true);
        reader.OpenObject("bare");
        Settle(window);
        var editor = reader.Panel.CurrentObjectEditor!.SnippetsBox;
        Assert.Equal(0, editor.CardCount);
        var before = Model(dir);
        editor.AddButton.RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
        Assert.Equal(1, editor.CardCount);
        Assert.False(editor.AddButton.IsEnabled);
        editor.TitleOf(0).Text = "Accept";
        await editor.TitleOf(0).Commit();
        Assert.True(await editor.LanguageOf(0).Choose("sql"));
        Assert.Equal(before, Model(dir));
        editor.CodeOf(0).Text = "UPDATE orders\r\nSET status = 'accepted'";
        await editor.CodeOf(0).Commit();
        await Until(() => Model(dir).Contains("snippets:"));
        Assert.Contains("title: Accept\n", Model(dir).Replace("\r\n", "\n"));
        Assert.Contains("language: sql", Model(dir));
        Assert.Contains("UPDATE orders", Model(dir));
        await Until(() => reader.Folder!.Model.GetObject("bare") is { Snippets: List<object?> { Count: 1 } });
        Assert.True(editor.AddButton.IsEnabled);
    }

    [AvaloniaFact]
    public async Task Remove_takes_a_snippet_out_and_the_last_one_takes_the_key_out()
    {
        var (temp, dir, window, reader) = Open(Source);
        using var _ = temp;
        reader.SetEditing(true);
        reader.OpenObject("shop");
        Settle(window);
        var editor = reader.Panel.CurrentObjectEditor!.SnippetsBox;
        editor.RemoveOf(0).RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
        await Until(() => !Model(dir).Contains("Delivery fee"));
        Assert.Contains("language: sql", Model(dir));
        await Until(() => editor.CardCount == 1);
        editor.RemoveOf(0).RaiseEvent(new Avalonia.Interactivity.RoutedEventArgs(Button.ClickEvent));
        await Until(() => reader.Folder!.Model.GetObject("shop")!.Snippets is null);
        Assert.DoesNotContain("language: sql", Model(dir));
        Assert.Contains("name: Guess", Model(dir)); // the other shapes were not touched
    }

    [AvaloniaFact]
    public async Task Emptying_the_code_of_a_saved_snippet_is_refused_and_the_text_stays()
    {
        var (temp, dir, window, reader) = Open(Source);
        using var _ = temp;
        reader.SetEditing(true);
        reader.OpenObject("shop");
        Settle(window);
        var editor = reader.Panel.CurrentObjectEditor!.SnippetsBox;
        var before = Model(dir);
        editor.CodeOf(1).Text = "";
        await editor.CodeOf(1).Commit();
        Assert.Equal(before, Model(dir));
        Assert.Contains("snippet 2 has no text", reader.NoticeText);
        Assert.Equal("", editor.CodeOf(1).Text);
    }
}
