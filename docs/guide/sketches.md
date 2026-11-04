# Sketches

A sketch of a system or a flow kept apart from the model. Part of the [Flowy Docs guide](../guide.md).

## Sketches

A sketch is for something that isn't built yet, or isn't decided: a new feature, another way to do a part, a change to talk over before
anyone writes it into the model. It is a model of its own in `flowy/sketches/<id>/`, with the same files as the model (`model.yaml`,
`flows/`, `layout.yaml`, `failures/`), so it reads, edits and checks like one. The model never reads a sketch, so nothing in a sketch can
change it, and a problem in a sketch is no problem of the model's.

Plum has two: [Group orders](../demo/flowy/sketches/group-orders/model.yaml), where friends order into one basket and each pays their share, and [Embedded device](../demo/flowy/sketches/embedded-device/model.yaml), three layers of a touch-screen device with a line for each connection ([below](#several-lines-between-two-shapes)).

**Where they show.** The Explorer lists the model's sketches under its tree, in a **Sketches** group. A row opens the sketch the way the Model
picker opens a model. In a sketch, the top bar names the model it belongs to, which leads back, beside a **Sketch** mark. A sketch holds no
sketches of its own.

**Making one.** **New sketch** at the foot of the group asks for a name and makes an empty sketch, and needs no edit mode, since it
changes no file of the model. Its folder is named after it: "LAN transfer" is `sketches/lan-transfer/`. Edit it like the model, with
**Edit** (E). To delete a sketch, delete its folder.

**Starting from the model.** An AI can start a sketch with copies of shapes of the model: ask for a sketch "between these components",
and `new_sketch` copies the shapes you name, the shapes they sit in and the lines between them. Copies don't follow the model: a later change
to the model doesn't reach them, and a change in the sketch doesn't reach the model. Every other tool takes `sketch`, the sketch's id, to work on
the sketch instead of the model ([AI and MCP](ai.md)).

**What else knows about sketches.** `flowy check` checks each sketch after the model, on its own, and names a sketch's files from the model
folder (`sketches/group-orders/flows/order-together.yaml`). A shape's `code` and `links` paths in a sketch start from the same folder as
the model's, the one that holds `flowy/`. A sketch keeps its own history, apart from the model's ([The canvas](canvas.md#yaml-and-history)).
An exported page and the VS Code panel show the model alone.

**Called drafts before.** Sketches used to be drafts, in `flowy/drafts/<id>/`. Flowy still reads that folder, and a sketch in it works like any
other, so nothing needs moving. New sketches go to `sketches/`. If an id is in both folders, the one in `sketches/` is the sketch. An AI setup
that still calls `new_draft`, `get_drafts` or `delete_draft`, or gives `draft` to a tool, keeps working.

## Several lines between two shapes

The model draws one line between two shapes, however many connections run between them. A sketch can draw one line for each connection. A new sketch is set up that way, and so is one an AI starts from shapes of the model. For another, choose **Separate** under **Lines between two shapes** in Details (edit mode, with nothing picked), or add `pairs: separate` to its `model.yaml` ([the file format](../format.md#modelyaml)). **Merged** goes back to one line. The model leaves the key out, and a model that has it draws the same way a sketch does. Open Embedded device in Plum to see it: its Controller has six lines to the Touch app and seven to the Network daemon, all six kinds among them, and its four flows each play on the line a step names.

```yaml
# flowy/sketches/wlan/model.yaml
name: WLAN device
pairs: separate

connections:
  - { from: ui,         to: management, label: Request and reply, kind: request }
  - { from: ui,         to: management, label: Start scan,        kind: stream }
  - { from: management, to: ui,         label: Scan results }
  - { from: management, to: ui,         label: Radio state,       kind: cached }
```

The lines of a pair run side by side, one direction on one side and the other direction on the other, in the order their connections have in the file. Connections between the same two shapes that run the same way and have the same label share one line, so give each its own label. In edit mode **Move up** and **Move down** on a connection's card change that order. Select a pair, or a shape on it, and its lines spread so each shows its label. Click one and the panel opens that connection. Each line keeps its own [kind](kinds.md).

**In a flow.** When a step plays on the pair, the other lines part around the one the step rides, and that line keeps its place, so nothing crosses. The key at the foot of the canvas names it **In use**. A step picks its connection with `via: <label>` ([Flows](flows.md#which-line-a-step-rides)). Leave `via` out when the payload or the direction already say which one. A line that runs the step's way is tried first. A reply step rides the line of its request (a Request and reply or a Request then stream) only when no line of the pair runs the reply's way, or when its `via` or `payload` names that line. When recording a flow in edit mode, a click on a line sets the step's `via`.

```yaml
steps:
  - { from: ui, to: management, text: The screen asks for a scan, animation: call, via: Start scan }
  - { from: management, to: ui, text: Results reach the screen, via: Start scan }   # Scan results and Radio state run this way, so without via it would ride Scan results
```

**Many lines.** A pair draws its lines side by side for as long as they fit across the two shapes: at most eight, and fewer where the shapes are short across the pair. Shapes one above the other have room for eight. Shapes side by side in a row meet on their short sides, which have room for five lines one way, or four when lines run both ways. When the lines do not fit, those that run the same way and share a kind fold into one line with their count on it, and the key names it **Stacked lines**; a line with no mate stays as it is. If that still does not fit, each direction folds into one stacked line, whatever the kinds. A pair of three lines or fewer never folds. A click on a stacked line opens it into its connections, up to twelve. The panel always lists every connection.

**What stays pair-level.** Failures, Performance and Compare treat the shapes as one pair: a failure badge sits on the middle of the lines and traffic runs along their axis. With many lines on a pair, use straight lines (`lines: straight`, the default): curved and angled lines of two pairs on one side of a shape can overlap, because the side is not shared out between the pairs.

**The words.** The files say one thing and the app another.

| In the file | In the app |
| --- | --- |
| `pairs` | Lines between two shapes |
| `merged`, `separate` | Merged, Separate |
| `via` | The line a step rides (set by a click on the line while recording) |
| no `kind` | Plain line |
| a folded group of lines | Stacked lines |
