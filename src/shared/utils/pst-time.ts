/**
 * PST/PDT Time Utilities
 * Provides functions for working with Pacific Time (automatically handles DST)
 */

/**
 * Get current time in Pacific Time as ISO string with offset
 * Returns format like: "2025-10-09T15:36:05.572-08:00" (PST) or "2025-10-09T15:36:05.572-07:00" (PDT)
 */
export function getPstTimestamp(): string {
	const date = new Date();
	return convertToPstIso(date);
}

/**
 * Convert a Date object to Pacific Time ISO string
 */
export function convertToPstIso(date: Date): string {
    try {
        // Validate input
        if (!(date instanceof Date) || isNaN(date.getTime())) {
            console.warn('[PST-TIME] Invalid date, using current time');
            date = new Date();
        }

        const pstDateTimeFormat = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3,
            hour12: false,
        });

        const parts = pstDateTimeFormat.formatToParts(date);
        const partsMap = new Map<string, string>();

        for (const part of parts) {
            if (part.type !== 'literal') {
                partsMap.set(part.type, part.value);
            }
        }

        // Validate required parts
        const required = ['year', 'month', 'day', 'hour', 'minute', 'second', 'fractionalSecond'];
        for (const part of required) {
            if (!partsMap.has(part)) {
                throw new Error(`Missing part: ${part}`);
            }
        }

        // Calculate offset
        const pstDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
        const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
        const offsetMinutes = (utcDate.getTime() - pstDate.getTime()) / (1000 * 60);
        const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
        const offsetSign = offsetMinutes <= 0 ? '+' : '-';
        const offsetString = `${offsetSign}${String(offsetHours).padStart(2, '0')}:00`;

        return `${partsMap.get('year')}-${partsMap.get('month')}-${partsMap.get('day')}T${partsMap.get('hour')}:${partsMap.get('minute')}:${partsMap.get('second')}.${partsMap.get('fractionalSecond')}${offsetString}`;
    } catch (error) {
        console.error('[PST-TIME] Error, falling back to UTC:', error);
        return date.toISOString();
    }
}

/**
 * Format PST timestamp for use in filenames
 * Converts "2025-10-09T15:36:05.572-08:00" to "2025-10-09T15-36-05-572-PST"
 */
export function formatPstForFilename(timestamp: string): string {
	// Remove the timezone offset part and replace special characters
	const withoutOffset = timestamp.split(/[+-]\d{2}:\d{2}$/)[0];
	const formatted = withoutOffset.replace(/[:.]/g, '-');
	return `${formatted}-PST`;
}

/**
 * Format a PST ISO string for display in reports
 * Adds "Pacific Time" label for clarity
 */
export function formatPstForDisplay(timestamp: string): string {
	// Check if it's PST (-08:00) or PDT (-07:00)
	const isPst = timestamp.includes('-08:00');
	const isPdt = timestamp.includes('-07:00');
	const tzLabel = isPst ? 'PST' : isPdt ? 'PDT' : 'PT';

	// Return the timestamp with timezone label
	return `${timestamp} (${tzLabel})`;
}

/**
 * Convert a stored_at timestamp (could be UTC or PST) to PST for display
 */
export function convertStoredTimestampToPst(timestamp: string): string {
	const date = new Date(timestamp);
	return convertToPstIso(date);
}
