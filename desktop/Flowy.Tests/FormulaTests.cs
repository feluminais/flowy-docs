using System.Text.Json.Nodes;
using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

/// <summary>Everything desktop/fixtures/formula.ts says about the traffic formula, reproduced by <see cref="Formulas"/>, and the cases the TypeScript tests name.</summary>
public class FormulaTests
{
    private static JsonNode Expected() => JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "desktop", "fixtures", "expected", "formula.json")))!;

    private static Formula Good(string text)
    {
        var read = Formulas.Parse(text);
        Assert.True(read.Formula is not null, $"\"{text}\" should read, got {read.Problem}");
        return read.Formula!;
    }

    private static string Problem(string text)
    {
        var read = Formulas.Parse(text);
        Assert.True(read.Formula is null, $"\"{text}\" should not read");
        return read.Problem!;
    }

    private static double? At(string text, FormulaVars vars = default) => Formulas.Eval(Good(text), vars);

    [Fact]
    public void Every_text_of_the_fixture_reads_or_fails_in_the_same_words()
    {
        var reads = Expected()["reads"]!.AsArray();
        Assert.True(reads.Count > 80);
        foreach (var item in reads)
        {
            var text = item!["text"]!.GetValue<string>();
            var read = Formulas.Parse(text);
            if (item["problem"] is { } problem)
            {
                Assert.True(read.Formula is null, $"\"{text}\" should not read");
                Assert.Equal(problem.GetValue<string>(), read.Problem);
                continue;
            }
            Assert.True(read.Formula is not null, $"\"{text}\" should read, got {read.Problem}");
            Assert.Equal(item["formula"]!.GetValue<string>(), Formulas.Text(read.Formula!));
            Assert.Equal(item["names"]!.AsArray().Select(n => n!.GetValue<string>()), Formulas.UsedNames(read.Formula!));
            Assert.Equal(item["linear"]?.GetValue<double>(), Formulas.LinearInRate(read.Formula!));
        }
    }

    [Fact]
    public void Every_value_of_the_fixture_is_the_same_number_or_no_value()
    {
        var values = Expected()["values"]!.AsArray();
        Assert.True(values.Count > 30);
        foreach (var item in values)
        {
            var text = item!["text"]!.GetValue<string>();
            var vars = item["vars"]!.AsObject();
            double? Get(string key) => vars[key]?.GetValue<double>();
            Assert.Equal(item["value"]?.GetValue<double>(), Formulas.Eval(Good(text), new FormulaVars(Get("rate"), Get("bytes"), Get("p50"))));
        }
    }

    [Fact]
    public void Operators_bind_the_way_arithmetic_does_and_unary_minus_applies_to_what_follows()
    {
        Assert.Equal(7, At("1 + 2 * 3"));
        Assert.Equal(9, At("(1 + 2) * 3"));
        Assert.Equal(3, At("10 - 4 - 3"));
        Assert.Equal(5, At("-rate / 2 * -1", new FormulaVars(Rate: 10)));
        Assert.Equal(3, At("--3"));
        Assert.Equal(2, At("rate / 50", new FormulaVars(Rate: 100)));
        Assert.Equal(20, At("rate / 50", new FormulaVars(Rate: 1000)));
    }

    [Fact]
    public void A_missing_name_a_division_by_zero_and_a_number_too_big_give_no_value()
    {
        Assert.Null(At("rate / 50"));
        Assert.Null(At("rate / 0", new FormulaVars(Rate: 5)));
        Assert.Null(At("0 / 0"));
        Assert.Null(At("rate * 1000000", new FormulaVars(Rate: 1e305)));
        Assert.Null(At("rate / 50", new FormulaVars(Rate: double.NaN)));
        Assert.Null(At("rate / 50", new FormulaVars(Rate: double.PositiveInfinity)));
        Assert.Equal(0.0, At("-rate * 0", new FormulaVars(Rate: 5)));
        Assert.False(double.IsNegative(At("-rate * 0", new FormulaVars(Rate: 5))!.Value));
    }

    [Fact]
    public void A_formula_is_linear_in_rate_when_it_is_a_constant_times_rate()
    {
        Assert.Equal(0.02, Formulas.LinearInRate(Good("rate / 50"))!.Value, 12);
        Assert.Equal(3, Formulas.LinearInRate(Good("2 * rate + rate")));
        Assert.Null(Formulas.LinearInRate(Good("rate + 1")));
        Assert.Null(Formulas.LinearInRate(Good("rate * rate")));
        Assert.Null(Formulas.LinearInRate(Good("bytes / 400")));
        Assert.Null(Formulas.LinearInRate(Good("rate - rate")));
        Assert.Null(Formulas.LinearInRate(Good("-rate")));
    }

    [Theory]
    [InlineData("rate / 50 + ", "formula \"rate / 50 + \": unexpected end")]
    [InlineData("((rate)", "formula \"((rate)\": missing \")\"")]
    [InlineData("rate)", "formula \"rate)\": unexpected \")\" at 5")]
    [InlineData("rate()", "formula \"rate()\": unexpected \"(\" at 5")]
    [InlineData("foo * 2", "formula \"foo * 2\": unknown name \"foo\" (use rate, bytes, p50)")]
    [InlineData("1e3", "formula \"1e3\": unexpected \"e3\" at 2")]
    [InlineData("1.2.3", "formula \"1.2.3\": bad number \"1.2.3\" at 1")]
    [InlineData("rate * .", "formula \"rate * .\": bad number \".\" at 8")]
    [InlineData("+rate", "formula \"+rate\": unexpected \"+\" at 1")]
    [InlineData("", "formula \"\": empty")]
    [InlineData("    ", "formula \"    \": empty")]
    [InlineData("😀", "formula \"😀\": unexpected \"😀\" at 1")]
    [InlineData("٣", "formula \"٣\": unexpected \"٣\" at 1")]
    public void A_formula_that_cannot_be_read_is_a_problem_that_says_what_and_where(string text, string expected) => Assert.Equal(expected, Problem(text));

    [Fact]
    public void A_formula_over_eighty_characters_is_a_problem_and_its_text_is_not_echoed_whole()
    {
        var eighty = "rate" + string.Concat(Enumerable.Repeat(" + 1", 19));
        Assert.Equal(80, eighty.Length);
        Assert.NotNull(Formulas.Parse(eighty).Formula);
        var long81 = eighty + " ";
        Assert.Equal($"formula \"{long81[..40]}…\": at most 80 characters", Problem(long81));
    }

    [Fact]
    public void Nesting_and_chains_the_width_of_a_formula_are_read_without_trouble_and_text_that_is_not_text_is_a_problem()
    {
        Assert.Equal(1, At(new string('(', 39) + "1" + new string(')', 39)));
        Assert.Equal(-1, At(new string('-', 79) + "1"));
        Assert.Null(Formulas.Parse(new string('(', 80)).Formula);
        Assert.Equal("formula \"\": must be text", Formulas.Parse(null).Problem);
    }

    [Fact]
    public void A_formula_prints_with_only_the_outermost_operation_bare()
    {
        Assert.Equal("1 + (2 * 3)", Formulas.Text(Good("1 + 2 * 3")));
        Assert.Equal("(1 + 2) * 3", Formulas.Text(Good("(1 + 2) * 3")));
        Assert.Equal("-(rate + 1)", Formulas.Text(Good("-(rate + 1)")));
        Assert.Equal("rate / 50", Good("rate/50").ToString());
    }
}
