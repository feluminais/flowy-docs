# Code

A few lines of code on a shape. Part of the [Flowy Docs guide](../guide.md).

## Code

A shape can hold a few lines of code: the formula a component applies, the query a store answers, the request an app takes. Its panel has a
**Code** section that draws each snippet with its title, the language it is shown in and a Copy button, with the code in colour. The code
is only text, and nothing in it is run.

![Pricing's panel: a Delivery fee snippet in TypeScript with its keywords, strings and comment in colour, and an Accepting an order snippet in SQL](../images/desktop-code.png)

```yaml
objects:
  pricing:
    type: component
    in: order-api
    name: Pricing
    snippets:
      - title: Delivery fee
        text: |-
          // Mapbox answers in metres. Round up to the next 500 m.
          const km = Math.ceil(meters / 500) / 2
          const fee = Math.max(MIN_FEE, BASE_FEE + km * PER_KM)
```

`title` and `language` are optional. Without a `language`, Flowy works out the language from the code, and the panel names what it found.
A short snippet can be too little to tell. The form's Language choice (Auto, TypeScript, SQL and the rest) sets one when the guess is wrong.
A language is written as its id: `typescript`, `javascript`, `json`, `yaml`, `csharp`, `java`, `kotlin`, `python`, `go`, `rust`, `sql`,
`bash`, `powershell`, `html`, `xml`, `css`, `dockerfile`, `markdown`, `c`, `cpp`, `php`, `ruby`, `swift` or `text` (no colours). The short
names people write (`ts`, `py`, `sh`, `c#`) are read too, and saving writes the id.

A fenced block in a description is coloured the same way when it names one of those languages (`` ```ts ``) and stays plain when it names none.

The checks keep the section small. They refuse:

- A snippet with no text, and one with a language Flowy doesn't know.
- A snippet of more than 40 lines or 8000 characters, and more than six snippets on one shape. Long code belongs in a file, listed under Source.

Saving writes the code as a block of lines (`text: |-`), so a change to one line is one line in git. What to put in a snippet is in
[Writing good Flowy docs](../writing.md#show-a-few-lines-of-code).
