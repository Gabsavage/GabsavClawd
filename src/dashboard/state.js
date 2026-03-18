import { EventEmitter } from 'events';

export const emitter = new EventEmitter();
emitter.setMaxListeners(30);

export const state = {
  cycleLog: [],
  pendingLaunches: [],
  running: new Set(), // flux types currently running
};

export const triggers = {
  perplexity: null,
  flux2: null,
  flux3: null,
};

export function signalCycleStart(type) {
  state.running.add(type);
  emitter.emit('cycle_start', { type });
}

export function pushCycleEntry(entry) {
  state.running.delete(entry.type);
  state.cycleLog.unshift(entry);
  if (state.cycleLog.length > 20) state.cycleLog.length = 20;
  emitter.emit('cycle_update', { entry, log: state.cycleLog });
}

export function syncPendingLaunches(launches) {
  state.pendingLaunches = [...launches];
  emitter.emit('launches_update', state.pendingLaunches);
}

export function emitNewConcept(concept) {
  emitter.emit('new_concept', concept);
}
