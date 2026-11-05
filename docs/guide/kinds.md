# Connection kinds

A kind sets the pattern of a line and the mark at each end. Colour stays the line's state, and width stays traffic in a Performance run. A word that is no kind draws plain.

```yaml
- { from: ui, to: management, label: reads radio settings, kind: request }
- { from: ui, to: management, label: Start scan, kind: stream }
- { from: management, to: ui, label: publishes scan events, kind: publish }
- { from: management, to: ui, label: publishes radio state, kind: cached }
- { from: management, to: ui, label: updates the client list, kind: object }
- { from: management, to: linux, label: runs vendor hooks, kind: extension }
```

![The six kinds](../images/connection-kinds.svg)

### Request and reply

The caller waits for one answer (`request`). Also RPC.

### Request then stream

The caller waits, and answers keep coming (`stream`). Also server streaming. A step's `opens: stream` is a separate key.

### Publish and subscribe

The sender carries on, and anyone may listen (`publish`). Also pub/sub, events, a topic.

### Cached publish

The sender keeps the last value, and a late listener gets it first (`cached`). Also a retained message.

### Object updates

One object and its changes, field by field (`object`). A late listener gets no current object. Also a watched record.

### Extension point

The host calls what plugs into it and waits for the result (`extension`). Also a plugin, a hook.

gRPC client streaming and bidirectional calls: use `request` or `stream`.

## Marks

![The marks](../images/connection-marks.svg)

The head sits at the receiving end, the tail at the sending end. Filled head: sender waits. Open head: just arrives. Open chevron: answer returns. Two chevrons: answers keep coming. Ring: keeps last value. Diamond: holds an object. Dash-dot line: plugs in. Plain line: filled head, no tail, says nothing about waiting.

## One line for several connections

The line shows their kind when all share it, and is a Plain line when they differ. A shared kind running both ways has a head at each end and no tail. The line's panel lists each connection with its own mark.
