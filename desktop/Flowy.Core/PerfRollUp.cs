namespace Flowy.Core;

/// <summary>A level as one view draws it: shapes and lines rolled up from what they hold and from the connections that land on them.</summary>
public static partial class Perf
{
    /// <summary>One of two numbers when only one exists, else <paramref name="f"/> of both.</summary>
    private static double? Either(double? x, double? y, Func<double, double, double> f) => x is null ? y : y is null ? x : f(x.Value, y.Value);

    /// <summary>
    /// A level as one view draws it. Each object takes the worst of what it holds and of itself (highest util and errors, queues added). Each line
    /// the view draws takes the connections that land on it: rates added, worst latency, worst errors. A connection the model doesn't have is left out.
    /// </summary>
    public static (IdMap<Metrics> Objects, IReadOnlyList<Pair> Lines) RollUp(Model model, Level level, string view)
    {
        var held = new Dictionary<string, Metrics>();
        var order = new List<string>();
        foreach (var (id, m) in level.Objects)
        {
            if (model.GetObject(id) is null) continue;
            foreach (var holder in Views.Chain(model, id))
            {
                if (holder == Names.Root) continue;
                var so = held.TryGetValue(holder, out var found) ? found : new Metrics();
                if (!held.ContainsKey(holder)) order.Add(holder);
                held[holder] = new Metrics { Util = Either(so.Util, m.Util, Math.Max), Errors = Either(so.Errors, m.Errors, Math.Max), Queue = Either(so.Queue, m.Queue, (a, b) => a + b) };
            }
        }
        var objects = new IdMap<Metrics>();
        foreach (var id in order) objects.Add(id, held[id]);

        var lines = new List<Pair>();
        var sizes = new List<Sizes>();
        var index = new Dictionary<(string, string), int>();
        foreach (var c in level.Connections)
        {
            if (!model.Connections.Any(m => m.From == c.From && m.To == c.To)) continue;
            if (Views.PlaceEnds(model, view, c.From, c.To) is not { } ends) continue;
            var so = index.TryGetValue(ends, out var at) ? lines[at] : null;
            var line = new Pair(ends.From, ends.To)
            {
                Rate = Either(so?.Rate, c.Rate, (a, b) => a + b), P50 = Either(so?.P50, c.P50, Math.Max), P95 = Either(so?.P95, c.P95, Math.Max), Errors = Either(so?.Errors, c.Errors, Math.Max),
            };
            var size = so is null ? new Sizes() : sizes[at];
            size.TakeBytes(c.Bytes, c.Rate);
            // What each source carries on the line is rolled up the same way, source by source.
            if (c.By is { } by)
            {
                foreach (var (sid, m) in by)
                {
                    if (!size.By.TryGetValue(sid, out var share)) size.By[sid] = share = new Share();
                    share.Rate = Either(share.Rate, m.Rate, (a, b) => a + b);
                    share.P50 = Either(share.P50, m.P50, Math.Max);
                    share.Errors = Either(share.Errors, m.Errors, Math.Max);
                    share.TakeBytes(m.Bytes, m.Rate);
                }
            }
            if (c.Failure is { } failure && !size.Failures.Contains(failure)) size.Failures.Add(failure);
            if (so is null)
            {
                index[ends] = lines.Count;
                lines.Add(line);
                sizes.Add(size);
            }
            else lines[at] = line;
        }
        return (objects, lines.Select((line, i) => WithSizes(line, sizes[i])).ToList());
    }

    /// <summary>The sizes of calls seen so far, for a mean that is weighted by rate (<c>Weighted</c> over <c>Weight</c>) or, with no rates, plain (<c>Sum</c> over <c>N</c>).</summary>
    private class Mean
    {
        public double Weighted { get; set; }

        public double Weight { get; set; }

        public double Sum { get; set; }

        public int N { get; set; }

        /// <summary>The size of a call a connection gives, if it gives one, counted in; the rate it gives is its weight.</summary>
        public void TakeBytes(double? bytes, double? rate)
        {
            if (bytes is not { } b) return;
            Sum += b;
            N++;
            if (rate is not { } r) return;
            Weighted += b * r;
            Weight += r;
        }

        /// <summary>The mean size of a call: weighted by rate (a connection with no rate has no weight); with no rates at all it is the plain mean; none given is none.</summary>
        public double? Bytes
        {
            get
            {
                double? v = Weight > 0 ? Weighted / Weight : N > 0 ? Sum / N : null;
                return v is { } d && double.IsFinite(d) ? d : null; // an overflowing weighted sum is no number, not Infinity
            }
        }
    }

    /// <summary>What one source carries on a line, as <see cref="RollUp"/> collects it from the connections that land there.</summary>
    private sealed class Share : Mean
    {
        public double? Rate { get; set; }

        public double? P50 { get; set; }

        public double? Errors { get; set; }
    }

    /// <summary>What the connections that land on one line say about the size of a call, how its failing share fails and what each source carries, as <see cref="RollUp"/> collects them.</summary>
    private sealed class Sizes : Mean
    {
        public List<string> Failures { get; } = [];

        public OrderedDictionary<string, Share> By { get; } = [];
    }

    /// <summary>
    /// A rolled-up line with its size of a call and how it fails. Bytes is the mean of the connections that give one, weighted by their rates (a connection
    /// with no rate has no weight; with no rates at all it is the plain mean). The failure style is the one the connections that name one agree on; if they
    /// differ there is none, and a connection that names none doesn't veto.
    /// </summary>
    private static Pair WithSizes(Pair line, Sizes size)
    {
        var by = new IdMap<Metrics>();
        foreach (var (sid, s) in size.By)
        {
            var m = new Metrics { Rate = s.Rate, Bytes = s.Bytes, P50 = s.P50, Errors = s.Errors };
            if (!m.IsEmpty) by.Add(sid, m);
        }
        return line with
        {
            Bytes = size.Bytes,
            Failure = size.Failures.Count == 1 ? size.Failures[0] : null,
            By = by.Count > 0 ? by : null,
        };
    }
}
