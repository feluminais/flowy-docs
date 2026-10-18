using System.Text.Json.Nodes;
using Xunit;

namespace Flowy.Tests;

/// <summary>
/// Reads every folder in desktop/fixtures/fixtures.json with Flowy.Core and compares it with what the TypeScript core said
/// (desktop/fixtures/expected, written by generate.ts): the same boxes, problems, views and flow steps.
/// </summary>
public class ParityTests
{
    // The two YAML libraries word and place their own syntax errors differently. For these, both must refuse the file.
    private static readonly string[] LibraryErrors = ["bad-syntax", "duplicate-key"];

    private static string Fixtures => Path.Combine(Repo.Root, "desktop", "fixtures");

    public static IEnumerable<object[]> Names() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "fixtures.json")))!.AsObject().Select(kv => new object[] { kv.Key });

    [Theory]
    [MemberData(nameof(Names))]
    public void Reads_the_folder_the_way_the_TypeScript_core_does(string name)
    {
        var dirs = JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "fixtures.json")))!.AsObject();
        var expected = JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures, "expected", name + ".json")))!;
        var actual = JsonDump.Dump(Path.Combine(Repo.Root, dirs[name]!.GetValue<string>()));
        if (LibraryErrors.Contains(name))
        {
            Assert.Equal(expected["parseError"]!["file"]!.GetValue<string>(), actual["parseError"]!["file"]!.GetValue<string>());
            return;
        }
        Assert.Equal(JsonDump.Pretty(expected), JsonDump.Pretty(actual));
    }
}
