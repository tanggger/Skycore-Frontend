export type ConflictSource = 'physical' | 'explicit' | 'geometric' | 'none'

// Frontend display thresholds are intentionally stricter than raw radio-alert thresholds.
// This avoids painting the whole swarm red in Hard mode and keeps dynamic/static differences visible.
export const SINR_CONFLICT_THRESHOLD_DB = 6
export const INTERFERENCE_CONFLICT_THRESHOLD_DBM = -75
export const GEOMETRIC_CONFLICT_DISTANCE_M = 18

interface ConflictInputs {
  sinr?: number
  interference?: number
  explicitConflict?: boolean
  sameChannelNearby?: boolean
}

export function resolveConflictState({
  sinr,
  interference,
  explicitConflict,
  sameChannelNearby = false,
}: ConflictInputs): { isConflict: boolean; source: ConflictSource } {
  if (sinr !== undefined && sinr !== null) {
    return {
      isConflict: Number(sinr) < SINR_CONFLICT_THRESHOLD_DB,
      source: 'physical',
    }
  }

  if (interference !== undefined && interference !== null) {
    return {
      isConflict: Number(interference) > INTERFERENCE_CONFLICT_THRESHOLD_DBM,
      source: 'physical',
    }
  }

  if (explicitConflict !== undefined) {
    return {
      isConflict: Boolean(explicitConflict),
      source: 'explicit',
    }
  }

  if (sameChannelNearby) {
    return {
      isConflict: true,
      source: 'geometric',
    }
  }

  return {
    isConflict: false,
    source: 'none',
  }
}
