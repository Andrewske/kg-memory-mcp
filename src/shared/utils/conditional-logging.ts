/**
 * Conditional logging utilities
 * Only logs debug messages when LOG_LEVEL is DEBUG or lower
 */

import { env } from '~/shared/env.js';

const DEBUG_ENABLED = ['DEBUG', 'TRACE'].includes(env.LOG_LEVEL);

/**
 * Debug logging that only runs when DEBUG mode is enabled
 * This prevents the overhead of string formatting and console calls in production
 */
export function debugLog(message: string, data?: any) {
	if (DEBUG_ENABLED) {
		if (data !== undefined) {
			console.debug(message, data);
		} else {
			console.debug(message);
		}
	}
}

/**
 * Info logging (always enabled unless LOG_LEVEL is ERROR/WARN only)
 */
export function infoLog(message: string, data?: any) {
	if (!['ERROR', 'WARN'].includes(env.LOG_LEVEL)) {
		if (data !== undefined) {
			console.log(message, data);
		} else {
			console.log(message);
		}
	}
}

/**
 * Warning logging (always enabled unless LOG_LEVEL is ERROR only)
 */
export function warnLog(message: string, data?: any) {
	if (env.LOG_LEVEL !== 'ERROR') {
		if (data !== undefined) {
			console.warn(message, data);
		} else {
			console.warn(message);
		}
	}
}

/**
 * Error logging (always enabled)
 */
export function errorLog(message: string, data?: any) {
	if (data !== undefined) {
		console.error(message, data);
	} else {
		console.error(message);
	}
}

/**
 * Performance logging - special case for development performance analysis
 * Only enabled in DEBUG/TRACE mode
 */
export function perfLog(message: string, data?: any) {
	if (DEBUG_ENABLED) {
		if (data !== undefined) {
			console.debug(`🚀 ${message}`, data);
		} else {
			console.debug(`🚀 ${message}`);
		}
	}
}

/**
 * Check if debug logging is enabled
 */
export function isDebugEnabled(): boolean {
	return DEBUG_ENABLED;
}
