# Writing good Flowy docs

What to draw, how to word it and when to use an optional part. Keys are in [the file format](format.md). Plum is the [demo model](demo/flowy).

## Write the model

Write what the code can't tell you: what a part is for, who relies on it, why it's cut this way, what it must never do. Facts that change with every commit stay in the code. Pick one reader and their question in one line, and draw what answers it.

### What gets a shape

- Actor: a role, never a named person
- System: one team owns it, and it delivers value
- App: runs on its own (a service, mobile app, website, serverless function, batch job)
- Store: keeps data or messages (a database, cache, file store, named queue or topic). A queue is named for what it carries, and producers and consumers connect to it.
- Component: a part behind its own interface, inside one running program
- A folder, package, library, class or file is not a shape. Neither is a domain, layer or team.
- A monolith is one app and one store, with modules as components.
- Mark what you don't own `external: true`. A managed database holding your data is your store.
- Leave out what no flow touches: logging, config, build and deploy plumbing, data classes, the insides of outside services.
- Keep a view to a handful of shapes, a dozen at most, at one level of detail. The top level is people and systems, no protocols.

### Names, tech and paths

- Name a shape for what it holds or does ("Orders DB"), never its type ("Database"), singular, in words a new teammate knows. Spell out an acronym where it first appears.
- One name for one thing everywhere.
- Name an outside service for the vendor (Stripe), with its role in the teaser.
- Fill `tech` on every app, store and component with the real stack, short ("Node, Fastify").
- Give every app, store and component a `code` path: two or three, folders before files. Actors and outside services are the exception.
- A path that exists proves little: when code changes what a shape does, update its text.

### Looks

Shape, colour, opacity and icon are optional: the type picks a good default. Set one only when it says what the type can't, never as the only copy of a fact.

