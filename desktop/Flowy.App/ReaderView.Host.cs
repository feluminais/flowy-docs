using Avalonia.Controls;
using Flowy.Core;

namespace Flowy.App;

internal sealed partial class ReaderView
{
    /// <summary>What the parts of the reader may ask of it.</summary>
    private sealed class Host(ReaderView r) : IReader
    {
        public Folder? Folder => r._folder;

        public string CurrentView => r.CurrentView();

        public Side? Pick
        {
            get => r._side;
            set => r._side = value;
        }

        public PanelTab? Tab => r._panels.Tab;

        public bool Editing => r.Editing;

        public bool ReadOnly => r.ReadOnly;

        public void Refresh() => r.Refresh();

        public void ShowNotice(string text, double seconds = 0, Action? undo = null) => r.ShowNotice(text, seconds, undo);

        public void GoTo(string view) => r.GoTo(view);

        public void OpenObject(string id) => r.OpenObject(id);

        public void Play(string flow, int step = 0) => r.Play(flow, step);

        public void SetTab(PanelTab tab) => r._panels.SetTab(tab);

        public void CloseNavigator() => r._panels.CloseNav();

        public void SetEditing(bool on) => r.SetEditing(on);

        public Task<bool> RunAsync(Func<EditDoc, EditDoc> op) => r.RunAsync(op);

        public void TakeFocus() => r.Focus();

        public void RevealAll(IEnumerable<string> ids) => r._canvas.RevealAll(ids, r._panels.DetailsInset, r._panels.NavInset);

        public void ShowRun(string run, double at)
        {
            r._perf.StopRamp();
            r._perf.SetRun(run);
            r.OpenPerf();
            r._perf.JumpTo(at);
        }

        public Task<bool> CopyAsync(string text) => r.CopyAsync(text);

        public (string Flow, int Step)? Playing => r.PlayingFlow() is { } p ? (p.Id, r.StopIndex()) : null;

        public string LineStyle => r.LineStyle;

        public bool PerfOpen => r.PerfOpen;

        public bool FailuresOpen => r.FailuresOpen;

        public string? SaveOff => r.SaveOff;

        public void Interacted() => r.Interacted();

        public void DidSomethingElse() => r.DidSomethingElse();

        public void PaneClicked() => r.PaneClicked();

        public void CloseDetails() => r.CloseDetails();

        public void StopAutoplay() => r._playback.StopAuto();

        public void LeavePerformance() => r.LeavePerformance();

        public Task<bool> WriteRunTagAsync(string id, CompareTag? tag) => r.WriteRunTagAsync(id, tag);
    }
}
