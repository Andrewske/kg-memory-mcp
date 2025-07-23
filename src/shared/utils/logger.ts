import fs from "node:fs/promises";
import path from "node:path";

// Result type for error handling
export type LoggerResult<T> =
	| { success: true; data: T }
	| { success: false; error: LoggerError };

export type LoggerError = {
	type: "FILE_ERROR" | "VALIDATION_ERROR" | "PROCESSING_ERROR";
	message: string;
	cause?: unknown;
};

export type LogEntry = {
	timestamp: string;
	component: string;
	message: string;
	error?: any;
};

export type LoggerState = {
	readonly logDir: string;
	readonly errorLog: string;
	readonly infoLog: string;
	readonly debugLog: string;
	readonly isInitialized: boolean;
};

export type LoggerConfig = {
	logDir?: string;
	enableDebug?: boolean;
};

// Pure utility functions
export const createLoggerState = (config: LoggerConfig = {}): LoggerState => {
	const logDir = config.logDir || process.env.KG_LOG_DIR || "./logs";
	return {
		logDir,
		errorLog: path.join(logDir, "errors.jsonl"),
		infoLog: path.join(logDir, "info.jsonl"),
		debugLog: path.join(logDir, "debug.jsonl"),
		isInitialized: false,
	};
};

const createLogEntry = (
	component: string,
	message: string,
	error?: any,
): LogEntry => ({
	timestamp: new Date().toISOString(),
	component,
	message,
	error: error
		? {
				message: error.message || String(error),
				stack: error.stack,
				...error,
			}
		: undefined,
});

const formatLogMessage = (component: string, message: string): string =>
	`[${component}] ${message}`;

// Core logging operations
export const initializeLogger = async (
	state: LoggerState,
	logDir?: string,
): Promise<LoggerResult<LoggerState>> => {
	try {
		const actualLogDir = logDir || state.logDir;
		await fs.mkdir(actualLogDir, { recursive: true });

		const newState: LoggerState = {
			logDir: actualLogDir,
			errorLog: path.join(actualLogDir, "errors.jsonl"),
			infoLog: path.join(actualLogDir, "info.jsonl"),
			debugLog: path.join(actualLogDir, "debug.jsonl"),
			isInitialized: true,
		};

		return { success: true, data: newState };
	} catch (error) {
		return {
			success: false,
			error: {
				type: "FILE_ERROR",
				message: "Failed to initialize logger directory",
				cause: error,
			},
		};
	}
};

export const logError = async (
	state: LoggerState,
	component: string,
	message: string,
	error?: any,
): Promise<LoggerResult<void>> => {
	const entry = createLogEntry(component, message, error);
	const formattedMessage = formatLogMessage(component, message);

	// Always write to file if initialized
	if (!state.isInitialized) {
		return { success: true, data: undefined };
	}

	try {
		await fs.appendFile(state.errorLog, JSON.stringify(entry) + "\n");
		return { success: true, data: undefined };
	} catch (writeError) {
		// Skip console logging in MCP stdio mode
		return {
			success: false,
			error: {
				type: "FILE_ERROR",
				message: "Failed to write to error log",
				cause: writeError,
			},
		};
	}
};

export const logInfo = async (
	state: LoggerState,
	component: string,
	message: string,
): Promise<LoggerResult<void>> => {
	const entry = createLogEntry(component, message);

	// Always write to file if initialized
	if (!state.isInitialized) {
		return { success: true, data: undefined };
	}

	try {
		await fs.appendFile(state.infoLog, JSON.stringify(entry) + "\n");
		return { success: true, data: undefined };
	} catch (writeError) {
		return {
			success: false,
			error: {
				type: "FILE_ERROR",
				message: "Failed to write to info log",
				cause: writeError,
			},
		};
	}
};

export const logDebug = async (
	state: LoggerState,
	component: string,
	message: string,
): Promise<LoggerResult<void>> => {
	if (!process.env.DEBUG) {
		return { success: true, data: undefined };
	}

	const entry = createLogEntry(component, message);

	// Always write to file if initialized
	if (!state.isInitialized) {
		return { success: true, data: undefined };
	}

	try {
		await fs.appendFile(state.debugLog, JSON.stringify(entry) + "\n");
		return { success: true, data: undefined };
	} catch (writeError) {
		return {
			success: false,
			error: {
				type: "FILE_ERROR",
				message: "Failed to write to debug log",
				cause: writeError,
			},
		};
	}
};

// Higher-order function for creating logger operations
export const createLoggerOperations = (config: LoggerConfig = {}) => {
	let state = createLoggerState(config);

	return {
		// Initialize
		initialize: async (logDir?: string): Promise<LoggerResult<void>> => {
			const result = await initializeLogger(state, logDir);
			if (!result.success) {
				return { success: false, error: result.error };
			}
			state = result.data;
			return { success: true, data: undefined };
		},

		// Core operations
		logError: (component: string, message: string, error?: any) =>
			logError(state, component, message, error),

		logInfo: (component: string, message: string) =>
			logInfo(state, component, message),

		logDebug: (component: string, message: string) =>
			logDebug(state, component, message),

		// State inspection
		getState: () => state,
		isInitialized: () => state.isInitialized,
	};
};