- One shape for one kind of thing: [Which shape for what](guide/shapes.md#which-shape-for-what).
- A colour means one thing across the model, said in the descriptions that use it. Leave opacity alone unless you set a colour.
- An icon only when it names the thing better than its type's.

### Text

- A description's first paragraph is the hover teaser, on every shape: about 25 words on what it does for others, in words its name doesn't hold. Start apps and components with a verb ("Assigns a courier to each new order") and a store with what it keeps. A shape with children says what it covers, an actor what the role does here.
- Use the real verb (charges, stores, publishes). No "handles", "manages", "responsible for", no praise. Several "and"s mean two shapes.
- Warnings go first ("Deprecated: ...", "(planned)"): a reader may stop at the teaser. Write for any day: no "currently", "now" or "soon".
- Later paragraphs: why, limits, risks. Point first, about 150 words at most, none for a plain shape. Write behaviour, which survives a rewrite. No versions, counts or endpoint lists, nothing the panel shows, no commands to run.
- Where something is a guess, end its description with "Open question: ..." and never a plausible sentence.
- Long documents (runbooks, decision records, specs) go in `links`. A relative Markdown link in a description fails on the canvas and in an export.
- The project's `about`: what the system is for, who uses it and which shapes to open first, in one or two short paragraphs. No list of shapes, stack or endpoints.

### Label connections

- Label every line. A connection label is a few words, a verb and what moves, said from the side that starts it ("publishes order events", "reads menus"). No code.
- The arrow shows which way, so never end on "to", "from", "with" or another preposition, unless it belongs to the verb and has its object ("signs in with Auth0").
- Never "uses", "calls", "talks to", "data" or "API".
- A reply is not a connection. Connect both ways only when each side starts something of its own.
- One line per relationship in the model. Feature detail goes in flow steps.
- Set a `kind` only where the code shows it. A plain line is right when unsure.

### Write flows

- Few flows: the key journeys, the risky ones, the failure path, start-up, calls to outside services. Name each for a goal ("Customer places an order").
- Start with whoever sets it off: the person, or the outside system or timer when no person does. Show people where they act later and where the result reaches them.
- One trigger, one story, usually 3-9 steps.
- Happy path first and whole. A failure gets its own flow, whose first step states the condition as a fact ("Stripe declines the card").
- A step is one handover, the sender its subject, saying what passes: "Hands over the order", "POST /orders with the basket". Leave the receiver's name out unless the text needs it, and never end on "to", "from" or another preposition.
- Say when the sender doesn't wait (it queues the work, fires and forgets, runs on a timer).
- Add a step back only when something new is sent or time passes. When a shape asks and gets its answer in one step, say so.
- Keep to what the trigger causes. Something that happens on its own gets a step that says so, or its own flow.
- More (a step's description) holds why, timing, failure behaviour or limits, about 80 words, never a repeat of the step.
- Play a flow on the view where its ends are separate shapes. put_flow answers with how each step reads there: an end written "X in Y" is drawn as Y.
- A step with no matching line means the model is missing one: fix the model, then the step. A step handing something to a person is the exception.
- Write plain steps. Motion, repeats, branches, parallel lanes and shape states are for a user who asked for them: read flowy://rules/flows first.

## Flows beyond plain steps

Every step text still says everything, with motion off and as a plain list.

### Motion

- Animate only when the user asked for motion. Then ask how much, unless they have said: Key steps (only a step whose way of travelling adds to its text) or Every step that hands something from one shape to another. If they asked for motion and gave no more, animate every such step.
- Pick the kind by who waits: `call` when the sender waits for the answer, `send` or `event` when it doesn't, `callback` when something sets off a reply to a subscriber (`trigger: outside` when that came in at the step before).
- A step with no "to" can't travel, with one exception: a shape that calls itself to handle a smaller piece of the same job (a tree walk, a CNAME chase) is one step with no "to", tagged `recurse`. The text says what gets smaller and what stops it. `depth` is only how deep the picture goes, so the real limit goes in More. Repeating the same work without nesting is not recursion.

### Outcomes

- Give an `outcome` only where a step really ends that way: `fail` on a send or call that is refused (a declined card), `timeout` on a call nobody answers, and on a send, call or event `lost` (never arrives), `rejected` (turned away at the door: a rate limit, a firewall), `intercepted` (taken by a third party, named in `by`), `duplicated` (delivered twice) or `delayed` (the story is a wait: a cold start, a queue). A step that is a little slow gets none.
- Add a `reason` in a few words ("Rate limit") when the picture raises the question of why, and a `share` when only some of the requests end that way.

### Groups

- Mark structure only where it is true. Keep a group's steps next to each other, and don't put one group inside another.
- A repeat is the same steps run again: times is the limit the code really has (never a number for the picture), and until says what stops it. The backoff goes in the group's text.
- A branch is alternatives: each lane starts at the step that says `lane`, named by its condition in plain words. A failure that is a single step can be a lane; one that is a story stays its own flow.
- Parallel lanes all start together: a fan-out to several receivers is one-step lanes, so every step keeps one "to".
- A step may say flow: the id of another flow that tells what happens next.

### States

- A shape is Running unless a flow says otherwise. A step's `states` (running, starting, stopping, stopped, restarting, degraded) are for where the story really takes a shape down, brings it up or hurts it: an outage and its recovery, a deploy. Never for decoration, and never one you can't point to in the code or the incident.
- The change holds, so set the shape back to running when it recovers. If a shape's state after a branch matters, set it again in the next step.

### Streams, listeners and jobs

A step's `opens` leaves something drawn on later steps: `stream` (server-sent events, a websocket), `listener` (after a subscribe or a webhook registration) or `job` (a long report). Use it only where the story really keeps it open, and close it with a later step when the story ends it.

### Which line a step rides

Where the project draws a line for each connection (`pairs: separate`, as a sketch does), a step between two shapes with several connections may name the one it rides with `via`: its label, in any case.

### Payloads

A payload says what data moves where: write one with put_payload only when the user asks what lines or steps carry, or names a request or message a reader would ask about. Write it once and name it by id. Stay high level (name the types inside), and copy a schema or type from the repo rather than invent one.

### Folders and tags

The reader's own way of sorting flows. Leave them out unless the user asks. The form's tags: `happy path` (everything works), `error path` (something fails), `edge case` (an odd input or moment), `recovery` (the system heals itself, or someone repairs it), `background` (work nobody waits for).

## Data

Writing data (put_object's data), so a store shows what it holds:

- Only for a store the code shows, and only the few tables, key sets, topics or collections a reader needs to follow the flows. Take names, columns and keys from a migration, a schema file or the code that builds the keys, and add nothing you can't point to.
- Keep the columns that tell the reader something: the key, what it points to, the money. Leave out audit columns, defaults and indexes. Give a column its `type` when the name and sample row don't show it, ending in `?` when it can be empty.
- Sample rows are invented. They are never copied from a real database, a dump or a log, and carry no real names, emails, phone numbers or ids: use made-up ones like o_1042 and Noodle Bar. Two or three rows.
- A note is one line on why: "Stored in cents because rounding broke the first tax run." Leave it out when the name says it all.
- Check `limits` against the config ("Kept 7 years, then archived").
- A key-value store is columns Key, Value and Expires, a stream is Key and Value with a message on each row, a document store is a sample document.
- Change it with the code, and link the schema file from the store.
- `data` replaces the whole list: read the store with get_model first and send every entry to keep. `[]` removes it.

## Show a few lines of code

Writing code (put_object's snippets), so a panel shows the few lines that explain a shape:

- Only where a few lines say what a sentence can't: a formula, a query, the request or event a shape takes. The teaser still says what the shape does.
- Copy them from the repo as they are, never rewrite or invent them. Leave out secrets, real addresses, customer data and code that changes with every commit.
- At most 6 snippets of 40 lines. Anything longer is a file, listed in `code`.
- `title` says what the lines are ("Delivery fee"). Leave `language` out unless the code is too short to tell.
- `snippets` replaces the whole list: read the shape with get_model first and send every snippet to keep.

## Failure modes

Writing failure modes (put_failures, put_failure), when asked for a failure analysis:

- Name the analysis for what it covers, in plain words: "Plum fail scenario". One file per scope you would review in one meeting, such as Ordering or Delivery.
- One row per way a part fails, a line each. The mode is a condition stated as a fact ("Stripe doesn't answer within five seconds"), never a heading ("Payment problems").
- The effect is what a person or another part then sees, never a repeat of the mode.
- Rate honestly, and leave a rating out rather than guess it. Say in `about` who rated it and what the ratings rest on. Give severity 9 or 10 on purpose.
- `controls` is what exists today ("Three tries with backoff"), `action` what to do next. Mark a mode `done` once the action is in, with the ratings you now expect in `after`, and `accepted` when the team has decided to live with it.
- `flow` and `step` point at the flow that tells the failure, when one does.
- `affects` lists the shapes it hurts, which the lines can't tell you: a failing Stripe stops the kitchen tablet.
- `run` names a load-test run get_model lists. You cannot write runs, so leave it out if there are none.
- More is for the why. A long analysis of one part belongs in a linked document.
- put_failure replaces the whole mode: read it with get_model first, which holds every field of a mode (get_failures is only the table), and send every field you want kept.

## Write a comparison note

- Say what differs and why it matters: "Stripe returned the money and Orders DB didn't answer, so the order stays marked paid."
- Say which side is which.
- Use the numbers the pair holds.
- A few lines. Longer goes in the newer flow's More or a linked document.

## Draw a load test

A tool writes a run. These keys are choices about how it reads.

- Set a `source` when the ratio is the point. Without one the stripes follow a curve that makes a hundred times the calls look about twice as busy. A `dot` formula makes them a count: `rate / 50` is one stripe for every 50 calls a second. Keep the busiest line under 24 stripes: past that the ratio stops being true.
- Leave red to failing calls: a red source can't be told from its own failures.
- Test the sources together when you can: runs added from separate tests look calmer near the limit than the system is. Every combination of loads is a test, so two or three loads of each is usually right.
- Give each source its own colour, and `by` on every line two sources share that you can split.
- Give both `rate` and `bytes` on every line you measured.
- Measure over time when the story is a sequence (an outage, a restart, a deploy). An event's `text` is the fact ("Payments killed"), left out where "Stripe: Stopped" already says it. Put an event only where you saw the state change, and set the shape back to `running` with a later event.
- Set `failure` only where you know how the calls failed.

## What stays outside Flowy

Flowy is the map. Each fact lives in one place: the panel says what and why in a few lines and links the long version, and the long document names the shape.

- Decision record: one file per decision, in `links` on the shape it shaped, and a sentence in the panel
- Runbook: one file per app or store, in `links` on it
- API reference: generated from the spec, with the spec file in `links`
- Onboarding, quality goals and a glossary: one file each, in `links` on the top-level system

## Keep it true

- Change the model in the same pull request as the code, and review its diff.
- Delete rather than update: a gap beats a stale shape. Retire a flow nobody plays.
- Give the model one gardener: `CODEOWNERS` on `flowy/`.
- Export again after the model changes: the static site is a snapshot.
- Hand-written YAML: run `flowy check`, then `flowy mermaid --flow <id>` for each flow, and read every step text to its end. The check can't see a text cut short at `, retries: 3 times`, a valid extra key.

## More on shapes and text

- Too crowded: cut what a reader following a request never reaches, split a system by owning team, fold look-alike services behind one app, or tell the part as a flow. There is no in-between level.
- Microservices are apps in one system when one team owns them, separate systems when different teams do.
- A name repeated under different parents gets a teaser that says which.
- Planned or retiring things are marked in the name or teaser: there is no status field.
- `code` is where a shape lives, `links` what to read about it. Fix a broken path, or delete the shape if the code is gone. Removing `code` hides the problem.
- Raise opacity only for the one or two shapes a reader must not miss.
- An owner goes only on a top-level system, and is a team.
- Name the protocol only where it matters, in brackets at the end ("Sends requests (JSON/HTTPS)").
- Keep a small set of label verbs, one meaning each.
- A longer flow becomes phases, and the second names what it needs in step 1's More.
- For detail inside a shape, write a second flow on it.
