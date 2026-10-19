using System.Text.RegularExpressions;

namespace Flowy.Core;

/// <summary>
/// One thing wrong with the model. <c>Connection</c> and <c>Step</c> say where in the file to point (a place in
/// model.yaml's connections, a place in the flow's steps); they aren't part of what the problem is.
/// </summary>
public sealed record Problem(string File, string? Id, string Message, int? Connection = null, int? Step = null);

/// <summary>Every problem in a model, never throwing. A port of check() in src/core/check.ts, with the same wording.</summary>
public static class Checks
{
    private static readonly Dictionary<string, string[]> Parents = new()
    {
        ["actor"] = [],
        ["system"] = [],
        ["app"] = ["system"],
        ["store"] = ["system"],
        ["component"] = ["app", "store"],
    };

    /// <summary>The types an object may have when it sits right inside <paramref name="view"/> (the top level, or an object's id).</summary>
    public static List<string> TypesIn(Model model, string view)
    {
        var parent = view == Names.Root ? null : model.GetObject(view);
        if (view != Names.Root && parent is null) return [];
        return Names.ObjectTypes.Where(t => parent is null ? Parents[t].Length == 0 : Parents[t].Contains(parent.Type ?? "")).ToList();
    }

    private static bool NonEmpty(string? v) => !string.IsNullOrWhiteSpace(v);

    /// <summary>Absent, or a key with nothing after it (<c>type:</c>), which reads as "".</summary>
    private static bool Missing(string? v) => string.IsNullOrEmpty(v);

    /// <summary>A path in the repo as <c>code</c> takes it: relative, with / between folders, and no "." or ".." parts. A trailing / is a folder.</summary>
    public static bool IsRepoPath(string path)
    {
        if (path.StartsWith('/') || path.Contains('\\') || path.Contains(':')) return false;
        var parts = path.Split('/');
        return parts.Select((part, i) => (part != "" || (i == parts.Length - 1 && i > 0)) && part != "." && part != "..").All(ok => ok);
    }

