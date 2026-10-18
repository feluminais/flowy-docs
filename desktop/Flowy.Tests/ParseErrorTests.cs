using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class ParseErrorTests
{
    [Fact]
    public void The_message_names_the_file_and_the_line()
    {
        var e = new ParseError("model.yaml", "unresolved merge conflict", 3);
        Assert.Equal("model.yaml:3: unresolved merge conflict", e.Message);
        Assert.Equal("model.yaml", e.File);
        Assert.Equal(3, e.Line);
        Assert.Equal("unresolved merge conflict", e.Reason);
    }

    [Fact]
    public void Without_a_line_the_message_names_only_the_file()
    {
        var e = new ParseError("flows/f.yaml", "\"steps\" must be a list");
        Assert.Equal("flows/f.yaml: \"steps\" must be a list", e.Message);
        Assert.Null(e.Line);
    }
}
