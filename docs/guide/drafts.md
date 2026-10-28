# Drafts

A sketch of a system or a flow kept apart from the model. Part of the [Flowy Docs guide](../guide.md).

## Drafts

A draft is for something that isn't built yet, or isn't decided: a new feature, another way to do a part, a change to talk over before
anyone writes it into the model. It is a model of its own in `flowy/drafts/<id>/`, with the same files as the model (`model.yaml`,
`flows/`, `layout.yaml`, `failures/`), so it reads, edits and checks like one. The model never reads a draft, so nothing in a draft can
change it, and a problem in a draft is no problem of the model's.

Plum has one: [Group orders](../demo/flowy/drafts/group-orders/model.yaml), where friends order into one basket and each pays their share.

**Where they show.** The Explorer lists the model's drafts under its tree, in a **Drafts** group. A row opens the draft the way the Model
picker opens a model. In a draft, the top bar names the model it belongs to, which leads back, beside a **Draft** mark. A draft holds no
drafts of its own.

**Making one.** **New draft** at the foot of the group asks for a name and makes an empty draft, and needs no edit mode, since it
changes no file of the model. Its folder is named after it: "LAN transfer" is `drafts/lan-transfer/`. Edit it like the model, with
**Edit** (E). To delete a draft, delete its folder.

**Starting from the model.** An AI can start a draft with copies of shapes of the model: ask for a draft "between these components",
and `new_draft` copies the shapes you name, the shapes they sit in and the lines between them. Copies don't follow the model: a later change
to the model doesn't reach them, and a change in the draft doesn't reach the model. Every other tool takes `draft`, the draft's id, to work on
the draft instead of the model ([AI and MCP](ai.md)).

**What else knows about drafts.** `flowy check` checks each draft after the model, on its own, and names a draft's files from the model
folder (`drafts/group-orders/flows/order-together.yaml`). A shape's `code` and `links` paths in a draft start from the same folder as
the model's, the one that holds `flowy/`. A draft keeps its own history, apart from the model's ([The canvas](canvas.md#yaml-and-history)).
An exported page and the VS Code panel show the model alone.
