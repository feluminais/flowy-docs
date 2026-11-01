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

    [Fact]
    public void MotionOf_names_the_dot_after_the_payload_and_the_answer_after_the_reply()
    {
        var m = new Model { Meta = new Dictionary<string, object?> { ["payloads"] = Map(("order", Order), ("receipt", Map(("name", "Receipt"), ("about", "y")))) } };
        var a = Payloads.MotionOf(m, new Step("web", "api", "x", null, "call") { Payload = "order", Reply = "receipt" })!;
        Assert.Equal(("Order", "Receipt"), (a.Carries, a.Replies));
        var labels = Animations.BeatsFor(a, 300, false).Beats.Where(b => b.Do == "blob").Select(b => (b.Dir, b.Label));
        Assert.Equal([("fwd", "Order"), ("back", "Receipt")], labels);
        var failed = Payloads.MotionOf(m, new Step("web", "api", "x", null, Map(("kind", "call"), ("outcome", "fail"))) { Payload = "order", Reply = "receipt" })!;
        Assert.Null(Animations.BeatsFor(failed, 300, false).Beats.First(b => b.Do == "blob" && b.Dir == "back").Label);
    }

    [Fact]
    public void A_word_in_the_animation_wins_and_a_burst_keeps_its_request_names()
    {
        var m = new Model { Meta = new Dictionary<string, object?> { ["payloads"] = Map(("order", Order)) } };
        Assert.Equal("POST", Payloads.MotionOf(m, new Step("web", "api", "x", null, Map(("kind", "call"), ("carries", "POST"))) { Payload = "order" })!.Carries);
        Assert.Null(Payloads.MotionOf(m, new Step("web", "api", "x", null, Map(("kind", "send"), ("outcome", "lost"), ("share", "30"))) { Payload = "order" })!.Carries);
        Assert.Null(Payloads.MotionOf(m, new Step("web", "api", "x", null, "call") { Payload = "nope" })!.Carries);
    }

    private static Model WithReply() => new()
    {
        Meta = new Dictionary<string, object?> { ["payloads"] = Map(("order", Map(("name", "Order"))), ("receipt", Map(("name", "Receipt")))) },
    };

    [Fact]
    public void A_dot_that_answers_carries_the_reply_and_every_other_dot_the_payload()
    {
        var asks = new Step("web", "api", "Places the order", null, "call") { Payload = "order", Reply = "receipt" };
        Assert.Equal((new Payloads.Shown("order", "Order", null, null, null), false), Payloads.OfDot(WithReply(), asks, null));
        Assert.Equal((new Payloads.Shown("receipt", "Receipt", null, null, null), true), Payloads.OfDot(WithReply(), asks, "reply"));
        Assert.Equal((new Payloads.Shown("order", "Order", null, null, null), false), Payloads.OfDot(WithReply(), asks, "fail"));
    }

    [Fact]
    public void A_dot_whose_step_names_nothing_or_an_id_that_is_not_there_carries_nothing()
    {
        Assert.Null(Payloads.OfDot(WithReply(), new Step("a", "b", "x", null), null));
        Assert.Null(Payloads.OfDot(WithReply(), new Step("a", "b", "x", null) { Payload = "gone" }, null));
        Assert.Null(Payloads.OfDot(WithReply(), new Step("a", "b", "x", null) { Payload = "order" }, "reply"));
    }

    [Fact]
    public void A_payload_written_in_place_is_what_its_dot_carries() =>
        Assert.Equal((new Payloads.Shown(null, "Ping", "A heartbeat.", null, null), false), Payloads.OfDot(WithReply(), new Step("a", "b", "x", null) { Payload = Map(("name", "Ping"), ("about", "A heartbeat.")) }, null));
}
