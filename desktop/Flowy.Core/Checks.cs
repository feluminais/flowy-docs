using System.Text.RegularExpressions;

namespace Flowy.Core;

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

    private static bool NonEmpty(string? v) => !JsCompat.Blank(v);

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
            Add(FolderLayout.ModelFile, null, "lines must be straight, curved or angled");

        foreach (var key in new[] { "name", "about" })
            if (model.Meta.TryGetValue(key, out var text) && text is not (null or string)) Add(FolderLayout.ModelFile, null, $"{key} must be text");

        foreach (var path in EmptyKeys.Of(model.Meta)) Add("model.yaml", null, EmptyKeys.Message(path));

        if (model.Meta.TryGetValue("icons", out var icons) && !(icons is ""))
        {
            if (icons is not OrderedDictionary<string, object?> iconMap) Add(FolderLayout.ModelFile, null, "icons must map names to SVG path data");
            else
                foreach (var name in JsCompat.OrderKeys(iconMap.Keys))
                    if (Look.IconProblem(name, iconMap[name]) is { } why) Add(FolderLayout.ModelFile, null, $"icon {name}: {why}");
        }

        foreach (var (id, o) in model.Objects)
        {
            void P(string message) => Add(FolderLayout.ModelFile, id, $"{id}: {message}");
            if (!Names.IsValidId(id)) P($"ids {Names.IdRule}");
            if (!NonEmpty(o.Name)) P("name is missing");
            foreach (var path in o.NoValue) P(EmptyKeys.Message(path));
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
                        if (raw is not string url || JsCompat.Blank(url)) P("a link has no url");
                        else if (!IsWebAddress(url))
                        {
                            if (!IsRepoPath(url)) P($"link \"{url}\" must be a web address (http or https) or a path in the repo, relative, with / between folders and no \".\" or \"..\" parts");
                            else if (absent.Contains(url)) P($"link path \"{url}\" doesn't exist");
                        }
                    }
            }
            foreach (var message in Snippets.Problems(o)) P(message);
            foreach (var message in StoreData.Problems(o)) P(message);
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
            void P(string message) => Add(FolderLayout.ModelFile, null, $"connection {End(c.From)} → {End(c.To)}: {message}", connection: index);
            CheckEnds(P, c.From, c.To);
            foreach (var path in c.NoValue) P(EmptyKeys.Message(path));
            if (!Missing(c.From) && c.From == c.To) P("connects an object to itself");
            if (!seen.Add((c.From, c.To, c.Label ?? ""))) P($"duplicate{(string.IsNullOrEmpty(c.Label) ? "" : $" \"{c.Label}\"")}");
        }

        foreach (var (fid, f) in model.Flows)
        {
            void P(string message, int? step = null) => Add(FolderLayout.FlowFile(fid), null, message, step: step);
            if (!Names.IsValidId(fid)) P($"\"{fid}\" is not a valid flow id: the file name must {Names.IdRule}");
            if (!NonEmpty(f.Name)) P("name is missing");
            var viewOk = Views.IsView(model, f.View);
            if (Missing(f.View)) P("view is missing");
            else if (!viewOk) P($"view \"{f.View}\" must be \"root\" or an object with children");
            if (f.Steps.Count == 0) P("has no steps");
            foreach (var path in f.NoValue) P(EmptyKeys.Message(path)); // the steps are read one at a time below, so each says its own number; compare says what is wrong with it next
            if (Compares.Problem(f.CompareRaw, "flow") is { } compareWhy) P(compareWhy);
            else if (f.Compare is { } tag)
            {
                if (tag.With == fid) P("compare points at this flow itself");
                else if (!model.Flows.Contains(tag.With)) P($"compare \"{tag.With}\" is not a flow");
            }
            for (var i = 0; i < f.Steps.Count; i++)
            {
                var s = f.Steps[i];
                var index = i;
                void Sp(string message) => P($"{Problem.StepPrefix(index)}{message}", index);
                foreach (var path in s.NoValue) Sp(EmptyKeys.Message(path));
                var alone = s.To is null; // one box doing something on its own; a blank "to:" is still a missing end
                if (!alone) CheckEnds(Sp, s.From, s.To);
                else if (Missing(s.From)) Sp("\"from\" is missing");
                else if (model.GetObject(s.From) is null) Sp($"unknown object \"{s.From}\"");
                if (!NonEmpty(s.Text)) Sp("text is missing");
                if ((Animations.Problem(s.Animation, !alone) ?? Animations.InterceptorProblem(s.Animation, s.From, s.To, id => model.GetObject(id) is not null)) is { } animation) Sp(animation);
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
            foreach (var finding in Structure.Problems(f, id => model.Flows.Contains(id)).Concat(States.Problems(f, Structure.Stops(f), id => model.GetObject(id) is not null)))
            {
                if (finding.Step is { } n) P($"{Problem.StepPrefix(n)}{finding.Message}", n);
                else P(finding.Message);
            }
        }
        foreach (var (aid, a) in model.Failures) problems.AddRange(Failures.AnalysisProblems(model, aid, a));
        return problems;
    }
}
