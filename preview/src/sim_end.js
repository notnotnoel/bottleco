const API = { N, DAYS, START, IDEAL, LNAME, LID, FAULTS, PLANNED, DEFECTS, SKUS, BAY, SHIFTS, STORY, SEED, SLIDERS, KPIS, KEYS, PLAIN, T, dt, hhmm, dlabel, full, dayOf, shiftOf, clamp, build, prep, defaults, kv, scan, rangeStats, isBreach, fmtKpi, ws, pace30, mins };
Object.assign(API, { HYP, ORDER, PLAYBOOK, rcaCore, rcaIncident, similarPast, lensesFor, onsetOf, normalAt, num, pctS });
if (typeof reportFor !== 'undefined') Object.assign(API, { reportFor, slowKv, fillText });
if (typeof analysisFor !== 'undefined') Object.assign(API, { analysisFor, triangulate });
if (typeof answer !== 'undefined') Object.assign(API, { answer, SAMPLE_Q, pastText });
root.BottleSim = API; if (typeof module !== 'undefined' && module.exports) module.exports = API;
