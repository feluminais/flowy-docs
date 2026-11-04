import { newDraft } from '../../src/core/drafts.ts'
import { serializeModelFile } from '../../src/core/modelfiles.ts'
import { emptyModel } from '../../src/core/model.ts'

// The model.yaml a new empty draft starts as: what the browser's New draft and the MCP new_draft write. The desktop writes its own with Drafts.Create (no copying of shapes there),
// and a test holds the two files equal, so a draft starts the same wherever it is made.
const NAMES = ['Group orders', 'Sketch']

export const dumpNewDrafts = () => NAMES.map(name => ({ name, file: serializeModelFile(newDraft(emptyModel(), { name })) }))