    private static readonly Regex WebAddressPattern = new(@"^https?://[^\t\n\v\f\r /?#][^\t\n\v\f\r ]*\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    /// <summary>A web address as a link takes it: http or https, then a host. The same pattern as <c>isWebAddress</c> in src/core/check.ts, character for character (<c>\z</c> where JavaScript's <c>$</c> means the end).</summary>
    public static bool IsWebAddress(string url) => WebAddressPattern.IsMatch(url);

    /// <summary>A <c>links</c> entry whose known fields are text. A missing <c>url</c> is reported separately, as "a link has no url".</summary>
    private static bool IsLinkEntry(object? l) =>
        l is OrderedDictionary<string, object?> map
        && (!map.TryGetValue("url", out var url) || url is string)
        && (!map.TryGetValue("title", out var title) || title is string);

    /// <param name="absent">The <c>code</c> and <c>links</c> paths that don't exist. Only the file system can tell, so the loader fills it in.</param>
    public static List<Problem> Run(Model model, ISet<string>? absent = null)
    {
        absent ??= new HashSet<string>();
        var problems = new List<Problem>();
        void Add(string file, string? id, string message, int? connection = null, int? step = null) =>
            problems.Add(new Problem(file, id, message, connection, step));
        void CheckEnds(Action<string> p, string? from, string? to)
        {
            if (Missing(from)) p("\"from\" is missing");
            if (Missing(to)) p("\"to\" is missing");
            foreach (var end in new[] { from, to }.Distinct())
                if (!Missing(end) && model.GetObject(end) is null) p($"unknown object \"{end}\"");
        }

        if (model.Meta.TryGetValue("lines", out var lines) && !(lines is string style && Names.LineStyles.Contains(style)))
            Add("model.yaml", null, "lines must be straight, curved or angled");

        if (model.Meta.TryGetValue("icons", out var icons) && !(icons is ""))
        {
            if (icons is not OrderedDictionary<string, object?> iconMap) Add("model.yaml", null, "icons must map names to SVG path data");
            else
                foreach (var name in JsKeys.Order(iconMap.Keys))
                    if (Look.IconProblem(name, iconMap[name]) is { } why) Add("model.yaml", null, $"icon {name}: {why}");
        }

        foreach (var (id, o) in model.Objects)
        {
            void P(string message) => Add("model.yaml", id, $"{id}: {message}");
            if (!Names.IsValidId(id)) P($"ids {Names.IdRule}");
            if (!NonEmpty(o.Name)) P("name is missing");
            if (o.External is not null && o.External != "true" && o.External != "false") P("external must be true or false");
            if (!Missing(o.Shape) && !Look.IsShape(o.Shape)) P($"unknown shape \"{o.Shape}\" (use {string.Join(", ", Look.ShapeNames)})");
            if (!Missing(o.Color) && !Look.IsColor(o.Color)) P($"color \"{o.Color}\" must be a name ({string.Join(", ", Look.ColorNames)}) or a hex like #3b82f6");
            if (!Missing(o.Opacity) && !Look.IsOpacity(o.Opacity)) P($"opacity \"{o.Opacity}\" must be a whole number from 0 to 100");
            if (!Missing(o.Icon) && !Look.IsKnownIcon(model.Meta, o.Icon)) P($"unknown icon \"{o.Icon}\" (use a built-in name, or define it under icons: in model.yaml)");
            if (o.Code is not null)
            {
                if (o.Code is not List<object?> code || code.Any(c => c is not string)) P("code must be a list of paths");
                else
                    foreach (var path in code.Cast<string>())
                    {
                        if (!IsRepoPath(path)) P($"code path \"{path}\" must be relative, with / between folders and no \".\" or \"..\" parts");
                        else if (absent.Contains(path)) P($"code path \"{path}\" doesn't exist");
                    }
            }
            if (o.Links is not null)
            {
                if (o.Links is not List<object?> links || !links.All(IsLinkEntry)) P("links must be a list of entries with a url and, if you like, a title");
                else
                    foreach (var entry in links.Cast<OrderedDictionary<string, object?>>())
                    {
                        entry.TryGetValue("url", out var raw);
                        if (raw is not string url || string.IsNullOrWhiteSpace(url)) P("a link has no url");
                        else if (!IsWebAddress(url))
                        {
                            if (!IsRepoPath(url)) P($"link \"{url}\" must be a web address (http or https) or a path in the repo, relative, with / between folders and no \".\" or \"..\" parts");
                            else if (absent.Contains(url)) P($"link path \"{url}\" doesn't exist");
                        }
                    }
            }
            if (Missing(o.Type))
            {
                P("type is missing");
                continue;
            }
            if (!Parents.TryGetValue(o.Type!, out var allowed))
            {
                P($"unknown type \"{o.Type}\" (use {string.Join(", ", Names.ObjectTypes)})");
                continue;
            }
            var parent = model.GetObject(o.In);
            if (Missing(o.In))
            {
                if (allowed.Length > 0) P($"{o.Type} must be inside {string.Join(" or ", allowed)}");
            }
            else if (parent is null) P($"\"in\" points to unknown object \"{o.In}\"");
            else if (parent.Type is null || !allowed.Contains(parent.Type))
                P(allowed.Length > 0
                    ? $"{o.Type} must be inside {string.Join(" or ", allowed)}, not {parent.Type ?? "undefined"}"
                    : $"{o.Type} can't be inside anything");
        }

        var seen = new HashSet<(string?, string?, string)>();
        for (var i = 0; i < model.Connections.Count; i++)
        {
            var c = model.Connections[i];
            var index = i;
            string End(string? v) => Missing(v) ? "?" : v!;
            void P(string message) => Add("model.yaml", null, $"connection {End(c.From)} → {End(c.To)}: {message}", connection: index);
            CheckEnds(P, c.From, c.To);
            if (!Missing(c.From) && c.From == c.To) P("connects an object to itself");
            if (!seen.Add((c.From, c.To, c.Label ?? ""))) P($"duplicate{(string.IsNullOrEmpty(c.Label) ? "" : $" \"{c.Label}\"")}");
        }

        foreach (var (fid, f) in model.Flows)
        {
            void P(string message, int? step = null) => Add($"flows/{fid}.yaml", null, message, step: step);
            if (!Names.IsValidId(fid)) P($"\"{fid}\" is not a valid flow id: the file name must {Names.IdRule}");
            if (!NonEmpty(f.Name)) P("name is missing");
            var viewOk = Views.IsView(model, f.View);
            if (Missing(f.View)) P("view is missing");
            else if (!viewOk) P($"view \"{f.View}\" must be \"root\" or an object with children");
            if (f.Steps.Count == 0) P("has no steps");
            for (var i = 0; i < f.Steps.Count; i++)
            {
                var s = f.Steps[i];
                var index = i;
                void Sp(string message) => P($"step {index + 1}: {message}", index);
                var alone = s.To is null; // one box doing something on its own; a blank "to:" is still a missing end
                if (!alone) CheckEnds(Sp, s.From, s.To);
                else if (Missing(s.From)) Sp("\"from\" is missing");
                else if (model.GetObject(s.From) is null) Sp($"unknown object \"{s.From}\"");
                if (!NonEmpty(s.Text)) Sp("text is missing");
                if (alone)
                {
                    if (viewOk && model.GetObject(s.From) is not null && Views.PlaceStep(model, f.View, s.From, s.To) is null)
                        Sp($"{s.From} can't be shown in view \"{f.View}\"");
                    continue;
                }
                if (!Missing(s.From) && s.From == s.To) Sp("goes from an object to itself (leave out \"to\" for a step one shape does on its own)");
                else if (viewOk && model.GetObject(s.From) is not null && model.GetObject(s.To) is not null && Views.PlaceStep(model, f.View, s.From, s.To) is null)
                    Sp($"{s.From} → {s.To} can't be shown in view \"{f.View}\"");
            }
        }
        return problems;
    }
}
