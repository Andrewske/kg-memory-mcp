import fs from 'node:fs';
import path from 'node:path';
import { env } from '~/shared/config/env.js';

// Log levels
const LOG_LEVELS = {
	ERROR: 0,
	WARN: 1,
	INFO: 2,
	DEBUG: 3,
	TRACE: 4,
} as const;

const currentLevel = LOG_LEVELS[env.LOG_LEVEL] ?? LOG_LEVELS.INFO;

/**
 * Redirects console output to log files when running as MCP server
 * This prevents console output from interfering with stdio JSON-RPC protocol
 */
export function redirectConsoleToFiles(logDir: string = './logs') {
	// Ensure log directory exists
	fs.mkdirSync(logDir, { recursive: true });

	// Use timestamped files to avoid conflicts
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const logFile = path.join(logDir, `mcp-${timestamp}.log`);
	const errorFile = path.join(logDir, `mcp-error-${timestamp}.log`);

	// Create write streams for different log levels
	const infoStream = fs.createWriteStream(logFile, { flags: 'a' });
	const errorStream = fs.createWriteStream(errorFile, { flags: 'a' });

	// Create symlinks for easy access
	try {
		const latest = path.join(logDir, 'latest.log');
		const latestError = path.join(logDir, 'latest-error.log');
		if (fs.existsSync(latest)) fs.unlinkSync(latest);
		if (fs.existsSync(latestError)) fs.unlinkSync(latestError);
		fs.symlinkSync(path.basename(logFile), latest);
		fs.symlinkSync(path.basename(errorFile), latestError);
	} catch {
		// Symlink creation might fail on some systems, ignore
	}

	// Save original console methods
	const originalConsoleLog = console.log;
	const originalConsoleError = console.error;
	const originalConsoleWarn = console.warn;
	const originalConsoleDebug = console.debug;

	// Helper to format log entries
	const formatLogEntry = (level: string, args: any[]) => {
		const timestamp = new Date().toISOString();
		const message = args
			.map(arg => {
				if (arg instanceof Error) {
					return env.LOG_STACK_TRACE ? `${arg.message}\n${arg.stack}` : arg.message;
				}
				return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
			})
			.join(' ');
		return `[${timestamp}] [${level}] ${message}\n`;
	};

	// Override console.log
	console.log = (...args: any[]) => {
		if (currentLevel >= LOG_LEVELS.INFO) {
			const entry = formatLogEntry('INFO', args);
			infoStream.write(entry);
		}
	};

	// Override console.error
	console.error = (...args: any[]) => {
		if (currentLevel >= LOG_LEVELS.ERROR) {
			const entry = formatLogEntry('ERROR', args);
			errorStream.write(entry);
			// Also write errors to stderr for debugging
			if (env.LOG_TO_STDERR && process.stderr) {
				process.stderr.write(entry);
			}
		}
	};

	// Override console.warn
	console.warn = (...args: any[]) => {
		if (currentLevel >= LOG_LEVELS.WARN) {
			const entry = formatLogEntry('WARN', args);
			infoStream.write(entry);
		}
	};

	// Override console.debug
	console.debug = (...args: any[]) => {
		if (currentLevel >= LOG_LEVELS.DEBUG) {
			const entry = formatLogEntry('DEBUG', args);
			infoStream.write(entry);
		}
	};

	// Add trace method for very detailed logging
	(console as any).trace = (...args: any[]) => {
		if (currentLevel >= LOG_LEVELS.TRACE) {
			const entry = formatLogEntry('TRACE', args);
			infoStream.write(entry);
		}
	};

	// Return function to restore original console
	return () => {
		console.log = originalConsoleLog;
		console.error = originalConsoleError;
		console.warn = originalConsoleWarn;
		console.debug = originalConsoleDebug;
		infoStream.end();
		errorStream.end();
	};
}
