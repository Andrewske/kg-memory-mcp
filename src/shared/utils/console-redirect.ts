import fs from 'node:fs';
import path from 'node:path';

/**
 * Redirects console output to log files when running as MCP server
 * This prevents console output from interfering with stdio JSON-RPC protocol
 */
export function redirectConsoleToFiles(logDir: string = './logs') {
	// Ensure log directory exists
	fs.mkdirSync(logDir, { recursive: true });

	// Create write streams for different log levels
	const infoStream = fs.createWriteStream(path.join(logDir, 'console.log'), {
		flags: 'a',
	});
	const errorStream = fs.createWriteStream(path.join(logDir, 'console-error.log'), { flags: 'a' });

	// Save original console methods
	const originalConsoleLog = console.log;
	const originalConsoleError = console.error;
	const originalConsoleWarn = console.warn;
	const originalConsoleDebug = console.debug;

	// Helper to format log entries
	const formatLogEntry = (level: string, args: any[]) => {
		const timestamp = new Date().toISOString();
		const message = args
			.map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
			.join(' ');
		return `[${timestamp}] [${level}] ${message}\n`;
	};

	// Override console.log
	console.log = (...args: any[]) => {
		const entry = formatLogEntry('INFO', args);
		infoStream.write(entry);
	};

	// Override console.error
	console.error = (...args: any[]) => {
		const entry = formatLogEntry('ERROR', args);
		errorStream.write(entry);
	};

	// Override console.warn
	console.warn = (...args: any[]) => {
		const entry = formatLogEntry('WARN', args);
		infoStream.write(entry);
	};

	// Override console.debug
	console.debug = (...args: any[]) => {
		if (process.env.DEBUG) {
			const entry = formatLogEntry('DEBUG', args);
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
