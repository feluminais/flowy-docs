# Failure modes

## Ratings

On screen `occurrence` is Likelihood and `detection` is Hard to spot.

## Risk

The three ratings multiplied, 1 to 1000. With one missing there is no risk, never zero. A `done` mode counts by `after`, each rating falling back to the current one. The first band that fits wins:

| Band | Rule |
| --- | --- |
| High | Severity 9 or 10, even with ratings missing |
| Not rated | A rating missing |
| High | Risk 150+ |
| Medium | Risk 60 to 149 |
| Low | Risk under 60 |

The list runs High, Medium, Low, Not rated. Inside a band: by risk, then severity for a mode with no risk, then file order.

- Row: its risk, plus "Severity 10" when severity alone made it High.
- Card: "Risk 96 (8 × 4 × 3)", and "Risk after next action: 96 to 32" with `after`.

## Coverage

"Analysed 15 of 26 shapes" counts shapes that hold nothing, inside `scope`, with a mode on them or on a line they end. Actors are left out, outside services count, and lines don't count. Not analysed lists the rest.

## Reading it

| Mark | Means |
| --- | --- |
| Badge | Worst band and how many. A shape holding others adds up what's inside |
| Fails: red, orange or grey outline | The picked mode's part: High, Medium, or Low and Not rated |
| Affects: lighter outline | What it affects. The rest fades |

- This view holds modes with the part, or a line end, inside the level on screen. Picking from Other views moves the canvas.
- A line with both ends inside one drawn shape counts on that shape.
- A picked shape or line narrows the list. A click on a band's row filters it.
- Show it plays `flow` at `step`.
- Seen in a run opens Performance at the first load where the part has errors. It needs such a load in `run`, and a run with several sources has none.
- Failures and Performance are never open together.
- In edit mode the tab stays open and writes analyses and modes.
- CSV and Table copy the ranked list in the screen's words. A CSV cell starting with `=`, `+`, `-`, `@`, a tab or a return gets a leading quote mark.

## Checks

- An unreadable file is a problem, skipped and left as it is. The model still loads.
- A shape renamed by hand in `model.yaml` leaves its modes pointing at nothing, and the check says so.
