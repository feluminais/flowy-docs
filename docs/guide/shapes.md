# Shapes, colour and icons

Which shape, colour, opacity and icon a box can take, and when to leave them alone. Part of the [Flowy Docs guide](../guide.md).

## Shapes, colour and icons

Every shape starts with the look its type gives it: a person is a pill, a store is a cylinder, anything else is a rectangle, each
in its type's colour with its type's icon. Four optional fields change that, in the **Look** part of a shape's panel (in the app and
in the browser) or in the file. The type still decides what a shape may sit inside; these only decide how it is drawn.

```yaml
objects:
  paid:
    type: component
    in: checkout-api
    name: Payment taken?
    shape: diamond        # what it is drawn as
    color: amber          # a name, or #rgb / #rrggbb
    opacity: 30           # how much of the colour fills it, 0 to 100
    icon: coin            # a built-in icon, or one of your own
```

| Field | Takes | When you leave it out |
| --- | --- | --- |
| `shape` | One of the 13 shapes below | The type's: pill for an actor, cylinder for a store, rectangle for the rest |
| `color` | A name (`gray red orange amber green teal blue indigo purple pink`) or a hex colour | The type's colour, and grey for an outside service |
| `opacity` | A whole number, 0 to 100 | 15 once you set a colour, and 0 (the plain surface) until then |
| `icon` | A built-in icon name, or one defined under `icons:` | A cloud for an outside service, else the type's icon |

All four are optional, and a blank value (`shape:`) counts as left out. A value Flowy doesn't know is a problem, and the problem list
says which.

![The 13 shapes, each labelled with what it is for](../images/shapes.png)

### Which shape for what

Keep the type's own shape unless another says something the type can't. A model where every shape is different says nothing; one
where a diamond always means a decision, and a queue always means a queue, can be read at a glance.

| Shape | Use it for | For example |
| --- | --- | --- |
| `rectangle` | Things that run or do work: systems, apps, services, components. The default, and right most of the time | Order API, Billing |
| `pill` | People and roles, and the start or end of a flow | Customer, Support agent, "Order placed" |
| `ellipse` | A state or an event: something that is true or happens, rather than a thing that runs | "Payment failed", "Idle" |
| `diamond` | A decision: a question with more than one way out | "Paid?", "Within the limit?" |
| `hexagon` | Background work that runs without being asked: a worker, a job, a scheduled task | Nightly settlement, Image resizer |
| `parallelogram` | Data going in or out: an import, an export, a feed | CSV import, Invoice export |
| `cylinder` | A place data is kept: a database, a cache, a bucket, a warehouse. A store is one by default | Orders DB |
| `queue` | Things waiting their turn: a message queue, a topic, a job queue, a backlog | Order events |
| `document` | A file or paper someone reads, fills in or signs: a report, a form, a contract | Invoice PDF, Terms of service |
| `folder` | A group that holds others: a team, a package, a shared drive | Compliance, Billing team |
| `note` | A remark that is not part of the system: a caveat, an assumption, a to-do | "Manual step until Q3" |
| `cloud` | The wider world you reach over a network, when the shape itself should say "out there" | The public internet, A partner's network |
| `arrow` | One stage of a process that hands over to the next | Build, Test, Ship |

Some of these suit more than software. A hiring process is pills, arrows and diamonds; a warehouse is documents, queues and
folders; an organisation is folders and pills. Two cautions. A diamond, an ellipse and a cloud have less room for text, so keep their
names short. And an outside service already shows grey with a cloud icon from `external: true`, so reach for the cloud shape only when
the shape alone has to say it.

### Colour and opacity

A colour is a name, which has a version for the light theme and one for the dark so it reads on both, or any hex colour, which is
the same in both. It colours the icon, the outline and the fill. The fill is the colour at the opacity you give it over the
plain surface, 15 by default, which is a tint. Raise it for a stronger background, up to 100 for a solid one. Text and icon change
to near-black or near-white to stay readable on a strong fill, and the Mermaid copy keeps the colour as a `style` line.

Colour is a way to say something, so decide what first and say it once:

- **Use it for one thing across the model:** red for what is deprecated or risky, green for what is new, grey for what you don't own,
  blue for the part a team is responsible for. A colour that means three things means nothing.
