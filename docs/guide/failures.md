# Failure modes

Rating how each part fails, and reading the ranked list. Part of the [Flowy Docs guide](../guide.md).

## Failure modes

A failure analysis holds how a system breaks as data: for a part, how it fails, what that causes, how bad, how likely and how hard to
spot it is, what exists to deal with it and what to do next. It lives in `flowy/failures/<name>.yaml` (the name follows the same rule
as a flow's file name), one file for each scope you would review in one meeting, such as Ordering or Delivery, and a folder can hold
several.

```yaml
name: Plum fail scenario
about: Rated by the ordering team from a year of incidents and support tickets.
scale:
  severity: { low: Nobody notices, high: A customer loses money or the kitchen stops }
  occurrence: { low: Never seen, high: Most days }
  detection: { low: An alert fires within a minute, high: We hear from a customer }
modes:
  stripe-timeout:
    from: checkout
    to: stripe
    mode: Stripe doesn't answer within 5 s
    effect: The order waits on a hold that may or may not exist.
    cause: Stripe is slow, or the network between Plum and Stripe drops.
    severity: 8
    occurrence: 4
    detection: 3
    controls: Three tries with backoff. The idempotency key stops a double hold.
    action: Page when over 1% of holds time out for 5 min.
    owner: Payments
    status: planned
    after: { severity: 8, occurrence: 4, detection: 1 }
    affects: [customer-app, kitchen-tablet]
    flow: capture-payment
    step: 1
```

- A mode is keyed by its id: lowercase letters, digits and dashes, unique in the file. The key is what an address and an MCP write use.
- A mode names its part with `on: <shape id>` for a shape, or with `from` and `to` for a line. Exactly one of the two. A line must be a
  connection in the model, in that direction, so the badge has a line to sit on.
- Everything but `mode` and the part is optional. `about`, `scope` (`root`, the default, or the id of a shape that holds others: the
  parts that count towards coverage) and `scale` (what the ends of each rating mean, shown under it) belong to the analysis.
- A rating is a whole number from 1 to 10. A rating that is missing is **Not rated** on screen, never a zero. The file keeps the usual
  FMEA names so a row copied from a spreadsheet keeps its meaning, and the tab says it in plain words:

  | In the file | On screen | 10 means |
  | --- | --- | --- |
  | `severity` | Severity | The worst result |
  | `occurrence` | Likelihood | It keeps happening |
  | `detection` | Hard to spot | Nobody would notice |

- `controls` is what exists today, `action` what to do next, and `owner` who does it. `status` is `open` (the default), `planned`, `done`
  or `accepted` (known, and left alone). `after` holds the ratings once the action is done.
- `affects` lists the shapes the failure hurts. You write it: Flowy doesn't work it out from the lines, because a line's direction
  means different things (the order API calls Stripe, but the tracking service pushes to the customer app).
- `flow` names the flow that tells the failure, and `step` the step in it, numbered as the player numbers them. `run` names a run that
  shows it. `description` is More, in Markdown.
- Unknown keys are kept when Flowy writes the file back.

**How it ranks.** Risk is Severity times Likelihood times Hard to spot, from 1 to 1000, and there is none when a rating is missing.
The band follows: High when Severity is 9 or 10, even with the other ratings missing, since a severe failure never belongs in the quiet
group. Otherwise Not rated when a rating is missing, then High from a risk of 150, Medium from 60 and Low below that. The list runs
High, Medium, Low, then Not rated, and inside a band by risk, highest first, with ties in the order of the file. A mode that is `done`
counts by its `after` ratings, and the panel shows both ("Risk after next action: 96 to 32"). The rule sits beside each band's
count in the panel: "Risk 150+ or severity 9+", "Risk 60 to 149", "Risk under 60" and "A rating missing". The number at the right of each
row is the risk, under a **Risk** heading, so a High 20 can sit above a Medium 144: its severity is 10.

**Coverage.** "Analysed 15 of 26 shapes" counts the shapes that hold nothing, inside the analysis's scope, that have at least one mode, as the
part or as an end of a line. Actors are left out, because nothing of ours fails there. Outside services count, since a failing Stripe is
a failure you design for. Lines don't count. **Not analysed** lists the shapes left.

**Reading it.** Open the Failures tab on the left edge, or press **M**. Details stays free on the right: a shape or a line picked on the canvas reads out there and narrows the list. Performance and Failures are never open at once, because the load and the risk would draw over each other. Pick an analysis if there are several. A shape or a line that
has modes carries a badge: the colour of its worst band and how many. A shape that holds others adds up what is inside it, so at the
overview you see which system holds the risk and zoom in to find where, as in Performance. Four rows count the modes by band, each with its rule, and a
click on one filters the list. The list has two groups: **This view**, the modes whose part is inside the level on screen, and **Other
views**, and picking one of those moves the canvas to the level that draws its part. Pick a mode to see all of it, in a card above the list: Effect, Cause, the
three ratings drawn as ten small cells, Controls, Next action with the owner and status, and what it affects. On the canvas its part is
outlined in the colour of its band (red for High, orange for Medium, grey for Low and Not rated), what it affects in a lighter outline of
the same colour, and the rest fades. The card's **Fails** and **Affects** marks show both outlines. ← and → move down the list, and Esc closes the tab while your last click was in it, as it does Explorer and Flows. A click on
a shape or a line shows the modes on it. **Show it** plays the flow that tells the failure. **Seen in a run** appears when `run` is set
and the part has errors in it, and opens Performance at the first load where it does. The address is
`#<view>/failures/<analysis>/<mode>`.

**Writing it.** In the browser and in the desktop app, in edit mode the tab stays open and gains **New analysis** (a name and a scope), **Add failure mode** and a form for
each mode: the part, the text, the three ratings, the status, what it affects, the flow and the run. Every save goes through the same
checks as the rest of the model. An AI does the same through the MCP server: `get_failures` answers with the ranked table, the
coverage and the problems, `put_failure` writes one mode, `delete_failure` removes one, and `put_failures` and `delete_failures`
write and remove a whole analysis. Every write is checked. How to word a mode is in [Writing good Flowy docs](../writing.md#failure-modes).

**Getting it out.** **CSV** and **Table** at the top of the tab copy the ranked list with the words the screen uses. So does the
command line, which prints one table for each analysis:

```bash
node /path/to/flowy-docs/dist/cli.js failures --analysis ordering --format csv
```

`--format` is `markdown` (the default) or `csv`, and `--analysis` picks one. A problem in a file goes to stderr and the command exits
with 1, so a CI job can run it. A cell in the CSV that starts with `=`, `+`, `-` or `@` gets a leading quote mark, so a spreadsheet doesn't
run it.

**Checks.** Flowy checks an analysis the way it checks `code:` paths, so it can't quietly point at parts that are gone: a part that
isn't in the model, both forms of part or neither, an `affects` entry that isn't a shape, a missing `mode`, a rating outside 1 to 10, an
unknown `status`, a `flow`, `step` or `run` that doesn't exist, an id that breaks the rule or appears twice, and a `scope` that isn't
`root` or a shape that holds others. A change that would add a problem is refused. So is deleting a shape or a connection that a mode
names. A file that can't be read at all is a problem too, and it never stops the model from loading: the file is skipped and left as it
is. Renaming a shape by hand in `model.yaml` leaves its modes pointing at nothing, and the checks say so.

**Where it works.** The browser version, the desktop app and an exported page show failure modes, with the same badges, list and words.
The browser version and the desktop app also write them (see Writing it); an exported page only reads. Plum has an
analysis, [Order to door](../demo/flowy/failures/ordering.yaml), and `node dist/cli.js --dir docs/demo/flowy` from a clone opens it.
