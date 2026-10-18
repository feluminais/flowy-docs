using Flowy.Core;

namespace Flowy.Tests;

internal static class Repo
{
    /// <summary>The repo root: the nearest folder above the test run that holds desktop/Flowy.slnx.</summary>
    public static string Root { get; } = Find();

    private static string Find()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "desktop", "Flowy.slnx"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("Could not find the repo root above " + AppContext.BaseDirectory);
    }
}

/// <summary>A scratch folder that deletes itself.</summary>
internal sealed class TempDir : IDisposable
{
    public string Dir { get; } = Directory.CreateTempSubdirectory("flowy-test-").FullName;

    public string Write(string rel, string text)
    {
        var path = Path.Combine(Dir, rel);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text);
        return path;
    }

    public void Dispose() => Directory.Delete(Dir, true);
}

internal static class TestModels
{
    public const string ShopObjects = """
          customer: { type: actor, name: Customer }
          shop: { type: system, name: Shop, description: Sells things online. }
          web: { type: app, in: shop, name: Web app, tech: React }
          api: { type: app, in: shop, name: API, tech: Node }
          db: { type: store, in: shop, name: Orders DB, tech: Postgres }
          auth: { type: component, in: api, name: Auth }
          orders: { type: component, in: api, name: Orders }
          mail: { type: system, name: Mail service }

        """;

    public const string ShopConnections = """
          - { from: customer, to: web, label: browses }
          - { from: web, to: api, label: REST }
          - { from: orders, to: db, label: reads/writes }
          - { from: auth, to: db, label: checks users }
          - { from: orders, to: mail, label: sends receipts }

        """;

    /// <summary>A small shop with an actor, two systems, apps, a store and two components. Has no problems.</summary>
    public static Model Shop(string moreObjects = "", string? connections = null, string moreConnections = "", string flows = "") =>
        FromYaml("objects:\n" + ShopObjects + moreObjects + "connections:\n" + (connections ?? ShopConnections) + moreConnections, flows);

    /// <summary>A model from model.yaml text, plus flows written as <c>id: yaml</c> pairs.</summary>
    public static Model FromYaml(string modelYaml, string flows = "")
    {
        var parsed = ModelFiles.ParseModel(modelYaml);
        var map = new IdMap<Flow>();
        foreach (var chunk in flows.Split("\n===\n", StringSplitOptions.RemoveEmptyEntries))
        {
            var newline = chunk.IndexOf('\n');
            var id = chunk[..newline].Trim();
            map.Add(id, ModelFiles.ParseFlow(id, chunk[(newline + 1)..]));
        }
        return new Model { Objects = parsed.Objects, Connections = parsed.Connections, Meta = parsed.Meta, Flows = map };
    }
}
