# Sketches

A sketch is for what isn't built or decided. It can't change the model, and its problems are not the model's.

- **New sketch**, in the Explorer's **Sketches** group, needs no edit mode
- A sketch opens in [a tab](desktop.md#tabs) beside its model, inside one outline
- To delete one, remove its folder or call `delete_sketch`
- A sketch holds no sketches, and keeps its own history
- `code` and `links` paths start where the model's do
- An exported page and the VS Code panel show the model alone
- An id in both `sketches/` and `drafts/` is the one in `sketches/`

## What a sketch holds

A sketch is a design to think with, so it carries what a reader needs to judge the idea:

- Shapes for what is new, and copies of the model's shapes it touches (`copy` on new_sketch).
- Flows that tell the whole story: what starts it, each call and its answer, the payloads that move, and the steps that fail with what happens next. Five plain steps rarely say enough.
- Motion on the steps that matter: a call that waits, an event, a timeout.
- `code` on each shape, line, flow and step that already exists in the repo, at the line it starts on. What isn't built has none.
- Failure modes for the risks the design takes, where one is worth rating.

An AI asked over MCP to sketch something writes all of this unless told otherwise.

## Several lines between two shapes

**Lines between two shapes** in Details at the top level (edit mode, nothing picked): **Merged**, or **Separate** for `pairs: separate`.

Lines run side by side in file order, each direction on its own side. **Move up** and **Move down** (edit mode) on a connection's card change the order. Connections with the same direction and label share one line.

Failures, Performance and Compare treat the shapes as one pair. Curved and angled lines of two pairs can overlap on a shared side, so many lines read best with `lines: straight`.

**In a flow.** The other lines part around [the line a step rides](flows.md#which-line-a-step-rides), which the key names **In use**.

```yaml
- { from: management, to: ui, text: Results reach the screen, via: Start scan }   # the request's line, though another line runs this way
```

**Many lines.** A pair draws its lines side by side while they fit: at most eight. Shapes side by side in a row have room for five lines one way, or four when lines run both ways. When they don't fit, lines that run the same way and share a kind fold into one with their count on it, which the key names **Stacked lines**. If that still does not fit, each direction folds into one stacked line, whatever the kinds. A pair of three lines or fewer never folds. A click opens a stacked line into its connections, up to twelve, and the panel lists them all.
