# AI and MCP

[Install](../install.md#let-an-ai-write-the-model) connects the server.

## Let an AI build it

"Map this repo into Flowy" gets the default: a name and short about, the people, apps, stores, components and outside services in the repo, how they connect, and three to five plain flows.

Anything else is written only when you name it: flows with motion, repeats, branches or failed requests, what the stores hold, code on shapes, a failure analysis, a look. Ask for "everything" and it asks which. It ends by naming what Flowy could add, from what it saw in the repo.

## Review the first pass

The server refuses what is broken. It can't judge wording or tell that a shape is invented.

- Name outside services, schedulers and inbound callers yourself
- Commit between passes
- Review the diff for shapes with no code, duplicate names and deletions. A fresh session is a good second reader
- After two failed corrections, start over
- Keep CLAUDE.md and AGENTS.md to where the model lives and how to check it, with no generated overview

## What the server offers

**Tools.** The server has thirty-two. It also has five prompts for the usual jobs, and the rules and guides as resources. A client lists them all, and [What writes what over MCP](../format.md#what-writes-what-over-mcp) maps files to the tools that change them.
