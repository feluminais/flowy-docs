# Connection kinds

How a line says what its connection is. Part of the [Flowy Docs guide](../guide.md).

## Kinds

A kind says how two shapes talk, and the line is drawn to match. Add `kind:` to a connection and the canvas gives the line a pattern and a mark at each end. A connection with no kind is a plain line with a filled arrowhead, as it always was.

![The six kinds: Request and reply, Request then stream, Publish and subscribe, Cached publish, Object updates and Extension point, then the plain line, each drawn with its name and the word that picks it](../images/connection-kinds.svg)

```yaml
- { from: ui, to: management, label: Start scan, kind: stream }
```

A kind changes the pattern and the marks, never the colour or the width. Colour says the state of a line (picked, lit, a problem, a failure) and width says traffic in a Performance run, so a kind reads in greyscale and next to either. The six are fixed, and a word that is none of them draws plain and is a problem `flowy check` lists.

The canvas keeps a key at its foot with one item for each kind it draws now, and Plain line when one is drawn beside them. The edit form's **Kind** field is a row of drawn tiles, one for each kind and one for Plain line.

## Pick one with four questions

| Ask | Answer | Kind |
| --- | --- | --- |
| Does the caller wait? | One answer comes back | Request and reply (`request`) |
| | Answers keep coming after the first | Request then stream (`stream`) |
| Does the sender announce and carry on? | Anyone may listen | Publish and subscribe (`publish`) |
| Does a new listener need the current value first? | It gets the last value, then the changes | Cached publish (`cached`) |
| | The value is one object whose fields change | Object updates (`object`) |
| Does the host call what plugs into it? | Yes | Extension point (`extension`) |

When none fits, leave `kind:` out. A plain line is right for a connection you can't classify from the code, and a wrong kind misleads more than none does.

## Each kind

`from` starts a connection and `to` receives it. For the three publish kinds `from` is the publisher. For an extension point `from` is the host and `to` is what plugs into it, so the line points the way the host calls.

### Request and reply

```yaml
- { from: ui, to: management, label: Read radio settings, kind: request }
```

One side asks and waits. The filled arrowhead sits where the request lands, and an open chevron at the caller shows the answer coming back. Use it for a call with one result, such as reading a setting or applying a config. Model the call as one connection. In a sketch, where each connection is a line of its own, a flow shows the answer as a step on the same line when its `via` names it or no other line of the pair runs that way ([Flows](flows.md#which-line-a-step-rides)). In the main model, where a pair is one line, a step against a one-way line plays on a dashed line of its own.

### Request then stream

```yaml
- { from: ui, to: management, label: Start scan, kind: stream }
```

The same call, with two open chevrons at the caller. Answers keep arriving after the first. Use it when one request opens a feed, such as scan results that grow until the caller stops. It describes the connection. A flow step that opens a stream says so in its own `animation` ([Flows](flows.md#streams-listeners-and-jobs)), and the two keys are separate.

### Publish and subscribe

```yaml
- { from: management, to: ui, label: Events, kind: publish }
```

The sender announces and carries on. The arrowhead is open because nobody waits, and any number of shapes may listen. Use it for events nobody answers.

### Cached publish

```yaml
- { from: management, to: ui, label: Radio state, kind: cached }
```

A publish where the sender keeps the last value, shown by a ring at the sender. A shape that starts listening later gets that value first, then the changes. Use it for state, such as whether the radio is on.

### Object updates

```yaml
- { from: management, to: ui, label: Client list, kind: object }
```

A publish that carries one object and its changes, field by field. A diamond at the sender stands for the object. Use it when a listener follows a whole object, such as a client entry. A listener that starts later does not get the current object first. For that, use Cached publish.

### Extension point

```yaml
- { from: management, to: linux, label: Vendor hooks, kind: extension }
```

A dash-dot line from the host to the shape that plugs in. The arrowhead is filled because the host waits for the result. Use it for hooks, plugins and vendor code.

## When one line stands for several connections

The model draws one line between two shapes, however many connections run between them. A line that stands for connections of one kind shows that kind. When they run both ways it has an arrowhead at each end and no tail marks, since a tail would sit where the other end's head is. When the pattern is shared and the marks differ, the line keeps the pattern and has a plain head. In any other mix the line is plain.

A mixed line loses nothing on selection: its panel lists each connection with its own drawn mark and the name of its kind.

A sketch can draw one line for each connection with `pairs: separate`, and then each connection with a label of its own keeps its own kind ([Sketches](sketches.md#several-lines-between-two-shapes)).

## Reading the marks

![The marks: a filled arrowhead (Sender waits), an open one (Just arrives), an open chevron at the sender (Answer returns), two chevrons (Answers keep coming), a ring (Keeps last value), a diamond (Holds an object) and the dash-dot pattern (Plugs in)](../images/connection-marks.svg)

The arrowhead sits at the receiving end. The tail, at the sending end, says what the sender keeps or expects back. Request and reply and Request then stream differ by one chevron, so at a low zoom check the key at the foot of the canvas.

## The usual terms

| If you call it | Use |
| --- | --- |
| RPC, request and response | Request and reply |
| Server streaming, a subscription that starts with a request | Request then stream |
| Pub/sub, events, a topic | Publish and subscribe |
| Cached pub/sub, retained message, latest value | Cached publish |
| Object pub/sub, a watched record | Object updates |
| Plugin, hook, callback registered with a host | Extension point |

gRPC's client streaming and bidirectional calls have no marks of their own. Use `request` or `stream` and say the rest in the label.

## What else knows about kinds

- **The AI tools.** `connect` takes a `kind`, and `set_kind` sets or clears one on a connection that exists ([AI and MCP](ai.md)). The writing rules tell an AI to set a kind only where the code shows it.
- **The file.** `kind` is a key of a connection ([the file format](../format.md#a-connection)). The history names a change of kind, such as "Set Management to UI as Cached publish".
- **Mermaid.** The export keeps only what Mermaid can say: an extension point is a dotted line, and a line with a tail has an arrowhead at both ends. The kind's name is not added to the label ([Check it and share it](share.md)).
