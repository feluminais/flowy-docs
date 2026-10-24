using Avalonia.Automation;
using Avalonia.Controls;

namespace Flowy.App;

/// <summary>
/// A long list drawn a page at a time. Every row of a list is a control, and a list of thousands (the shapes no analysis covers, the dependents of a system about to go, the
/// problems of a broken model) made a panel that took seconds to build and again for every step. The first page is drawn at once, and a button under it draws the next.
/// </summary>
internal static class Paging
{
    /// <summary>How many rows a page has.</summary>
    internal const int Page = 100;

    /// <summary>
    /// Adds a page of <paramref name="items"/> to <paramref name="host"/>, and, while there are more, a button that adds the next. The button counts what is left, and goes
    /// when there is nothing left. <paramref name="make"/> builds the row of one item.
    /// </summary>
    /// <param name="kept">How many rows to draw to begin with, for a list that is drawn again (a choice in a row): the reader keeps what they opened. <paramref name="remember"/> is told how many are drawn.</param>
    public static void Fill<T>(Panel host, IReadOnlyList<T> items, Func<T, Control> make, int page = Page, int kept = 0, Action<int>? remember = null)
    {
        var shown = 0;
        Button? more = null;
        void Next()
        {
            if (more is not null) host.Children.Remove(more);
            var upTo = Math.Min(items.Count, shown == 0 ? Math.Max(page, kept) : shown + page);
            for (; shown < upTo; shown++) host.Children.Add(make(items[shown]));
            remember?.Invoke(shown);
            if (shown >= items.Count)
            {
                more = null;
                return;
            }
            var left = items.Count - shown;
            more = new Button { Content = $"Show {Math.Min(page, left)} more", HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Left };
            more.Classes.Add("link");
            AutomationProperties.SetName(more, $"Show {Math.Min(page, left)} more, {left} left");
            more.Click += (_, _) => Next();
            host.Children.Add(more);
        }
        Next();
    }
}
