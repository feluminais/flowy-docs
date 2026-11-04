# Sketches

A sketch of a system or a flow kept apart from the model. Part of the [Flowy Docs guide](../guide.md).

## Sketches

A sketch is for something that isn't built yet, or isn't decided: a new feature, another way to do a part, a change to talk over before
anyone writes it into the model. It is a model of its own in `flowy/sketches/<id>/`, with the same files as the model (`model.yaml`,
`flows/`, `layout.yaml`, `failures/`), so it reads, edits and checks like one. The model never reads a sketch, so nothing in a sketch can
change it, and a problem in a sketch is no problem of the model's.

Plum has one: [Group orders](../demo/flowy/sketches/group-orders/model.yaml), where friends order into one basket and each pays their share.

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
