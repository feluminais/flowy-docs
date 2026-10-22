# Data

What a store holds: tables, key sets, topics and collections. Part of the [Flowy Docs guide](../guide.md).

## Data

A store can say what it holds. Click it and its panel has a **Data** section that draws the data the way a developer pictures it: a
table is column headings over a few sample rows, and a document is its fields, indented. The first entry is open. The others are one
line each, with how many columns (or, for a document, fields) they have and how long they are kept, and a click opens or closes one.
The browser and the desktop app draw it the same way.

![Orders DB's panel: the orders table with a key mark on id and customer_id, a dot on total and its note under the table, and three more tables closed to a line each](../images/desktop-data.png)

Flowy never connects to a database. You write the entries, or an AI writes them from the code, and the sample rows are made up. A
store's `data:` is a list, and each entry is one table, one set of keys, one topic or one collection:

```yaml
objects:
  orders-db:
    type: store
    in: ordering
    name: Orders DB
    tech: Postgres
    data:
      - name: orders
        kind: table
        limits: Kept 7 years, then archived
        note: One row per order. A refund adds a row to refunds; the order stays.
        columns:
          - {name: id, key: primary}
          - {name: customer_id, to: customers}
          - status
          - {name: total, note: "Stored in cents because rounding broke the first tax run."}
        rows:
          - [o_1042, c_77, placed, 2490]
          - [o_1043, c_12, accepted, 1380]
```

| Key | Takes | Shown as |
| --- | --- | --- |
| `name` | The table, key set, topic or collection, as a developer names it | The heading of the entry |
| `kind` | A word for what it is: `table`, `collection`, `topic` | Small, beside the name |
| `limits` | One line on how long it is kept or how much fits | A clock and the line, on the right |
| `note` | One line on why it is this way | Under the heading |
| `columns` | The column headings. A bare name, or a mapping with `name` and any of `key: primary`, `to` and `note` | The headings of the grid |
| `rows` | Sample rows, with one cell for each column | The rows of the grid |
| `sample` | One sample document, in place of `columns` | Its fields, one to a line, nesting shown by indent |
| `notes` | With a `sample`: a field to its note. A nested field is its keys joined with dots (`hours.mon`) | Under the data |

In a grid, a column with `key: primary` shows a small **PK**, a column with `to: customers` shows **FK customers**, and a column with a
`note` shows a dot. The note is under the data, headed by the column's name. Notes are always shown. Point at a mark for its full name.

A key set is a grid with `Key`, `Value` and `Expires` columns, and a topic is a grid with `Key` and `Value` whose rows are messages. A
document store has a `sample` in place of `columns`, and its notes name fields:

```yaml
objects:
  menu-cache:
    type: store
    in: ordering
    name: Menu cache
    tech: Redis
    data:
      - name: Keys
        limits: Oldest unused go first at 256 MB
        columns: [Key, Value, Expires]
        rows:
          - ["menu:{restaurantId}", "{ items, prices, hours }", 5 min]
  profiles:
    type: store
    in: ordering
    name: Restaurant profiles
    tech: MongoDB
    data:
      - name: restaurants
        kind: collection
        sample:
          _id: r_42
          name: Noodle Bar
          tags: [ramen, vegan]
          hours:
            mon: 11-22
        notes:
          hours: Hours live inside the profile. They are only ever read with it.
```

Every value is text, like the rest of the files. In a row a comma ends a cell, so a cell with a comma in it is quoted
(`["Noodle Bar, Inc.", c_77, 2490]`), and so is text that starts with a bracket, a brace, a quote or one of `- # & * ! | > % @`, or that
holds a colon followed by a space. Saving writes the quotes where they are needed. A field under a list item and a key that itself holds
a dot cannot carry a note. What to put in it, and how to word a note, is in [Writing good Flowy docs](../writing.md#data).

The checks keep the section small. They refuse:

- `data` on anything but a store, an entry with no name or the name of another, and an entry with both `columns` and `sample` or with neither.
- `rows` with no `columns`, `notes` with no `sample`, and a column with no name or the name of another column.
- A row with a different number of cells than there are columns, more than 12 columns or 8 rows, and a `key` other than `primary`.
- A sample nested more than 3 levels deep or showing more than 20 fields, a list directly inside a list, and a note on a field that is not there.
- Text with a line break, anywhere in `data` (the separator characters U+0085, U+2028 and U+2029 count), so that a row stays on one line.

In edit mode, in the browser and in the desktop app, a store's form has a **Data** box that holds the same lines as the file. Leave the box and the change is checked like any
other: a refusal says why and keeps what you typed, and clearing the box removes the data. Saving writes each row on one line, so a table of
eight rows stays eight lines in git, and an empty cell is written `""`.
