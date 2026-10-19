import { ICON_GROUPS, ICONS } from '../../src/core/icons.ts'
import { colorPair, COLORS, customIcons, fillOpacity, iconData, onFill, SHAPE_DEFS, shapeOf, showsTile, typeColor } from '../../src/core/look.ts'
import { loadState } from '../../src/node/files.ts'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))

/**
 * What the native renderer (desktop/Flowy.Core/Look.cs, generated LookData.cs) must say about shapes, colours and icons: the tables
 * themselves, and what each object of the look case resolves to.
 */
export async function dumpLook(): Promise<unknown> {
  const state = await loadState(join(root, 'desktop/fixtures/cases/look/flowy'))
  if ('parseError' in state) throw new Error('the look case can\'t be read')
  const model = state.model
  return {
    shapes: SHAPE_DEFS,
    colors: COLORS,
    icons: ICONS,
    iconGroups: ICON_GROUPS,
    customIcons: customIcons(model.meta),
    objects: Object.entries(model.objects).map(([id, o]) => ({
      id,
      shape: shapeOf(o),
      tile: showsTile(o),
      typeColor: typeColor(o),
      pair: colorPair(o.color) ?? null,
      fillOpacity: fillOpacity(o),
      onFill: onFill(o) ?? null,
      icon: iconData(model, o),
    })),
  }
}
