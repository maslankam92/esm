/* eslint-disable sort-keys */
const ENTRY = {
  ERROR_GETTER: {},
  ERROR_STAR: {},
  LOAD_INDETERMINATE: -1,
  LOAD_INCOMPLETE: 0,
  LOAD_COMPLETED: 1,
  UPDATE_TYPE_INIT: 1,
  UPDATE_TYPE_LIVE: 2,
  SETTER_TYPE_DYNAMIC_IMPORT: 1,
  SETTER_TYPE_EXPORT_FROM: 2,
  SETTER_TYPE_NAMESPACE: 3,
  SETTER_TYPE_STATIC_IMPORT: 4,
  STATE_INITIAL: 0,
  STATE_PARSING_STARTED: 1,
  STATE_PARSING_COMPLETED: 2,
  STATE_INSTANTIATION_STARTED: 3,
  STATE_INSTANTIATION_COMPLETED: 4,
  STATE_EXECUTION_STARTED: 5,
  STATE_EXECUTION_COMPLETED: 6,
  TYPE_CJS: 1,
  TYPE_ESM: 2,
  TYPE_PSEUDO: 3,
  TYPE_WASM: 4
}

export default ENTRY
