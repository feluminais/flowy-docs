# Sketches

A sketch is for what isn't built or decided. It can't change the model, and its problems are not the model's.

- **New sketch**, in the Explorer's **Sketches** group, needs no edit mode
- A sketch opens in [a tab](desktop.md#tabs) beside its model, inside one outline
- To delete one, remove its folder or call `delete_sketch`
- A sketch holds no sketches, and keeps its own history
- `code` and `links` paths start where the model's do
- An exported page and the VS Code panel show the model alone
- An id in both `sketches/` and `drafts/` is the one in `sketches/`

## Several lines between two shapes

**Lines between two shapes** in Details at the top level (edit mode, nothing picked): **Merged**, or **Separate** for `pairs: separate`.

Lines run side by side in file order, each direction on its own side. **Move up** and **Move down** (edit mode) on a connection's card change the order. Connections with the same direction and label share one line.

Failures, Performance and Compare treat the shapes as one pair. Curved and angled lines of two pairs can overlap on a shared side, so many lines read best with `lines: straight`.

**In a flow.** The other lines part around [the line a step rides](flows.md#which-line-a-step-rides), which the key names **In use**.

```yaml
- { from: management, to: ui, text: Results reach the screen, via: Start scan }   # the request's line, though another line runs this way
```

**Many lines.** A pair draws its lines side by side while they fit: at most eight. Shapes side by side in a row have room for five lines one way, or four when lines run both ways. When they don't fit, lines that run the same way and share a kind fold into one with their count on it, which the key names **Stacked lines**. If that still does not fit, each direction folds into one stacked line, whatever the kinds. A pair of three lines or fewer never folds. A click opens a stacked line into its connections, up to twelve, and the panel lists them all.
