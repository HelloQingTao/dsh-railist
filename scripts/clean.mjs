/** Remove build output. Kept separate from tsdown because tsdown must never
 *  wipe `lib/types` (tsc's declaration output) mid-pipeline. */
import { rm } from 'node:fs/promises'

await rm(new URL('../lib', import.meta.url), { recursive: true, force: true })