- **Say what it means** in the descriptions that use it, or in the description of the shape that holds them. A reader can't
  look a colour up.
- **Keep the tint for grouping** and a strong fill for the one or two shapes the reader must not miss.
- **Don't use colour alone.** Someone who can't tell the colours apart still needs the name, the shape or the icon to say it.

### Icons

An icon says what a shape is at a glance, in a small space. There are about 150 built in (from [Tabler Icons](https://tabler.io/icons)),
picked for what people document. Pick one from the grid under Icon, which filters as you type, or write `icon: name`.

**People.** `user`, `users`, `user-circle`, `user-check`, `user-cog`, `user-shield`, `users-group`, `headset`, `robot`, `id-badge-2`, `heart-handshake`

**Places and organisations.** `building`, `building-bank`, `building-store`, `building-factory-2`, `building-warehouse`, `building-skyscraper`, `building-hospital`, `home`, `school`, `map-pin`, `world`, `flag`

**Computing.** `server`, `server-2`, `database`, `cloud`, `cloud-upload`, `cloud-computing`, `api`, `app-window`, `apps`, `cpu`, `device-desktop`, `device-laptop`, `device-mobile`, `device-tablet`, `terminal-2`, `code`, `git-branch`, `git-merge`, `git-pull-request`, `bug`, `settings`, `tool`, `rocket`, `bolt`

**Data and flow.** `arrows-exchange`, `refresh`, `repeat`, `filter`, `table`, `chart-bar`, `chart-line`, `chart-pie`, `list-check`, `hierarchy-2`, `binary-tree`, `schema`, `timeline`, `webhook`, `layers-intersect`, `stack-2`, `puzzle`, `cube`, `package`, `packages`, `box`, `container`

**Network and devices.** `network`, `router`, `wifi`, `antenna`, `satellite`, `plug-connected`, `battery-2`, `printer`, `camera`, `video`, `microphone`, `qrcode`, `barcode`, `scan`, `radar`

**Documents and messages.** `file`, `file-text`, `file-invoice`, `file-certificate`, `files`, `folder`, `notebook`, `book`, `books`, `article`, `clipboard-check`, `signature`, `certificate`, `receipt`, `mail`, `message`, `messages`, `bell`, `phone`, `calendar`, `clock`, `hourglass`, `alarm`

**Money and trade.** `coin`, `credit-card`, `wallet`, `cash`, `calculator`, `shopping-cart`, `basket`, `tag`, `receipt-2`, `gift`

**Transport.** `truck`, `truck-delivery`, `plane`, `ship`, `train`, `car`

**Security and rules.** `lock`, `key`, `shield`, `shield-check`, `fingerprint`, `eye`, `gavel`, `scale`

**Status and ideas.** `check`, `circle-check`, `alert-triangle`, `alert-circle`, `star`, `heart`, `bookmark`, `target`, `bulb`, `brain`, `sparkles`, `flame`, `droplet`, `leaf`, `tree`, `sun`, `moon`, `trophy`, `award`

**Science and health.** `flask`, `microscope`, `stethoscope`, `heartbeat`, `medical-cross`, `pill`

Choose an icon when it names the thing better than its type does: a `truck` for the courier, a `mail` for the notification service, a
`lock` for the login. Leave it out when the type's icon already says it.

**Your own icons** go in an `icons:` section at the top of `model.yaml`: a name, and the SVG path data of a line icon on a 24 by 24
grid, drawn two units thick with round ends like the built-in ones. Name a shape's `icon:` after it.

```yaml
icons:
  stripe: M4 6h16v12h-16zM4 10h16M8 15h3   # a card
objects:
  stripe:
    type: system
    name: Stripe
    external: true
    icon: stripe
```

To take one from an SVG file, copy the `d` of each `<path>` and join them one after another, as the built-in ones are. A name is
lowercase letters, digits and dashes, and can't be one of the built-in names. Claude adds and removes them with the `put_icon` and
`delete_icon` tools, and `get_model` lists the ones a model has. An icon that is still in use can't be deleted. There are no
colour or image icons: an icon takes the colour of the shape that shows it.
