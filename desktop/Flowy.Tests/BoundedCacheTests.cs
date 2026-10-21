using Flowy.Core;
using Xunit;

namespace Flowy.Tests;

public class BoundedCacheTests
{
    [Fact]
    public void A_value_is_made_once_per_key()
    {
        var cache = new BoundedCache<string, int>(3);
        var made = 0;
        Assert.Equal(1, cache.GetOrAdd("a", _ => ++made));
        Assert.Equal(1, cache.GetOrAdd("a", _ => ++made));
        Assert.Equal(1, made);
    }

    [Fact]
    public void The_entry_added_first_goes_when_the_cache_is_full()
    {
        var cache = new BoundedCache<string, int>(2);
        var made = 0;
        foreach (var key in new[] { "a", "b", "c" }) cache.GetOrAdd(key, _ => ++made);
        Assert.Equal(2, cache.Count);
        cache.GetOrAdd("b", _ => ++made);
        cache.GetOrAdd("c", _ => ++made);
        Assert.Equal(3, made);
        cache.GetOrAdd("a", _ => ++made);
        Assert.Equal(4, made);
    }
}
