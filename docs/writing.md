# Writing good Flowy docs

[The guide](guide.md) says what every part of the canvas does. This page is about what to put in it: which shapes to draw, how to word a description, a connection or a step, and how to keep the model true. The examples marked Plum come from the made-up delivery service whose model is in [`docs/demo/flowy`](demo/flowy). The rest are written for this page.

The rules are what IcePanel, the C4 model, arc42, Structurizr and a few others teach for the same job, fitted to Flowy's layers ([where they come from](#where-this-comes-from)). The numbers (about 25 words, a dozen shapes) are suggestions. Nobody has tested them, so change them when your model says otherwise.

## The idea

Write what the code can't tell you, and point at what it can. Code shows how. It doesn't show what a part is for, who relies on it, why it's cut this way or what it must never do. That's what the model is for. Facts that change with every commit (versions, endpoint lists, file lists) belong in the code, one `code:` path away. The model is a map, not all of the documentation: long documents still have a place beside it ([what stays outside Flowy](#what-stays-outside-flowy)).

A reader meets your words in four layers, and each should work without the next:

| Layer | Where it shows | What goes in it |
| --- | --- | --- |
| Name and tech | On the shape | What it's called and what it's built with |
| Look | On the shape: its outline, colour and icon | What kind of thing it is, at a glance |
| Teaser | On hover: the first paragraph of the description, up to the first blank line | One sentence on what it does |
| Panel | On click: the rest of the description | Why it's like this, its limits, its risks |
| Step and More | In the flow player | One handover, then why it matters |

Someone who stops at the teaser must not leave with a wrong idea. Anything that prevents one ("Deprecated", "planned") goes in the teaser, not the panel.

## Before you write

1. **Pick the reader and their question**, in one line: "A new backend developer wants to see what happens when a customer places an order, so they know where to change pricing." A model for everyone answers no one. Draw the shapes and flows that answer the question, and leave the rest.
2. **Start small.** The actors and systems, the apps and stores inside each with their `tech`, three to five flows for the journeys that matter, and text only where something is surprising. Write the stable parts first. Add components where they earn their place.

## What gets a shape

| Type | Draw it when | Plum |
| --- | --- | --- |
| Actor | A person or a role, never a named individual | Customer, Support agent |
| System | One team builds and owns it, and it delivers value | Ordering, Delivery |
| App | It runs on its own: a service, a mobile app, a website, a serverless function, a batch job | Order API, Courier app |
| Store | It keeps data or messages: a database, a cache, a file store, a named queue or topic | Orders DB, Order events |
| Component | A part behind its own interface, in the same process as its app | Checkout, Pricing |

- **External is about ownership.** If you don't own the code, mark it `external: true`. A managed database that holds your own data is still your store, inside your system.
- **A folder, package, library, class or file is not a shape.** Domains, layers and teams are ways to group shapes, not shapes.
- **Leave out what no flow touches:** logging, config, build and deploy plumbing, data classes, and the insides of outside services. A missing shape is information too.
- **Keep each level readable.** A handful of shapes under a parent, a dozen at most. Shapes side by side should sit at the same level of detail, so don't put a module next to a vendor.
- **The top level is for everyone.** People and systems, no protocols. A reader who doesn't code should follow it.
- **Queues are stores.** Model each named queue or topic as a store named for what it carries (Plum's Order events, tech Kafka). Producers and consumers connect to it. Don't draw one bus that everything touches.
- **Two patterns:** a monolith is one app and one store, with its modules as components. Microservices are apps in one system when one team owns them, and separate systems when different teams do.

**Too crowded?** Flowy nests in a fixed way and draws one view per shape, so you can't add a view or an in-between level. Leave out what a reader following a request would never reach. Or re-cut a boundary: split a system by owning team, or fold look-alike services behind one app whose parts are components. Or tell the part you care about as a flow.

## Names and tech

- **Use words a new teammate knows.** "Order events", not "OE-bus". Spell out an acronym in the teaser.
- **Don't name a shape after its type.** `Database`, `API` and `Data` say nothing the icon doesn't. Name what it holds or does ("Orders DB") and let `tech` say Postgres.
- **Singular names that make sense outside their view.** "Standard APIs" and "Checking" don't.
- **One name per thing, everywhere,** in names, labels, steps and text. If "Payment API", "the billing service" and "PSP" all mean one shape, pick one and rename. Don't add a second shape.
- **Siblings get distinct names.** A generic name like "Database" may repeat under different parents, but then the teaser says which.
- **Name an outside service after the vendor** and put its role in the teaser: Stripe, "Takes card payments and sends refunds."
- **Fill `tech` on every app, store and component** with the real stack, short, no sentence: `Node, Fastify`, `Postgres, PostGIS`.
- **Mark planned or retiring things** in the name ("Recommendations (planned)") or the teaser ("Deprecated: ..."). Flowy has no status field.

## Shape, colour and icon

The type already gives every shape a good look, so most shapes need none of this. Choose one when it says something the type can't ([which shape for what](guide.md#which-shape-for-what)).

- **Let the shape carry the kind of thing.** A decision is a diamond, a message queue a queue, a report a document. Then a reader knows what a shape is before reading it, and the name can say what it holds.
- **Use one shape for one kind of thing, everywhere.** If one queue is a queue and another is a rectangle, the reader will wonder what the difference is.
- **Give a colour one meaning across the model,** and say it in the descriptions that use it: red for deprecated, green for new, blue for what your team owns. Don't colour for decoration.
- **Keep the default tint** and raise the opacity only for the one or two shapes the reader must not miss.
- **Pick an icon only when it names the thing better than its type does,** and keep to a few: a `truck` for the courier is worth it, a different icon on every shape is noise.
- **Never let the look carry the only copy of a fact.** Someone who can't tell the colours apart, or who reads the Mermaid copy, still needs the name and the teaser to say it ('Deprecated' goes in the teaser, not only in red).

## Write the teaser

The first paragraph of a description is what a hover shows. Give every shape one. It's a sentence or two, about 25 words, saying what the shape does for others, in words its name doesn't already hold.

- **Start apps and components with the verb,** and a store with what it keeps. Plum's Dispatch: "Turns each new order into a courier on the way."
- **Add something the name doesn't say.** Don't repeat the name or open with "This component is" or "The Order API is".
- **Use the real verb.** "Handles", "manages" and "responsible for" hide it. Say charges, stores, publishes.
- **Give the fact, not praise.** "Robust" and "seamless" can't be checked. "Retries a declined charge once" can.
- **Several "and"s mean two shapes.** If you can't say it in one sentence, split the shape.
- **Say what a shape with children covers.** Plum's Ordering: "Everything a customer touches: browsing menus, building a basket, paying."
- **Actors are roles, described by what they do here.** Plum's Restaurant: "The kitchen staff who accept an order and mark it ready."
- **For an outside service, say what it does for you** and, if it matters, what it doesn't do. Plum's Stripe: "Takes card payments and sends refunds. Plum never sees a card number."
- **Put warnings first.** "Deprecated: charges cards for the old shop. Use Payment API v2."
- **Write for any day.** "Currently", "now", "soon" and "will" go stale. "(planned)" is the one exception.

| Instead of | Write | Why |
| --- | --- | --- |
| "Handles payments, refunds, invoices and receipts." | Two shapes, each with one sentence | Too many jobs |
| "Stores orders." (on Orders DB) | "Orders, baskets and refunds. The source of truth for what a customer owes and was charged." (Plum) | The name already said it |
| "Component responsible for checkout." | "Prices the basket, authorises the card and places the order." (Plum) | The real verbs |
| "A robust, scalable payment solution." | "Charges cards and retries a declined charge once." | A fact, not a claim |

## Write the panel

The rest of the description shows when someone clicks. Spend the words where the code is silent.

- **Lead with the point.** Every paragraph, then the detail. Two to four short paragraphs, about 150 words at most.
- **Say why.** Why it's cut this way, which choice it makes, what it must never do. Plum's Checkout: "Nothing is charged until the restaurant accepts. A rejected order releases the hold." Link a decision record if you keep them, and say in a clause what it means here.
- **Write behaviour, not implementation.** Would the sentence change if the code did? "Delivers events to one worker at a time, in the order they arrived" survives a rewrite. "Uses a Redis list with BRPOP" doesn't.
- **Keep out what goes stale:** versions, counts, endpoint lists, file lists. Link the file in `links:`, such as an OpenAPI spec, and let the code stay the source.
- **Don't repeat what the panel already shows:** the type, the tech, the connections.
- **Define an acronym where you first use it.** Each text is read alone.
- **Link out freely.** Point at the runbook, the decision record or the spec rather than retelling them ([what stays outside Flowy](#what-stays-outside-flowy)).
- **Describe, don't instruct.** "Run `make deploy`" belongs in a README.
- **Write more for what's surprising or risky** and less for what's plain. The teaser is enough for a plain shape.
- **Name an owner only on top-level systems,** if at all, and name a team, not a person. Owners change.

## Label connections

A line says that two shapes are connected. Its label says how. Lines show their labels on hover or when a shape is selected, so a label is always read next to the two names. Make it true when read that way.

- **Label every line.**
- **Write what the source does, from its side:** a verb phrase that reads as a sentence from source to target. Plum: "asks for totals" (Basket to Pricing), "holds the card" (Checkout to Stripe), "refunds the charge" (Refunds to Stripe).
- **Say what moves.** Avoid "uses", "calls", "talks to", "data", "API". "Sends customer update events to" beats "customer updates".
- **A few words,** two to five. Detail goes in the panel or in a step's More, and code doesn't go in a label.
- **Run from whoever starts it.** A reply isn't a connection, so show it in a flow. Draw two lines only when each side starts something of its own, such as a server that pushes events to a client that also makes requests.
- **One line per relationship, not per feature.** The line says "Browses and makes purchases using". A flow step says "Requests the top 20 books from". Feature detail belongs in flows.
- **Name the protocol only where it matters,** in brackets at the end ("Sends requests to (JSON/HTTPS)"), or leave it to the target's `tech`. A line has no tech field of its own.
- **Keep a small set of verbs and give each one meaning:** sends requests to, fetches data from, reads from, writes to, publishes events to, subscribes to, authenticates with. Don't use "pushes to", "sends to" and "posts to" for one handover.
- **Connect the most specific shapes you know** (component to store). Zoomed-out views merge the lines on their own.

## Write flows

A flow is a walkthrough of one thing happening. It has a name, the view it plays on, and steps. A step has a `from`, a `to` (leave it out when one shape acts alone), a `text`, and an optional `description` that shows as More.

- **Keep few flows.** The key journeys, the risky or surprising ones, the failure path, start-up, and the calls to outside services you depend on. Not every use case.
- **Name a flow for a goal:** "Customer places an order", not "Order flow".
- **One trigger, one story,** about 3 to 9 steps. If you can't say it in a sentence, split it. A longer story becomes phases, and the second names what it needs in step 1's More.
- **Happy path first, and whole.** Give each failure its own flow, whose first step states the condition as a fact ("Stripe declines the card").
- **The sender is the subject.** Start the text with a verb and say what is handed over: "Hands the order to Billing", "Asks Pricing for the total". One handover per step.
- **Put the intent in the step and the mechanics in More.** "Sends the basket to place the order", then More: "`POST /orders`, with an idempotency key, so a double tap places one order."
- **Say who waits.** If the sender doesn't wait (it queues the work, fires and forgets, or runs on a timer), say so.
- **Add a step back only when something new is sent,** or time passes. "Returns approved or declined" earns a step. A bare acknowledgement doesn't. When a shape asks and gets its answer in the same step, say so.
- **Stay with what the trigger causes.** Something that happens on its own gets a step that says so, or a flow of its own.
- **Use More for why:** timing, failure behaviour, limits. About 80 words, point first, never a repeat of the step. Plum's kitchen step: "The kitchen has two minutes to accept. After that the order is cancelled, the hold is released and the customer is told."
- **Play the flow on the view where its ends are separate shapes.** A step written "X in Y" is drawn as Y. For detail inside a shape, write a second flow on that shape.
- **A step with no matching line means the model is missing one.** Fix the model, then the step.
- **Tag a step only when the way it travels adds something.** `animation: call` when the sender waits for the answer, `send` or `event` when it doesn't, `callback` when something sets off a reply to whoever subscribed, with `trigger: outside` when what set it off came in at the step before. Most steps stay untagged. The text still says everything: it has to read the same in Mermaid, in a screenshot and with motion off.

An example. This is a flow Plum doesn't have, with Plum's shapes.

Before:

| # | From to | Text |
| --- | --- | --- |
| 1 | Customer to Customer app | "User taps cancel" |
| 2 | Customer app to Order API | "DELETE /orders/:id" |
| 3 | Order API to Stripe | "Stripe releases the hold" |
| 4 | Order API to Orders DB | "Order is marked cancelled" |
| 5 | Order API to Order events | "cancelled event" |
| 6 | Order events to Dispatch | "Dispatch stops the search" |

After:

```yaml
name: Customer cancels an order
view: ordering
steps:
  - { from: customer, to: customer-app, text: Taps Cancel on an order the restaurant hasn't accepted }
  - from: customer-app
    to: order-api
    text: Asks to cancel the order
    description: |
      `DELETE /orders/:id`. Once the restaurant has accepted, the request is refused and the
      customer is pointed to support.
  - from: order-api
    to: stripe
    text: Releases the hold on the card
    description: Nothing was charged yet, so there's no refund to make.
  - { from: order-api, to: orders-db, text: Marks the order cancelled }
  - { from: order-api, to: events, text: Announces the cancellation and carries on without waiting }
  - { from: events, to: dispatch, text: Hands the cancellation to Dispatch, which stops looking for a courier }
```

What changed: the sender is the subject in every step, the endpoint moved into More, the hold is something the Order API does to Stripe rather than something Stripe does, the event step says nobody is waited for, and each step says what passes.

## Point at code

`code:` lists the files and folders a shape lives in. A path that doesn't exist shows up as a problem, so the model can't quietly point at code that's gone.

- **Two or three paths per shape,** never every file. Folders survive a rename better than files.
- **Give every app, store and component a path.** Actors and outside services are the exceptions. If you can't point at anything, ask whether the shape is real.
- **`code:` is for where a shape lives, `links:` is for what to read about it.** A runbook or a decision record goes in `links:`.
- **Link the interface, don't copy it.** Link the OpenAPI file in `links:` instead of listing the endpoints in the panel.
- **Fix a broken path by pointing it at the new place,** or delete the shape if the code is gone. Removing `code:` to clear the "!" hides the problem.
- **A path that exists proves little.** It doesn't show the description is still right. When code changes what a shape does, update its text even though no "!" appears.

## What stays outside Flowy

Flowy is the map: what the parts are, how they connect and how a request travels. It isn't all of the documentation, and the panel is short on purpose. Decisions, procedures and reference tables still deserve proper long documents. Keep them as plain Markdown in the repo, and link to them from the shape. Links to proper documentation are encouraged: a shape that points to its runbook, its decision record or its spec is doing its job, and Flowy is the quickest way to find them.

One rule keeps the two from drifting apart: **each fact lives in one place.** The panel says what and why in a few lines and links to the long version. The long document says which shape it's about, using the shape's name. Don't copy a table or a procedure into a description. When a panel passes about 150 words, move the rest out.

| Document | Keep it as | The shape points to it with |
| --- | --- | --- |
| Decision records | One file per decision, such as `docs/adr/0007-hold-then-charge.md` | `links:` on the shape the decision shaped, and a sentence in the panel: the choice and what it means here |
| Runbooks | One file per app or store, such as `docs/runbooks/order-api.md` | `links:` on that app or store |
| API reference | Generated from the spec (OpenAPI, protobuf), not written by hand | `links:` to the spec file, and no endpoint list in the panel |
| Onboarding and how-tos | A README or a `docs/` folder, written as steps ("Run it locally") | `links:` on the top-level system |
| Quality goals, constraints, risks | One short file for the project: what must hold (uptime, where data may live) and where it's fragile | `links:` on the top-level system |
| Glossary | One file for the terms people argue about | `links:` on the top-level system, and each term spelled out in the teaser where it first appears |

How a shape points to a document:

- **Add it to `links:`.** Each entry has a `title` and a `url`, which is a web address or a path in the repo. They show in a Links section under the description. A repo path is checked, so one that has moved shows up as a problem, and on the canvas it links to the file on GitHub or GitLab. Without a GitHub or GitLab origin it shows as plain text and is still checked. The desktop app opens a repo path on your computer instead: a document in your default app, a folder in the file explorer, and anything that could run (a script, a program) is shown in its folder and not run. Under File › Open Files With you can pick the app that opens them.
- **Use a web address** for a document that isn't in the repo, such as a wiki page or a status page. It opens in a new tab, and nothing checks it.
- **Don't use a relative Markdown link** in a description, such as `[ADR 7](docs/adr/0007-hold-then-charge.md)`. The canvas resolves it against its own address, which answers "not found", and an export holds only the canvas, so it fails there too. Put the document in `links:`.

A long document can point back at the map. On a hosted export the address follows what's on screen, so a link to `#ordering` opens the inside of Ordering, and `#ordering/place-order` plays that flow.

## Keep it true

- **Change the model in the same pull request as the code.** Review the YAML diff like code.
- **Delete rather than update.** A model with gaps is better than one with stale shapes. Retire a flow nobody plays.
- **Give the model one gardener.** `CODEOWNERS` on `flowy/` is enough for a small team.
- **Show doubt.** If something is a guess, end the description with "Open question: ..." rather than a plausible sentence. This is a convention, not a feature.
- **Export again after the model changes.** The static site is a snapshot.

## Work with Claude

The server refuses what is broken: a path that doesn't exist, an unknown shape, a shape in the wrong parent, a step that can't be shown on its view. It doesn't judge wording, and it can't tell that a shape is invented. So the first pass is yours to review.

Claude's usual mistakes are shapes at the wrong level (every class a shape), plausible shapes the code doesn't have (a Redis, a gateway), generic descriptions ("Handles requests"), labels like "uses", and outside services nobody told it about. What helps is structure more than longer prompts.

- **Start with a survey, not with writing.**

  ```text
  Map this repo into Flowy, but don't write anything yet. List the people, apps, stores and
  outside services you can find, each with the file or folder that shows it. Mark the ones we
  don't own. Leave out anything you can't point to. I'll check the list first.
  ```

- **Say what the model is for,** with the reader line from the start of this page. Level and detail follow from it.
- **Allow "I can't tell".** Leaving out what it can't point to is the right answer.
- **Name the outside services, schedulers and inbound callers yourself.** They live in config and in people's heads, which is where Claude misses them.
- **Work in passes and commit between them:** shapes, then connections, then flows, then the text.
- **Reject descriptions you could have written from the name alone.**
- **Review the diff** for shapes with no `code:`, duplicate names, deletions and descriptions that restate the name. A fresh session makes a good second reader.
- **After a code change, give Claude the change.**

  ```text
  Read flowy/model.yaml first. Here is my last change: <diff or branch>. Change only the parts
  it affects, mark anything you guessed as an open question, and tell me what you left alone.
  ```

- **Ask for a closing note:** what it read, what it inferred, what it left out.
- **After two failed corrections, start over** with a better first message.
- **Don't paste a generated overview into `CLAUDE.md`.** Keep it for what the code can't say: where the model lives and how to check it.

## Review checklist

- Does every shape have a teaser that says something its name doesn't?
- Does every app, store and component have a real `tech`?
- Is every acronym explained where it's used?
- Does every line have a verb label that reads as a sentence from the source?
- Is every flow named for a goal, with one trigger and the sender as the subject of each step?
- Does each level hold a handful of shapes?
- Does every shape you built have a `code:` path that exists?
- Does anything long (a procedure, a table, a decision) live in a document the shape links to, rather than in its panel?
- Is anything planned or deprecated marked in its teaser?
- Does every shape, colour and icon that isn't the type's default say something, and does each colour mean one thing?
- Is anything that was guessed marked as an open question?

## Where this comes from

- The [C4 model notation](https://c4model.com/diagrams/notation) and its [review checklist](https://c4model.com/diagrams/checklist): labelled one-way lines, no bare "uses", and what each level shows.
- [arc42](https://docs.arc42.org/tips/5-5/): one or two sentences on what a block does, [two or three code references](https://docs.arc42.org/tips/5-14/), and [a few runtime scenarios](https://docs.arc42.org/tips/6-2/).
- [Structurizr's inspections](https://docs.structurizr.com/workspaces/inspections) and its [dynamic-view cookbook](https://docs.structurizr.com/dsl/cookbook/dynamic-view): what a model should have filled in, and one general line against specific steps.
- [IcePanel's docs](https://docs.icepanel.io/getting-started) and [Claude skill](https://github.com/IcePanel/icepanel-plugin/blob/main/skills/creating-c4-diagrams/SKILL.md): the short and long description, and rules for an agent that builds a model.
- [LikeC4's dynamic views](https://likec4.dev/dsl/views/dynamic/): a short label with longer notes on each step.
- [Ilograph's diagram mistakes](https://www.ilograph.com/blog/posts/diagram-mistakes/): mixed levels and unlabelled arrows.
- [Google's style guide for reference comments](https://developers.google.com/style/api-reference-comments): a first sentence that says more than the name.
- [Diátaxis](https://diataxis.fr/) and [Nygard on decision records](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions): tutorials, how-tos, reference and explanation are different documents, and one decision gets one short file.
- [Software Engineering at Google, chapter 10](https://abseil.io/resources/swe-book/html/ch10.html): owners, deleting, and keeping documents fresh.
- [An ICSA 2026 study of generated architecture views](https://conf.researchr.org/details/icsa-2026/icsa-2026-papers/25/LLM-based-Automated-Architecture-View-Generation-Where-Are-We-Now-): models drift to code level, and prompt wording changed little.
