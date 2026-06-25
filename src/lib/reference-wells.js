// Wells held out as the n-shot reference pool. They are NEVER classified by the
// demo — the well selector excludes them (see src/routes/api/wells/+server.js) —
// so every playable well is genuinely unseen and the train/test split is
// leakage-free. The scaler and KNN library are built from ONLY these wells
// (scripts/build-scaler.js, scripts/build-knn-library.js).
//
// F-10 is drilling-rich, F-4 is not-drilling-rich, so pooling the two gives both
// classes ample unanimous windows. Earlier the references were sampled from
// across all wells (the bundled volve_drilling/volve_not_drilling CSVs), which
// leaked reference rows into the very wells being classified.
export const REFERENCE_WELLS = [
	'Norway-StatoilHydro-15_$47$_9-F-10.csv',
	'Norway-StatoilHydro-15_$47$_9-F-4.csv'
];

// ACTC activity codes → class. Drilling = bit on bottom, rotating, deepening.
export const ACTC_DRILLING = ['1', '2'];
export const ACTC_NOT_DRILLING = ['3', '4', '8', '9'];
