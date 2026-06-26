// ===== Tool / object-type registry =====
// Every annotation kind is a self-contained module that registers ONE
// descriptor here. This is the contract fan-out tool modules implement.
// See CONTRACT.md for the full interface documentation.

export const tools = new Map();   // id -> descriptor (has .tool: creation state machine)
export const types = new Map();   // kind -> type handler (draw/hit/edit existing objects)

// descriptor = {
//   id, hotkey, icon, label, group(1|2|3),
//   isDimension?: boolean,
//   tool: ToolBehaviour,         // creation state machine (see CONTRACT.md)
//   type: TypeBehaviour,         // existing-object behaviour (kind === id unless `kinds`)
//   kinds?: string[],            // extra object kinds this module's `type` serves
// }
export function register(desc) {
  tools.set(desc.id, desc);
  if (desc.type) {
    types.set(desc.id, desc.type);
    for (const k of desc.kinds || []) types.set(k, desc.type);
  }
}

export function toolList() {
  return [...tools.values()];
}

export function typeFor(kind) {
  return types.get(kind);
}
