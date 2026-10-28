import { SNIPPET_MAX } from '../core/snippets.ts'
import { STATE_NAMES } from '../core/states.ts'

/**
 * What the AI is told about the parts of a model that most requests leave out. The server's instructions hold the default (shapes, connections, plain flows);
 * each of these is read as a resource, flowy://rules/<topic>, only when the user asked for that part.
 */
export const RULES = {
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
