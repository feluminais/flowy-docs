using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>The payloads a model, a line and a step name, read as src/core/payloads.ts reads them (test/payloads.test.ts has the same cases).</summary>
public class PayloadsTests
{
    private static OrderedDictionary<string, object?> Map(params (string Key, object? Value)[] pairs)
    {
        var map = new OrderedDictionary<string, object?>();
        foreach (var (key, value) in pairs) map[key] = value;
        return map;
    }

    private static readonly OrderedDictionary<string, object?> Order =
        Map(("name", "Order"), ("about", "What the app sends at checkout."), ("shape", Map(("language", "typescript"), ("text", "type Order = { id: string }"))));

    private static Model Model() => new()
    {
        Meta = new Dictionary<string, object?> { ["payloads"] = Map(("order", Order), ("bad", "x"), ("refund", Map(("about", "Money going back.")))) },
    };

    [Fact]
    public void Of_keeps_the_entries_that_are_mappings_in_file_order() => Assert.Equal(["order", "refund"], Payloads.Of(Model()).Keys);

    [Fact]
    public void An_id_finds_its_payload_named_after_the_id_when_it_has_no_name()
    {
        Assert.Equal(new Payloads.Shown("refund", "refund", "Money going back.", null, null), Payloads.Resolve(Model(), "refund"));
        Assert.Equal(new Payloads.CodeBlock("type Order = { id: string }", "typescript"), Payloads.Resolve(Model(), "order")!.Shape);
    }

    [Fact]
    public void An_inline_payload_is_itself_with_no_id() =>
        Assert.Equal(new Payloads.Shown(null, "Receipt", "x", null, null), Payloads.Resolve(Model(), Map(("name", "Receipt"), ("about", "x"))));

    [Fact]
    public void An_unknown_id_an_inline_payload_with_no_name_and_a_key_of_object_find_nothing()
    {
        foreach (var reference in new object?[] { "nope", Map(("about", "x")), "constructor", "toString", "bad", null })
            Assert.Null(Payloads.Resolve(Model(), reference));
    }

    [Fact]
    public void A_connection_lists_the_payloads_that_resolve_in_its_order()
    {
        var c = new Connection("app", "api", null) { Payloads = new List<object?> { "refund", "nope", Map(("name", "Receipt")) } };
        Assert.Equal(["refund", "Receipt"], Payloads.OfConnection(Model(), c).Select(p => p.Name));
        Assert.Empty(Payloads.OfConnection(Model(), new Connection("app", "api", null) { Payloads = "refund" }));
    }

    [Fact]
    public void A_blank_or_malformed_code_block_is_left_out_of_what_is_shown()
    {
        var m = new Model { Meta = new Dictionary<string, object?> { ["payloads"] = Map(("odd", Map(("about", "x"), ("shape", Map(("text", "\n  \n"))), ("example", "json")))) } };
        Assert.Equal(new Payloads.Shown("odd", "odd", "x", null, null), Payloads.Resolve(m, "odd"));
    }

    [Fact]
    public void A_step_reads_its_payload_and_its_reply()
    {
        var s = new Step("app", "api", "Places it", null) { Payload = "order", Reply = Map(("name", "Receipt"), ("about", "y")) };
        Assert.Equal("Order", Payloads.OfStep(Model(), s)?.Name);
        Assert.Equal("Receipt", Payloads.ReplyOf(Model(), s)?.Name);
    }

    /// <summary>A shop of web → api and a component inside api; the line web–api draws web → api (carrying the order) and orders → web (the receipt).</summary>
    private static Model Shop()
    {
        var steps = new List<Step>
        {
            new("web", "api", "POST /orders", null, "call") { Payload = "order", Reply = "refund" },
            new("api", "web", "Pushes an update", null) { Payload = Map(("name", "Update"), ("about", "Inline.")) },
        };
        var objects = new IdMap<FlowyObject>();
        objects.Add("shop", new FlowyObject("system", "Shop", null, null, null, null, null));
        objects.Add("web", new FlowyObject("app", "Web", "shop", null, null, null, null));
        objects.Add("api", new FlowyObject("app", "API", "shop", null, null, null, null));
        objects.Add("orders", new FlowyObject("component", "Orders", "api", null, null, null, null));
        var flows = new IdMap<Flow>();
        flows.Add("checkout", new Flow("Checkout", "shop", steps));
        return new Model
        {
            Objects = objects,
            Connections = [new Connection("web", "api", "REST") { Payloads = new List<object?> { "order" } }, new Connection("orders", "web", "notifies") { Payloads = new List<object?> { "refund" } }],
            Flows = flows,
            Meta = Model().Meta,
        };
    }

    [Fact]
    public void A_line_lists_its_connections_payloads_then_what_steps_send_along_it_once_each_by_id()
    {
        var rows = Payloads.OnLine(Shop(), "shop", "web", "api").Select(c => (c.Payload.Name, c.Back, c.Own, c.Steps.Count)).ToList();
        Assert.Equal([("Order", false, true, 1), ("refund", true, true, 1), ("Update", true, false, 1)], rows);
    }

    [Fact]
    public void A_payload_a_step_sends_the_other_way_and_a_reply_run_back() =>
        Assert.Equal([true, false, false], Payloads.OnLine(Shop(), "shop", "api", "web").Select(c => c.Back));
}

