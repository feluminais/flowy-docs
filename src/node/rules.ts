import { SNIPPET_MAX } from '../core/snippets.ts'
import { STATE_NAMES } from '../core/states.ts'

/**
 * What the AI reads as resources, flowy://rules/<topic>. `writing` is how the default is written (shapes, names, text, plain flows), read before the first
 * write; the server's instructions stay short because Claude Code cuts them off past about 4,000 characters. The other topics are the parts of a model
 * that most requests leave out, each read only when the user asked for that part.
 */
export const RULES = {
  writing: {
    title: 'What gets a shape, and how to word it',
    description: 'Read once before the first write: what gets a shape, names, looks, how to word descriptions and labels, payloads, and how a flow reads.',
    text: `What gets a shape:
- An app runs on its own; a component is a part inside one running program. A folder, package, library, class or file is not a shape. Leave out what no flow touches (logging, config, deploy plumbing). Keep a view to a handful of shapes, a dozen at most.
- Mark services you don't own external: true. A database or bucket the system owns is a store inside it, and so is a named queue or topic.
- Name a shape for what it holds or does ("Orders DB"), never for its type ("Database"), in words a new teammate knows, and use one name for one thing everywhere. Name an outside service for the vendor (Stripe) and say its role in the teaser. Fill tech on every app, store and component with the real stack, short ("Node, Fastify"). Give every app, store and component a code path: two or three, folders before files.
Looks (shape, color, opacity, icon) are optional; the type already picks a good default:
- Leave them out unless they say something the type doesn't. A decision is a diamond, a message queue a queue, a file or report a document, a group of shapes a folder, a remark a note. A colour means something only if it means the same everywhere in the model: say what it means in the descriptions that use it, and don't colour for decoration.
- Leave opacity alone unless you set a colour: it defaults to a light tint. Pick an icon from the built-in list only when it names the thing better than its type's icon does; put_icon adds one of your own.
Writing text:
- A description's first paragraph is the hover teaser: a sentence on what the object does for others, in words its name doesn't hold. Start apps and components with a verb. No "responsible for", no praise. Later paragraphs: why, limits, risks. No versions, counts or endpoint lists.
- A connection label is a few words, a verb and what moves, said from the side that starts it ("publishes order events", "reads menus"). The arrow already shows which way it goes, so never end a label on "to", "from", "with" or another preposition. Never "uses". A reply is not a connection.
- Put warnings first in the teaser ("Deprecated: ...", "(planned)"), since a reader may stop there. Write for any day: no "currently" or "soon". Behaviour, not implementation: leave out versions, counts and file lists that go stale. Where something is a guess, end its description with "Open question: ..." and never a plausible sentence.
- Put long documents (runbooks, decision records, specs, wiki pages) in links, not in a description. code: is the files and folders an object lives in.
- A payload says what data moves where: write one with put_payload only when the user asks what lines or steps carry, or names a request or message a reader would ask about. Write it once and name it by id from every line and step that carries it; stay high level (name the types inside, don't spell every field out), and copy a schema or type from the repo rather than invent one.
Writing a flow, so it reads the way the code works:
- One trigger, one story, usually 3-9 steps, named for the goal. A failure gets its own flow.
- A step's text says what passes between "from" and "to", from the side of "from": "Hands over the order", "Asks for the total". The step already shows both ends, so leave the receiver's name out unless the text needs it, and never end a text on "to", "from" or another preposition. When "from" asks and gets its answer in the same step, say so, and don't add a step going back unless something new is sent.
- Say when the sender doesn't wait for the other side (it queues the work, fires and forgets, or runs on a timer).
- Keep to what the flow's trigger causes. Something that happens on its own gets a step that says so, or a flow of its own.
- Play the flow on the view where its ends are separate shapes. put_flow answers with how each step reads there: an end written "X in Y" is drawn as Y.
- A step's More (its description) holds why, timing, failure behaviour or limits, not a repeat of the step.
- Write plain steps. Motion (animation), repeats, branches, parallel lanes and shape states are for a user who asked for them: read flowy://rules/flows first.`,
  },
  code: {
    title: 'Writing code on a shape',
    description: 'Read before adding snippets to a shape: what to copy, how much, and what to leave out.',
    text: `Writing code (put_object's snippets), so a panel shows the few lines that explain an object:
- Only where a few lines say what a sentence can't: a formula, a query, the request or event an object takes. Copy them from the repo as they are, never rewrite or invent them, and leave out secrets, tokens and real data. At most ${SNIPPET_MAX.snippets} snippets of ${SNIPPET_MAX.lines} lines; anything longer is a file, listed in code.
- title says what the lines are ("Delivery fee"). Leave language out unless the code is too short to tell: Flowy works it out, and the reader can pick another. snippets replaces the whole list: read the object with get_model first and send every snippet you want kept.`,
  },
  data: {
    title: 'Writing what a store holds',
    description: 'Read before adding tables, key sets, topics or collections to a store.',
    text: `Writing data (put_object's data), so a store shows what it holds:
- Only for a store the code shows, and only the few tables, key sets, topics or collections a reader needs to follow the flows, never the whole schema. Take names, columns and keys from a migration, a schema file or the code that builds the keys, and add nothing you can't point to.
- Sample rows are invented. They are never copied from a real database, a dump or a log, and carry no real names, emails, phone numbers or ids: use made-up ones like o_1042 and Noodle Bar. Two or three rows, at most 8.
- A note is one line that says why, not what: "Stored in cents because rounding broke the first tax run." Leave it out when the name says it all. limits is one line on how long data is kept or how much fits ("Kept 7 years, then archived", "Oldest unused go first at 256 MB").
- A table is columns and rows. A key-value store is columns Key, Value and Expires, a stream is columns Key and Value with a message on each row, a document store is a sample document. data replaces the whole list: read the store with get_model first and send every entry you want kept. [] removes it.`,
  },
  flows: {
    title: 'Animation, repeats, branches and shape states in a flow',
    description: 'Read before a flow goes beyond plain steps: motion, outcomes, groups, lanes and states.',
    text: `- A step may carry animation (send, call, callback or event) so it plays as something travelling between the two shapes. Animate only when the user asked for motion. Then ask how much, unless they have said: Key steps (only a step whose way of travelling adds to its text) or Every step that hands something from one shape to another. If they asked for motion and gave no more, animate every such step. Pick the kind by who waits: call when the sender waits for the answer, send or event when it doesn't, callback when something sets off a reply to a subscriber (trigger: "outside" when that came in at the step before). A step with no "to" can't travel, with one exception: a shape that calls itself to handle a smaller piece of the same job (a tree walk, a CNAME chase) is one step with no "to", tagged recurse, with depth (2 to 5, how deep the picture goes) and optional carries and returns words; say in the text what gets smaller and what stops it. Repeating the same work without nesting is not recursion. Make the text read the same with the motion off. Where a step really ends another way (a declined card, a call that times out, a request lost on the way), give its animation an outcome, and only then: fail on a send or call, timeout on a call, and on a send, call or event lost, rejected (turned away at the door), intercepted (taken by a third party: give by, a shape id or { name }), duplicated (handled twice) or delayed. Add a reason in a few words ("Rate limit") when it helps, and share (a whole percent, 1 to 100) when only some of the requests meet it.
- Neighbouring steps may be a group, declared once under groups and joined with group on each step. A repeat is the same steps run again: times is the limit the code really has (never a number for the picture), and until says what stops it; the backoff goes in the group's text. A branch is alternatives: each lane starts at the step that says lane, named by its condition in plain words, and every lane is told in turn. A failure that is a single step can be a lane; one that is a story stays its own flow. Parallel lanes all start together: a fan-out to several receivers is one-step lanes, so every step still has one "to". Keep a group's steps next to each other, and don't put one group inside another. A step may say flow: the id of another flow that tells what happens next. Say in the step text what the group says, so the text reads the same without it.
- A shape is Running unless a flow says otherwise. A step may carry states (shape id to ${STATE_NAMES.join(', ')}) where the story really takes a shape down, brings it up or hurts it: Stripe stops answering, the team restarts it, checkout runs degraded. The change holds until another step changes it, so set the shape back to running when it recovers; a flow's own states say where shapes stand before step 1. Never for decoration, and the text must read the same without it.
- A step's animation may leave something open that later steps still show: opens: stream (data keeps flowing along the line, as server-sent events or a websocket do), listener (a shape keeps listening for callbacks after a subscribe or a webhook registration) or job (work keeps running on a shape). Name it (name, at most 24 characters) so a later step can close it with closes: that name; unnamed ones stay open to the end of the flow. A stream flows to the step's to shape and a job runs on it; a listener sits at the from shape. Say towards: from or to only when the story is the other way round. Use it only where the story really keeps it open, and only on a step that arrives (no outcome).
- Folders and tags are the reader's own way of sorting flows. Leave them out unless the user asks, then give put_flow a folder (names joined by "/", such as "payments/refunds") and tags (happy path, error path, edge case, recovery or background, or their own words), or change a flow you have with move_flow and tag_flow. Moving a flow changes nothing that names it, since its id stays.`,
  },
  failures: {
    title: 'Writing a failure analysis',
    description: 'Read before writing failure modes: what a row holds, how to rate, and what not to invent.',
    text: `Writing failure modes (put_failures, put_failure), when asked for a failure analysis:
- One row per way a part fails. The mode is a condition stated as a fact ("Stripe doesn't answer within five seconds"). The effect is what a person or another part then sees. Name the part with on (a shape) or with from and to (a line that exists, in that direction).
- Rate honestly, and leave a rating out rather than guess it: a mode without all three ratings is shown as Not rated. Severity, occurrence and detection are whole numbers from 1 to 10; for detection, 10 means nobody would notice. Severity 9 or 10 is always High.
- Put what exists today in controls and what to do next in action. Name the flow that tells the failure in flow, and the shapes it hurts in affects. Never work out affects from the direction of the lines. run is the id of a load-test run: get_model lists them under runs, and a run that is not there is refused. You cannot write runs (they are files in perf/, made by a load-testing tool), so leave run out if there are none.
- put_failure replaces the whole mode: read it with get_model first, which holds every field of a mode (get_failures is only the table), and send every field you want kept.`,
  },
} as const

export type RuleTopic = keyof typeof RULES
