# perf-lab

A made-up shop that really runs, so Flowy's Performance tab has something real to measure. It is a test bed for Flowy, not
a benchmark.

```bash
npm run lab:run                                              # the ramp: about 2.5 minutes, writes flowy/perf/ramp.yaml
npm run lab:run -- --name slow-gateway --gateway-delay 360   # the same, with a gateway four times slower
npm run lab:smoke                                            # two short levels, to check the harness still works
node src/cli.ts --dir perf-lab/flowy                         # open the lab and its runs in Flowy
```

`lab:run` takes `--levels 10,25,50,100,200,400` (requests a second), `--duration 20` and `--warmup 3` (seconds), `--name`,
`--gateway-delay` (ms), `--about` (the text shown with the run), `--seed` and `--out`.

## What is in it

| Part | What it is | Its limit |
| --- | --- | --- |
| Web API (`src/lab.ts`) | `GET /catalog`, `POST /orders`, `GET /reports` | one Node process, one event loop |
| File API | `POST /uploads` (200 KB, flushed to disk), `GET /files/seed` | 8 uploads written at once |
| SQLite (`src/db.ts`) | orders and products, through `node:sqlite` | one synchronous connection, `synchronous=FULL`: a commit waits for the disk |
| Cache (`src/cache.ts`) | the 20 most recently used catalog pages of 60 | its size |
| Queue and worker (`src/queue.ts`) | an authorized order is queued and its payment captured | 4 jobs at once, each waiting on the gateway |
| Payment gateway (`src/gateway.ts`) | its own process, about 90 ms a call | answers 429 past 100 calls in a second |
| Report export | reads the latest orders and hashes them 40 000 times | CPU on the web API's own loop |

Every part is real code, and everything it does is measured by the lab itself (`src/stats.ts`): how long each call between
two parts took and whether it failed, how busy each limited resource was, how many jobs wait. `GET /__stats` hands those out
and starts a new interval.

## What the harness does

`load/run.ts` starts a gateway and a fresh lab for every level (so no level inherits the last one's backlog, cache or rows),
holds the level with an **open-loop** generator, reads `/__stats`, and writes the run. Open-loop means each request is sent at
its scheduled time whether or not earlier ones have come back, and its time is counted from when it was scheduled. A closed
loop (send the next when the last returns) slows down with the server and hides exactly what a load test is for. The mix is
60% catalog, 20% orders, 10% uploads, 5% downloads and 5% reports, with arrivals drawn from a seeded Poisson process, so the
same seed sends the same load.

Each level runs in a process of its own (`load/level.ts`), which starts the gateway and the lab. Every process tells its children
to finish by closing their stdin, and a child finishes the same way if its parent dies, so a run that is killed leaves no
gateway or lab running.

## Read the numbers with these in mind

- The load generator and the lab share one machine. They compete for it a little, and more on a small one.
- The limits above are deliberate. They are why the parts give way in a predictable order, and the order is the point: the
  fulfilment worker fills first, then the gateway starts refusing calls, then the web API's own loop gets busy. Where each
  one gives way depends on the machine.
- The committed runs were measured on one machine, once. Run `npm run lab:run` to get your own.
- The gateway is a stub. Its delay and its rate limit are settings, not measurements.
- Under heavy load on Windows (seen with Node 24) one of the processes has occasionally stopped with exit code 3221226505 and
  nothing said, for a reason that was not found: it happened at the start of a heavy level, in the gateway, the lab or the
  generator, and a direct flood of the lab could not repeat it. The harness prints `starting that level again` (with the exit
  code of the level's own process, and what stopped it printed above), runs the level once more, up to three times, and says in
  the run's `about` which levels needed a later try, so a run does not have to be started over and is not made to look cleaner than it was.
