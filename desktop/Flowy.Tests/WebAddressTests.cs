using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class WebAddressTests
{
    [Theory]
    [InlineData("https://github.com/acme/shop/tree/main/src/")]
    [InlineData("http://example.com")]
    [InlineData("HTTPS://EXAMPLE.COM/a%20b?q=1#top")]
    public void Web_addresses_are_safe_to_open(string address) => Assert.True(WebAddress.IsSafe(address));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("example.com")]
    [InlineData("/docs/readme.md")]
    [InlineData("../up")]
    [InlineData("javascript:alert(1)")]
    [InlineData("file:///C:/Windows/System32/calc.exe")]
    [InlineData("mailto:someone@example.com")]
    [InlineData("ftp://example.com/file")]
    [InlineData("data:text/html,<script>alert(1)</script>")]
    [InlineData("http://")]
    [InlineData("ms-settings:privacy")]
    public void Anything_else_is_not_opened(string? address) => Assert.False(WebAddress.IsSafe(address));
}
