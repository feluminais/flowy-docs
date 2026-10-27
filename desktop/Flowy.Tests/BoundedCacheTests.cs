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

    [Fact]
    public async Task A_key_asked_for_while_it_is_being_made_waits_for_that_value_instead_of_making_it_again()
    {
        var token = TestContext.Current.CancellationToken;
        var cache = new BoundedCache<string, int>(3);
        var made = 0;
        var started = new TaskCompletionSource();
        var release = new TaskCompletionSource();
        var first = Task.Run(() => cache.GetOrAdd("a", _ => { Interlocked.Increment(ref made); started.SetResult(); release.Task.Wait(token); return 7; }), token);
        await started.Task.WaitAsync(token);
        var second = Task.Run(() => cache.GetOrAdd("a", _ => { Interlocked.Increment(ref made); return 8; }), token);
        await Task.Delay(100, token);
        Assert.False(second.IsCompleted);
        release.SetResult();
        Assert.Equal(7, await first);
        Assert.Equal(7, await second);
        Assert.Equal(1, made);
    }

    [Fact]
    public void A_value_that_fails_to_be_made_is_tried_again_next_time()
    {
        var cache = new BoundedCache<string, int>(3);
        Assert.Throws<InvalidOperationException>(() => cache.GetOrAdd("a", _ => throw new InvalidOperationException()));
        Assert.Equal(5, cache.GetOrAdd("a", _ => 5));
        Assert.Equal(1, cache.Count);
    }
}
