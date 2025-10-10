export const EXTRACTION_STAGES = {
	ENTITY_ENTITY: "ENTITY_ENTITY",
	ENTITY_EVENT: "ENTITY_EVENT",
	EVENT_EVENT: "EVENT_EVENT",
	EMOTIONAL_CONTEXT: "EMOTIONAL_CONTEXT",
} as const;

export type ExtractionStage =
	(typeof EXTRACTION_STAGES)[keyof typeof EXTRACTION_STAGES];

export function isValidExtractionStage(
	value: unknown,
): value is ExtractionStage {
	if (typeof value !== "string") return false;
	return Object.values(EXTRACTION_STAGES).includes(
		value as ExtractionStage,
	);
}

export function getValidExtractionStage(
	value: unknown,
): ExtractionStage | null {
	return isValidExtractionStage(value) ? value : null;
}
