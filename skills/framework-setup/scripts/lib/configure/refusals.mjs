/**
 * A revision that is refused, carrying the reason code a caller reports it by.
 * Every refusal is decided before anything is written.
 */
export const revisionRefusal = (reasonCode, message) => Object.assign(new Error(message), { reasonCode });
