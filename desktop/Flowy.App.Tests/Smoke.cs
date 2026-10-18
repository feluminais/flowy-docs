using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Flowy.Core;
using Xunit;

namespace Flowy.App.Tests;

public class Smoke
{
    [AvaloniaFact]
    public void The_reader_shows_a_folder()
    {
        var reader = new ReaderView();
        var window = new Window { Width = 1100, Height = 700, Content = reader };
        window.Show();
        reader.Load(FolderLoader.Load(Path.Combine(Repo.Root, "docs", "demo", "flowy")), Path.Combine(Repo.Root, "docs", "demo", "flowy"));
        Assert.Equal(Names.Root, reader.View);
        Assert.NotNull(reader.Canvas.Scene);
    }
}

internal static class Repo
{
    public static string Root { get; } = Find();

    private static string Find()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "desktop", "Flowy.slnx"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("repo root not found");
    }
}
