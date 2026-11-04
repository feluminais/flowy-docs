import { newSketch } from '../../src/core/sketches.ts'
import { serializeModelFile } from '../../src/core/modelfiles.ts'
import { emptyModel } from '../../src/core/model.ts'

// The model.yaml a new empty sketch starts as: what the browser's New sketch and the MCP new_sketch write. The desktop writes its own with Sketches.Create (no copying of shapes there),
// and a test holds the two files equal, so a sketch starts the same wherever it is made.
const NAMES = ['Group orders', 'Sketch']

export const dumpNewSketches = () => NAMES.map(name => ({ name, file: serializeModelFile(newSketch(emptyModel(), { name })) }))
